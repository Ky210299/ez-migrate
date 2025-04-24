import DatabaseConnector from "./DatabaseConnector";

export default class SeedExecutor {
    private readonly connection: DatabaseConnector
    constructor(connection: DatabaseConnector) {
        if (connection == null) throw new Error("Invalid Seed Executor constructor");
        this.connection = connection;
    }
    
    async execute(sql: Array<string>) {
        await this.connection.testConnection()
        await this.connection.initConnection()
        await this.connection.runSQL(sql.map(s => s.endsWith(";") ? s : s + ";").join(" "));
    }
    async close(){
        await this.connection.close()
    }
}