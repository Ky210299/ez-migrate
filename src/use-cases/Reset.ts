import ConfigReader from "../ConfigReader";
import ConnectionFactory from "../ConnectionFactory";
import MigrationExecutor from "../MigrationExecutor";
import { withLockedTracker } from "../TrackerSession";
import Migrate from "./Migrate";

export default class Reset {
    /** Revert all migrations, newest first, and apply them again in one batch, holding the lock for both steps */
    public static async run() {
        const config = new ConfigReader().getConfig();
        await withLockedTracker(config, async tracker => {
            const migrationsDone = await tracker.listMigrations()
            if (migrationsDone.length) {
                const migrationExecutor = new MigrationExecutor(ConnectionFactory.create(config), tracker)
                try {
                    await migrationExecutor.executeMigrationsDown(migrationsDone.reverse());
                } finally {
                    await migrationExecutor.close()
                }
            }
            await Migrate.apply(config, tracker);
        });
    }
}
