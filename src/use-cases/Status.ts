import { basename } from "node:path";
import ConfigReader from "../ConfigReader";
import SchemasHandler from "../SchemasHandler";
import SeedHandler from "../SeedHandler";
import { withTracker } from "../TrackerSession";
import { consoleLogger } from "../Logger";
import { stripTimestamp } from "../utils";
import { configForTenant, isMultiTenantRun, tenantSettings } from "../Tenants";
import { inTenant } from "../TenantRunner";
import type Repository from "../Repository";
import type { Config } from "../types";

export type StatusOptions = {
    /** Print the status as JSON, for scripts and AI agents */
    json?: boolean,
}

type MigrationState = "applied" | "pending" | "changed";

type FileStatus = { file: string, name: string, state: string };

export default class Status {
    static consoleLogger = consoleLogger;
    /**
     * Print every migration file: ✔ applied, ✘ pending, ⚠️ applied but the file changed after.
     * Then every seed file: ✔ run, ✘ pending.
     * With --json: one JSON object with the same data, files in run order.
     * With several tenants: one line per tenant with its counts.
     */
    public static async run(options: StatusOptions = {}) {
        const config = new ConfigReader().getConfig();
        if (isMultiTenantRun()) {
            await Status.runTenants(config, options);
            return;
        }
        const schemaHandler = SchemasHandler.forConfig(config);
        await withTracker(config, async tracker => {
            const { migrations, seeds } = await Status.collect(config, schemaHandler, tracker);

            // The status is the output of the command, not a log line: print it whatever the log level or format
            if (options.json) {
                console.log(JSON.stringify({ migrations, seeds }, null, 2));
                return;
            }
            const marks: Record<string, string> = { applied: "✔", pending: "✘", changed: "⚠️" };
            const status = migrations.map((m, i) => `${i + 1} ${marks[m.state]} - ${m.name}`);
            console.log(status.length ? status.reverse().join("\n") : "No migrations");
            if (seeds.length) {
                console.log("\nSeeds:\n" + seeds.map(s => `${s.state === "run" ? "✔" : "✘"} - ${s.name}`).join("\n"));
            }
        });
    }

    /** State of every migration and seed file of the config */
    private static async collect(config: Config, schemaHandler: SchemasHandler, tracker: Repository) {
        const allMigrations = schemaHandler.getAllMigrations();
        const allMigrationsDone = await tracker.listMigrations();
        const doneNames = new Set(allMigrationsDone.map(m => basename(m.getDetails().path)));
        const changed = new Set(schemaHandler.findChangedMigrations(allMigrationsDone));
        const migrations: Array<FileStatus> = allMigrations.map(path => {
            const state: MigrationState = changed.has(path) ? "changed" : doneNames.has(basename(path)) ? "applied" : "pending";
            return { file: basename(path), name: stripTimestamp(basename(path)), state };
        });
        const seedFiles = new SeedHandler(config).getSeedsFileNames();
        const seedsDone = new Set(seedFiles.length ? await tracker.listSeeds() : []);
        const seeds: Array<FileStatus> = seedFiles.map(file => ({ file, name: stripTimestamp(file), state: seedsDone.has(file) ? "run" : "pending" }));
        return { migrations, seeds };
    }

    /**
     * One line per tenant: how many migrations are applied, pending and changed.
     * A tenant that can't be read shows its error and the exit code is 1.
     * With --json: `{ tenants: [{ tenant, migrations, seeds } | { tenant, error }] }`
     */
    private static async runTenants(base: Config, options: StatusOptions) {
        const results: Array<{ tenant: string, migrations?: Array<FileStatus>, seeds?: Array<FileStatus>, error?: string }> = [];
        for (const tenant of tenantSettings.selected) {
            const config = configForTenant(base, tenant);
            try {
                const status = await inTenant(tenant, () => withTracker(config, tracker => Status.collect(config, SchemasHandler.forConfig(config), tracker)));
                results.push({ tenant: tenant.name, ...status });
            } catch (err) {
                results.push({ tenant: tenant.name, error: err instanceof Error ? err.message : String(err) });
            }
        }
        if (results.some(r => r.error != null)) process.exitCode = 1;
        if (options.json) {
            console.log(JSON.stringify({ tenants: results }, null, 2));
            return;
        }
        if (results.length === 0) {
            console.log("No tenants");
            return;
        }
        const width = Math.max(...results.map(r => r.tenant.length));
        console.log(results.map(r => {
            if (r.error != null) return `✘ ${r.tenant.padEnd(width)}  error: ${r.error}`;
            const count = (state: string) => r.migrations?.filter(m => m.state === state).length ?? 0;
            const parts = [`${count("applied")} applied`];
            if (count("pending")) parts.push(`${count("pending")} pending`);
            if (count("changed")) parts.push(`${count("changed")} changed`);
            const mark = count("changed") ? "⚠️" : count("pending") ? "✘" : "✔";
            return `${mark} ${r.tenant.padEnd(width)}  ${parts.join(", ")}`;
        }).join("\n"));
    }
}
