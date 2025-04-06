import type DatabaseConnector from "./DatabaseConnector";

class MigrationExecutor {
    readonly dbconnector: DatabaseConnector;
    constructor(dbconnector: DatabaseConnector) {
        this.dbconnector = dbconnector;
    }
    async execute(sql: string) {
        await this.dbconnector.testConnection();
        await this.dbconnector.runSQL(sql);
    }
}

export default MigrationExecutor;
