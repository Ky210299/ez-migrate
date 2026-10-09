import ConfigReader from "../ConfigReader";
import ConnectionFactory from "../ConnectionFactory";
import MigrationExecutor from "../MigrationExecutor";
import SchemasHandler from "../SchemasHandler";
import TrackerFactory from "../TrackerFactory";
import Down from "./Down"

export default class Redo {
    private constructor() { throw new Error("Not constructor available for Redo") }
    /** Revert the last migration and apply the same migration file again */
    static async run() {
        const reverted = await Down.run();
        if (reverted == null) return;

        const config = new ConfigReader().getConfig();
        const schemaHandler = new SchemasHandler({ migrationsPath: config.migrationsPath });
        const file = schemaHandler.findMigrationFile(reverted);
        if (file == null) throw new Error(`Migration file ${reverted.getDetails().path} not found. It was reverted but cannot be applied again`);

        const tracker = TrackerFactory.create(config);
        const migrationExecutor = new MigrationExecutor(ConnectionFactory.create(config), tracker);
        try {
            await migrationExecutor.executeSingleMigrationUp(schemaHandler.makeMigrationFromFile(file));
        } finally {
            await migrationExecutor.close()
        }
    }
}
