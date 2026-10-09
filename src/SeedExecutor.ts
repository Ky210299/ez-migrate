import DatabaseConnector from "./DatabaseConnector";
import { normalizeSQL } from "./sql";

export default class SeedExecutor {
    private readonly connection: DatabaseConnector
    constructor(connection: DatabaseConnector) {
        if (connection == null) throw new Error("Invalid Seed Executor constructor");
        this.connection = connection;
    }
    
    /** Run all seeds in one transaction */
    async execute(sql: Array<string>) {
        await this.connection.testConnection()
        await this.connection.initConnection()
        // A new line before the separator avoids joining the ";" to a trailing "-- comment"
        await this.connection.runSQL(sql.map(s => normalizeSQL(s).endsWith(";") ? s : s + "\n;").join("\n"));
    }
    async close(){
        await this.connection.close()
    }
}
