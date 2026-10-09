import ConfigReader from "../ConfigReader";
import ConnectionFactory from "../ConnectionFactory";
import MigrationExecutor from "../MigrationExecutor";
import TrackerFactory from "../TrackerFactory";
import { consoleLogger } from "../Logger";

export default class Rollback {
    static consoleLogger = consoleLogger;
    /** Revert all migrations of the last batch, newest first */
    public static async run() {
        const config = new ConfigReader().getConfig();
        const tracker = TrackerFactory.create(config);
        try {
            await tracker.init()
            const lastBatchMigrationDone = await tracker.getLastBatchMigrationDone();
            if (lastBatchMigrationDone == null) {
                Rollback.consoleLogger.info("Not migration done for rollback.")
                return
            }
            const migrationExecutor = new MigrationExecutor(ConnectionFactory.create(config), tracker);
            try {
                await migrationExecutor.executeBatchDown(lastBatchMigrationDone);
            } finally {
                await migrationExecutor.close()
            }
        } finally {
            await tracker.close().catch(() => {})
        }
    }
}
