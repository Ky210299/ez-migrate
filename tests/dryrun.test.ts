import { afterEach, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";

import { createProject, Dialect, DIALECTS, Project } from "./helpers";

const USERS_UP = "CREATE TABLE users (id INTEGER PRIMARY KEY);";
const USERS_DOWN = "DROP TABLE users;";
const POSTS_UP = "CREATE TABLE posts (id INTEGER PRIMARY KEY);";
const POSTS_DOWN = "DROP TABLE posts;";
/** Two statements: on MySQL each one is committed on its own */
const TWO_UP = "CREATE TABLE a (id INTEGER PRIMARY KEY);\nCREATE TABLE b (id INTEGER PRIMARY KEY);";
const TWO_DOWN = "DROP TABLE b;\nDROP TABLE a;";

const projects: Array<Project> = [];
function project(dialect: Dialect) {
    const p = createProject(dialect);
    projects.push(p);
    return p;
}
afterEach(async () => {
    while (projects.length) await projects.pop()!.cleanup();
});

describe.each(DIALECTS)("--dry-run [%s]", (dialect) => {
    it("migrate prints the SQL of the pending migrations and runs nothing", async () => {
        const p = project(dialect);
        p.addMigration("users", USERS_UP, USERS_DOWN);
        p.addMigration("posts", POSTS_UP, POSTS_DOWN);
        const r = p.run("migrate", "--dry-run");
        expect(r.code, r.output).toBe(0);
        expect(r.output).toContain("2 migrations would be applied");
        expect(r.output).toMatch(/users\.sql \(up\)\nCREATE TABLE users[\s\S]*posts\.sql \(up\)\nCREATE TABLE posts/);
        expect(await p.tables()).toEqual([]);
        expect(await p.tracked()).toEqual([]);
    });

    it("migrate shows only what is pending", async () => {
        const p = project(dialect);
        p.addMigration("users", USERS_UP, USERS_DOWN);
        expect(p.run("migrate").code).toBe(0);
        p.addMigration("posts", POSTS_UP, POSTS_DOWN);
        const r = p.run("migrate", "--dry-run");
        expect(r.output).toContain("1 migration would be applied");
        expect(r.output).not.toContain("CREATE TABLE users");
        expect(p.run("migrate").code).toBe(0);
        expect(p.run("migrate", "--dry-run").output).toContain("no migration would be applied");
    });

    it("up prints only the next migration", async () => {
        const p = project(dialect);
        p.addMigration("users", USERS_UP, USERS_DOWN);
        p.addMigration("posts", POSTS_UP, POSTS_DOWN);
        const r = p.run("up", "--dry-run");
        expect(r.code, r.output).toBe(0);
        expect(r.output).toContain("CREATE TABLE users");
        expect(r.output).not.toContain("CREATE TABLE posts");
        expect(await p.tables()).toEqual([]);
    });

    it("down and rollback print the saved down SQL and revert nothing", async () => {
        const p = project(dialect);
        p.addMigration("users", USERS_UP, USERS_DOWN);
        p.addMigration("posts", POSTS_UP, POSTS_DOWN);
        expect(p.run("migrate").code).toBe(0);

        const down = p.run("down", "--dry-run");
        expect(down.code, down.output).toBe(0);
        expect(down.output).toContain("1 migration would be reverted");
        expect(down.output).toContain("DROP TABLE posts");
        expect(down.output).not.toContain("DROP TABLE users");

        const rollback = p.run("rollback", "--dry-run");
        expect(rollback.code, rollback.output).toBe(0);
        expect(rollback.output).toMatch(/posts\.sql \(down\)\nDROP TABLE posts[\s\S]*users\.sql \(down\)\nDROP TABLE users/);

        expect((await p.tables()).sort()).toEqual(["posts", "users"]);
        expect(await p.tracked()).toHaveLength(2);
    });

    it("fails like the real run when an applied migration changed", async () => {
        const p = project(dialect);
        const file = p.addMigration("users", USERS_UP, USERS_DOWN);
        expect(p.run("migrate").code).toBe(0);
        writeFileSync(file, `-- ez-migration-up\nCREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR(10));\n-- ez-migration-up\n-- ez-migration-down\n${USERS_DOWN}\n-- ez-migration-down\n`);
        const r = p.run("migrate", "--dry-run");
        expect(r.code).toBe(1);
        expect(r.output).toContain("Applied migrations changed");
    });

    it("never logs the SQL, it only prints it as the command output", () => {
        const p = project(dialect);
        p.addMigration("users", USERS_UP, USERS_DOWN);
        const r = p.run("migrate", "--dry-run", "--log-format", "json", "--verbose");
        const logLines = r.output.split("\n").filter(l => l.startsWith("{"));
        expect(logLines.length).toBeGreaterThan(0);
        expect(logLines.join("\n")).not.toContain("CREATE TABLE");
    });
});

describe.each(DIALECTS)("Migrations with several statements [%s]", (dialect) => {
    const warns = dialect === "mysql";

    it(warns ? "warns that the migration is not atomic" : "doesn't warn: the migration is atomic", () => {
        const p = project(dialect);
        p.addMigration("two", TWO_UP, TWO_DOWN);
        const r = p.run("migrate");
        expect(r.code, r.output).toBe(0);
        expect(r.output.includes("is not atomic")).toBe(warns);
        expect(p.run("migrate", "--dry-run").code).toBe(0);
        const dry = p.run("down", "--dry-run");
        expect(dry.output.includes("Not atomic. It has 2 statements")).toBe(warns);
    });

    it("doesn't warn for one statement", () => {
        const p = project(dialect);
        p.addMigration("users", USERS_UP, USERS_DOWN);
        expect(p.run("migrate").output).not.toContain("not atomic");
    });

    it("doesn't count semicolons inside strings and comments", () => {
        const p = project(dialect);
        p.addMigration("users", "-- one; two;\nCREATE TABLE users (id INTEGER PRIMARY KEY, note VARCHAR(10) DEFAULT 'a;b');", USERS_DOWN);
        const r = p.run("migrate");
        expect(r.code, r.output).toBe(0);
        expect(r.output).not.toContain("not atomic");
    });

    it("says what to do when a statement fails", async () => {
        const p = project(dialect);
        p.addMigration("broken", "CREATE TABLE a (id INTEGER PRIMARY KEY);\nCREATE TABLE a (id INTEGER PRIMARY KEY);", "DROP TABLE a;");
        const r = p.run("migrate");
        expect(r.code).toBe(1);
        expect(r.output).toContain("Migration");
        expect(r.output.includes("undo them by hand")).toBe(warns);
        // MySQL keeps the first table, the others roll back the whole migration
        expect(await p.tables()).toEqual(warns ? ["a"] : []);
        expect(await p.tracked()).toEqual([]);
    });
});
