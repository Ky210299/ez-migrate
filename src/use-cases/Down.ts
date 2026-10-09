import ConfigReader from "../ConfigReader";
import MigrationExecutor from "../MigrationExecutor";
import ConnectionFactory from "../ConnectionFactory";
import TrackerFactory from "../TrackerFactory";
import { consoleLogger } from "../Logger";
import Migration from "../Migration";

/** Class for running the Down use case */
export default class Down {
    /** Revert the last migration done. Returns the reverted migration, or null if there was none */
    public static async run(): Promise<Migration | null> {
        const config = new ConfigReader().getConfig();
        const tracker = TrackerFactory.create(config);
        try {
            await tracker.init();
            const lastMigration = await tracker.getLastMigrationDone();
            if (lastMigration == null) {
                consoleLogger.info("There is not migrations done")
                return null
            };
            const migrationExecutor = new MigrationExecutor(ConnectionFactory.create(config), tracker);
            try {
                await migrationExecutor.executeSingleMigrationDown(lastMigration);
            } finally {
                await migrationExecutor.close()
            }
            return lastMigration
        } finally {
            await tracker.close().catch(() => {})
        }
    }
}
