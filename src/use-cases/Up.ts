import ConfigReader from "../ConfigReader";
import MigrationExecutor from "../MigrationExecutor";
import SchemasHandler from "../SchemasHandler";
import ConnectionFactory from "../ConnectionFactory";
import TrackerFactory from "../TrackerFactory";
import Repository from "../Repository";
import { Config } from "../types";

/** Class for running the Up use case */
export default class Up {
    /** returns the next Migration available next to the last done. If not last migration done,
     * use the first migration file, throw otherwise.
    */
    private static async getNextMigration(config: Config, tracker: Repository) {
        const { migrationsPath } = config;
        const schemaHandler = new SchemasHandler({ migrationsPath });
        
        const lastMigration = await tracker.getLastMigrationDone();
        if (lastMigration == null) {
            const firstMigrationFile = schemaHandler.getAllMigrations().at(0);
            
            if (firstMigrationFile == null) 
                throw new Error("There is not next migration available");
                
            return schemaHandler.makeMigrationFromFile(firstMigrationFile);
        }
        const lastMigrationPath = lastMigration.getDetails().path;
        const cleanName = lastMigrationPath.substring(lastMigrationPath.lastIndexOf("/") + 1)
        return schemaHandler.next(cleanName);
    }
    
    /** Execute the next available migration */
    public static async run() {
        const configReader = new ConfigReader();
        const config = configReader.getConfig();
        
        const tracker = TrackerFactory.create(config);
        const nextMigration = await this.getNextMigration(config, tracker);
        if (!nextMigration) throw new Error("There is not a next migration available");
        
        const connection = ConnectionFactory.create(config);
        const migrationExecutor = new MigrationExecutor(connection, tracker);
        
        await migrationExecutor.executeSingleMigrationUp(nextMigration);
    }
}