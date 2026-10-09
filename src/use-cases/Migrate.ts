import ConfigReader from "../ConfigReader";
import ConnectionFactory from "../ConnectionFactory";
import MigrationExecutor from "../MigrationExecutor";
import SchemasHandler from "../SchemasHandler";
import TrackerFactory from "../TrackerFactory";
import { consoleLogger } from "../Logger";

export default class Migrate {
    static consoleLogger = consoleLogger
    /** Apply all pending migrations in one new batch */
    public static async run() {
        const config = new ConfigReader().getConfig();
        const schemaHandler = new SchemasHandler({ migrationsPath: config.migrationsPath })
        const tracker = TrackerFactory.create(config)
        try {
            const done = await tracker.listMigrations()
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
        } finally {
            await tracker.close().catch(() => {})
        }
    }
}
