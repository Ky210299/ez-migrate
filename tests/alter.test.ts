import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createProject, Dialect, DIALECTS, Project } from "./helpers";
import { parseTargetType } from "../src/AlterColumn";
import SchemasHandler from "../src/SchemasHandler";
import { nonAtomicWarning } from "../src/MigrationExecutor";

const USERS_UP = "CREATE TABLE users (id INTEGER PRIMARY KEY, status VARCHAR(20) NOT NULL DEFAULT 'active', zip VARCHAR(10));";
const USERS_DOWN = "DROP TABLE users;";
const POSTS_UP = "CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE);";
const POSTS_DOWN = "DROP TABLE posts;";
const ENUM = "enum('active','blocked')";

const projects: Array<Project> = [];
function project(dialect: Dialect) {
    const p = createProject(dialect);
    projects.push(p);
    return p;
}
afterEach(async () => {
    while (projects.length) await projects.pop()!.cleanup();
});

/** Project with users (3 rows) and posts that reference them, all migrations applied */
async function withUsers(dialect: Dialect, statuses = ["active", "blocked", "active"]) {
    const p = project(dialect);
    p.addMigration("users", USERS_UP, USERS_DOWN);
    p.addMigration("posts", POSTS_UP, POSTS_DOWN);
    const r = p.run("migrate");
    expect(r.code, r.output).toBe(0);
    const zips = ["1000", "2000", "3000"];
    for (const [i, status] of statuses.entries()) {
        await p.query(`INSERT INTO users (id, status, zip) VALUES (${i + 1}, '${status}', '${zips[i] ?? "4000"}')`);
        await p.query(`INSERT INTO posts (id, user_id) VALUES (${i + 1}, ${i + 1})`);
    }
    return p;
}

function migrationFiles(p: Project) {
    try {
        return readdirSync(join(p.dir, "migrations")).filter(f => f.includes("alter"));
    } catch {
        return [];
    }
}

async function users(p: Project) {
    return (await p.query("SELECT id, status, zip FROM users ORDER BY id")).map(r => [Number(r.id), String(r.status), r.zip == null ? null : String(r.zip)]);
}

/** stdout of a run is the JSON; logs go to stderr, so parse from the first "{" */
function json(output: string) {
    return JSON.parse(output.slice(output.indexOf("{")));
}

