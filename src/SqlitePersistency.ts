import sqlite from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Persistency, TRACKER_SCHEMA, Commit, Rollback, TABLE_NAME, MIGRATION_COLUMNS, migrationValues } from "./Repository.js";
import Migration, { MigrationData } from "./Migration.js";

import type { DatabaseSync } from "node:sqlite";
import { consoleLogger } from "./Logger.js";

type DBMigrationData =
    Pick<MigrationData, "path" | "up" | "down"> 
    &
    { batch_id: MigrationData["batchId"], migrated_at: MigrationData["migratedAt"] };
type SqlitePersistencyArguments = { trackerPath: string };

function toMigration(m: DBMigrationData) {
    return new Migration({ ...m, batchId: m.batch_id, migratedAt: m.migrated_at });
}

export default class SqlitePersistency implements Persistency {
    private readonly MIGRATION_TABLE = TABLE_NAME;
    private readonly db: DatabaseSync;
    
    private checkSchema() {
        const query = this.db.prepare(`
            SELECT * FROM sqlite_schema
            WHERE 
                type = 'table' AND
                name = '${this.MIGRATION_TABLE}'
        `);
        const currentSchema = query.get();
        // SQLite stores the CREATE TABLE statement without "IF NOT EXISTS"
        const normalize = (sql: unknown) => String(sql).replace(/IF NOT EXISTS/i, "").replace(/\s+/g, " ").trim();

        if (currentSchema == null) this.db.exec(TRACKER_SCHEMA);
        else if (normalize(currentSchema.sql) !== normalize(TRACKER_SCHEMA)) {
            throw new Error(
                `Invalid Schema:\ncurrent: ${currentSchema.sql}\nvs\nneeded: ${TRACKER_SCHEMA}`,
            );
        }
    }

    /** Stores the tracker in <trackerPath>/tracker.db */
    constructor({ trackerPath }: SqlitePersistencyArguments) {
        mkdirSync(trackerPath, { recursive: true });
        this.db = new sqlite.DatabaseSync(join(trackerPath, "tracker.db"));
        this.checkSchema()
    }
    async init() {
    }

    /** Begins a transaction, runs the statement and returns the commit and rollback functions */
    private async inTransaction(sql: string, values: Array<string | null>, action: string) {
        this.db.exec("BEGIN TRANSACTION");
        const commit: Commit = async () => {
            this.db.exec("COMMIT")
        };
        const rollback: Rollback = async () => {
            this.db.exec("ROLLBACK");
            consoleLogger.warn(`SQLite tracker rollback successfuly at ${action}`)
        }
        try {
            this.db.prepare(sql).run(...values);
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
    }
    
    async removeMigrations(migrations: Array<MigrationData>) {
        const placeholders = migrations.map(() => "?").join(",")
        const sql = `DELETE FROM ${TABLE_NAME} WHERE migrated_at IN (${placeholders})`
        return this.inTransaction(sql, migrations.map(m => m.migratedAt), "remove migrations");
    }
    
    async removeMigration(migration: MigrationData) {
        const sql = `DELETE FROM ${TABLE_NAME} WHERE migrated_at = ?`
        return this.inTransaction(sql, [migration.migratedAt], "remove migration");
    }

    async list() {
        const rows = this.db.prepare(`SELECT * FROM ${this.MIGRATION_TABLE} ORDER BY migrated_at`).all();
        return (rows as unknown as Array<DBMigrationData>).map(toMigration);
    }

    async getLastMigrationDone() {
        const row = this.db.prepare(`SELECT * FROM ${TABLE_NAME} ORDER BY migrated_at DESC LIMIT 1`).get();
        return row != null ? toMigration(row as unknown as DBMigrationData) : null;
    }
    
    async getLastBatchMigrationDone() {
        const rows = this.db.prepare(`
                SELECT * FROM ${TABLE_NAME}
                WHERE batch_id = (
                    SELECT batch_id FROM ${TABLE_NAME} ORDER BY migrated_at DESC LIMIT 1
                )
                ORDER BY migrated_at DESC
            `).all() as unknown as Array<DBMigrationData>;
        if (rows.length === 0) return null;
        return rows.map(toMigration)
    }
    async close() {
        this.db.close()
    }
}
