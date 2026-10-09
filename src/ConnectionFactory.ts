import { join } from "node:path";
import { MIGRATIONS_DIALECTS } from "./constants"
import MysqlConnection from "./mysql"
import DatabaseConnector from "./DatabaseConnector"
import { Config } from "./types";
import SqliteConnection from "./sqlite";
import { consoleLogger } from "./Logger";
import PostgresConnectionImpl from "./Postgres";
import { connectionDataFromEnv } from "./utils";

/** Create DBMS connections by they dialect. Throw if doesn't support the dialect */
export default class ConnectionFactory {
    private constructor() { throw new Error("Not constructor allow for ConnectionFactory") };
    static create(config: Config) {
        const { dialect, envKeys } = config
        switch (dialect) {
            case MIGRATIONS_DIALECTS.MYSQL: {
                const { host, user, password, port, database } = connectionDataFromEnv(envKeys);
                const mysqlConnection = new MysqlConnection({ host, user, password, port, database, logger: consoleLogger})
                return new DatabaseConnector(mysqlConnection, {logger: consoleLogger})
            }
            case MIGRATIONS_DIALECTS.SQLITE: {
                // For SQLite the "database" env var is the path of the database file
                const { database } = connectionDataFromEnv(envKeys);
                const path = database ?? join(config.sqlitePath, "database.db");
                const sqliteConnection = new SqliteConnection(path);
                return new DatabaseConnector(sqliteConnection, {logger: consoleLogger})
            }
            case MIGRATIONS_DIALECTS.POSTGRES: {
                const { host, user, password, port, database } = connectionDataFromEnv(envKeys);
                const postgresConnection = new PostgresConnectionImpl({ host, user, password, port, database, logger: consoleLogger });
                return new DatabaseConnector(postgresConnection, { logger: consoleLogger });
            }
            default: {
                throw new Error(`Migration dialect not supported: ${dialect}`);
            }
        }
    }
}
