import ConfigReader from "../ConfigReader";
import ConnectionFactory from "../ConnectionFactory";
import MigrationExecutor from "../MigrationExecutor";
import TrackerFactory from "../TrackerFactory"
import Migrate from "./Migrate";

export default class Reset {
    /** Revert all migrations, newest first, and apply them again in one batch */
    public static async run() {
        const config = new ConfigReader().getConfig();
        const tracker = TrackerFactory.create(config);
        try {
            const migrationsDone = await tracker.listMigrations()
            if (migrationsDone.length) {
                const migrationExecutor = new MigrationExecutor(ConnectionFactory.create(config), tracker)
                try {
                    await migrationExecutor.executeMigrationsDown(migrationsDone.reverse());
                } finally {
                    await migrationExecutor.close()
                }
            }
        } finally {
            await tracker.close().catch(() => {})
        }
        await Migrate.run();
    }
}
