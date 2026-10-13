import ConfigReader from "../ConfigReader";
import MigrationExecutor from "../MigrationExecutor";
import Migration from "../Migration";
import Repository from "../Repository";
import SchemasHandler from "../SchemasHandler";
import ConnectionFactory from "../ConnectionFactory";
import { withLockedTracker, withTracker } from "../TrackerSession";
import { printDryRun } from "../DryRun";
import { consoleLogger } from "../Logger";
import type { Config } from "../types";
import type { MigrateOptions } from "./Migrate";

/** Class for running the Up use case */
export default class Up {
    static consoleLogger = consoleLogger

    /** Execute the next pending migration */
    public static async run(options: MigrateOptions = {}) {
        const config = new ConfigReader().getConfig();
        if (options.dryRun) {
            await withTracker(config, async tracker => {
                const next = await Up.next(config, tracker, options);
                printDryRun(config.dialect, "up", next ? [next] : []);
            });
            return;
        }
        await withLockedTracker(config, async tracker => {
            const nextMigration = await Up.next(config, tracker, options);
            if (nextMigration == null) {
                Up.consoleLogger.info("There is not a next migration available");
                return
            }
            const migrationExecutor = new MigrationExecutor(ConnectionFactory.create(config), tracker);
            try {
                await migrationExecutor.executeSingleMigrationUp(nextMigration);
            } finally {
                await migrationExecutor.close()
            }
        });
    }

    /** Next pending migration, or null. Fails if an applied file changed or the next file has DML */
    private static async next(config: Config, tracker: Repository, options: MigrateOptions): Promise<Migration | null> {
        const schemaHandler = new SchemasHandler({ migrationsPath: config.migrationsPath });
        const done = await tracker.listMigrations();
        schemaHandler.checkAppliedUnchanged(done, options.allowChanged);
        const nextMigration = schemaHandler.getPendingMigrations(done).at(0) ?? null;
        if (nextMigration != null && schemaHandler.hasDML(nextMigration.getDetails().up)) {
            throw new Error(`Migration file with DML: ${nextMigration.getDetails().path}. Migrations files cannot have DML statements. Use Seeds instead`);
        }
        return nextMigration;
    }
}
