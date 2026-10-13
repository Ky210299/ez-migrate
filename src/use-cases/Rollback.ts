import ConfigReader from "../ConfigReader";
import ConnectionFactory from "../ConnectionFactory";
import MigrationExecutor from "../MigrationExecutor";
import { withLockedTracker, withTracker } from "../TrackerSession";
import { printDryRun } from "../DryRun";
import { consoleLogger } from "../Logger";
import type { RevertOptions } from "./Down";

export default class Rollback {
    static consoleLogger = consoleLogger;
    /** Revert all migrations of the last batch, newest first */
    public static async run(options: RevertOptions = {}) {
        const config = new ConfigReader().getConfig();
        if (options.dryRun) {
            await withTracker(config, async tracker => {
                printDryRun(config.dialect, "down", await tracker.getLastBatchMigrationDone() ?? []);
            });
            return;
        }
        await withLockedTracker(config, async tracker => {
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
        });
    }
}
