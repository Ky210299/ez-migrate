import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { createProject, createSslUser, DB, Dialect, DIALECTS, Project } from "./helpers";

const USERS_UP = "CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR(50));";
const USERS_DOWN = "DROP TABLE users;";
const POSTS_UP = "CREATE TABLE posts (id INTEGER PRIMARY KEY);";
const POSTS_DOWN = "DROP TABLE posts;";

/** A statement that takes about `seconds` in each DBMS, to keep the lock busy */
function slowSQL(dialect: Dialect, seconds: number) {
    if (dialect === "mysql") return `DO SLEEP(${seconds});`;
    if (dialect === "postgres") return `SELECT pg_sleep(${seconds});`;
    // SQLite has no sleep: count rows of a recursive query (about 1 s per 5 million)
    return `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < ${Math.round(seconds * 5_000_000)}) SELECT count(*) FROM c;`;
}

const projects: Array<Project> = [];
function project(dialect: Dialect, trackerDialect?: Dialect) {
    const p = createProject(dialect, trackerDialect);
    projects.push(p);
    return p;
}
afterEach(async () => {
    while (projects.length) await projects.pop()!.cleanup();
});

describe.each(DIALECTS)("lock [%s]", (dialect) => {
    it("two migrate at the same time apply each migration once", async () => {
        const p = project(dialect);
        p.addMigration("slow", `CREATE TABLE slow (id INTEGER PRIMARY KEY);\n${slowSQL(dialect, 1.5)}`, "DROP TABLE slow;");
        p.addMigration("users", USERS_UP, USERS_DOWN);
        const first = p.runAsync("migrate");
        await sleep(400);
        const second = p.runAsync("migrate");
        const results = await Promise.all([first, second]);
        for (const r of results) expect(r.code, r.output).toBe(0);
        // The second one waited for the first, then found nothing to do
        expect(results.filter(r => /No pending migrations/.test(r.output))).toHaveLength(1);
        expect(await p.tracked()).toHaveLength(2);
        expect(await p.tables()).toEqual(["slow", "users"]);
    });

    it("stops after --lock-timeout while another migrate runs", async () => {
        const p = project(dialect);
        p.addMigration("slow", `CREATE TABLE slow (id INTEGER PRIMARY KEY);\n${slowSQL(dialect, 3)}`, "DROP TABLE slow;");
        const first = p.runAsync("migrate");
        await sleep(600);
        const second = await p.runAsync("migrate", "--lock-timeout", "0.5");
        expect(second.code).toBe(1);
        expect(second.output).toMatch(/Another ez-migrate is changing this database/);
        expect((await first).code).toBe(0);
    });

    it("releases the lock when a migration fails", () => {
        const p = project(dialect);
        p.addMigration("broken", "CREATE TABLE broken (;", "DROP TABLE broken;");
        expect(p.run("migrate").code).toBe(1);
        const again = p.run("migrate", "--lock-timeout", "0");
        expect(again.code).toBe(1);
        expect(again.output).toMatch(/broken\.sql \(up\) failed/);
        expect(again.output).not.toMatch(/Another ez-migrate/);
    });

    it("status doesn't wait for the lock", async () => {
        const p = project(dialect);
        p.addMigration("slow", slowSQL(dialect, 2), "SELECT 1;");
        const first = p.runAsync("migrate");
        await sleep(600);
        const status = await p.runAsync("status", "--lock-timeout", "0");
        expect(status.code, status.output).toBe(0);
        await first;
    });
});

describe("lock file of the SQLite tracker", () => {
    const lockFile = (p: Project) => join(p.dir, "db", "tracker.db.lock");

    it("removes a lock left by a process that died", () => {
        const p = project("sqlite");
        p.addMigration("users", USERS_UP, USERS_DOWN);
        writeFileSync(lockFile(p), JSON.stringify({ pid: 999_999_999, host: hostname(), since: "2026-01-01T00:00:00Z" }));
        const r = p.run("migrate", "--lock-timeout", "2");
        expect(r.code, r.output).toBe(0);
        expect(existsSync(lockFile(p))).toBe(false);
    });

    it("waits for a lock of another host and says who has it", () => {
        const p = project("sqlite");
        p.addMigration("users", USERS_UP, USERS_DOWN);
        writeFileSync(lockFile(p), JSON.stringify({ pid: 1, host: "build-server-2", since: "2026-01-01T00:00:00Z" }));
        const r = p.run("migrate", "--lock-timeout", "0.3");
        expect(r.code).toBe(1);
        expect(r.output).toMatch(/pid 1 on build-server-2/);
    });

    it("rejects an invalid --lock-timeout", () => {
        const p = project("sqlite");
        const r = p.run("migrate", "--lock-timeout", "soon");
        expect(r.code).toBe(1);
        expect(r.output).toMatch(/Invalid lock timeout: soon/);
    });
});

