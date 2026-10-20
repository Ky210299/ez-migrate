import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createProject, DB, Dialect, DIALECTS, dropDatabase, Project, queryOn } from "./helpers";
import { crossTenantProblem, resolveTenant } from "../src/Tenants";
import type { Config, ResolvedTenant } from "../src/types";

type Rows = Array<Record<string, unknown>>;

/** A project with three tenants: <db>_acme, <db>_beta and <db>_gamma */
interface TenantsProject extends Project {
    names: { acme: string, beta: string, gamma: string };
    /** Write a migration for every tenant (folder migrations) */
    common: (name: string, up: string, down: string) => string;
    /** Write a migration only for one tenant (folder tenants/<tenant>) */
    own: (tenant: string, name: string, up: string, down: string) => string;
    /** Tables of a tenant (tracker tables excluded) */
    tenantTables: (tenant: string) => Promise<Array<string>>;
    /** File names in the tracker of a tenant */
    tenantTracked: (tenant: string) => Promise<Array<string>>;
    /** Run SQL in a tenant */
    tenantQuery: (tenant: string, sql: string) => Promise<Rows>;
    /** Databases to drop at the end (MySQL tenants, PostgreSQL tenants with their own database) */
    extraDatabases: Array<string>;
}

let counter = 0;
/** File names in creation order, in the format of ez-migrate make */
function fileName(name: string) {
    counter++;
    return `20260101${String(counter).padStart(9, "0")}-${name}.sql`;
}

function migrationText(up: string, down: string) {
    return `-- ez-migration-up\n${up}\n-- ez-migration-up\n-- ez-migration-down\n${down}\n-- ez-migration-down\n`;
}

const projects: Array<TenantsProject> = [];
afterEach(async () => {
    while (projects.length) {
        const p = projects.pop()!;
        await p.cleanup();
        for (const database of p.extraDatabases) await dropDatabase(p.dialect, database);
    }
});

