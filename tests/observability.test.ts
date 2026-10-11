import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { createProject, DIALECTS, Project } from "./helpers";

const USERS_UP = "CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR(50));";
const USERS_DOWN = "DROP TABLE users;";

const projects: Array<Project> = [];
function project(...args: Parameters<typeof createProject>) {
    const p = createProject(...args);
    projects.push(p);
    return p;
}
afterEach(async () => {
    while (projects.length) await projects.pop()!.cleanup();
});

describe("startup", () => {
    it("doesn't load the database drivers until a command needs them", () => {
        const dist = resolve(__dirname, "../dist");
        const script = `require(${JSON.stringify(join(dist, "CLI.js"))});
            const loaded = Object.keys(require.cache).filter(f => /node_modules[\\\\/](mysql2|pg|pino)[\\\\/]/.test(f));
            console.log(JSON.stringify(loaded));`;
        const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual([]);
    });

    it("hides the SQLite experimental warning", () => {
        const p = project("sqlite");
        p.addMigration("users", USERS_UP, USERS_DOWN);
        const r = p.run("migrate");
        expect(r.code).toBe(0);
        expect(r.output).not.toMatch(/ExperimentalWarning/);
    });
});

describe("log options", () => {
    it("rejects an unknown log level", () => {
        const p = project("sqlite");
        const r = p.run("status", "--log-level", "loud");
        expect(r.code).toBe(1);
        expect(r.output).toMatch(/Invalid log level: loud/);
    });

    it("writes one JSON object per line with --log-format json", () => {
        const p = project("sqlite");
        p.addMigration("users", USERS_UP, USERS_DOWN);
        const r = p.run("migrate", "--log-format", "json", "--verbose");
        expect(r.code).toBe(0);
        const lines = r.output.trim().split("\n").map(line => JSON.parse(line));
        expect(lines.every(l => typeof l.time === "string" && typeof l.level === "string" && typeof l.msg === "string")).toBe(true);
        expect(lines.some(l => l.level === "debug" && l.msg === "end migration.up" && typeof l.ms === "number")).toBe(true);
    });

    it("keeps the status list with --log-level error", () => {
        const p = project("sqlite");
        p.addMigration("users", USERS_UP, USERS_DOWN);
        const r = p.run("status", "--log-level", "error");
        expect(r.code).toBe(0);
        expect(r.output.trim()).toMatch(/^1 ✘ - users\.sql$/);
    });

    it("reads the level from EZ_MIGRATE_LOG_LEVEL", () => {
        const p = project("sqlite");
        p.addMigration("users", USERS_UP, USERS_DOWN);
        const r = spawnSync(process.execPath, [resolve(__dirname, "../dist/ez-migrate.js"), "migrate"], {
            cwd: p.dir,
            env: { ...process.env, DB_NAME: `./db/${p.database}.db`, EZ_MIGRATE_LOG_LEVEL: "debug", NO_COLOR: "1" },
            encoding: "utf8",
        });
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/DEBUG/);
    });
});

describe.each(DIALECTS)("logs and traces [%s]", (dialect) => {
    it("--trace prints the time of each step", () => {
        const p = project(dialect);
        p.addMigration("users", USERS_UP, USERS_DOWN);
        p.addMigration("posts", "CREATE TABLE posts (id INTEGER PRIMARY KEY);", "DROP TABLE posts;");
        const r = p.run("migrate", "--trace");
        expect(r.code, r.output).toBe(0);
        expect(r.output).toMatch(/Trace \(process [\d.]+ ms, startup [\d.]+ ms\)/);
        expect(r.output).toMatch(/[\d.]+ ms {2}command migrate/);
        expect(r.output).toMatch(/[\d.]+ ms {2}migration\.up {2}file=\S+-users\.sql/);
        expect(r.output).toMatch(/[\d.]+ ms {2}migration\.up {2}file=\S+-posts\.sql/);
        expect(r.output).toMatch(new RegExp(`db\\.run {2}db=${dialect}`));
        expect(r.output).toMatch(/tracker\.save/);
    });

    it("--trace-file writes a Chrome trace with every step", () => {
        const p = project(dialect);
        p.addMigration("users", USERS_UP, USERS_DOWN);
        const r = p.run("migrate", "--trace-file", "trace.json");
        expect(r.code, r.output).toBe(0);
        const trace = JSON.parse(readFileSync(join(p.dir, "trace.json"), "utf8"));
        const names = trace.traceEvents.map((e: { name: string }) => e.name);
        expect(names).toContain("command migrate");
        expect(names).toContain("migration.up");
        for (const event of trace.traceEvents) {
            expect(event.ph).toBe("X");
            expect(event.dur).toBeGreaterThanOrEqual(0);
        }
    });

    it("a failed migration names the file, and --verbose shows the cause", () => {
        const p = project(dialect);
        p.addMigration("users", USERS_UP, USERS_DOWN);
        p.addMigration("broken", "CREATE TABLE broken (;", "DROP TABLE broken;");
        const r = p.run("migrate", "--verbose", "--trace");
        expect(r.code).toBe(1);
        expect(r.output).toMatch(/Migration \S+-broken\.sql \(up\) failed: /);
        expect(r.output).toMatch(/migration\.up {2}file=\S+-broken\.sql {2}FAILED/);
        expect(r.output).toMatch(/Caused by: /);
    });

    it("never writes the SQL or its values in the logs", () => {
        const p = project(dialect);
        p.addMigration("users", USERS_UP, USERS_DOWN);
        p.addSeed("people", "INSERT INTO users (id, name) VALUES (1, 'secret-value-123');");
        expect(p.run("migrate").code).toBe(0);
        const r = p.run("seed", "--verbose", "--trace", "--trace-file", "trace.json");
        expect(r.code, r.output).toBe(0);
        expect(r.output).toMatch(/seeds\.run/);
        expect(r.output).not.toMatch(/secret-value-123/);
        expect(readFileSync(join(p.dir, "trace.json"), "utf8")).not.toMatch(/secret-value-123/);
    });
});
