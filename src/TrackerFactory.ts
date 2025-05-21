import { TRACKER_DIALECTS } from "./constants";
import Repository from "./Repository";

import SqlitePersistency from "./SqlitePersistency";
import MysqlTracker from "./MysqlTracker";
import { Config } from "./types";
import { PinoConsoleLogger } from "./PinoLogger";
import { ConsoleLoggerImpl } from "./Logger";

const pino = new PinoConsoleLogger()
const logger = new ConsoleLoggerImpl(pino)

/** Create a tracker for the migrations. By default use sqlite */
export default class TrackerFactory {
    private constructor() {
        throw new Error("PersistencyFactory is a static class. Not constructor allow");
    }
    static create(config: Config) {
        const { dialect, envKeys } = config.tracker;
        
        switch (dialect) {
            case TRACKER_DIALECTS.SQLITE: {
                const { sqlitePath } = config.tracker;
                const sqlitePersistency = new SqlitePersistency({ trackerPath: sqlitePath })
                return new Repository(sqlitePersistency);
            };
            case TRACKER_DIALECTS.MYSQL: {
                try { process.loadEnvFile() } 
                catch (err) { logger.warn("Environment not loaded. Using default configurations") }
                const { env: ENV } = process;
                const connectionData = { 
                    host: ENV[envKeys.host],
                    user: ENV[envKeys.user], 
                    password: ENV[envKeys.password],
                    port: Number(ENV[envKeys.port]),
                    database: ENV[envKeys.database],
                }
                const { host, user, password, port, database } = connectionData;
                const mysqlConnection = new MysqlTracker({ host, user, password, port, database, })
                return new Repository(mysqlConnection)
            }
            default: {
                logger.error("Invalid Tracker dialect")
                process.exit(1)
            }
        }
    }
}