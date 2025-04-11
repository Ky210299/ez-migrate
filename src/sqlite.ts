import sqlite from "node:sqlite";
import type { DatabaseSync } from "node:sqlite";
import { Connection } from "./DatabaseConnector";

export default class SqliteConnection implements Connection {
    private readonly db: DatabaseSync;

    constructor() {
        this.db = new sqlite.DatabaseSync("testDB.db");
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
}
