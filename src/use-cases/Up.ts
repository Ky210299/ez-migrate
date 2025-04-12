import ConfigReader from "../ConfigReader";
import Repository from "../Repository";
import { SqlitePersistency } from "../SqlitePersistency";

export default class Up {
    public static async run() {
        const configReader = new ConfigReader();
        const { sqlitePath, migrationsPath } = configReader.getConfig();
        const repository = new Repository(new SqlitePersistency({ sqlitePath, migrationsPath }));
        const lastMigration = await repository.getLastMigrationDone();
    }
}