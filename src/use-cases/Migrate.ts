import ConfigReader from "../ConfigReader";
import ConnectionFactory from "../ConnectionFactory";
import MigrationExecutor from "../MigrationExecutor";
import Repository from "../Repository";
import SchemasHandler from "../SchemasHandler";
import { withLockedTracker } from "../TrackerSession";
import { consoleLogger } from "../Logger";
import type { Config } from "../types";

export type MigrateOptions = {
    /** Run even if an applied migration file changed */
    allowChanged?: boolean,
}

export default class Migrate {
    static consoleLogger = consoleLogger

    /** Apply all pending migrations in one new batch */
    public static async run(options: MigrateOptions = {}) {
        const config = new ConfigReader().getConfig();
        await withLockedTracker(config, tracker => Migrate.apply(config, tracker, options));
    }

    /** Apply all pending migrations with a tracker that is already locked */
    static async apply(config: Config, tracker: Repository, options: MigrateOptions = {}) {
        const schemaHandler = new SchemasHandler({ migrationsPath: config.migrationsPath })
        const done = await tracker.listMigrations()
        schemaHandler.checkAppliedUnchanged(done, options.allowChanged);
        const pending = schemaHandler.getPendingMigrations(done);
        if (pending.length === 0) {
            Migrate.consoleLogger.info("No pending migrations")
            return
        }
        const migrationWithDML = pending.find(m => schemaHandler.hasDML(m.getDetails().up));
        if (migrationWithDML != null) {
            throw new Error(`File ${migrationWithDML.getDetails().path} has DML. Migrations files cannot have DML statements. Use Seeds instead`)
        }
        const migrationExecutor = new MigrationExecutor(ConnectionFactory.create(config), tracker);
        try {
            await migrationExecutor.executeMigrationsUp(pending);
        } finally {
            await migrationExecutor.close()
        }
    }
}
