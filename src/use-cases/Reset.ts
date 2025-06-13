import ConfigReader from "../ConfigReader";
import ConnectionFactory from "../ConnectionFactory";
import MigrationExecutor from "../MigrationExecutor";
import TrackerFactory from "../TrackerFactory"
import Migrate from "./Migrate";

export default class Reset {
    public static async run() {
        const config = new ConfigReader().getConfig();
        
        const tracker = TrackerFactory.create(config);
        await tracker.init();
        const migrationsDone = await tracker.listMigrations()
        const connection = ConnectionFactory.create(config);
        if (migrationsDone.length) {
            const migrationExecutor = new MigrationExecutor(connection, tracker)
            await migrationExecutor.executeMigrationsDown(migrationsDone.reverse());
            await migrationExecutor.close()
        }
        await Migrate.run();
    }
}