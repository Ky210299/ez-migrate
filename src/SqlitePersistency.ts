import sqlite from "sqlite3";
import type { Database } from "sqlite3";
import type { Persistency, Migration, Commit, Rollback } from "./Repository.js";

class SqlitePersistency implements Persistency {
    private readonly MIGRATION_TABLE = "ez_migrations";
    private readonly MIGRATION_COLUMNS = ["id", "sql", "date", "direction", "order_number"];

    private readonly db: Database;
    constructor(dbPath: string) {
        this.db = new sqlite.Database(dbPath);
    }
    async save(migrations: Array<Migration>) {
        this.db.exec("BEGIN TRANSACTION");
        const values = [];
        for (const m of migrations) {
            values.push([m.id, m.sql, m.date, m.direction, m.orderNumber]);
        }
        this.db.exec(`
            INSERT INTO ${this.MIGRATION_TABLE}
            VALUES ${values.map((migrations, i) => {
                `(${migrations.flat().join(",")})${i >= values.length - 1 ? ";" : ","}`;
            })}
            `);

        const commit: Commit = async () => {
            this.db.exec("COMMIT");
            return;
        };
        const rollback: Rollback = async () => {
            this.db.exec("ROLLBACK");
            return;
        };
        return { commit, rollback };
    }
    async list(): Promise<Array<Migration>> {
        let results;
        this.db.all(`SELECT * FROM ${this.MIGRATION_TABLE}`, (err, rows: Migration[]) => {
            if (err != null) throw err;
            else results = rows;
        });
        return (results as unknown as Migration[]) ?? [];
    }
}
sqlite.verbose();
