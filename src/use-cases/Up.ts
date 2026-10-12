import ConfigReader from "../ConfigReader";
import MigrationExecutor from "../MigrationExecutor";
import SchemasHandler from "../SchemasHandler";
import ConnectionFactory from "../ConnectionFactory";
import { withLockedTracker } from "../TrackerSession";
import { consoleLogger } from "../Logger";
import type { MigrateOptions } from "./Migrate";

/** Class for running the Up use case */
export default class Up {
    static consoleLogger = consoleLogger

    /** Execute the next pending migration */
    public static async run(options: MigrateOptions = {}) {
        const config = new ConfigReader().getConfig();
        const schemaHandler = new SchemasHandler({ migrationsPath: config.migrationsPath });
        await withLockedTracker(config, async tracker => {
            const done = await tracker.listMigrations();
            schemaHandler.checkAppliedUnchanged(done, options.allowChanged);
            const nextMigration = schemaHandler.getPendingMigrations(done).at(0);
            if (nextMigration == null) {
                Up.consoleLogger.info("There is not a next migration available");
                return
            }
            if (schemaHandler.hasDML(nextMigration.getDetails().up)) {
                throw new Error(`Migration file with DML: ${nextMigration.getDetails().path}. Migrations files cannot have DML statements. Use Seeds instead`);
            }
            const migrationExecutor = new MigrationExecutor(ConnectionFactory.create(config), tracker);
            try {
                await migrationExecutor.executeSingleMigrationUp(nextMigration);
            } finally {
                await migrationExecutor.close()
            }
        });
    }
}