describe.each(DIALECTS)("changed migrations [%s]", (dialect) => {
    it("migrate stops if an applied migration changed, and applies nothing", async () => {
        const p = project(dialect);
        const users = p.addMigration("users", USERS_UP, USERS_DOWN);
        expect(p.run("migrate").code).toBe(0);
        writeFileSync(users, readFileSync(users, "utf8").replace("name VARCHAR(50)", "name VARCHAR(80)"));
        p.addMigration("posts", POSTS_UP, POSTS_DOWN);

        for (const command of ["migrate", "up"]) {
            const r = p.run(command);
            expect(r.code).toBe(1);
            expect(r.output).toMatch(/Applied migrations changed after they were applied:\s+- \S+-users\.sql/);
        }
        expect(await p.tables()).toEqual(["users"]);

        const allowed = p.run("migrate", "--allow-changed");
        expect(allowed.code, allowed.output).toBe(0);
        expect(allowed.output).toMatch(/allowed by --allow-changed/);
        expect(await p.tables()).toEqual(["posts", "users"]);
    });

    it("ignores changes in comments and whitespace", () => {
        const p = project(dialect);
        const users = p.addMigration("users", USERS_UP, USERS_DOWN);
        expect(p.run("migrate").code).toBe(0);
        writeFileSync(users, readFileSync(users, "utf8").replace(USERS_UP, `-- the users\n${USERS_UP.replace(" (", "\n    (").replace("TABLE users", "TABLE   users")}`));
        p.addMigration("posts", POSTS_UP, POSTS_DOWN);
        const r = p.run("migrate");
        expect(r.code, r.output).toBe(0);
    });
});

describe.each(["mysql", "postgres"] as const)("SSL and connection URL [%s]", (dialect) => {
    beforeAll(() => createSslUser(dialect));

    /** Project whose database user (ezm_ssl) can only connect with SSL */
    function sslProject(ssl?: unknown) {
        const p = project(dialect);
        p.env.DB_USER = "ezm_ssl";
        if (ssl !== undefined) p.updateConfig({ ssl });
        p.addMigration("users", USERS_UP, USERS_DOWN);
        return p;
    }

    it("can't connect without SSL when the server requires it", () => {
        const r = sslProject().run("migrate");
        expect(r.code).toBe(1);
    });

    it("connects with SSL", async () => {
        const p = sslProject({ rejectUnauthorized: false });
        const r = p.run("migrate");
        expect(r.code, r.output).toBe(0);
        expect(await p.tables()).toEqual(["users"]);
    });

    it("verifies the server certificate by default", () => {
        const r = sslProject(true).run("migrate");
        expect(r.code).toBe(1);
        expect(r.output).toMatch(/self-signed certificate/);
    });

    it("reports a missing certificate file", () => {
        const r = sslProject({ ca: "./missing-ca.pem" }).run("migrate");
        expect(r.code).toBe(1);
        expect(r.output).toMatch(/Cannot read the SSL file \.\/missing-ca\.pem/);
    });

    it("reads the connection from a URL, with the SSL mode", async () => {
        const p = project(dialect);
        const { host, port } = DB[dialect];
        const mode = dialect === "postgres" ? "sslmode=require" : "ssl-mode=REQUIRED";
        p.env.DATABASE_URL = `${dialect}://ezm_ssl:ezmigrate@${host}:${port}/${p.database}?${mode}`;
        p.updateConfig({ envKeys: { user: "DB_USER", password: "DB_PASSWORD", port: "DB_PORT", host: "DB_HOST", database: "DB_NAME", url: "DATABASE_URL" } });
        p.addMigration("users", USERS_UP, USERS_DOWN);
        const r = p.run("migrate");
        expect(r.code, r.output).toBe(0);
        expect(await p.tables()).toEqual(["users"]);
    });

    it("never prints the URL of an invalid connection URL", () => {
        const p = project(dialect);
        p.env.DATABASE_URL = "not a url with secret-password";
        p.updateConfig({ envKeys: { user: "DB_USER", password: "DB_PASSWORD", port: "DB_PORT", host: "DB_HOST", database: "DB_NAME", url: "DATABASE_URL" } });
        const r = p.run("migrate");
        expect(r.code).toBe(1);
        expect(r.output).toMatch(/The env var DATABASE_URL is not a valid connection URL/);
        expect(r.output).not.toMatch(/secret-password/);
    });
});

describe("SSL with a CA file [postgres]", () => {
    it("verifies the server certificate with the given CA", async () => {
        const p = project("postgres");
        p.env.DB_USER = "ezm_ssl";
        p.updateConfig({ ssl: { ca: resolve(__dirname, "fixtures/ssl/server.crt") } });
        p.addMigration("users", USERS_UP, USERS_DOWN);
        const r = p.run("migrate");
        expect(r.code, r.output).toBe(0);
        expect(await p.tables()).toEqual(["users"]);
    });
});
