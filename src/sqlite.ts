import sqlite from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Row, SqliteConnection as SqliteConnectionInterface } from "./DatabaseConnector";
import { consoleLogger } from "./Logger";
import { describeTarget } from "./utils";

export default class SqliteConnection implements SqliteConnectionInterface {
    private db: DatabaseSync | null = null;
    readonly DBMSName: string = "sqlite";
    readonly path: string

    constructor(path: string) {
        this.path = path;
    }

    private open(): DatabaseSync {
        if (this.db != null) return this.db;
        mkdirSync(dirname(this.path), { recursive: true });
        this.db = new sqlite.DatabaseSync(this.path);
        return this.db;
    }
    
    async init(migrationPath?: string, migrationDirection?: string) {
        this.open();
        consoleLogger.info(describeTarget(this.path, migrationPath, migrationDirection));
    }

    async isConnected(): Promise<boolean> {
        try {
            this.open().exec("SELECT 1");
            return true;
        } catch (err) {
            consoleLogger.error(`Cannot open SQLite database ${this.path}: ${err}`);
            return false;
        }
    }

    /** Run all the statements in a transaction. SQLite DDL is transactional */
    async runSQL(sql: string): Promise<void> {
        const db = this.open();
        db.exec("BEGIN");
        try {
            db.exec(sql);
            db.exec("COMMIT");
        } catch (err) {
            consoleLogger.error(`SQLite error during migration:\n${err}`);
            db.exec("ROLLBACK");
            throw err;
        }
    }
    
    async query(sql: string, values: Array<unknown> = []): Promise<Array<Row>> {
        return this.open().prepare(sql).all(...(values as Array<string | number | null>)) as Array<Row>;
    }

    async close() {
        this.db?.close();
        this.db = null;
    }
}
