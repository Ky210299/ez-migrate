import { TRACKER_DIALECTS } from "./constants";
import Repository from "./Repository";

import { Config } from "./types";
import { connectionOptions } from "./ConnectionOptions";

/* eslint-disable @typescript-eslint/no-require-imports */
// Drivers are loaded only for the tracker dialect in use (see ConnectionFactory)

/** Create a tracker for the migrations. By default use sqlite */
export default class TrackerFactory {
    private constructor() {
        throw new Error("PersistencyFactory is a static class. Not constructor allow");
    }
    static create(config: Config) {
        const { dialect, envKeys, ssl } = config.tracker;
        
        switch (dialect) {
            case TRACKER_DIALECTS.SQLITE: {
                const { sqlitePath } = config.tracker;
                const SqlitePersistency: typeof import("./SqlitePersistency").default = require("./SqlitePersistency").default;
                const sqlitePersistency = new SqlitePersistency({ trackerPath: sqlitePath })
                return new Repository(sqlitePersistency);
            };
            case TRACKER_DIALECTS.MYSQL: {
                const MysqlTracker: typeof import("./MysqlTracker").default = require("./MysqlTracker").default;
                const mysqlConnection = new MysqlTracker(connectionOptions(envKeys, ssl))
                return new Repository(mysqlConnection)
            }
            case TRACKER_DIALECTS.POSTGRES: {
                const PGTracker: typeof import("./PostgresTracker").default = require("./PostgresTracker").default;
                const pgConnection = new PGTracker(connectionOptions(envKeys, ssl))
                return new Repository(pgConnection)
            }
            default: {
                throw new Error(`Invalid tracker dialect: ${dialect}`);
            }
        }
    }
}
