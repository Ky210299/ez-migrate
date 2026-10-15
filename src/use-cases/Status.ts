import { basename } from "node:path";
import ConfigReader from "../ConfigReader";
import SchemasHandler from "../SchemasHandler";
import SeedHandler from "../SeedHandler";
import { withTracker } from "../TrackerSession";
import { consoleLogger } from "../Logger";
import { stripTimestamp } from "../utils";

export type StatusOptions = {
    /** Print the status as JSON, for scripts and AI agents */
    json?: boolean,
}

type MigrationState = "applied" | "pending" | "changed";

export default class Status {
    static consoleLogger = consoleLogger;
    /**
     * Print every migration file: ✔ applied, ✘ pending, ⚠️ applied but the file changed after.
     * Then every seed file: ✔ run, ✘ pending.
     * With --json: one JSON object with the same data, files in run order
     */
    public static async run(options: StatusOptions = {}) {
        const config = new ConfigReader().getConfig();
        const schemaHandler = new SchemasHandler({ migrationsPath: config.migrationsPath });
        const allMigrations = schemaHandler.getAllMigrations();
        await withTracker(config, async tracker => {
            const allMigrationsDone = await tracker.listMigrations();
            const doneNames = new Set(allMigrationsDone.map(m => basename(m.getDetails().path)));
            const changed = new Set(schemaHandler.findChangedMigrations(allMigrationsDone));
            const migrations = allMigrations.map(path => {
                const state: MigrationState = changed.has(path) ? "changed" : doneNames.has(basename(path)) ? "applied" : "pending";
                return { file: basename(path), name: stripTimestamp(basename(path)), state };
            });
            const seedFiles = new SeedHandler(config).getSeedsFileNames();
            const seedsDone = new Set(seedFiles.length ? await tracker.listSeeds() : []);
            const seeds = seedFiles.map(file => ({ file, name: stripTimestamp(file), state: seedsDone.has(file) ? "run" : "pending" }));

            // The status is the output of the command, not a log line: print it whatever the log level or format
            if (options.json) {
                console.log(JSON.stringify({ migrations, seeds }, null, 2));
                return;
            }
            const marks: Record<MigrationState, string> = { applied: "✔", pending: "✘", changed: "⚠️" };
            const status = migrations.map((m, i) => `${i + 1} ${marks[m.state]} - ${m.name}`);
            console.log(status.length ? status.reverse().join("\n") : "No migrations");
            if (seeds.length) {
                console.log("\nSeeds:\n" + seeds.map(s => `${s.state === "run" ? "✔" : "✘"} - ${s.name}`).join("\n"));
            }
        });
    }
}
