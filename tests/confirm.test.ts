import { afterEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";

import { createProject, Dialect, DIALECTS, Project } from "./helpers";

const USERS_UP = "CREATE TABLE users (id INTEGER PRIMARY KEY);";
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

describe.each(DIALECTS)("confirmation at the terminal [%s]", (dialect) => {
    it("migrate shows the plan and runs nothing if the answer is no", async () => {
        const p = project(dialect);
        p.addMigration("users", USERS_UP, USERS_DOWN);
        const r = await p.runInTerminal(["migrate"], { answer: "n" });
        expect(r.asked, r.output).toBe(true);
        expect(r.output).toContain("1 migration will be applied");
        expect(r.output).toContain(USERS_UP);
        expect(r.output).toContain("Cancelled. Nothing was run");
        expect(r.code).toBe(0);
        expect(await p.tables()).toEqual([]);
        expect(await p.tracked()).toEqual([]);
    });

    it("migrate runs the plan if the answer is yes", async () => {
        const p = project(dialect);
        p.addMigration("users", USERS_UP, USERS_DOWN);
        p.addMigration("posts", POSTS_UP, POSTS_DOWN);
        const r = await p.runInTerminal(["migrate"], { answer: "y" });
        expect(r.asked, r.output).toBe(true);
        expect(r.output).toContain("2 migrations will be applied");
        expect(r.code, r.output).toBe(0);
        expect(await p.tables()).toEqual(["posts", "users"]);
    });

    it("doesn't ask with --yes, EZ_MIGRATE_YES=1, \"confirm\": false or CI", async () => {
        const ways: Array<{ args?: Array<string>, env?: Record<string, string>, config?: Record<string, unknown> }> = [
            { args: ["--yes"] },
            { args: ["-y"] },
            { env: { EZ_MIGRATE_YES: "1" } },
            { config: { confirm: false } },
            { env: { CI: "true" } },
        ];
        for (const way of ways) {
            const p = project(dialect);
            p.addMigration("users", USERS_UP, USERS_DOWN);
            if (way.config) p.updateConfig(way.config);
            const r = await p.runInTerminal(["migrate", ...way.args ?? []], { env: way.env });
            expect(r.asked, JSON.stringify(way)).toBe(false);
            expect(r.code, r.output).toBe(0);
            expect(await p.tables()).toEqual(["users"]);
        }
    });

    it("doesn't ask without a terminal (CI, deploys, pipes)", async () => {
        const p = project(dialect);
        p.addMigration("users", USERS_UP, USERS_DOWN);
        const r = p.run("migrate");
        expect(r.output).not.toContain("Run it?");
        expect(r.code, r.output).toBe(0);
        expect(await p.tables()).toEqual(["users"]);
    });

    it("doesn't ask when there is nothing to run", async () => {
        const p = project(dialect);
        const r = await p.runInTerminal(["migrate"]);
        expect(r.asked).toBe(false);
        expect(r.output).toContain("No pending migrations");
        expect(r.code).toBe(0);
    });

    it("runs nothing if the plan changed while the person answered", async () => {
        const p = project(dialect);
        p.addMigration("users", USERS_UP, USERS_DOWN);
        const r = await p.runInTerminal(["migrate"], {
            answer: "y",
            beforeAnswer: () => p.addMigration("posts", POSTS_UP, POSTS_DOWN),
        });
        expect(r.asked).toBe(true);
        expect(r.output).toContain("The migrations to run changed while you answered");
        expect(r.code).toBe(1);
        expect(await p.tables()).toEqual([]);
    });

    it("up, down, rollback, reset and redo ask too, and run nothing if the answer is no", async () => {
        const p = project(dialect);
        p.addMigration("users", USERS_UP, USERS_DOWN);
        expect(p.run("migrate").code).toBe(0);
        p.addMigration("posts", POSTS_UP, POSTS_DOWN);
        const expected: Record<string, string> = {
            up: "1 migration will be applied",
            down: "1 migration will be reverted",
            rollback: "1 migration will be reverted",
            reset: "1 migration will be reverted and 2 applied",
            redo: "1 migration will be reverted and 1 applied",
        };
        for (const [command, plan] of Object.entries(expected)) {
            const r = await p.runInTerminal([command], { answer: "n" });
            expect(r.asked, `${command}: ${r.output}`).toBe(true);
            expect(r.output).toContain(plan);
            expect(r.output).toContain("Cancelled. Nothing was run");
        }
        expect(await p.tables()).toEqual(["users"]);
        expect(await p.tracked()).toHaveLength(1);
    });

    it("redo runs the down and the up after yes", async () => {
        const p = project(dialect);
        p.addMigration("users", USERS_UP, USERS_DOWN);
        expect(p.run("migrate").code).toBe(0);
        await p.query("INSERT INTO users (id) VALUES (1)");
        const r = await p.runInTerminal(["redo"], { answer: "y" });
        expect(r.code, r.output).toBe(0);
        // The table was dropped and created again
        expect(await p.query("SELECT * FROM users")).toEqual([]);
        expect(await p.tracked()).toHaveLength(1);
    });
});

describe.each(DIALECTS)("reset and redo [%s]", (dialect) => {
    it("--dry-run prints the down and the up SQL and runs nothing", async () => {
        const p = project(dialect);
        p.addMigration("users", USERS_UP, USERS_DOWN);
        p.addMigration("posts", POSTS_UP, POSTS_DOWN);
        expect(p.run("migrate").code).toBe(0);

        const reset = p.run("reset", "--dry-run");
        expect(reset.code, reset.output).toBe(0);
        expect(reset.output).toContain("2 migrations would be reverted and 2 applied");
        expect(reset.output.indexOf(POSTS_DOWN)).toBeLessThan(reset.output.indexOf(USERS_DOWN));
        expect(reset.output.indexOf(USERS_DOWN)).toBeLessThan(reset.output.indexOf(USERS_UP));

        const redo = p.run("redo", "--dry-run");
        expect(redo.code, redo.output).toBe(0);
        expect(redo.output).toContain("1 migration would be reverted and 1 applied");
        expect(redo.output).toContain(POSTS_DOWN);
        expect(redo.output).toContain(POSTS_UP);
        expect(redo.output).not.toContain(USERS_DOWN);

        expect(await p.tables()).toEqual(["posts", "users"]);
        expect(await p.tracked()).toHaveLength(2);
    });

    it("redo fails before reverting when the migration file is missing", async () => {
        const p = project(dialect);
        const file = p.addMigration("users", USERS_UP, USERS_DOWN);
        expect(p.run("migrate").code).toBe(0);
        rmSync(file);
        const r = p.run("redo");
        expect(r.code).toBe(1);
        expect(r.output).toMatch(/not found.*nothing was reverted/);
        expect(await p.tables()).toEqual(["users"]);
        expect(await p.tracked()).toHaveLength(1);
    });
});
