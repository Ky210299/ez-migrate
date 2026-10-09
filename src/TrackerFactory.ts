import { TRACKER_DIALECTS } from "./constants";
import Repository from "./Repository";

import SqlitePersistency from "./SqlitePersistency";
import MysqlTracker from "./MysqlTracker";
import { Config } from "./types";
import PGTracker from "./PostgresTracker";
import { connectionDataFromEnv } from "./utils";

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
                const { host, user, password, port, database } = connectionDataFromEnv(envKeys);
                const mysqlConnection = new MysqlTracker({ host, user, password, port, database, })
                return new Repository(mysqlConnection)
            }
            case TRACKER_DIALECTS.POSTGRES: {
                const { host, user, password, port, database } = connectionDataFromEnv(envKeys);
                const pgConnection = new PGTracker({ host, user, password, port, database })
                return new Repository(pgConnection)
            }
            default: {
                throw new Error(`Invalid tracker dialect: ${dialect}`);
            }
        }
    }
}
