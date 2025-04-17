import ConfigReader from "../ConfigReader";
import ConnectionFactory from "../ConnectionFactory";
import MigrationExecutor from "../MigrationExecutor";
import TrackerFactory from "../TrackerFactory";

export default class Rollback {
    public static async run() {
        const config = new ConfigReader().getConfig();
        const tracker = TrackerFactory.create(config);
        const lastBatchMigrationDone = await tracker.getLastBatchMigrationDone();
        if (lastBatchMigrationDone == null) throw new Error("Not migration done for rollback.");
        
        const connection = ConnectionFactory.create(config);
        const migrationExecutor = new MigrationExecutor(connection, tracker);
        await migrationExecutor.executeBatchDown(lastBatchMigrationDone);
    }
}