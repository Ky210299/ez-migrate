import ConfigReader from "../ConfigReader";
import ConnectionFactory from "../ConnectionFactory";
import MigrationExecutor from "../MigrationExecutor";
import TrackerFactory from "../TrackerFactory";
import { consoleLogger } from "../Logger";

export default class Rollback {
    static consoleLogger = consoleLogger;
    public static async run() {
        const config = new ConfigReader().getConfig();
        const tracker = TrackerFactory.create(config);
        const lastBatchMigrationDone = await tracker.getLastBatchMigrationDone();
        
        if (lastBatchMigrationDone == null) {
            await tracker.close()
            Rollback.consoleLogger.info("Not migration done for rollback.")
            return
        }
        const connection = ConnectionFactory.create(config);
        const migrationExecutor = new MigrationExecutor(connection, tracker);
        await migrationExecutor.executeBatchDown(lastBatchMigrationDone);
        await migrationExecutor.close()
    }
}