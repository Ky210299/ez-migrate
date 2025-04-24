import sqlite from "node:sqlite";
import type { DatabaseSync } from "node:sqlite";

export default class SqliteConnection implements SqliteConnection {
    private readonly db: DatabaseSync;
    readonly DBMSName: string = "sqlite";
    readonly path: string

    constructor(path: string) {
        this.path = path;
        this.db = new sqlite.DatabaseSync(this.path);
    }
    
    async init() {
        return;
    }

    async isConnected(): Promise<boolean> {
        try {
            this.db.exec("SELECT 1");
            return true;
        } catch (err) {
            console.error("Cannot connect to  Sqlite\n", err);
            return false;
        }
    }
    async runSQL(sql: string): Promise<any> {
        return this.db.prepare(sql).all();
    }
    
    async close() {
        this.db.close();
    }
}
