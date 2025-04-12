import { MIGRATIONS_DILALECTS } from "./constants"
import MysqlConnection from "./mysql"
import DatabaseConnector from "./DatabaseConnector"
import { Config } from "./types";
import SqliteConnection from "./sqlite";



export default class ConnectionFactory {
    private constructor() { throw new Error("Not constructor allow for ConnectionFactory") };
    static create(config: Config) {
        const { dialect, envKeys } = config
        if (Object.values(MIGRATIONS_DILALECTS).includes(dialect) === false) 
            throw new Error("Invalid Migration Dialect");
            
        switch (dialect) {
            case MIGRATIONS_DILALECTS.MYSQL: {
                try { process.loadEnvFile() } 
                catch (err) { console.warn("Environment not loaded. Using default configurations") }
                const { env: ENV } = process;
                        
                const mysqlConnection = new MysqlConnection({ 
                    host: ENV[envKeys.host],
                    user: ENV[envKeys.user], 
                    password: ENV[envKeys.password],
                    port: Number(ENV[envKeys.port]),
                    database: ENV[envKeys.database],
                })
                return new DatabaseConnector(mysqlConnection)
            }
            default: {
                const { sqlite } = config;
                const sqliteConnection = new SqliteConnection(sqlite.trackerPath);
                return new DatabaseConnector(sqliteConnection)
            }
        }
    }
}