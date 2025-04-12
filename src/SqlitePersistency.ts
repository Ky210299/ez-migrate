import sqlite from "node:sqlite";
import type { DatabaseSync } from "node:sqlite";
import { Persistency, TRACKER_SCHEMA, Commit, Rollback, TABLE_NAME } from "./Repository.js";

import Migration, { MigrationData } from "./Migration.js";

import type { DatabaseSync } from "node:sqlite";

type SqlitePersistencyArguments = { sqlitePath: string, migrationsPath: string };

export class SqlitePersistency implements Persistency {
    private readonly MIGRATION_TABLE = TABLE_NAME;
    private readonly MIGRATION_COLUMNS = {
        MIGRATED_AT: "migrated_at",
        UP: "up",
        DOWN: "down",
        PATH: "path",
    };
    private readonly db: DatabaseSync;

    constructor({ sqlitePath, migrationsPath }: SqlitePersistencyArguments) {
        let path = "";
        if (sqlitePath != null && typeof sqlitePath === "string") {
            const hasSlash = sqlitePath.endsWith("/");
            path = sqlitePath + (hasSlash ? "" : "/");
        } else if (migrationsPath != null && typeof migrationsPath === "string") {
            const hasSlash = migrationsPath.endsWith("/");
            path = migrationsPath + (hasSlash ? "" : "/");
        } else path = "./migrations/";

        this.db = new sqlite.DatabaseSync(`${path}tracker.db`);

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
    async save(migrations: Array<MigrationData>): Promise<{ commit: Commit; rollback: Rollback }> {
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
        const commit = async () => this.db.exec("COMMIT");
        const rollback = async () => this.db.exec("ROLLBACK");

        try {
            insert.run(...values);
        } catch (err) {
            console.error(err);
            rollback();
            process.exit("Error saving the migration");
        }
        return { commit, rollback };
    }
    async list(): Promise<Array<Migration>> {
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
        return query.get() as MigrationData;
    }
}
