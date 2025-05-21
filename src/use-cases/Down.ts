import ConfigReader from "../ConfigReader";
import MigrationExecutor from "../MigrationExecutor";
import ConnectionFactory from "../ConnectionFactory";
import TrackerFactory from "../TrackerFactory";
import { ConsoleLoggerImpl } from "../Logger";
import { PinoConsoleLogger } from "../PinoLogger";

/** Class for running the Down use case */
export default class Down {
    public static async run() {
        const configReader = new ConfigReader();
        const config = configReader.getConfig();
        
        const pino = new PinoConsoleLogger()
        const logger = new ConsoleLoggerImpl(pino)
        
        const tracker = TrackerFactory.create(config);
        
        const lastMigration = await tracker.getLastMigrationDone();
        if (lastMigration == null) {
            logger.warn("There is not migrations done")
            return;
        };
        
        const connection = ConnectionFactory.create(config);
        const migrationExecutor = new MigrationExecutor(connection, tracker);
        
        await migrationExecutor.executeSingleMigrationDown(lastMigration);
        await migrationExecutor.close()
    }
}