import { MIGRATIONS_DILALECTS } from "./constants"
import MysqlConnection from "./mysql"
import DatabaseConnector from "./DatabaseConnector"
import { Config } from "./types";
import SqliteConnection from "./sqlite";

/** Create DBMS connections by they dialect. Throw if doesn't support the dialect */
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
                console.log('\n')
                const connectionData = { 
                    host: ENV[envKeys.host],
                    user: ENV[envKeys.user], 
                    password: ENV[envKeys.password],
                    port: Number(ENV[envKeys.port]),
                    database: ENV[envKeys.database],
                }
                const { host, user, password, port, database } = connectionData;
                if (!connectionData.database) console.warn("Database name is not especified");
                else if (!connectionData.password) console.warn("Password is not especified")
                const mysqlConnection = new MysqlConnection({ host, user, password, port, database, })
                console.log('\n')
                return new DatabaseConnector(mysqlConnection)
            }
            case MIGRATIONS_DILALECTS.SQLITE: {
                const { sqlite } = config;
                const sqliteConnection = new SqliteConnection(sqlite.trackerPath);
                return new DatabaseConnector(sqliteConnection)
            }
            default: {
                throw new Error("Migration dialect not supported")
            }
        }
    }
}