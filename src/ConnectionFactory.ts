import { MIGRATIONS_DIALECTS } from "./constants"
import MysqlConnection from "./mysql"
import DatabaseConnector from "./DatabaseConnector"
import { Config } from "./types";
import SqliteConnection from "./sqlite";
import { consoleLogger } from "./Logger";

/** Create DBMS connections by they dialect. Throw if doesn't support the dialect */
export default class ConnectionFactory {
    private constructor() { throw new Error("Not constructor allow for ConnectionFactory") };
    static create(config: Config) {
        const { dialect, envKeys } = config
        if (Object.values(MIGRATIONS_DIALECTS).includes(dialect) === false) 
            throw new Error("Invalid Migration Dialect");
            
        switch (dialect) {
            case MIGRATIONS_DIALECTS.MYSQL: {
                try { process.loadEnvFile() } 
                catch (err) { consoleLogger.warn("Environment not loaded. Using default configurations") }
                const { env: ENV } = process;
                const connectionData = { 
                    host: ENV[envKeys.host],
                    user: ENV[envKeys.user], 
                    password: ENV[envKeys.password],
                    port: Number(ENV[envKeys.port]),
                    database: ENV[envKeys.database],
                }
                const { host, user, password, port, database } = connectionData;
                const mysqlConnection = new MysqlConnection({ host, user, password, port, database, logger: consoleLogger})
                return new DatabaseConnector(mysqlConnection, {logger: consoleLogger})
            }
            case MIGRATIONS_DIALECTS.SQLITE: {
                const { sqlitePath } = config.tracker;
                const sqliteConnection = new SqliteConnection(sqlitePath);
                return new DatabaseConnector(sqliteConnection, {logger: consoleLogger})
            }
            default: {
                consoleLogger.error("Migration dialect not supported")
                throw ""
            }
        }
    }
}