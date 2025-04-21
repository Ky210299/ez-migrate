import { randomUUID } from "node:crypto";
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
            
            if (allNext.length === 0) throw new Error("Not migrations available")
            const migrationWithDML = allNext.find(m => schemaHandler.hasDML(m.getDetails().up));
            if (migrationWithDML != null) {
                throw new Error(`File ${migrationWithDML.getDetails().path} has DML.
                    Migrations files cannot have DML statements. Use Seeds instead`)
            }
            
            await migrationExecutor.executeMigrationsUp(allNext);
            return;
        }
        const batchId = randomUUID();
        const migrations = schemaHandler.getAllMigrations().map(m => {
            return schemaHandler.makeMigrationFromFile(m, batchId);
        });
        if (migrations.length === 0) throw new Error("Not migrations available");
        
        const migrationWithDML = migrations.find(m => schemaHandler.hasDML(m.getDetails().up));
        if (migrationWithDML != null) {
            throw new Error(`File ${migrationWithDML.getDetails().path} has DML.
                Migrations files cannot have DML statements. Use Seeds instead`)
        }
        
        await migrationExecutor.executeMigrationsUp(migrations);
    }
}