import { basename } from "node:path";
import ConfigReader from "../ConfigReader";
import SchemasHandler from "../SchemasHandler";
import SeedHandler from "../SeedHandler";
import { withTracker } from "../TrackerSession";
import { consoleLogger } from "../Logger";
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
        const allMigrations = schemaHandler.getAllMigrations();
        await withTracker(config, async tracker => {
            const allMigrationsDone = await tracker.listMigrations();
            const doneNames = new Set(allMigrationsDone.map(m => basename(m.getDetails().path)));
            const changed = new Set(schemaHandler.findChangedMigrations(allMigrationsDone));
            const status = allMigrations.map((path, i) => {
                const mark = changed.has(path) ? "⚠️" : doneNames.has(basename(path)) ? "✔" : "✘";
                return `${i + 1} ${mark} - ${stripTimestamp(basename(path))}`;
            });
            // The list is the output of the command, not a log line: print it whatever the log level or format
            console.log(status.length ? status.reverse().join("\n") : "No migrations");

            const seeds = new SeedHandler(config).getSeedsFileNames();
            if (seeds.length) {
                const seedsDone = new Set(await tracker.listSeeds());
                const seedStatus = seeds.map(name => `${seedsDone.has(name) ? "✔" : "✘"} - ${stripTimestamp(name)}`);
                console.log("\nSeeds:\n" + seedStatus.join("\n"));
            }
        });
    }
}
