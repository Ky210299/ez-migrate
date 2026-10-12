import ConfigReader from "../ConfigReader";
import ConnectionFactory from "../ConnectionFactory";
import MigrationExecutor from "../MigrationExecutor";
import SchemasHandler from "../SchemasHandler";
import { withLockedTracker } from "../TrackerSession";
import Down from "./Down"

export default class Redo {
    private constructor() { throw new Error("Not constructor available for Redo") }
    /** Revert the last migration and apply the same migration file again, holding the lock for both steps */
    static async run() {
        const config = new ConfigReader().getConfig();
        const schemaHandler = new SchemasHandler({ migrationsPath: config.migrationsPath });
        await withLockedTracker(config, async tracker => {
            const reverted = await Down.revertLast(config, tracker);
            if (reverted == null) return;

            const file = schemaHandler.findMigrationFile(reverted);
            if (file == null) throw new Error(`Migration file ${reverted.getDetails().path} not found. It was reverted but cannot be applied again`);

            const migrationExecutor = new MigrationExecutor(ConnectionFactory.create(config), tracker);
            try {
                await migrationExecutor.executeSingleMigrationUp(schemaHandler.makeMigrationFromFile(file));
            } finally {
                await migrationExecutor.close()
            }
        });
    }
}
