import { Connection, Pool, PoolConnection, createConnection, createPool } from "mysql2/promise";
import type { ConnectionData, TlsOptions } from "./ConnectionOptions";

import { Persistency, TRACKER_SCHEMA, Commit, Rollback, TABLE_NAME, EXPECTED_SCHEMA, MIGRATION_COLUMNS, migrationValues, SEED_TABLE_NAME, SEED_TRACKER_SCHEMA, saveSeedsStatements } from "./Repository.js";
import Migration, { MigrationData } from "./Migration.js";
import { consoleLogger } from "./Logger.js";
import { LockTimeoutError } from "./Lock.js";

type DBMigrationData =
    Pick<MigrationData, "path" | "up" | "down">
    &
    { batch_id: MigrationData["batchId"], migrated_at: MigrationData["migratedAt"] };

function toMigration(m: DBMigrationData) {
    return new Migration({ ...m, batchId: m.batch_id, migratedAt: m.migrated_at });
}

export default class MysqlTracker implements Persistency{
    private readonly MIGRATION_TABLE = TABLE_NAME;
    private readonly MIGRATION_DATABASE = "ez_migration";
    
    readonly DBMSName: string = "mysql";
    readonly host: string;
    readonly user: string;
    readonly password: string | undefined;
    readonly database: string;
    readonly port: number;
    readonly ssl: TlsOptions | undefined;
    private db: Pool | null = null;
    /** Connection that holds the lock. MySQL locks belong to a connection */
    private lockConnection: Connection | null = null;
    private databaseReady = false;

    constructor({ user, password, port, host, database, ssl }: ConnectionData) {
        this.host = host ?? "localhost";
        this.user = user ?? "root";
        this.password = password ?? "";
        this.port = port ?? 3306;
        this.database = database ?? this.MIGRATION_DATABASE;
        this.ssl = ssl;
    }

    private get pool(): Pool {
        if (this.db == null) throw new Error("MySQL tracker is not initialized");
        return this.db;
    }

    private async checkSchema() {
        await this.pool.query(TRACKER_SCHEMA);
        const [result] = await this.pool.query(`SHOW COLUMNS FROM ${this.MIGRATION_TABLE}`) as unknown as [{
            Field: string
            Type: string
            Null: string
            Key: string
        }[]];
        for (const column of EXPECTED_SCHEMA) {
            const current = result.find(col => col.Field === column.name)
            if (current == null || !current.Type.toUpperCase().startsWith(column.type)) {
                throw new Error(`Invalid tracker table ${this.MIGRATION_TABLE}. Needed: ${TRACKER_SCHEMA}`);
            }
        }
    }

    private get options() {
        return { host: this.host, user: this.user, password: this.password, port: this.port, ssl: this.ssl };
    }

