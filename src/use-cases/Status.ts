import { basename } from "node:path";
import ConfigReader from "../ConfigReader";
import SchemasHandler from "../SchemasHandler";
import TrackerFactory from "../TrackerFactory";
import { consoleLogger } from "../Logger";
import { normalizeSQL } from "../sql";

export default class Status {
    static consoleLogger = consoleLogger;
    /** Print every migration file: ✔ applied, ✘ pending, ⚠️ applied but the file changed after */
    public static async run() {
        const config = new ConfigReader().getConfig();
        const schemaHandler = new SchemasHandler({ migrationsPath: config.migrationsPath });
        const allMigrations = schemaHandler.getAllMigrations().map(m => schemaHandler.makeMigrationFromFile(m));
        const tracker = TrackerFactory.create(config);
        try {
            const allMigrationsDone = await tracker.listMigrations();
            const status = allMigrations.map((migration, i) => {
                const { path, up } = migration.getDetails()
                const name = basename(path)
                const migrationDone = allMigrationsDone.find(m => basename(m.getDetails().path) === name);
                // Remove the timestamp prefix of the file name
                const shortName = name.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+\.\d+-/, "");
                let mark = "✘";
                if (migrationDone != null) {
                    // Compare without comments and spaces. Old versions stored the SQL normalized
                    const changed = normalizeSQL(up) !== normalizeSQL(migrationDone.getDetails().up);
                    mark = changed ? "⚠️" : "✔";
                }
                return `${i + 1} ${mark} - ${shortName}`;
            });
            Status.consoleLogger.info("\n" + (status.length ? status.reverse().join("\n") : "No migrations"));
        } finally {
            await tracker.close()
        }
    }
}
