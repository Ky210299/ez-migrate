import { Pool, PoolConnection, createConnection, createPool, PoolOptions } from "mysql2/promise";

import { Persistency, TRACKER_SCHEMA, Commit, Rollback, TABLE_NAME, EXPECTED_SCHEMA, MIGRATION_COLUMNS, migrationValues } from "./Repository.js";
import Migration, { MigrationData } from "./Migration.js";
import { consoleLogger } from "./Logger.js";

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
    private db: Pool | null = null;

    constructor({ user, password, port, host, database }: PoolOptions) {
        this.host = host ?? "localhost";
        this.user = user ?? "root";
        this.password = password ?? "";
        this.port = port ?? 3306;
        this.database = database ?? this.MIGRATION_DATABASE;
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

    async init() {
        if (this.db != null) return;
        const options = { host: this.host, user: this.user, password: this.password, port: this.port };
        const connection = await createConnection(options);
        try {
            await connection.query(`CREATE DATABASE IF NOT EXISTS \`${this.database.replace(/`/g, "``")}\``);
        } finally {
            await connection.end();
        }
        this.db = createPool({ ...options, database: this.database, connectionLimit: 1 });
        await this.checkSchema();
    }

    /**
     * Runs the statement in a new transaction and returns the commit and rollback
     * functions. Both release the connection.
     */
    private async inTransaction(sql: string, values: Array<string | null>, action: string) {
        const connection: PoolConnection = await this.pool.getConnection();
        await connection.beginTransaction();
        const commit: Commit = async () => {
            await connection.commit()
            connection.release()
        };
        const rollback: Rollback = async () => {
            await connection.rollback()
            connection.release()
            consoleLogger.warn(`MySQL tracker rollback successfuly at ${action}`)
        }
        try {
            await connection.execute(sql, values);
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
        return this.inTransaction(sql, migrations.flatMap(migrationValues), "save migration");
    };

    async removeMigrations(migrations: Array<MigrationData>) {
        const placeholders = migrations.map(() => "?").join(",")
        const sql = `DELETE FROM ${TABLE_NAME} WHERE migrated_at IN (${placeholders})`
        return this.inTransaction(sql, migrations.map(m => m.migratedAt), "remove migrations");
    };

    async removeMigration(migration: MigrationData) {
        const sql = `DELETE FROM ${TABLE_NAME} WHERE migrated_at = ?`
        return this.inTransaction(sql, [migration.migratedAt], "remove migration");
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

    async close(): Promise<void>{
        await this.db?.end();
        this.db = null;
    };
}
