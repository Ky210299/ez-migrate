import ConfigReader from "../ConfigReader";
import MigrationExecutor from "../MigrationExecutor";
import ConnectionFactory from "../ConnectionFactory";
import TrackerFactory from "../TrackerFactory";

/** Class for running the Down use case */
export default class Down {
    public static async run() {
        const configReader = new ConfigReader();
        const config = configReader.getConfig();
        
        const tracker = TrackerFactory.create(config);
        
        const lastMigration = await tracker.getLastMigrationDone();
        if (lastMigration == null)  throw new Error("There is not migration done");
        
        const connection = ConnectionFactory.create(config);
        const migrationExecutor = new MigrationExecutor(connection, tracker);
        
        await migrationExecutor.executeSingleMigrationDown(lastMigration);
        process.exit();
    }
}