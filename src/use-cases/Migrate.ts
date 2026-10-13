import ConfigReader from "../ConfigReader";
import ConnectionFactory from "../ConnectionFactory";
import MigrationExecutor from "../MigrationExecutor";
import Migration from "../Migration";
import Repository from "../Repository";
import SchemasHandler from "../SchemasHandler";
import { withLockedTracker, withTracker } from "../TrackerSession";
import { printDryRun } from "../DryRun";
import { consoleLogger } from "../Logger";
import type { Config } from "../types";

export type MigrateOptions = {
    /** Run even if an applied migration file changed */
    allowChanged?: boolean,
    /** Print the SQL that would run, without running it */
    dryRun?: boolean,
}

export default class Migrate {
    static consoleLogger = consoleLogger

    /** Apply all pending migrations in one new batch */
    public static async run(options: MigrateOptions = {}) {
        const config = new ConfigReader().getConfig();
        if (options.dryRun) {
            await withTracker(config, async tracker => printDryRun(config.dialect, "up", await Migrate.pending(config, tracker, options)));
            return;
        }
        await withLockedTracker(config, tracker => Migrate.apply(config, tracker, options));
    }

    /** Apply all pending migrations with a tracker that is already locked */
    static async apply(config: Config, tracker: Repository, options: MigrateOptions = {}) {
        const pending = await Migrate.pending(config, tracker, options);
        if (pending.length === 0) {
            Migrate.consoleLogger.info("No pending migrations")
            return
        }
        const migrationExecutor = new MigrationExecutor(ConnectionFactory.create(config), tracker);
        try {
            await migrationExecutor.executeMigrationsUp(pending);
        } finally {
            await migrationExecutor.close()
        }
    }

    /** Pending migrations, in order. Fails if an applied file changed or a pending file has DML */
    private static async pending(config: Config, tracker: Repository, options: MigrateOptions): Promise<Array<Migration>> {
        const schemaHandler = new SchemasHandler({ migrationsPath: config.migrationsPath })
        const done = await tracker.listMigrations()
        schemaHandler.checkAppliedUnchanged(done, options.allowChanged);
        const pending = schemaHandler.getPendingMigrations(done);
        const migrationWithDML = pending.find(m => schemaHandler.hasDML(m.getDetails().up));
        if (migrationWithDML != null) {
            throw new Error(`File ${migrationWithDML.getDetails().path} has DML. Migrations files cannot have DML statements. Use Seeds instead`)
        }
        return pending;
    }
}
