import { basename } from "node:path";
import ConfigReader from "../ConfigReader";
import SchemasHandler from "../SchemasHandler";
import SeedHandler from "../SeedHandler";
import TrackerFactory from "../TrackerFactory";
import { consoleLogger } from "../Logger";
import { normalizeSQL } from "../sql";
import { stripTimestamp } from "../utils";

export default class Status {
    static consoleLogger = consoleLogger;
    /**
     * Print every migration file: ✔ applied, ✘ pending, ⚠️ applied but the file changed after.
     * Then every seed file: ✔ run, ✘ pending
     */
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
                const shortName = stripTimestamp(name);
                let mark = "✘";
                if (migrationDone != null) {
                    // Compare without comments and spaces. Old versions stored the SQL normalized
                    const changed = normalizeSQL(up) !== normalizeSQL(migrationDone.getDetails().up);
                    mark = changed ? "⚠️" : "✔";
                }
                return `${i + 1} ${mark} - ${shortName}`;
            });
            Status.consoleLogger.info("\n" + (status.length ? status.reverse().join("\n") : "No migrations"));

            const seeds = new SeedHandler(config).getSeedsFileNames();
            if (seeds.length) {
                const seedsDone = new Set(await tracker.listSeeds());
                const seedStatus = seeds.map(name => `${seedsDone.has(name) ? "✔" : "✘"} - ${stripTimestamp(name)}`);
                Status.consoleLogger.info("\nSeeds:\n" + seedStatus.join("\n"));
            }
        } finally {
            await tracker.close()
        }
    }
}