describe.each(DIALECTS)("alter [%s]", (dialect) => {
    it("writes a migration that changes a column to an enum, keeps every row and can be reverted", async () => {
        const p = await withUsers(dialect);
        const before = await users(p);
        const r = p.run("alter", "users", "status", ENUM);
        expect(r.code, r.output).toBe(0);
        expect(r.output).toContain("Result: safe");
        expect(r.output).toContain("every value is back as it was");
        expect(migrationFiles(p)).toHaveLength(1);
        // The copy of the table is dropped after the test
        expect(await p.tables()).toEqual(["posts", "users"]);

        const migrate = p.run("migrate");
        expect(migrate.code, migrate.output).toBe(0);
        expect(await users(p)).toEqual(before);
        expect(await p.query("SELECT COUNT(*) AS n FROM posts")).toEqual([{ n: dialect === "postgres" ? "3" : 3 }]);
        // The enum rejects other values now
        await expect(p.query("INSERT INTO users (id, status) VALUES (9, 'gone')")).rejects.toThrow();
        // The default is kept
        await p.query("INSERT INTO users (id) VALUES (10)");
        expect((await p.query("SELECT status FROM users WHERE id = 10"))[0].status).toBe("active");

        const down = p.run("down");
        expect(down.code, down.output).toBe(0);
        await p.query("INSERT INTO users (id, status) VALUES (11, 'gone')");
        expect((await users(p)).slice(0, 3)).toEqual(before);
    });

    it("doesn't write the migration when a value is not in the enum, and says which", async () => {
        const p = await withUsers(dialect, ["active", "banned", "active"]);
        const r = p.run("alter", "users", "status", ENUM);
        expect(r.code).toBe(1);
        expect(r.output).toContain("1 can't be converted");
        expect(r.output).toContain("'banned' (1 row)");
        expect(r.output).toContain("No migration was written");
        expect(migrationFiles(p)).toEqual([]);
    });

    it("doesn't write the migration when values would change, unless --allow-changes", async () => {
        const p = await withUsers(dialect);
        await p.query("UPDATE users SET zip = '0070' WHERE id = 2");
        const r = p.run("alter", "users", "zip", "integer");
        expect(r.code).toBe(1);
        expect(r.output).toContain("'0070' -> '70' (1 row)");
        expect(r.output).toContain("--allow-changes");
        expect(migrationFiles(p)).toEqual([]);

        const allowed = p.run("alter", "users", "zip", "integer", "--allow-changes");
        expect(allowed.code, allowed.output).toBe(0);
        expect(p.run("migrate").code).toBe(0);
        expect((await users(p)).map(u => u[2])).toEqual(["1000", "70", "3000"]);
    });

    it("--dry-run tests on a copy and writes nothing", async () => {
        const p = await withUsers(dialect);
        const r = p.run("alter", "users", "status", ENUM, "--dry-run");
        expect(r.code, r.output).toBe(0);
        expect(r.output).toContain("Test on a copy of the table");
        expect(r.output).toContain("Dry run: no migration was written");
        expect(migrationFiles(p)).toEqual([]);
        expect(await p.tables()).toEqual(["posts", "users"]);
    });

    it("the migration stops without changes if the database has values the test didn't have", async () => {
        const p = await withUsers(dialect);
        expect(p.run("alter", "users", "status", ENUM).code).toBe(0);
        // Another database (production) has a value that is not in the enum
        await p.query("UPDATE users SET status = 'banned' WHERE id = 3");
        const before = await users(p);
        const r = p.run("migrate");
        expect(r.code).toBe(1);
        expect(await users(p)).toEqual(before);
        await p.query("INSERT INTO users (id, status) VALUES (9, 'any text')");
    });

    it("the migration stops without changes if a value would change in another database", async () => {
        const p = await withUsers(dialect);
        expect(p.run("alter", "users", "zip", "integer").code).toBe(0);
        await p.query("UPDATE users SET zip = '007' WHERE id = 1");
        const r = p.run("migrate");
        expect(r.code).toBe(1);
        expect(r.output).toMatch(/would_change|would not be the same/);
        expect((await users(p))[0]).toEqual([1, "active", "007"]);
    });

    it("prints the result as JSON", async () => {
        const p = await withUsers(dialect);
        const r = p.run("alter", "users", "status", ENUM, "--dry-run", "--json");
        expect(r.code, r.output).toBe(0);
        const result = json(r.output);
        expect(result).toMatchObject({
            table: "users", column: "status", to: ENUM, rows: 3, safe: true, dryRun: true, file: null,
            values: { unchanged: 3, changed: 0, invalid: 0 },
            test: { up: { ok: true, changed: 0 }, down: { ok: true, notRestored: 0 } },
        });
        expect(result.up).toContain("users");
    });

    it("refuses to run with pending migrations", async () => {
        const p = await withUsers(dialect);
        p.addMigration("later", "CREATE TABLE later (id INTEGER PRIMARY KEY);", "DROP TABLE later;");
        const r = p.run("alter", "users", "status", ENUM);
        expect(r.code).toBe(1);
        expect(r.output).toContain("1 migration is pending");
        expect(migrationFiles(p)).toEqual([]);
    });

    it("the generated migration passes check --strict", async () => {
        const p = await withUsers(dialect);
        expect(p.run("alter", "users", "status", ENUM).code).toBe(0);
        const r = p.run("check", "--strict");
        expect(r.code, r.output).toBe(0);
    });

    it("says when the column doesn't exist", async () => {
        const p = await withUsers(dialect);
        const r = p.run("alter", "users", "nope", ENUM);
        expect(r.code).toBe(1);
        expect(r.output).toContain("Column nope doesn't exist in table users");
    });

    if (dialect !== "sqlite") {
        it("doesn't write the migration when it fails on the copy of the table", async () => {
            const p = await withUsers(dialect, ["blocked", "blocked", "blocked"]);
            // The values fit, but the default 'active' is not in the new enum
            const r = p.run("alter", "users", "status", "enum('blocked','gone')");
            expect(r.code).toBe(1);
            expect(r.output).toContain("3 stay the same");
            expect(r.output).toContain("up: failed:");
            expect(r.output).toContain("The migration failed on the copy of the table");
            expect(migrationFiles(p)).toEqual([]);
            expect(await p.tables()).toEqual(["posts", "users"]);
        });

        it("refuses a column that is part of a foreign key", async () => {
            const p = await withUsers(dialect);
            const r = p.run("alter", "posts", "user_id", "bigint");
            expect(r.code).toBe(1);
            expect(r.output).toContain("foreign key");
            expect(migrationFiles(p)).toEqual([]);
        });
    }
});

describe("alter [postgres]", () => {
    it("adds values at the end of an enum with ADD VALUE, and removes them with a new type", async () => {
        const p = await withUsers("postgres");
        expect(p.run("alter", "users", "status", ENUM).code).toBe(0);
        expect(p.run("migrate").code).toBe(0);

        const add = p.run("alter", "users", "status", "enum('active','blocked','gone')");
        expect(add.code, add.output).toBe(0);
        const file = migrationFiles(p).sort().at(-1)!;
        const up = readFileSync(join(p.dir, "migrations", file), "utf8").split("-- ez-migration-down")[0];
        expect(up).toContain("ADD VALUE 'gone'");
        expect(up).not.toContain("ALTER COLUMN");
        expect(p.run("migrate").code).toBe(0);
        expect(await p.query("SELECT enum_range(NULL::users_status)::text AS r")).toEqual([{ r: "{active,blocked,gone}" }]);

        await p.query("UPDATE users SET status = 'gone' WHERE id = 3");
        const remove = p.run("alter", "users", "status", "enum('blocked','gone')");
        expect(remove.code).toBe(1);
        expect(remove.output).toContain("'active' (1 row)");

        // The down can't put 'gone' back in the old enum: it fails and changes nothing
        const down = p.run("down");
        expect(down.code).toBe(1);
        expect(down.output).toContain("gone");
        expect((await users(p))[2]).toEqual([3, "gone", "3000"]);
    });

    it("refuses a column used by a view", async () => {
        const p = await withUsers("postgres");
        await p.query("CREATE VIEW active_users AS SELECT id, status FROM users");
        const r = p.run("alter", "users", "status", ENUM);
        expect(r.code).toBe(1);
        expect(r.output).toContain("active_users");
    });
});

