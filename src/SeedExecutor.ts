import DatabaseConnector from "./DatabaseConnector";

export default class SeedExecutor {
    private readonly connection: DatabaseConnector
    constructor(connection: DatabaseConnector) {
        if (connection == null) throw new Error("Invalid Seed Executor constructor");
        this.connection = connection;
    }
    
    async execute(sql: Array<string>) {
        await this.connection.runSQL(sql.join(" "));
    }
}