import ConfigReader from "../ConfigReader";
import ConnectionFactory from "../ConnectionFactory";
import { ConsoleLoggerImpl } from "../Logger";
import MigrationExecutor from "../MigrationExecutor";
import { PinoConsoleLogger } from "../PinoLogger";
import TrackerFactory from "../TrackerFactory";

export default class Rollback {
    public static async run() {
        const config = new ConfigReader().getConfig();
        const tracker = TrackerFactory.create(config);
        const lastBatchMigrationDone = await tracker.getLastBatchMigrationDone();
        
        const pino = new PinoConsoleLogger()
        const consoleLogger = new ConsoleLoggerImpl(pino)
        
        if (lastBatchMigrationDone == null) {
            await tracker.close()
            consoleLogger.info("Not migration done for rollback.")
            process.exit(1)
        }
        
        const connection = ConnectionFactory.create(config);
        const migrationExecutor = new MigrationExecutor(connection, tracker);
        await migrationExecutor.executeBatchDown(lastBatchMigrationDone);
        await migrationExecutor.close()
    }
}