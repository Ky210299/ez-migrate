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

type Rows = Array<Record<string, unknown>>;

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
    query: (sql: string) => Promise<Rows>;
    /** Rows of the tracker table */
    tracked: () => Promise<Rows>;
    /** Names of the seed files recorded as run */
    seeded: () => Promise<Array<string>>;
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

/** Env vars for a database. For SQLite the database is the file path */
function envFor(dialect: Dialect, keyPrefix: string, database: string): Record<string, string> {
    if (dialect === "sqlite") return { [`${keyPrefix}_NAME`]: `./db/${database}.db` };
    const conn = DB[dialect];
    return {
        [`${keyPrefix}_USER`]: conn.user,
        [`${keyPrefix}_PASSWORD`]: conn.password,
        [`${keyPrefix}_PORT`]: String(conn.port),
        [`${keyPrefix}_HOST`]: conn.host,
        [`${keyPrefix}_NAME`]: database,
    };
}

function envKeys(keyPrefix: string) {
    return {
        user: `${keyPrefix}_USER`,
        password: `${keyPrefix}_PASSWORD`,
        port: `${keyPrefix}_PORT`,
        host: `${keyPrefix}_HOST`,
        database: `${keyPrefix}_NAME`,
    };
}

async function queryOn(dialect: Dialect, database: string, sqliteFile: string, sql: string): Promise<Rows> {
    if (dialect === "sqlite") {
        const db = new DatabaseSync(sqliteFile);
        try {
            return db.prepare(sql).all() as Rows;
        } finally {
            db.close();
        }
    }
    if (dialect === "mysql") {
        const c = await createConnection({ ...DB.mysql, database });
        try {
            const [rows] = await c.query(sql);
            return rows as Rows;
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
}

async function dropDatabase(dialect: Dialect, database: string) {
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
}

/**
 * Create a temp project with an ez-migrate.json for the dialect.
 * Without trackerDialect the tracker uses the target database.
 */
export function createProject(dialect: Dialect, trackerDialect?: Dialect): Project {
    const dir = mkdtempSync(join(tmpdir(), `ezm-${dialect}-`));
    mkdirSync(join(dir, "db"));
    const database = uniqueName();
    const trackerDatabase = trackerDialect ? `${database}_tracker` : database;
    const env: Record<string, string> = envFor(dialect, "DB", database);
    const config: Record<string, unknown> = {
        dialect,
        migrationsPath: "./migrations",
        seedsPath: "./seeds",
        sqlitePath: "./db",
        envKeys: envKeys("DB"),
    };
    if (trackerDialect) {
        config.tracker = { dialect: trackerDialect, sqlitePath: "./db", envKeys: envKeys("TRACKER") };
        Object.assign(env, envFor(trackerDialect, "TRACKER", trackerDatabase));
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

    const query = (sql: string) => queryOn(dialect, database, join(dir, "db", `${database}.db`), sql);

    const tables = async () => {
        let rows: Rows;
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
            .map((r) => String(r.t))
            .filter((t) => t !== "ez_migration" && t !== "ez_seed")
            .sort();
    };

    // The SQLite tracker is always <sqlitePath>/tracker.db
    const queryTracker = (sql: string) =>
        queryOn(trackerDialect ?? dialect, trackerDatabase, join(dir, "db", "tracker.db"), sql);
    const tracked = () => queryTracker("SELECT * FROM ez_migration ORDER BY migrated_at");
    const seeded = async () =>
        (await queryTracker("SELECT name FROM ez_seed ORDER BY name")).map((r) => String(r.name));

    const cleanup = async () => {
        rmSync(dir, { recursive: true, force: true });
        await dropDatabase(dialect, database);
        if (trackerDialect) await dropDatabase(trackerDialect, trackerDatabase);
    };

    return { dir, dialect, database, run, addMigration, addSeed, tables, query, tracked, seeded, cleanup };
}
