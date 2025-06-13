import ConfigReader from "../ConfigReader";
import MigrationExecutor from "../MigrationExecutor";
import ConnectionFactory from "../ConnectionFactory";
import TrackerFactory from "../TrackerFactory";
import { consoleLogger } from "../Logger";

/** Class for running the Down use case */
export default class Down {
    public static async run() {
        const configReader = new ConfigReader();
        const config = configReader.getConfig();
        
        
        const tracker = TrackerFactory.create(config);
        await tracker.init();
        
        const lastMigration = await tracker.getLastMigrationDone();
        if (lastMigration == null) {
            consoleLogger.info("There is not migrations done")
            await tracker.close()
            return
        };
        
        const connection = ConnectionFactory.create(config);
        const migrationExecutor = new MigrationExecutor(connection, tracker);
        
        await migrationExecutor.executeSingleMigrationDown(lastMigration);
        await migrationExecutor.close()
    }
}