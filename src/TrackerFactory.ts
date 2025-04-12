import { TRACKER_DIALECTS } from "./constants";
import Repository from "./Repository";
import SqlitePersistency from "./SqlitePersistency";

import { Config } from "./types";

export default class TrackerFactory {
    private constructor() {
        throw new Error("PersistencyFactory is a static class. Not constructor allow");
    }
    static create(config: Config) {
        const { trackerDialect } = config;
        if (Object.values(TRACKER_DIALECTS).includes(trackerDialect) === false) {
            throw new Error("Invalid Tracker Dialect")
        }
        
        switch (trackerDialect) {
            default: {
                const { sqlite } = config;
                const {trackerPath} = sqlite
                const sqlitePersistency = new SqlitePersistency({ trackerPath })
                return new Repository(sqlitePersistency);
            }
        }
    }
}