function tenantsProject(dialect: Dialect, tenants?: Array<Record<string, unknown>>): TenantsProject {
    const p = createProject(dialect);
    const names = { acme: `${p.database}_acme`, beta: `${p.database}_beta`, gamma: `${p.database}_gamma` };
    const extraDatabases = dialect === "mysql" ? Object.values(names) : [];
    p.updateConfig({ tenants: { list: tenants ?? Object.values(names).map(name => ({ name })) } });

    const write = (folder: string, name: string, up: string, down: string) => {
        mkdirSync(join(p.dir, folder), { recursive: true });
        const file = join(p.dir, folder, fileName(name));
        writeFileSync(file, migrationText(up, down));
        return file;
    };
    const sqliteFile = (tenant: string) => join(p.dir, "db", "tenants", `${tenant}.db`);
    const tenantQuery = async (tenant: string, sql: string): Promise<Rows> => {
        if (dialect === "sqlite") return queryOn("sqlite", "", sqliteFile(tenant), sql);
        if (dialect === "mysql") return queryOn("mysql", tenant, "", sql);
        return pgRows(p.database, tenant, sql);
    };
    const tenantTables = async (tenant: string) => {
        let rows: Rows;
        if (dialect === "sqlite") {
            if (!existsSync(sqliteFile(tenant))) return [];
            rows = await queryOn("sqlite", "", sqliteFile(tenant), "SELECT name AS t FROM sqlite_schema WHERE type = 'table'");
        } else if (dialect === "mysql") {
            rows = await queryOn("mysql", "", "", `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = '${tenant}'`);
        } else {
            rows = await queryOn("postgres", p.database, "", `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = '${tenant}'`);
        }
        return rows.map(r => String(r.t)).filter(t => !t.startsWith("ez_") && !t.startsWith("sqlite_")).sort();
    };
    const tenantTracked = async (tenant: string) => {
        let rows: Rows;
        if (dialect === "sqlite") {
            rows = await queryOn("sqlite", "", join(p.dir, "db", "tenants", `${tenant}.tracker.db`), "SELECT path FROM ez_migration ORDER BY migrated_at");
        } else if (dialect === "mysql") {
            rows = await queryOn("mysql", tenant, "", "SELECT path FROM ez_migration ORDER BY migrated_at");
        } else {
            rows = await queryOn("postgres", p.database, "", `SELECT path FROM "${tenant}".ez_migration ORDER BY migrated_at`);
        }
        return rows.map(r => String(r.path).replace(/^.*\//, ""));
    };
    const project: TenantsProject = {
        ...p,
        names,
        extraDatabases,
        common: (name, up, down) => write("migrations", name, up, down),
        own: (tenant, name, up, down) => write(join("tenants", tenant), name, up, down),
        tenantTables,
        tenantTracked,
        tenantQuery,
    };
    projects.push(project);
    return project;
}

/** Run SQL in the schema of a tenant */
async function pgRows(database: string, tenant: string, sql: string): Promise<Rows> {
    const { Client } = await import("pg");
    const client = new Client({ ...DB.postgres, database });
    await client.connect();
    try {
        await client.query(`SET search_path TO "${tenant}"`);
        return (await client.query(sql)).rows;
    } finally {
        await client.end();
    }
}

const USERS = ["CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR(50));", "DROP TABLE users;"] as const;
const POSTS = ["CREATE TABLE posts (id INTEGER PRIMARY KEY);", "DROP TABLE posts;"] as const;
const VIP = ["CREATE TABLE vip (id INTEGER PRIMARY KEY);", "DROP TABLE vip;"] as const;

describe.each(DIALECTS)("tenants [%s]", (dialect) => {
    it("migrate --all-tenants applies the common migrations to every tenant and the own ones only to their tenant", async () => {
        const p = tenantsProject(dialect);
        const { acme, beta, gamma } = p.names;
        await p.setup([]);
        p.common("users", ...USERS);
        p.own(acme, "vip", ...VIP);
        p.common("posts", ...POSTS);

        const r = p.run("migrate", "--all-tenants");
        expect(r.code, r.output).toBe(0);
        expect(r.output).toMatch(/Tenants: 3 done, 0 failed, 0 not run/);
        expect(r.output).toMatch(new RegExp(`✔ ${acme}\\s+3 migrations were applied`));
        expect(r.output).toMatch(new RegExp(`✔ ${beta}\\s+2 migrations were applied`));

        expect(await p.tenantTables(acme)).toEqual(["posts", "users", "vip"]);
        expect(await p.tenantTables(beta)).toEqual(["posts", "users"]);
        expect(await p.tenantTables(gamma)).toEqual(["posts", "users"]);
        // The own migration runs in file name order, between the common ones
        expect((await p.tenantTracked(acme)).map(f => f.replace(/^\d+-/, ""))).toEqual(["users.sql", "vip.sql", "posts.sql"]);
        expect(await p.tenantTracked(beta)).toHaveLength(2);
        // The main database is not touched
        if (dialect !== "sqlite") expect(await p.tables()).toEqual([]);

        const again = p.run("migrate", "--all-tenants");
        expect(again.code, again.output).toBe(0);
        expect(again.output).toMatch(/Tenants: 3 done/);
        expect(again.output).toMatch(new RegExp(`✔ ${beta}\\s+nothing to run`));
    });

    it("--tenant runs only for that tenant, also rollback, up and down", async () => {
        const p = tenantsProject(dialect);
        const { acme, beta } = p.names;
        p.common("users", ...USERS);
        p.common("posts", ...POSTS);

        expect(p.run("migrate", "--tenant", acme).code).toBe(0);
        expect(await p.tenantTables(acme)).toEqual(["posts", "users"]);
        expect(await p.tenantTables(beta)).toEqual([]);

        expect(p.run("up", "--tenant", beta).code).toBe(0);
        expect(await p.tenantTables(beta)).toEqual(["users"]);

        const rollback = p.run("rollback", "--tenant", acme);
        expect(rollback.code, rollback.output).toBe(0);
        expect(await p.tenantTables(acme)).toEqual([]);
        expect(await p.tenantTables(beta)).toEqual(["users"]);

        expect(p.run("down", "--tenant", beta).code).toBe(0);
        expect(await p.tenantTables(beta)).toEqual([]);
    });

    it("EZ_MIGRATE_TENANT works like --tenant, and the logs say the tenant", async () => {
        const p = tenantsProject(dialect);
        p.common("users", ...USERS);
        p.env.EZ_MIGRATE_TENANT = p.names.beta;
        const r = p.run("migrate");
        expect(r.code, r.output).toBe(0);
        expect(r.output).toMatch(new RegExp(`tenant=${p.names.beta}`));
        expect(await p.tenantTables(p.names.beta)).toEqual(["users"]);
        expect(await p.tenantTables(p.names.acme)).toEqual([]);
    });

    it("status --all-tenants shows each tenant, as text and JSON", async () => {
        const p = tenantsProject(dialect);
        const { acme, beta, gamma } = p.names;
        p.common("users", ...USERS);
        p.own(beta, "vip", ...VIP);
        expect(p.run("migrate", "--tenant", acme).code).toBe(0);

        const text = p.run("status", "--all-tenants");
        expect(text.code, text.output).toBe(0);
        expect(text.output).toMatch(new RegExp(`✔ ${acme}\\s+1 applied`));
        expect(text.output).toMatch(new RegExp(`✘ ${beta}\\s+0 applied, 2 pending`));
        expect(text.output).toMatch(new RegExp(`✘ ${gamma}\\s+0 applied, 1 pending`));

        const json = p.run("status", "--all-tenants", "--json", "--log-level", "error");
        expect(json.code, json.output).toBe(0);
        const { tenants } = JSON.parse(json.output);
        expect(tenants.map((t: { tenant: string }) => t.tenant)).toEqual([acme, beta, gamma]);
        expect(tenants[1].migrations.map((m: { name: string, state: string }) => `${m.name}:${m.state}`)).toEqual(["users.sql:pending", "vip.sql:pending"]);

        // --tenant a,b: only those
        const two = p.run("status", "--tenant", `${acme},${gamma}`);
        expect(two.output).toMatch(new RegExp(acme));
        expect(two.output).not.toMatch(new RegExp(beta));
    });

    it("stops at the first tenant that fails; the others are not changed. --continue-on-error runs the rest", async () => {
        const p = tenantsProject(dialect);
        const { acme, beta, gamma } = p.names;
        // beta already has a table vip made by hand, so the common migration fails there
        p.own(beta, "hand", "CREATE TABLE vip (id INTEGER PRIMARY KEY);", "DROP TABLE vip;");
        p.common("vip", "CREATE TABLE extra (id INTEGER PRIMARY KEY);\nCREATE TABLE vip (id INTEGER PRIMARY KEY);", "DROP TABLE vip;\nDROP TABLE extra;");

        const r = p.run("migrate", "--all-tenants");
        expect(r.code).toBe(1);
        expect(r.output).toMatch(/Tenants: 1 done, 1 failed, 1 not run/);
        expect(r.output).toMatch(new RegExp(`✘ ${beta}\\s+Migration \\S+-vip.sql \\(up\\) failed`));
        expect(r.output).toMatch(new RegExp(`- ${gamma}\\s+not run`));
        expect(await p.tenantTables(acme)).toEqual(["extra", "vip"]);
        expect(await p.tenantTables(gamma)).toEqual([]);
        // Postgres and SQLite roll the failed migration back. MySQL commits each DDL statement
        expect(await p.tenantTables(beta)).toEqual(dialect === "mysql" ? ["extra", "vip"] : ["vip"]);
        expect(await p.tenantTracked(beta)).toHaveLength(1);

        const rest = p.run("migrate", "--all-tenants", "--continue-on-error");
        expect(rest.code).toBe(1);
        expect(rest.output).toMatch(/Tenants: 2 done, 1 failed, 0 not run/);
        expect(await p.tenantTables(gamma)).toEqual(["extra", "vip"]);
    });

    it("migrate --all-tenants --dry-run shows the plan of each tenant and runs nothing", async () => {
        const p = tenantsProject(dialect);
        const { acme, beta } = p.names;
        p.common("users", ...USERS);
        p.own(acme, "vip", ...VIP);

        const text = p.run("migrate", "--all-tenants", "--dry-run");
        expect(text.code, text.output).toBe(0);
        expect(text.output).toMatch(new RegExp(`-- Tenant ${acme}\\n-- Dry run: nothing was run. 2 migrations would be applied`));
        expect(text.output).toMatch(new RegExp(`-- Tenant ${beta}\\n-- Dry run: nothing was run. 1 migration would be applied`));

        const json = p.run("migrate", "--all-tenants", "--dry-run", "--json", "--log-level", "error");
        const plan = JSON.parse(json.output);
        expect(plan.dryRun).toBe(true);
        expect(plan.tenants[0].tenant).toBe(acme);
        expect(plan.tenants[0].steps[0].migrations.map((m: { file: string }) => m.file.replace(/^\d+-/, ""))).toEqual(["users.sql", "vip.sql"]);
        expect(await p.tenantTables(acme)).toEqual([]);
    });

    it("rejects migrations that change other tenants or leave the tenant, before running anything", async () => {
        const p = tenantsProject(dialect);
        const { acme, beta } = p.names;
        p.common("users", ...USERS);
        const other = dialect === "sqlite"
            ? `ATTACH DATABASE 'other.db' AS other;`
            : `CREATE TABLE ${beta}.stolen (id INTEGER PRIMARY KEY);`;
        p.own(acme, "bad", other, "SELECT 1;");

        const r = p.run("migrate", "--tenant", acme);
        expect(r.code).toBe(1);
        expect(r.output).toMatch(/can't run for tenant .*SQL of a tenant must only change its own schema or database. Nothing was run/);
        expect(await p.tenantTables(acme)).toEqual([]);

        // check finds it too
        const check = p.run("check", "--tenant", acme);
        expect(check.code).toBe(1);
        expect(check.output).toMatch(/outside-tenant/);

        // The other tenants don't have that file
        expect(p.run("migrate", "--tenant", beta).code).toBe(0);
    });

    it("seed, redo and reset with --tenant work on that tenant only", async () => {
        const p = tenantsProject(dialect);
        const { acme, beta } = p.names;
        p.common("users", ...USERS);
        p.addSeed("users", "INSERT INTO users (id, name) VALUES (1, 'ana');");
        expect(p.run("migrate", "--all-tenants").code).toBe(0);

        const seed = p.run("seed", "--tenant", acme);
        expect(seed.code, seed.output).toBe(0);
        expect(await p.tenantQuery(acme, "SELECT name FROM users")).toEqual([{ name: "ana" }]);
        expect(await p.tenantQuery(beta, "SELECT name FROM users")).toEqual([]);

        expect(p.run("redo", "--tenant", acme).code).toBe(0);
        expect(await p.tenantQuery(acme, "SELECT name FROM users")).toEqual([]);
        // reset reverts every migration and applies them again
        const reset = p.run("reset", "--tenant", beta);
        expect(reset.code, reset.output).toBe(0);
        expect(reset.output).toMatch(new RegExp(`tenant=${beta}`));
        expect(reset.output).not.toMatch(new RegExp(`tenant=${acme}`));
        expect(await p.tenantTracked(beta)).toHaveLength(1);
        expect(await p.tenantTables(acme)).toEqual(["users"]);
    });

    it("--tenant a,b migrates those two and --log-format json has the tenant in each line", async () => {
        const p = tenantsProject(dialect);
        const { acme, beta, gamma } = p.names;
        p.common("users", ...USERS);
        const r = p.run("migrate", "--tenant", `${acme},${gamma}`, "--log-format", "json");
        expect(r.code, r.output).toBe(0);
        expect(r.output).toMatch(/Tenants: 2 done/);
        const lines = r.output.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
        expect(lines.length).toBeGreaterThan(0);
        expect(lines.every(line => line.tenant === acme || line.tenant === gamma)).toBe(true);
        expect(await p.tenantTables(beta)).toEqual([]);
    });

    it("runs nothing for a tenant whose plan changed while the person answered", async () => {
        const p = tenantsProject(dialect);
        p.common("users", ...USERS);
        const r = await p.runInTerminal(["migrate", "--all-tenants"], {
            answer: "y",
            beforeAnswer: () => { p.common("posts", ...POSTS) },
        });
        expect(r.asked).toBe(true);
        expect(r.code).toBe(1);
        expect(r.output).toMatch(/The migrations to run changed while you answered/);
        expect(await p.tenantTables(p.names.acme)).toEqual([]);
    });

    it("rejects seeds that write to another tenant", async () => {
        const p = tenantsProject(dialect);
        if (dialect === "sqlite") return;
        p.common("users", ...USERS);
        expect(p.run("migrate", "--all-tenants").code).toBe(0);
        p.addSeed("other", `INSERT INTO ${p.names.beta}.users (id, name) VALUES (1, 'x');`);
        const r = p.run("seed", "--tenant", p.names.acme);
        expect(r.code).toBe(1);
        expect(r.output).toMatch(/Seed \S+-other.sql can't run for tenant/);
        expect(await p.tenantQuery(p.names.beta, "SELECT * FROM users")).toEqual([]);
    });

    it("make --tenant writes the file in the folder of the tenant", () => {
        const p = tenantsProject(dialect);
        const r = p.run("make", "vip", "--tenant", p.names.acme);
        expect(r.code, r.output).toBe(0);
        expect(readdirSync(join(p.dir, "tenants", p.names.acme))).toHaveLength(1);
        expect(existsSync(join(p.dir, "migrations")) ? readdirSync(join(p.dir, "migrations")) : []).toHaveLength(0);
    });

    it("a project with tenants runs on the main database as before without --tenant", async () => {
        const p = tenantsProject(dialect);
        p.common("users", ...USERS);
        const r = p.run("migrate");
        expect(r.code, r.output).toBe(0);
        expect(await p.tables()).toEqual(["users"]);
        expect(await p.tracked()).toHaveLength(1);
        expect(await p.tenantTables(p.names.acme)).toEqual([]);
    });

    it("fails with a clear message on unknown tenants, --all-tenants with other commands and repeated file names", () => {
        const p = tenantsProject(dialect);
        const unknown = p.run("migrate", "--tenant", "nobody");
        expect(unknown.code).toBe(1);
        expect(unknown.output).toMatch(new RegExp(`Unknown tenant nobody. Tenants: ${p.names.acme}, ${p.names.beta}, ${p.names.gamma}`));

        const rollback = p.run("rollback", "--all-tenants");
        expect(rollback.code).toBe(1);
        expect(rollback.output).toMatch(/rollback runs for one tenant at a time/);

        const both = p.run("migrate", "--tenant", p.names.acme, "--all-tenants");
        expect(both.output).toMatch(/Use --tenant or --all-tenants, not both/);

        const file = p.common("users", ...USERS);
        mkdirSync(join(p.dir, "tenants", p.names.acme), { recursive: true });
        writeFileSync(join(p.dir, "tenants", p.names.acme, file.replace(/^.*\//, "")), migrationText(...USERS));
        const repeated = p.run("migrate", "--tenant", p.names.acme);
        expect(repeated.code).toBe(1);
        expect(repeated.output).toMatch(/is in .*migrations and in .*tenants/);
    });

    it("asks once at the terminal for all the tenants", async () => {
        const p = tenantsProject(dialect);
        p.common("users", ...USERS);
        const no = await p.runInTerminal(["migrate", "--all-tenants"], { answer: "n" });
        expect(no.asked).toBe(true);
        expect(no.output).toMatch(new RegExp(`${p.names.acme}: 1 migration will be applied: \\S+-users.sql`));
        expect(no.output).toMatch(/Cancelled. Nothing was run/);
        expect(await p.tenantTables(p.names.acme)).toEqual([]);

        const yes = await p.runInTerminal(["migrate", "--all-tenants"], { answer: "y" });
        expect(yes.code, yes.output).toBe(0);
        expect(await p.tenantTables(p.names.gamma)).toEqual(["users"]);
    });

    it("reads the tenants from a JSON file", async () => {
        const p = tenantsProject(dialect);
        writeFileSync(join(p.dir, "tenants.json"), JSON.stringify([{ name: p.names.beta }]));
        p.updateConfig({ tenants: { file: "./tenants.json" } });
        p.common("users", ...USERS);
        const r = p.run("migrate", "--all-tenants");
        expect(r.code, r.output).toBe(0);
        expect(r.output).toMatch(/Tenants: 1 done/);
        expect(await p.tenantTables(p.names.beta)).toEqual(["users"]);
    });

    it("reads the tenants with a query on the main database", async () => {
        const p = tenantsProject(dialect);
        await p.setup([
            "CREATE TABLE clients (name VARCHAR(80), active INTEGER)",
            `INSERT INTO clients VALUES ('${p.names.acme}', 1), ('${p.names.beta}', 0), ('${p.names.gamma}', 1)`,
        ]);
        p.updateConfig({ tenants: { query: "SELECT name FROM clients WHERE active = 1 ORDER BY name" } });
        p.common("users", ...USERS);
        const r = p.run("migrate", "--all-tenants");
        expect(r.code, r.output).toBe(0);
        expect(r.output).toMatch(/Tenants: 2 done/);
        expect(await p.tenantTables(p.names.acme)).toEqual(["users"]);
        expect(await p.tenantTables(p.names.beta)).toEqual([]);
        expect(await p.tenantTables(p.names.gamma)).toEqual(["users"]);
    });

    it("two tenants can't use the same target", () => {
        const p = tenantsProject(dialect);
        const same = dialect === "sqlite" ? { database: "./db/same.db" } : dialect === "mysql" ? { database: "same_db" } : { schema: "same" };
        p.updateConfig({ tenants: { list: [{ name: p.names.acme, ...same }, { name: p.names.beta, ...same }] } });
        const r = p.run("status", "--all-tenants");
        expect(r.code).toBe(1);
        expect(r.output).toMatch(new RegExp(`Tenants ${p.names.acme} and ${p.names.beta} use the same database`));
    });

    it("migrates different tenants at the same time: each tenant has its own lock", async () => {
        const p = tenantsProject(dialect);
        const slow = dialect === "mysql" ? "DO SLEEP(1.5);" : dialect === "postgres" ? "SELECT pg_sleep(1.5);" : "SELECT 1;";
        p.common("slow", `CREATE TABLE slow (id INTEGER PRIMARY KEY);\n${slow}`, "DROP TABLE slow;");
        const started = Date.now();
        const results = await Promise.all([
            p.runAsync("migrate", "--tenant", p.names.acme, "--lock-timeout", "0.5"),
            p.runAsync("migrate", "--tenant", p.names.beta, "--lock-timeout", "0.5"),
        ]);
        for (const r of results) expect(r.code, r.output).toBe(0);
        expect(await p.tenantTables(p.names.acme)).toEqual(["slow"]);
        expect(await p.tenantTables(p.names.beta)).toEqual(["slow"]);
        expect(Date.now() - started).toBeLessThan(15_000);
    });
});

describe.each(["mysql", "postgres"] as const)("tenants on other databases and servers [%s]", (dialect) => {
    it("a tenant with url uses that connection; an empty env var fails without touching the main database", async () => {
        const p = tenantsProject(dialect);
        await p.setup([]);
        const other = `${p.database}_url`;
        p.extraDatabases.push(other);
        const c = DB[dialect];
        const scheme = dialect === "mysql" ? "mysql" : "postgres";
        p.env.ACME_URL = `${scheme}://${c.user}:${c.password}@${c.host}:${c.port}/${other}`;
        p.updateConfig({ tenants: { list: [{ name: p.names.acme, url: "ACME_URL" }, { name: p.names.beta, url: "BETA_URL" }] } });
        p.common("users", ...USERS);

        const r = p.run("migrate", "--tenant", p.names.acme);
        expect(r.code, r.output).toBe(0);
        expect(r.output).not.toContain(c.password);
        const tables = dialect === "mysql"
            ? await queryOn("mysql", other, "", "SHOW TABLES")
            : await queryOn("postgres", other, "", "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        expect(tables.map(row => String(Object.values(row)[0])).sort()).toEqual(["ez_migration", "ez_seed", "users"]);

        const empty = p.run("migrate", "--tenant", p.names.beta);
        expect(empty.code).toBe(1);
        expect(empty.output).toMatch(/The env var BETA_URL of tenant .* is empty/);
        expect(await p.tables()).toEqual([]);
    });

    it("a tenant with database uses another database of the same server", async () => {
        const other = `ezm_db_${Math.random().toString(16).slice(2, 10)}`;
        const p = tenantsProject(dialect);
        p.extraDatabases.push(other);
        p.updateConfig({ tenants: { list: [{ name: p.names.acme, database: other }] } });
        p.common("users", ...USERS);
        const r = p.run("migrate", "--all-tenants");
        expect(r.code, r.output).toBe(0);
        const rows = dialect === "mysql"
            ? await queryOn("mysql", other, "", "SELECT path FROM ez_migration")
            : await queryOn("postgres", other, "", "SELECT path FROM ez_migration");
        expect(rows).toHaveLength(1);
    });
});

describe("tenants [postgres] schemas", () => {
    it("objects go to the schema of the tenant, also with the default schema search_path", async () => {
        const p = tenantsProject("postgres");
        p.common("users", "CREATE TABLE users (id INTEGER PRIMARY KEY);\nCREATE INDEX users_id ON users (id);", "DROP TABLE users;");
        expect(p.run("migrate", "--all-tenants").code).toBe(0);
        const rows = await queryOn("postgres", p.database, "", "SELECT schemaname, tablename FROM pg_tables WHERE tablename = 'users' ORDER BY schemaname");
        expect(rows.map(r => r.schemaname)).toEqual([p.names.acme, p.names.beta, p.names.gamma]);
        expect(await p.tenantQuery(p.names.acme, "SELECT count(*)::int AS n FROM users")).toEqual([{ n: 0 }]);
    });

    it("rejects SET search_path and changes to public", () => {
        const p = tenantsProject("postgres");
        p.common("path", "SET search_path TO public;\nCREATE TABLE x (id INTEGER);", "DROP TABLE x;");
        const r = p.run("migrate", "--tenant", p.names.acme);
        expect(r.code).toBe(1);
        expect(r.output).toMatch(/it changes the search_path/);

        const q = tenantsProject("postgres");
        q.common("pub", "CREATE TABLE public.x (id INTEGER);", "DROP TABLE public.x;");
        const r2 = q.run("migrate", "--tenant", q.names.acme);
        expect(r2.code).toBe(1);
        expect(r2.output).toMatch(/it changes an object of public, outside the tenant/);
    });

    it("baseline and schema work on the schema of the tenant", async () => {
        const p = tenantsProject("postgres");
        await p.setup([`CREATE SCHEMA "${p.names.acme}"`, `CREATE TABLE "${p.names.acme}".items (id INTEGER PRIMARY KEY, label TEXT)`]);
        const schema = p.run("schema", "--tenant", p.names.acme);
        expect(schema.code, schema.output).toBe(0);
        expect(schema.output).toMatch(/CREATE TABLE items/);
        expect(schema.output).not.toContain(`${p.names.acme}.`);

        const baseline = p.run("baseline", "--tenant", p.names.acme);
        expect(baseline.code, baseline.output).toBe(0);
        expect(readdirSync(join(p.dir, "tenants", p.names.acme))).toHaveLength(1);
        expect(await p.tenantTracked(p.names.acme)).toHaveLength(1);
        // Other tenants don't get the baseline of acme
        const status = p.run("status", "--tenant", p.names.beta);
        expect(status.output).toMatch(/No migrations/);
    });
});

describe("tenants [mysql] databases", () => {
    it("rejects USE and changes to other databases", () => {
        const p = tenantsProject("mysql");
        p.common("use", `USE ${p.names.beta};\nCREATE TABLE x (id INTEGER);`, "DROP TABLE x;");
        const r = p.run("migrate", "--tenant", p.names.acme);
        expect(r.code).toBe(1);
        expect(r.output).toMatch(/it changes the database in use \(USE\)/);
    });
});

describe("tenants [sqlite] files", () => {
    it("each tenant has its file and a tracker file next to it", async () => {
        const p = tenantsProject("sqlite");
        p.common("users", ...USERS);
        expect(p.run("migrate", "--all-tenants").code).toBe(0);
        const files = readdirSync(join(p.dir, "db", "tenants")).filter(f => !f.endsWith(".lock")).sort();
        expect(files).toEqual([p.names.acme, p.names.beta, p.names.gamma].flatMap(n => [`${n}.db`, `${n}.tracker.db`]).sort());
    });
});

describe("crossTenantProblem", () => {
    const config = (dialect: "mysql" | "postgres") => ({ dialect, sqlitePath: "./db", tenants: { list: [] } }) as unknown as Config;
    const tenants = (dialect: "mysql" | "postgres"): Array<ResolvedTenant> =>
        ["acme", "beta"].map(name => resolveTenant(config(dialect), { name }));
    const problem = (dialect: "mysql" | "postgres", sql: string) => {
        const [acme, beta] = tenants(dialect);
        return crossTenantProblem(dialect, sql, acme, [beta]);
    };

    it("allows normal migrations", () => {
        for (const dialect of ["mysql", "postgres"] as const) {
            expect(problem(dialect, "CREATE TABLE users (id INT, email VARCHAR(50) DEFAULT 'beta.example.com');")).toBeNull();
            expect(problem(dialect, "-- beta.users is not used\nCREATE TABLE t (id INT);")).toBeNull();
            expect(problem(dialect, "CREATE VIEW v AS SELECT u.id FROM users u JOIN orders o ON u.id = o.user_id;")).toBeNull();
            expect(problem(dialect, "CREATE TABLE acme.t (id INT);")).toBeNull();
            expect(problem(dialect, "ALTER TABLE users ADD COLUMN beta INT;")).toBeNull();
        }
        // A foreign key or a function of the shared schema reads it, it doesn't change it
        expect(problem("postgres", "CREATE TABLE t (id uuid DEFAULT public.gen_random_uuid(), plan INT REFERENCES public.plans(id));")).toBeNull();
    });

    it("finds changes outside the tenant", () => {
        expect(problem("postgres", "CREATE TABLE beta.t (id INT);")).toMatch(/uses beta, the schema of tenant beta/);
        expect(problem("postgres", 'INSERT INTO "beta"."t" SELECT * FROM x;')).toMatch(/uses beta/);
        expect(problem("postgres", "SELECT 1; SELECT * FROM beta . t;")).toMatch(/uses beta/);
        expect(problem("postgres", "DROP TABLE public.users;")).toMatch(/changes an object of public/);
        expect(problem("postgres", "CREATE INDEX i ON public.users (id);")).toMatch(/changes an object of public/);
        expect(problem("postgres", "CREATE TRIGGER t BEFORE INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION f();")).toMatch(/changes an object of public/);
        expect(problem("postgres", "ALTER TABLE users SET SCHEMA public;")).toMatch(/moves an object/);
        expect(problem("postgres", "SET LOCAL search_path TO public;")).toMatch(/search_path/);
        expect(problem("postgres", "DROP SCHEMA acme CASCADE;")).toMatch(/schema or database/);
        expect(problem("mysql", "USE beta;")).toMatch(/USE/);
        expect(problem("mysql", "RENAME TABLE users TO other.users;")).toMatch(/changes an object of other/);
        expect(problem("mysql", "CREATE TABLE `beta`.t (id INT);")).toMatch(/uses beta, the database of tenant beta/);
    });
});

describe("tenants config", () => {
    it("without tenants in the config, --tenant fails and nothing runs", async () => {
        const p = createProject("sqlite");
        try {
            p.addMigration("users", ...USERS);
            const r = p.run("migrate", "--tenant", "acme");
            expect(r.code).toBe(1);
            expect(r.output).toMatch(/There are no "tenants" in ez-migrate.json/);
            expect(await p.tables()).toEqual([]);
        } finally {
            await p.cleanup();
        }
    });

    it("validates names and sources", async () => {
        const p = createProject("sqlite");
        try {
            p.updateConfig({ tenants: { list: [{ name: "bad name" }] } });
            expect(p.run("status", "--all-tenants").output).toMatch(/Invalid tenant name "bad name"/);
            p.updateConfig({ tenants: { list: [], query: "SELECT 1" } });
            expect(p.run("status", "--all-tenants").output).toMatch(/needs one of "list", "file" or "query"/);
            p.updateConfig({ tenants: { list: [{ name: "a" }, { name: "a" }] } });
            expect(p.run("status", "--all-tenants").output).toMatch(/Tenant a is twice/);
            p.updateConfig({ tenants: { list: [{ name: "a", schema: "x" }] } });
            expect(p.run("status", "--all-tenants").output).toMatch(/SQLite has no schemas/);
            // init and version ignore the tenant options
            expect(p.run("version", "--tenant", "x").code).toBe(0);
        } finally {
            await p.cleanup();
        }
    });

    it("--all-tenants with an empty list says so", async () => {
        const p = createProject("sqlite");
        try {
            p.updateConfig({ tenants: { list: [] } });
            const r = p.run("migrate", "--all-tenants");
            expect(r.code).toBe(0);
            expect(r.output).toMatch(/No tenants/);
        } finally {
            await p.cleanup();
        }
    });
});
