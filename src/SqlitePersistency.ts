import sqlite from "node:sqlite";
import type { DatabaseSync } from "node:sqlite";
import {
    Persistency,
    TRACKER_SCHEMA,
    Migration,
    Commit,
    Rollback,
    TABLE_NAME,
} from "./Repository.js";
import ConfigReader from "./ConfigReader.js";

export class SqlitePersistency implements Persistency {
    private readonly MIGRATION_TABLE = TABLE_NAME;
    private readonly MIGRATION_COLUMNS = ["id", "sql", "date", "direction", "order_number"];
    private readonly db: DatabaseSync;

    constructor() {
        const { dbPath, migrationPath } = ConfigReader.getConfig();

        let path = "";
        if (dbPath != null && typeof dbPath === "string") {
            const hasSlash = dbPath.endsWith("/");
            path = dbPath + (hasSlash ? "" : "/");
        } else if (migrationPath != null && typeof migrationPath === "string") {
            const hasSlash = migrationPath.endsWith("/");
            path = migrationPath + (hasSlash ? "" : "/");
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
    async save(migrations: Array<Migration>): Promise<{ commit: Commit; rollback: Rollback }> {
        this.db.exec("BEGIN TRANSACTION");

        const placeholders = new Array(migrations.length)
            .fill("(" + new Array(this.MIGRATION_COLUMNS.length).fill("?").join(",") + ")")
            .join(",");

        const insert = this.db.prepare(`
            INSERT INTO ${this.MIGRATION_TABLE} (${this.MIGRATION_COLUMNS.join(",")})
            VALUES ${placeholders}
            `);

        const values = migrations.flatMap((m) => Object.values(m));

        if (values.length !== migrations.length * this.MIGRATION_COLUMNS.length) {
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
        return query.all() as Migration[];
    }
}
