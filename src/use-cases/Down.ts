import ConfigReader from "../ConfigReader";
import MigrationExecutor from "../MigrationExecutor";
import ConnectionFactory from "../ConnectionFactory";
import Repository from "../Repository";
import { withLockedTracker, withTracker } from "../TrackerSession";
import { printDryRun } from "../DryRun";
import { consoleLogger } from "../Logger";
import Migration from "../Migration";
import type { Config } from "../types";

export type RevertOptions = {
    /** Print the SQL that would run, without running it */
    dryRun?: boolean,
}

/** Class for running the Down use case */
export default class Down {
    /** Revert the last migration done */
    public static async run(options: RevertOptions = {}) {
        const config = new ConfigReader().getConfig();
        if (options.dryRun) {
            await withTracker(config, async tracker => {
                const last = await tracker.getLastMigrationDone();
                printDryRun(config.dialect, "down", last ? [last] : []);
            });
            return;
        }
        await withLockedTracker(config, tracker => Down.revertLast(config, tracker));
    }

    /**
     * Revert the last migration done with a tracker that is already locked.
     * Returns the reverted migration, or null if there was none
     */
    static async revertLast(config: Config, tracker: Repository): Promise<Migration | null> {
        const lastMigration = await tracker.getLastMigrationDone();
        if (lastMigration == null) {
            consoleLogger.info("There is not migrations done")
            return null
        }
        const migrationExecutor = new MigrationExecutor(ConnectionFactory.create(config), tracker);
        try {
            await migrationExecutor.executeSingleMigrationDown(lastMigration);
        } finally {
            await migrationExecutor.close()
        }
        return lastMigration
    }
}
