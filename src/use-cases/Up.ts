import ConfigReader from "../ConfigReader";
import MigrationExecutor from "../MigrationExecutor";
import SchemasHandler from "../SchemasHandler";
import ConnectionFactory from "../ConnectionFactory";
import TrackerFactory from "../TrackerFactory";
import Repository from "../Repository";
import { PinoConsoleLogger } from "../PinoLogger";
import { ConsoleLoggerImpl } from "../Logger";

const pino = new PinoConsoleLogger()
const consoleLogger = new ConsoleLoggerImpl(pino)

/** Class for running the Up use case */
export default class Up {
    static consoleLogger = consoleLogger
    /** returns the next Migration available next to the last done. If not last migration done,
     * use the first migration file, throw otherwise.
    */
    private static async getNextMigration(schemaHandler: SchemasHandler, tracker: Repository) {
        const lastMigration = await tracker.getLastMigrationDone();
        if (lastMigration == null) {
            const firstMigrationFile = schemaHandler.getAllMigrations().at(0);
            
            if (firstMigrationFile == null) return null
                
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
        const { migrationsPath } = config;
        const schemaHandler = new SchemasHandler({ migrationsPath });
        const nextMigration = await Up.getNextMigration(schemaHandler, tracker);
        
        if (!nextMigration) {
            Up.consoleLogger.info("There is not a next migration available");
            await tracker.close();
            process.exit(1);
        }
        else if (schemaHandler.hasDML(nextMigration.getDetails().up)) {
            Up.consoleLogger.error(`Migration file with DML: ${nextMigration.getDetails().path}
                Migrations files cannot have DML statements. Use Seeds instead`);
            await tracker.close();
            process.exit(1);
        }
        
        const connection = ConnectionFactory.create(config);
        const migrationExecutor = new MigrationExecutor(connection, tracker);
        
        await migrationExecutor.executeSingleMigrationUp(nextMigration);
        await migrationExecutor.close()
        await tracker.close()
    }
}