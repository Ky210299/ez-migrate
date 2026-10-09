import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { CLI, createProject, DIALECTS, Project } from "./helpers";

const USERS_UP = "CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR(50));";
const USERS_DOWN = "DROP TABLE users;";
const POSTS_UP = "CREATE TABLE posts (id INTEGER PRIMARY KEY, title VARCHAR(50));";
const POSTS_DOWN = "DROP TABLE posts;";
const TAGS_UP = "CREATE TABLE tags (id INTEGER PRIMARY KEY, label VARCHAR(50));";
const TAGS_DOWN = "DROP TABLE tags;";

describe("init", () => {
    it("creates ez-migrate.json with the default config", () => {
        const dir = mkdtempSync(join(tmpdir(), "ezm-init-"));
        try {
            const result = spawnSync(process.execPath, [CLI, "init"], { cwd: dir, encoding: "utf8" });
            expect(result.status).toBe(0);
            const config = JSON.parse(readFileSync(join(dir, "ez-migrate.json"), "utf8"));
            expect(config.dialect).toBe("mysql");
            expect(config.migrationsPath).toBe("./migrations");
            expect(config.seedsPath).toBe("./seeds");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("does not overwrite an existing config", () => {
        const dir = mkdtempSync(join(tmpdir(), "ezm-init-"));
        try {
            spawnSync(process.execPath, [CLI, "init"], { cwd: dir });
            const before = readFileSync(join(dir, "ez-migrate.json"), "utf8");
            const result = spawnSync(process.execPath, [CLI, "init"], { cwd: dir, encoding: "utf8" });
            expect(result.status).toBe(0);
            expect(readFileSync(join(dir, "ez-migrate.json"), "utf8")).toBe(before);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe.each(DIALECTS)("%s", (dialect) => {
    let p: Project;
    beforeEach(() => {
        p = createProject(dialect);
    });
    afterEach(async () => {
        await p.cleanup();
    });

    describe("make", () => {
        it("creates a migration file with the template", () => {
            const r = p.run("make", "create_users");
            expect(r.code).toBe(0);
            const files = readdirSync(join(p.dir, "migrations"));
            expect(files).toHaveLength(1);
            expect(files[0]).toMatch(/-create_users\.sql$/);
            const content = readFileSync(join(p.dir, "migrations", files[0]), "utf8");
            expect(content).toContain("-- ez-migration-up");
            expect(content).toContain("-- ez-migration-down");
        });

        it("creates several migrations in order", () => {
            expect(p.run("make", "first").code).toBe(0);
            expect(p.run("make", "second").code).toBe(0);
            const files = readdirSync(join(p.dir, "migrations")).sort();
            expect(files).toHaveLength(2);
            expect(files[0]).toMatch(/-first\.sql$/);
            expect(files[1]).toMatch(/-second\.sql$/);
        });

        it("creates a seed file with --seed", () => {
            expect(p.run("make", "--seed", "users").code).toBe(0);
            expect(p.run("make", "--seed", "posts").code).toBe(0);
            const files = readdirSync(join(p.dir, "seeds"));
            expect(files).toHaveLength(2);
        });
    });

    describe("migrate", () => {
        it("applies all pending migrations and tracks them in one batch", async () => {
            p.addMigration("users", USERS_UP, USERS_DOWN);
            p.addMigration("posts", POSTS_UP, POSTS_DOWN);
            const r = p.run("migrate");
            expect(r.code, r.output).toBe(0);
            expect(await p.tables()).toEqual(["posts", "users"]);
            const tracked = await p.tracked();
            expect(tracked).toHaveLength(2);
            expect(tracked[0].batch_id).toBe(tracked[1].batch_id);
        });

        it("does nothing when there are no pending migrations", async () => {
            p.addMigration("users", USERS_UP, USERS_DOWN);
            expect(p.run("migrate").code).toBe(0);
            const r = p.run("migrate");
            expect(r.code, r.output).toBe(0);
            expect(await p.tracked()).toHaveLength(1);
        });

        it("does nothing when there are no migration files", () => {
            const r = p.run("migrate");
            expect(r.code, r.output).toBe(0);
            expect(r.output).toMatch(/no migrations? (available|pending)|not migrations available/i);
        });

        it("applies only new migrations in a new batch", async () => {
            p.addMigration("users", USERS_UP, USERS_DOWN);
            expect(p.run("migrate").code).toBe(0);
            p.addMigration("posts", POSTS_UP, POSTS_DOWN);
            const r = p.run("migrate");
            expect(r.code, r.output).toBe(0);
            expect(await p.tables()).toEqual(["posts", "users"]);
            const tracked = await p.tracked();
            expect(tracked).toHaveLength(2);
            expect(tracked[0].batch_id).not.toBe(tracked[1].batch_id);
        });

        it("rejects migrations with DML", async () => {
            p.addMigration("users", `${USERS_UP} INSERT INTO users VALUES (1, 'a');`, USERS_DOWN);
            const r = p.run("migrate");
            expect(r.code).not.toBe(0);
            expect(r.output).toMatch(/DML/);
            expect(await p.tables()).toEqual([]);
        });

        it("fails with a broken migration and does not track it", async () => {
            p.addMigration("users", USERS_UP, USERS_DOWN);
            p.addMigration("broken", "CREATE TABLE broken (;", "DROP TABLE broken;");
            const r = p.run("migrate");
            expect(r.code).not.toBe(0);
            const tracked = await p.tracked();
            expect(tracked).toHaveLength(1);
            expect(String(tracked[0].path)).toMatch(/-users\.sql$/);
        });
    });

    describe("up", () => {
        it("applies only the next pending migration", async () => {
            p.addMigration("users", USERS_UP, USERS_DOWN);
            p.addMigration("posts", POSTS_UP, POSTS_DOWN);
            let r = p.run("up");
            expect(r.code, r.output).toBe(0);
            expect(await p.tables()).toEqual(["users"]);
            r = p.run("up");
            expect(r.code, r.output).toBe(0);
            expect(await p.tables()).toEqual(["posts", "users"]);
            r = p.run("up");
            expect(r.code, r.output).toBe(0);
            expect(await p.tracked()).toHaveLength(2);
        });
    });

    describe("down", () => {
        it("reverts only the last migration", async () => {
            p.addMigration("users", USERS_UP, USERS_DOWN);
            p.addMigration("posts", POSTS_UP, POSTS_DOWN);
            expect(p.run("migrate").code).toBe(0);
            const r = p.run("down");
            expect(r.code, r.output).toBe(0);
            expect(await p.tables()).toEqual(["users"]);
            expect(await p.tracked()).toHaveLength(1);
        });

        it("does nothing when nothing was migrated", async () => {
            p.addMigration("users", USERS_UP, USERS_DOWN);
            const r = p.run("down");
            expect(r.code, r.output).toBe(0);
            expect(await p.tracked()).toHaveLength(0);
        });
    });

    describe("rollback", () => {
        it("reverts only the last batch", async () => {
            p.addMigration("users", USERS_UP, USERS_DOWN);
            expect(p.run("migrate").code).toBe(0);
            p.addMigration("posts", POSTS_UP, POSTS_DOWN);
            p.addMigration("tags", TAGS_UP, TAGS_DOWN);
            expect(p.run("migrate").code).toBe(0);
            const r = p.run("rollback");
            expect(r.code, r.output).toBe(0);
            expect(await p.tables()).toEqual(["users"]);
            expect(await p.tracked()).toHaveLength(1);
        });

        it("reverts a batch whose tables depend on each other", async () => {
            p.addMigration("users", USERS_UP, USERS_DOWN);
            p.addMigration(
                "posts",
                "CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id));",
                POSTS_DOWN,
            );
            expect(p.run("migrate").code).toBe(0);
            const r = p.run("rollback");
            expect(r.code, r.output).toBe(0);
            expect(await p.tables()).toEqual([]);
            expect(await p.tracked()).toHaveLength(0);
        });
    });

    describe("redo", () => {
        it("reverts and applies again the last migration", async () => {
            p.addMigration("users", USERS_UP, USERS_DOWN);
            p.addMigration("posts", POSTS_UP, POSTS_DOWN);
            expect(p.run("migrate").code).toBe(0);
            const before = await p.tracked();
            const r = p.run("redo");
            expect(r.code, r.output).toBe(0);
            expect(await p.tables()).toEqual(["posts", "users"]);
            const after = await p.tracked();
            expect(after).toHaveLength(2);
            expect(after[1].migrated_at).not.toBe(before[1].migrated_at);
        });
    });

    describe("reset", () => {
        it("reverts all migrations and applies them again", async () => {
            p.addMigration("users", USERS_UP, USERS_DOWN);
            expect(p.run("migrate").code).toBe(0);
            p.addMigration("posts", POSTS_UP, POSTS_DOWN);
            expect(p.run("migrate").code).toBe(0);
            await p.query("CREATE TABLE extra_marker (id INTEGER)");
            const r = p.run("reset");
            expect(r.code, r.output).toBe(0);
            expect(await p.tables()).toEqual(["extra_marker", "posts", "users"]);
            const tracked = await p.tracked();
            expect(tracked).toHaveLength(2);
            expect(tracked[0].batch_id).toBe(tracked[1].batch_id);
        });
    });

    describe("status", () => {
        it("shows applied and pending migrations", async () => {
            p.addMigration("users", USERS_UP, USERS_DOWN);
            expect(p.run("migrate").code).toBe(0);
            p.addMigration("posts", POSTS_UP, POSTS_DOWN);
            const r = p.run("status");
            expect(r.code, r.output).toBe(0);
            expect(r.output).toMatch(/✔ - users\.sql/);
            expect(r.output).toMatch(/✘ - posts\.sql/);
        });

        it("warns when an applied migration file was edited", async () => {
            const file = p.addMigration("users", USERS_UP, USERS_DOWN);
            expect(p.run("migrate").code).toBe(0);
            const { writeFileSync } = await import("node:fs");
            writeFileSync(
                file,
                `-- ez-migration-up\nCREATE TABLE users (id INTEGER);\n-- ez-migration-up\n-- ez-migration-down\n${USERS_DOWN}\n-- ez-migration-down\n`,
            );
            const r = p.run("status");
            expect(r.code, r.output).toBe(0);
            expect(r.output).toMatch(/⚠️ - users\.sql/);
        });
    });

    describe("seed", () => {
        it("runs all seed files", async () => {
            p.addMigration("users", USERS_UP, USERS_DOWN);
            expect(p.run("migrate").code).toBe(0);
            p.addSeed("a", "INSERT INTO users (id, name) VALUES (1, 'ana');");
            p.addSeed("b", "INSERT INTO users (id, name) VALUES (2, 'bob');\nINSERT INTO users (id, name) VALUES (3, 'eva');");
            const r = p.run("seed");
            expect(r.code, r.output).toBe(0);
            const rows = await p.query("SELECT name FROM users ORDER BY id");
            expect(rows.map((x) => x.name)).toEqual(["ana", "bob", "eva"]);
        });

        it("rejects seeds with DDL", async () => {
            p.addMigration("users", USERS_UP, USERS_DOWN);
            expect(p.run("migrate").code).toBe(0);
            p.addSeed("bad", "DROP TABLE users;");
            const r = p.run("seed");
            expect(r.code).not.toBe(0);
            expect(r.output).toMatch(/DDL/);
            expect(await p.tables()).toEqual(["users"]);
        });

        it("does nothing when there are no seeds", () => {
            const r = p.run("seed");
            expect(r.code, r.output).toBe(0);
        });
    });
});

describe("version", () => {
    it("prints the package version", () => {
        const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"));
        const result = spawnSync(process.execPath, [CLI, "version"], { encoding: "utf8" });
        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe(pkg.version);
    });
});

it("CLI binary is built", () => {
    expect(existsSync(CLI)).toBe(true);
});
