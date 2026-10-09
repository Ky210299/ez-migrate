import { Client, ClientConfig, QueryResult } from "pg"
import { consoleLogger } from "./Logger.js";

import { Persistency, TRACKER_SCHEMA, Commit, Rollback, TABLE_NAME, EXPECTED_SCHEMA, MIGRATION_COLUMNS, migrationValues } from "./Repository.js";
import Migration, { MigrationData } from "./Migration.js";
import { MigrateError } from "./Errors.js";
import DialectTranslator, { TranslatableKeyword } from "./DialectTraductor.js";

type DBMigrationData =
    Pick<MigrationData, "path" | "up" | "down">
    &
    { batch_id: MigrationData["batchId"], migrated_at: MigrationData["migratedAt"] };

function toMigration(m: DBMigrationData) {
    return new Migration({ ...m, batchId: m.batch_id, migratedAt: m.migrated_at });
}

export default class PGTracker implements Persistency {
    private readonly MIGRATION_TABLE = TABLE_NAME;
    
    readonly DBMSName: string = "postgres";
    readonly host: string;
    readonly user: string;
    readonly password: string | (() => string | Promise<string>);
    readonly database: string;
    readonly port: number;
    private db: Client | null = null;
    constructor({ user, password, port, host, database }: ClientConfig) {
        this.host = host ?? "localhost";
        this.user = user ?? "postgres";
        this.password = password ?? "";
        this.port = port ?? 5432;
        this.database = database ?? "postgres";
    }

    private newClient(database: string) {
        return new Client({
            host: this.host,
            user: this.user,
            password: this.password,
            port: this.port,
            database,
        });
    }

    private get client(): Client {
        if (this.db == null) throw new Error("Postgres tracker is not initialized");
        return this.db;
    }

    /** Creates the tracker database if it doesn't exist */
    private async ensureTrackerDatabase() {
        // Connect to the default database to check if the tracker database exists
        const admin = this.newClient("postgres");
        await admin.connect();
        try {
            const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [this.database]);
            if (!rowCount) {
                await admin.query(`CREATE DATABASE "${this.database.replace(/"/g, '""')}"`);
                consoleLogger.info(`"${this.database}" database created`)
            }
        } finally {
            await admin.end();
        }
    }
    
    private async checkSchema() {
        const { rows: cols } = await this.client.query(`
            SELECT c.column_name, c.data_type
            FROM information_schema.columns c
            WHERE c.table_schema = current_schema() AND c.table_name = $1
        `, [this.MIGRATION_TABLE]);
        if (cols.length === 0) {
            await this.client.query(TRACKER_SCHEMA);
            consoleLogger.info(`Created table ${this.MIGRATION_TABLE} for migration tracking`);
            return
        }
        for (const expected of EXPECTED_SCHEMA) {
            const current = cols.find(c => c.column_name === expected.name)
            if (!current) throw new MigrateError(`Missing column ${expected.name} in tracker table`);
            const type = DialectTranslator.translate("postgres", "mysql", current.data_type.toUpperCase() as TranslatableKeyword);
            if (type !== expected.type) throw new MigrateError(`Invalid type of column ${expected.name} in tracker table`);
        }
    }
    
    async init() {
        if (this.db != null) return
        await this.ensureTrackerDatabase();
        const client = this.newClient(this.database);
        await client.connect();
        this.db = client;
        await this.checkSchema();
    }

    /** Begins a transaction, runs the statement and returns the commit and rollback functions */
    private async inTransaction(sql: string, values: Array<string | null>, action: string) {
        await this.client.query("BEGIN");
        const commit: Commit = async () => {
            await this.client.query("COMMIT")
        };
        const rollback: Rollback = async () => {
            await this.client.query("ROLLBACK")
            consoleLogger.warn(`Postgres tracker rollback successfuly at ${action}`)
        }
        try {
            await this.client.query(sql, values);
        } catch (err) {
            await rollback();
            throw new Error(`Error tracking the migration: ${err}`);
        }
        return { commit, rollback };
    }

    async save(migrations: Array<MigrationData>): Promise<{ commit: Commit; rollback: Rollback; }> {
        let idx = 1;
        const placeholders = migrations
            .map(() => "(" + MIGRATION_COLUMNS.map(() => `$${idx++}`).join(",") + ")")
            .join(",");
        const sql = `INSERT INTO ${this.MIGRATION_TABLE} (${MIGRATION_COLUMNS.join(",")}) VALUES ${placeholders}`;
        return this.inTransaction(sql, migrations.flatMap(migrationValues), "save migration");
    };
    
    async removeMigrations(migrations: Array<MigrationData>): Promise<{ commit: Commit; rollback: Rollback; }> { 
        const placeholders = migrations.map((_, i) => `$${i + 1}`).join(",")
        const sql = `DELETE FROM ${TABLE_NAME} WHERE migrated_at IN (${placeholders})`
        return this.inTransaction(sql, migrations.map(m => m.migratedAt), "remove migrations");
    };
    
    async removeMigration(migration: MigrationData): Promise<{ commit: Commit; rollback: Rollback; }> { 
        const sql = `DELETE FROM ${TABLE_NAME} WHERE migrated_at = $1`
        return this.inTransaction(sql, [migration.migratedAt], "remove migration");
    };
    
    async list(): Promise<Array<Migration>> { 
        const sql = `SELECT * FROM ${this.MIGRATION_TABLE} ORDER BY migrated_at`
        const { rows } = await this.client.query(sql) as QueryResult<DBMigrationData>;
        return rows.map(toMigration);
    };
    
    async getLastMigrationDone(): Promise<Migration | null> { 
        const sql = `SELECT * FROM ${TABLE_NAME} ORDER BY migrated_at DESC LIMIT 1`
        const { rows } = await this.client.query(sql) as QueryResult<DBMigrationData>;
        return rows.length === 0 ? null : toMigration(rows[0]);
    };
    
    async getLastBatchMigrationDone(): Promise<Array<Migration> | null> {
        const sql = `
            SELECT * FROM ${TABLE_NAME}
            WHERE batch_id = (
                SELECT batch_id FROM ${TABLE_NAME} ORDER BY migrated_at DESC LIMIT 1
            )
            ORDER BY migrated_at DESC
        `
        const { rows } = await this.client.query(sql) as QueryResult<DBMigrationData>
        if (rows.length === 0) return null;
        return rows.map(toMigration)
    };
    
    async close(): Promise<void> { 
        await this.db?.end()
        this.db = null;
    };
}
