import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createConnection } from "mysql2/promise";
import { Client } from "pg";

export const CLI = resolve(__dirname, "../dist/ez-migrate.js");

export type Dialect = "mysql" | "postgres" | "sqlite";
export const DIALECTS: Array<Dialect> = ["mysql", "postgres", "sqlite"];

/** Connection data of the databases started with docker-compose.yml */
export const DB = {
    mysql: {
        host: process.env.EZM_MYSQL_HOST ?? "127.0.0.1",
        port: Number(process.env.EZM_MYSQL_PORT ?? 33306),
        user: "root",
        password: "ezmigrate",
    },
    postgres: {
        host: process.env.EZM_POSTGRES_HOST ?? "127.0.0.1",
        port: Number(process.env.EZM_POSTGRES_PORT ?? 55432),
        user: "postgres",
        password: "ezmigrate",
    },
} as const;

export interface RunResult {
    code: number | null;
    output: string;
}

export interface Project {
    dir: string;
    dialect: Dialect;
    database: string;
    /** Run the built CLI inside the project directory */
    run: (...args: Array<string>) => RunResult;
    /** Write a migration file with the ez-migrate template */
    addMigration: (name: string, up: string, down: string) => string;
    /** Write a seed file */
    addSeed: (name: string, sql: string) => string;
    /** Names of the tables in the target database (tracker table excluded) */
    tables: () => Promise<Array<string>>;
    /** Run a query in the target database and return the rows */
    query: (sql: string) => Promise<Array<Record<string, unknown>>>;
    /** Rows of the tracker table */
    tracked: () => Promise<Array<Record<string, unknown>>>;
    cleanup: () => Promise<void>;
}

let counter = 0;
/** Unique, sortable prefix so files keep the creation order */
function prefix() {
    counter++;
    return `2025-01-01T00:00:00.000.${String(counter).padStart(8, "0")}`;
}

function uniqueName() {
    return `ezm_${randomBytes(4).toString("hex")}`;
}

/** Create a temp project with an ez-migrate.json for the dialect. The tracker uses the same DBMS */
export function createProject(dialect: Dialect): Project {
    const dir = mkdtempSync(join(tmpdir(), `ezm-${dialect}-`));
    const database = uniqueName();
    const env: Record<string, string> = {};
    const config: Record<string, unknown> = {
        dialect,
        migrationsPath: "./migrations",
        seedsPath: "./seeds",
        envKeys: {
            user: "DB_USER",
            password: "DB_PASSWORD",
            port: "DB_PORT",
            host: "DB_HOST",
            database: "DB_NAME",
        },
    };
    if (dialect === "sqlite") {
        config.sqlitePath = "./db";
        mkdirSync(join(dir, "db"));
        env.DB_NAME = "./db/app.db";
    } else {
        const conn = DB[dialect];
        Object.assign(env, {
            DB_USER: conn.user,
            DB_PASSWORD: conn.password,
            DB_PORT: String(conn.port),
            DB_HOST: conn.host,
            DB_NAME: database,
        });
    }
    writeFileSync(join(dir, "ez-migrate.json"), JSON.stringify(config, null, 4));

    const run = (...args: Array<string>): RunResult => {
        const result = spawnSync(process.execPath, [CLI, ...args], {
            cwd: dir,
            env: { ...process.env, ...env, NO_COLOR: "1" },
            encoding: "utf8",
            timeout: 30_000,
        });
        return { code: result.status, output: `${result.stdout}${result.stderr}` };
    };

    const addMigration = (name: string, up: string, down: string) => {
        mkdirSync(join(dir, "migrations"), { recursive: true });
        const file = join(dir, "migrations", `${prefix()}-${name}.sql`);
        writeFileSync(
            file,
            `-- ez-migration-up\n${up}\n-- ez-migration-up\n-- ez-migration-down\n${down}\n-- ez-migration-down\n`,
        );
        return file;
    };

    const addSeed = (name: string, sql: string) => {
        mkdirSync(join(dir, "seeds"), { recursive: true });
        const file = join(dir, "seeds", `${prefix()}-${name}.sql`);
        writeFileSync(file, sql);
        return file;
    };

    const query = async (sql: string): Promise<Array<Record<string, unknown>>> => {
        if (dialect === "sqlite") {
            const db = new DatabaseSync(join(dir, "db", "app.db"));
            try {
                return db.prepare(sql).all() as Array<Record<string, unknown>>;
            } finally {
                db.close();
            }
        }
        if (dialect === "mysql") {
            const c = await createConnection({ ...DB.mysql, database });
            try {
                const [rows] = await c.query(sql);
                return rows as Array<Record<string, unknown>>;
            } finally {
                await c.end();
            }
        }
        const c = new Client({ ...DB.postgres, database });
        await c.connect();
        try {
            return (await c.query(sql)).rows;
        } finally {
            await c.end();
        }
    };

    const tables = async () => {
        let rows: Array<Record<string, unknown>>;
        if (dialect === "sqlite") {
            rows = await query("SELECT name AS t FROM sqlite_schema WHERE type = 'table'");
        } else if (dialect === "mysql") {
            rows = await query(
                `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = '${database}'`,
            );
        } else {
            rows = await query(
                "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public'",
            );
        }
        return rows
            .map((r) => String(r.t ?? r.T ?? r.TABLE_NAME))
            .filter((t) => t !== "ez_migration")
            .sort();
    };

    const tracked = async () => {
        if (dialect === "sqlite") {
            const db = new DatabaseSync(join(dir, "db", "tracker.db"));
            try {
                return db.prepare("SELECT * FROM ez_migration ORDER BY migrated_at").all() as Array<
                    Record<string, unknown>
                >;
            } finally {
                db.close();
            }
        }
        return query("SELECT * FROM ez_migration ORDER BY migrated_at");
    };

    const cleanup = async () => {
        rmSync(dir, { recursive: true, force: true });
        if (dialect === "mysql") {
            const c = await createConnection({ ...DB.mysql });
            await c.query(`DROP DATABASE IF EXISTS ${database}`);
            await c.end();
        } else if (dialect === "postgres") {
            const c = new Client({ ...DB.postgres, database: "postgres" });
            await c.connect();
            await c.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
            await c.end();
        }
    };

    return { dir, dialect, database, run, addMigration, addSeed, tables, query, tracked, cleanup };
}
