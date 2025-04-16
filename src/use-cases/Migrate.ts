import ConfigReader from "../ConfigReader";
import ConnectionFactory from "../ConnectionFactory";
import MigrationExecutor from "../MigrationExecutor";
import SchemasHandler from "../SchemasHandler";
import TrackerFactory from "../TrackerFactory";

export default class Migrate {
    public static async run() {
        const config = new ConfigReader().getConfig();
        
        const tracker = TrackerFactory.create(config)
        const lastMigration = await tracker.getLastMigrationDone()
       
        const { migrationsPath } = config
        const schemaHandler = new SchemasHandler({ migrationsPath })
       
        const connection = ConnectionFactory.create(config);
        const migrationExecutor = new MigrationExecutor(connection, tracker);
       
        if (lastMigration != null) {
            const migrationPath = lastMigration.getDetails().path
            const cleanName = migrationPath.substring(migrationPath.lastIndexOf("/") + 1);
            const allNext = schemaHandler.allNextTo(cleanName);
            if(allNext.length === 0) throw new Error("Not migrations available")
            await migrationExecutor.executeMigrationsUp(allNext);
            return;
        }
        const migrations = schemaHandler.getAllMigrations().map(m => {
            return schemaHandler.makeMigrationFromFile(m)
        });
        if (migrations.length === 0) throw new Error("Not migrations available");
        await migrationExecutor.executeMigrationsUp(migrations);
    }
}