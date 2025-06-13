import { randomUUID } from "node:crypto";
import ConfigReader from "../ConfigReader";
import ConnectionFactory from "../ConnectionFactory";
import MigrationExecutor from "../MigrationExecutor";
import SchemasHandler from "../SchemasHandler";
import TrackerFactory from "../TrackerFactory";
import { consoleLogger } from "../Logger";

export default class Migrate {
    static consoleLogger = consoleLogger
    public static async run() {
        const config = new ConfigReader().getConfig();
        
        const tracker = TrackerFactory.create(config)
        await tracker.init()
        const lastMigration = await tracker.getLastMigrationDone()
       
        const { migrationsPath } = config
        const schemaHandler = new SchemasHandler({ migrationsPath })
       
        const connection = ConnectionFactory.create(config);
        const migrationExecutor = new MigrationExecutor(connection, tracker);
       
        if (lastMigration != null) {
            const migrationPath = lastMigration.getDetails().path
            const cleanName = migrationPath.substring(migrationPath.lastIndexOf("/") + 1);
            const allNext = schemaHandler.allNextTo(cleanName);
            
            if (allNext.length === 0) {
                await migrationExecutor.close()
                Migrate.consoleLogger.info("Not migrations available")
                return
            }
            const migrationWithDML = allNext.find(m => schemaHandler.hasDML(m.getDetails().up));
            if (migrationWithDML != null) {
                await migrationExecutor.close()
                throw new Error(`File ${migrationWithDML.getDetails().path} has DML.
                    Migrations files cannot have DML statements. Use Seeds instead`)
            }
            
            await migrationExecutor.executeMigrationsUp(allNext);
            await migrationExecutor.close()
            return
        }
        const batchId = randomUUID();
        const migrations = schemaHandler.getAllMigrations().map(m => {
            return schemaHandler.makeMigrationFromFile(m, batchId);
        });
        if (migrations.length === 0) {
            await migrationExecutor.close()
            Migrate.consoleLogger.info("Not migrations available")
            return
        }
        
        const migrationWithDML = migrations.find(m => schemaHandler.hasDML(m.getDetails().up));
        if (migrationWithDML != null) {
            await migrationExecutor.close()
            Migrate.consoleLogger.error(`File ${migrationWithDML.getDetails().path} has DML.
                Migrations files cannot have DML statements. Use Seeds instead`);
            return
        }
        await migrationExecutor.executeMigrationsUp(migrations);
        await migrationExecutor.close()
    }
}