describe("alter [sqlite]", () => {
    it("keeps views, indexes, triggers and the rows of other tables when it rebuilds the table", async () => {
        const p = await withUsers("sqlite");
        await p.query("CREATE VIEW active_users AS SELECT id, status FROM users");
        await p.query("CREATE INDEX users_zip ON users (zip)");
        await p.query("CREATE TRIGGER users_ai AFTER INSERT ON users BEGIN SELECT 1; END");
        expect(p.run("alter", "users", "status", ENUM).code).toBe(0);
        const r = p.run("migrate");
        expect(r.code, r.output).toBe(0);
        const names = (await p.query("SELECT name FROM sqlite_schema ORDER BY name")).map(row => row.name);
        expect(names).toEqual(expect.arrayContaining(["active_users", "users_zip", "users_ai", "posts", "users"]));
        expect(await p.query("SELECT COUNT(*) AS n FROM posts")).toEqual([{ n: 3 }]);
        expect(await p.query("SELECT COUNT(*) AS n FROM active_users")).toEqual([{ n: 3 }]);
        expect(await p.query("PRAGMA foreign_key_check")).toEqual([]);
    });
});

describe("alter on a big table [sqlite]", () => {
    it("doesn't copy it without --yes, and --skip-test writes the migration without the test", async () => {
        const p = await withUsers("sqlite");
        await p.query(`INSERT INTO users (id, status) WITH RECURSIVE n(i) AS (SELECT 100 UNION ALL SELECT i + 1 FROM n WHERE i < 1000100) SELECT i, 'active' FROM n`);
        const r = p.run("alter", "users", "status", ENUM);
        expect(r.code).toBe(1);
        expect(r.output).toContain("Run it with --yes to copy it, or with --skip-test");
        expect(migrationFiles(p)).toEqual([]);

        const skip = p.run("alter", "users", "status", ENUM, "--skip-test");
        expect(skip.code, skip.output).toBe(0);
        expect(skip.output).toContain("Test on a copy of the table: not run. --skip-test");
        expect(migrationFiles(p)).toHaveLength(1);
    });
});

describe("parseTargetType", () => {
    it("reads enums with quotes inside", () => {
        expect(parseTargetType("enum('a', 'it''s')")).toEqual({ kind: "enum", labels: ["a", "it's"] });
        expect(parseTargetType("ENUM ('x')")).toEqual({ kind: "enum", labels: ["x"] });
    });
    it("keeps other types as they are", () => {
        expect(parseTargetType(" numeric(10,2) ")).toEqual({ kind: "sql", sql: "numeric(10,2)" });
    });
    it("rejects statements, comments and bad enums", () => {
        expect(() => parseTargetType("int; DROP TABLE users")).toThrow("Invalid type");
        expect(() => parseTargetType("int -- x")).toThrow("Invalid type");
        expect(() => parseTargetType("enum(a, b)")).toThrow("single quotes");
        expect(() => parseTargetType("enum('a','a')")).toThrow("repeated");
        expect(() => parseTargetType("enum('a')) x")).toThrow("Invalid enum");
    });
});

describe("rules for generated migrations", () => {
    const handler = new SchemasHandler({ migrationsPath: "./migrations" });
    it("a migration can copy rows from one table to another, not insert values", () => {
        expect(handler.hasDML('INSERT INTO "t__ezm_new" ("id", "a") SELECT "id", "a" FROM "t";')).toBe(false);
        expect(handler.hasDML("INSERT INTO t SELECT 'x', a FROM b;")).toBe(true);
        expect(handler.hasDML("INSERT INTO t SELECT 1 FROM b;")).toBe(true);
        expect(handler.hasDML("INSERT INTO t VALUES (1);")).toBe(true);
        expect(handler.hasDML("INSERT INTO t2 SELECT a FROM b2;")).toBe(false);
    });
    it("SET and temporary tables don't make a MySQL migration non atomic", () => {
        expect(nonAtomicWarning("mysql", "SET @a = 1; CREATE TEMPORARY TABLE x (a INT); DROP TEMPORARY TABLE x; ALTER TABLE t MODIFY a INT;")).toBeNull();
        expect(nonAtomicWarning("mysql", "CREATE TABLE a (id INT); CREATE TABLE b (id INT);")).toContain("2 statements");
    });
});
