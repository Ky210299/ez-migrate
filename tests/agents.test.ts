import { afterEach, describe, expect, it } from "vitest";

import { createProject, Dialect, DIALECTS, Project } from "./helpers";

const USERS_UP = "CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR(50));";
const USERS_DOWN = "DROP TABLE users;";
const POSTS_UP = "CREATE TABLE posts (id INTEGER PRIMARY KEY);";
const POSTS_DOWN = "DROP TABLE posts;";

const projects: Array<Project> = [];
function project(dialect: Dialect) {
    const p = createProject(dialect);
    projects.push(p);
    return p;
}
afterEach(async () => {
    while (projects.length) await projects.pop()!.cleanup();
});

/** stdout of a run is the JSON; logs of the config go to stderr, so parse from the first "{" */
function json(output: string) {
    return JSON.parse(output.slice(output.indexOf("{")));
}

describe.each(DIALECTS)("output for scripts and AI agents [%s]", (dialect) => {
    it("status --json lists migrations and seeds with their state", async () => {
        const p = project(dialect);
        p.addMigration("users", USERS_UP, USERS_DOWN);
        expect(p.run("migrate").code).toBe(0);
        p.addMigration("posts", POSTS_UP, POSTS_DOWN);
        p.addSeed("ana", "INSERT INTO users (id, name) VALUES (1, 'ana');");

        const r = p.run("status", "--json");
        expect(r.code, r.output).toBe(0);
        const status = json(r.output);
        expect(status.migrations.map((m: { name: string, state: string }) => [m.name, m.state]))
            .toEqual([["users.sql", "applied"], ["posts.sql", "pending"]]);
        expect(status.seeds.map((s: { name: string, state: string }) => [s.name, s.state])).toEqual([["ana.sql", "pending"]]);
        expect(json(p.run("list", "--json").output)).toEqual(status);
    });

    it("migrate --dry-run --json prints the plan as JSON and runs nothing", async () => {
        const p = project(dialect);
        p.addMigration("users", USERS_UP, USERS_DOWN);
        p.addMigration("posts", POSTS_UP, POSTS_DOWN);
        const r = p.run("migrate", "--dry-run", "--json");
        expect(r.code, r.output).toBe(0);
        const plan = json(r.output);
        expect(plan.dryRun).toBe(true);
        expect(plan.steps).toHaveLength(1);
        expect(plan.steps[0].direction).toBe("up");
        expect(plan.steps[0].migrations.map((m: { sql: string }) => m.sql)).toEqual([USERS_UP, POSTS_UP]);
        expect(await p.tables()).toEqual([]);

        expect(p.run("migrate").code).toBe(0);
        const redo = json(p.run("redo", "--dry-run", "--json").output);
        expect(redo.steps.map((s: { direction: string }) => s.direction)).toEqual(["down", "up"]);
        expect(redo.steps[0].migrations[0].sql).toBe(POSTS_DOWN);
    });

    it("--json without --dry-run fails and runs nothing", () => {
        const p = project(dialect);
        p.addMigration("users", USERS_UP, USERS_DOWN);
        const r = p.run("migrate", "--json");
        expect(r.code).toBe(1);
        expect(r.output).toContain("--json only works with --dry-run");
        // It fails before connecting: the migration is still pending
        expect(json(p.run("status", "--json").output).migrations[0].state).toBe("pending");
    });

    it("schema prints the current schema without data or ez-migrate tables", async () => {
        const p = project(dialect);
        p.addMigration("users", USERS_UP, USERS_DOWN);
        p.addSeed("ana", "INSERT INTO users (id, name) VALUES (1, 'secret-row');");
        expect(p.run("migrate").code).toBe(0);
        expect(p.run("seed").code).toBe(0);

        const r = p.run("schema");
        expect(r.code, r.output).toBe(0);
        expect(r.output).toMatch(/CREATE TABLE \S*users/i);
        expect(r.output).not.toContain("ez_migration");
        expect(r.output).not.toContain("secret-row");

        const schema = json(p.run("schema", "--json").output);
        expect(schema.dialect).toBe(dialect);
        expect(schema.tables).toEqual(["users"]);
        expect(schema.sql).toMatch(/CREATE TABLE \S*users/i);
        // Read only: nothing was written or recorded
        expect(await p.tracked()).toHaveLength(1);
    });

    it("check passes on good files", () => {
        const p = project(dialect);
        p.addMigration("users", USERS_UP, USERS_DOWN);
        p.addSeed("ana", "INSERT INTO users (id, name) VALUES (1, 'ana');");
        const r = p.run("check");
        expect(r.code, r.output).toBe(0);
        expect(r.output).toContain("No problems found in 2 files");
    });

    it("check finds secrets without printing them, and fails", () => {
        const p = project(dialect);
        p.addMigration("users", `${USERS_UP}\n-- deploy key AKIAABCDEFGHIJKLMNOP`, USERS_DOWN);
        p.addSeed("ana", "-- conn postgres://admin:Sup3rS3cret@db.example.com/app\nINSERT INTO users (id) VALUES (1);");
        p.addSeed("bob", "INSERT INTO users (id) VALUES (2); -- AKIAABCDEFGHIJKLMNOP ez-migrate-allow-secret");

        const r = p.run("check", "--json");
        expect(r.code).toBe(1);
        expect(r.output).not.toContain("AKIAABCDEFGHIJKLMNOP");
        expect(r.output).not.toContain("Sup3rS3cret");
        const result = json(r.output);
        expect(result.ok).toBe(false);
        expect(result.problems.map((x: { rule: string, line: number }) => [x.rule, x.line])).toEqual([["secret", 3], ["secret", 1]]);
    });

    it("check finds DML in migrations, DDL in seeds and destructive statements", () => {
        const p = project(dialect);
        p.addMigration("users", USERS_UP, USERS_DOWN);
        p.addMigration("insert", "INSERT INTO users (id) VALUES (1);", "DELETE FROM users;");
        p.addMigration("drop", "DROP TABLE users;", USERS_UP);
        p.addSeed("ddl", "CREATE TABLE x (id INTEGER);");

        const r = p.run("check", "--json");
        expect(r.code).toBe(1);
        const rules = json(r.output).problems.map((x: { rule: string, level: string }) => `${x.level} ${x.rule}`);
        expect(rules).toEqual(["error dml-in-migration", "warning destructive", "error ddl-in-seed"]);
    });

    it("check fails on warnings only with --strict", () => {
        const p = project(dialect);
        p.addMigration("users", USERS_UP, USERS_DOWN);
        p.addMigration("drop", "ALTER TABLE users DROP COLUMN name;", "ALTER TABLE users ADD COLUMN name VARCHAR(50);");
        const r = p.run("check");
        expect(r.code, r.output).toBe(0);
        expect(r.output).toContain("warning destructive: The up section has DROP COLUMN");
        expect(p.run("check", "--strict").code).toBe(1);
    });
});

describe("check [mysql]", () => {
    it("warns about migrations that are not atomic", () => {
        const p = project("mysql");
        p.addMigration("two", `${USERS_UP}\n${POSTS_UP}`, `${POSTS_DOWN}\n${USERS_DOWN}`);
        const r = p.run("check");
        expect(r.code, r.output).toBe(0);
        expect(r.output).toContain("warning not-atomic");
    });
});