    private async ensureDatabase() {
        if (this.databaseReady) return;
        const connection = await createConnection(this.options);
        try {
            await connection.query(`CREATE DATABASE IF NOT EXISTS \`${this.database.replace(/`/g, "``")}\``);
        } finally {
            await connection.end();
        }
        this.databaseReady = true;
    }

    async init() {
        if (this.db != null) return;
        await this.ensureDatabase();
        this.db = createPool({ ...this.options, database: this.database, connectionLimit: 1 });
        await this.checkSchema();
        await this.pool.query(SEED_TRACKER_SCHEMA);
    }

    /** Lock name, unique per tracker database. MySQL allows 64 characters */
    private get lockName() {
        return `ez-migrate:${this.database}`.substring(0, 64);
    }

    async lock(timeoutMs: number) {
        await this.ensureDatabase();
        const connection = await createConnection({ ...this.options, database: this.database });
        const [[{ got }]] = await connection.query(
            "SELECT GET_LOCK(?, ?) AS got", [this.lockName, Math.ceil(timeoutMs / 1000)],
        ) as unknown as [[{ got: number | null }]];
        if (got !== 1) {
            await connection.end();
            throw new LockTimeoutError(timeoutMs);
        }
        this.lockConnection = connection;
    }

    async unlock() {
        if (this.lockConnection == null) return;
        const connection = this.lockConnection;
        this.lockConnection = null;
        try {
            await connection.query("SELECT RELEASE_LOCK(?)", [this.lockName]);
        } finally {
            // Closing the connection also releases the lock
            await connection.end();
        }
    }

    /**
     * Runs the statement in a new transaction and returns the commit and rollback
     * functions. Both release the connection.
     */
    private async inTransaction(statements: Array<{ sql: string, values: Array<string | null> }>, action: string) {
        const connection: PoolConnection = await this.pool.getConnection();
        await connection.beginTransaction();
        const commit: Commit = async () => {
            await connection.commit()
            connection.release()
        };
        const rollback: Rollback = async () => {
            await connection.rollback()
            connection.release()
            consoleLogger.debug(`MySQL tracker change rolled back (${action})`)
        }
        try {
            for (const { sql, values } of statements) await connection.execute(sql, values);
        } catch (err) {
            await rollback();
            throw new Error(`Error tracking the migration: ${err}`);
        }
        return { commit, rollback };
    }

    async save(migrations: Array<MigrationData>) {
        const placeholders = migrations
            .map(() => "(" + MIGRATION_COLUMNS.map(() => "?").join(",") + ")")
            .join(",");
        const sql = `INSERT INTO ${this.MIGRATION_TABLE} (${MIGRATION_COLUMNS.join(",")}) VALUES ${placeholders}`;
        return this.inTransaction([{ sql, values: migrations.flatMap(migrationValues) }], "save migration");
    };

    async removeMigrations(migrations: Array<MigrationData>) {
        const placeholders = migrations.map(() => "?").join(",")
        const sql = `DELETE FROM ${TABLE_NAME} WHERE migrated_at IN (${placeholders})`
        return this.inTransaction([{ sql, values: migrations.map(m => m.migratedAt) }], "remove migrations");
    };

    async removeMigration(migration: MigrationData) {
        const sql = `DELETE FROM ${TABLE_NAME} WHERE migrated_at = ?`
        return this.inTransaction([{ sql, values: [migration.migratedAt] }], "remove migration");
    };

    async list(): Promise<Array<Migration>> {
        const [migrations] = await this.pool.query(
            `SELECT * FROM ${this.MIGRATION_TABLE} ORDER BY migrated_at`,
        ) as unknown as [Array<DBMigrationData>];
        return migrations.map(toMigration);
    };

    async getLastMigrationDone() {
        const [rows] = await this.pool.query(
            `SELECT * FROM ${TABLE_NAME} ORDER BY migrated_at DESC LIMIT 1`,
        ) as unknown as [Array<DBMigrationData>];
        return rows.length === 0 ? null : toMigration(rows[0]);
    };

    async getLastBatchMigrationDone(): Promise<Array<Migration> | null>{
        // MySQL doesn't allow LIMIT in a IN/= subquery of the same table, so use two queries
        const last = await this.getLastMigrationDone();
        if (last == null) return null;
        const [rows] = await this.pool.query(
            `SELECT * FROM ${TABLE_NAME} WHERE batch_id = ? ORDER BY migrated_at DESC`,
            [last.getDetails().batchId],
        ) as unknown as [Array<DBMigrationData>];
        return rows.map(toMigration);
    };

    async listSeeds(): Promise<Array<string>> {
        const [rows] = await this.pool.query(`SELECT name FROM ${SEED_TABLE_NAME} ORDER BY name`) as unknown as [Array<{ name: string }>];
        return rows.map(r => r.name);
    }

    async saveSeeds(names: Array<string>, seededAt: string) {
        return this.inTransaction(saveSeedsStatements(names, seededAt, () => "?"), "save seeds");
    }

    async close(): Promise<void>{
        await this.unlock();
        await this.db?.end();
        this.db = null;
    };
}
