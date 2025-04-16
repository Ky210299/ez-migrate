import sqlite from "node:sqlite";
import { Persistency, TRACKER_SCHEMA, Commit, Rollback, TABLE_NAME } from "./Repository.js";
import Migration, { MigrationData } from "./Migration.js";

import type { DatabaseSync } from "node:sqlite";

type SqlitePersistencyArguments = { trackerPath: string };

export default class SqlitePersistency implements Persistency {
    private readonly MIGRATION_TABLE = TABLE_NAME;
    private readonly MIGRATION_COLUMNS = {
        MIGRATED_AT: "migrated_at",
        UP: "up",
        DOWN: "down",
        PATH: "path",
    };
    private readonly db: DatabaseSync;
    
    private checkSchema() {
        const query = this.db.prepare(`
            SELECT * FROM sqlite_schema
            WHERE 
                type = 'table' AND
                name = '${this.MIGRATION_TABLE}'
        `);
        const currentSchema = query.get();

        if (currentSchema == null) this.db.exec(TRACKER_SCHEMA);
        else if (currentSchema.sql !== TRACKER_SCHEMA) {
            throw new Error(
                `Invalid Schema:\ncurrent: ${currentSchema.sql}\nvs\nneeded: ${TRACKER_SCHEMA}`,
            );
        }
    }

    constructor({ trackerPath }: SqlitePersistencyArguments) {
        const path = `${trackerPath}${trackerPath.endsWith("/") ? "" : "/"}tracker.db`
        this.db = new sqlite.DatabaseSync(path);
        this.checkSchema()
    }
    async save(migrations: Array<MigrationData>) {
        this.db.exec("BEGIN TRANSACTION");
        const columns = Object.values(this.MIGRATION_COLUMNS);

        const placeholders = new Array(migrations.length)
            .fill("(" + new Array(columns.length).fill("?").join(",") + ")")
            .join(",");

        const insert = this.db.prepare(`
            INSERT INTO ${this.MIGRATION_TABLE} (${columns.join(",")})
            VALUES ${placeholders}
            `);

        const values = migrations.flatMap((m) => Object.values(m));

        if (values.length !== migrations.length * columns.length) {
            throw new Error("Mismatch in values and placeholders count");
        }

        // Returns commit or rollback function that will be used
        // when the migration is done successfuly (commit) or not (rollback)
        const commit: Commit = async () => {
            this.db.exec("COMMIT")
            console.log("Commit tracker successfuly")
        };
        const rollback: Rollback = async () => {
            this.db.exec("ROLLBACK");
            console.warn("Rollback successfuly")
        }

        try {
            insert.run(...values);
        } catch (err) {
            console.error(err);
            throw new Error("Error tracking migration");
        } finally {
            return { commit, rollback };
        }
    }
    
    async remove(migrations: Array<MigrationData>) {
        this.db.exec("BEGIN TRANSACTION");
        const placeholders = new Array(migrations.length).fill("?").join(",")
        const values = migrations.map(m => m.path);
        const sql = `
                DELETE FROM ${TABLE_NAME} WHERE
                ${this.MIGRATION_COLUMNS.PATH} IN (${placeholders})
        `
        const q = this.db.prepare(sql)
        
        // Returns commit or rollback function that will be used
        // when the migration is done successfuly (commit) or not (rollback)
        const commit: Commit = async () => {
            this.db.exec("COMMIT")
            console.log("Commit tracker successfuly")
        };
        const rollback: Rollback = async () => {
            this.db.exec("ROLLBACK");
            console.warn("Rollback tracker successfuly")
        }
        
        try {
            q.run(...values);
        } catch (err) {
            console.error(err);
            throw new Error("Error tracking the migration")
        } finally {
            return { commit, rollback };
        }
    }
    async list() {
        const query = this.db.prepare(`
            SELECT * FROM ${this.MIGRATION_TABLE};
            `);
        return query.all() as unknown as Migration[];
    }

    async getLastMigrationDone() {
        const query = this.db.prepare(`
                SELECT * FROM ${TABLE_NAME} 
                ORDER BY ${this.MIGRATION_COLUMNS.MIGRATED_AT} DESC LIMIT 1
            `);
        const migrationData = query.get() as MigrationData
        return migrationData != null ? new Migration(migrationData) : null;
    }
}