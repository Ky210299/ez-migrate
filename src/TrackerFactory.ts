import { TRACKER_DIALECTS } from "./constants";
import Repository from "./Repository";

import SqlitePersistency from "./SqlitePersistency";
import MysqlTracker from "./MysqlTracker";


import { Config } from "./types";

/** Create a tracker for the migrations. By default use sqlite */
export default class TrackerFactory {
    private constructor() {
        throw new Error("PersistencyFactory is a static class. Not constructor allow");
    }
    static create(config: Config) {
        const { trackerDialect, envKeys } = config;
        if (Object.values(TRACKER_DIALECTS).includes(trackerDialect) === false) {
            throw new Error("Invalid Tracker Dialect")
        }
        
        switch (trackerDialect) {
            case TRACKER_DIALECTS.SQLITE: {
                const { sqlite } = config;
                const { trackerPath } = sqlite
                const sqlitePersistency = new SqlitePersistency({ trackerPath })
                return new Repository(sqlitePersistency);
            };
            case TRACKER_DIALECTS.MYSQL: {
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
                const mysqlConnection = new MysqlTracker({ host, user, password, port, database, })
                console.log('\n')
                return new Repository(mysqlConnection)
            }
            default: {
                throw new Error("Invalid Tracker dialect")
            }
        }
    }
}