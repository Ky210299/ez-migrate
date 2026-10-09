import { basename } from "node:path";
import { rmSync } from "node:fs";
import ConfigReader from "../ConfigReader";
import ConnectionFactory from "../ConnectionFactory";
import { consoleLogger } from "../Logger";
import Migration from "../Migration";
import SchemaDumper from "../SchemaDumper";
import SchemasHandler from "../SchemasHandler";
import SeedHandler from "../SeedHandler";
import TrackerFactory from "../TrackerFactory";

export type BaselineOptions = {
    /** Also write a seed file with the current data */
    data?: boolean,
    /** Name of the migration file (after the timestamp) */
    name?: string,
}

/**
 * Adopt ez-migrate on an existing database: write its current schema as one
 * migration (and its data as one seed with --data) and record them as already
 * done, because the database already has them. Running these files on an empty
 * database (local, CI, a new server) creates the same schema and data.
 */
export default class Baseline {
    private static consoleLogger = consoleLogger;
    constructor() { throw new Error("Baseline use case constructor not allowed") }

    static async run(options: BaselineOptions = {}) {
        const config = new ConfigReader().getConfig();
        const name = options.name ?? "baseline";
        const schemaHandler = new SchemasHandler({ migrationsPath: config.migrationsPath });
        const seedHandler = new SeedHandler(config);
        const tracker = TrackerFactory.create(config);
        const connection = ConnectionFactory.create(config);
        const written: Array<string> = [];
        try {
            const done = await tracker.listMigrations();
            if (done.length > 0) {
                throw new Error("The tracker already has applied migrations. baseline is only for databases that don't use ez-migrate yet");
            }
            await connection.testConnection();
            const dumper = new SchemaDumper(connection, config.dialect);
            const schema = await dumper.dumpSchema();
            if (schema.tables.length === 0) {
                throw new Error("The database has no tables. Nothing to baseline");
            }

            const migrationPath = schemaHandler.writeMigrationFile(name, schema.up, schema.down);
            written.push(migrationPath);
            let seedPath: string | null = null;
            let rows = 0;
            if (options.data) {
                const data = await dumper.dumpData(schema.tables);
                rows = data.rows;
                if (rows > 0) {
                    seedPath = seedHandler.writeSeedFile(`${name}-data`, data.sql);
                    written.push(seedPath);
                }
            }

            // Read the file back so the tracked SQL is the same as the file and status doesn't mark it as changed
            const migration = schemaHandler.makeMigrationFromFile(migrationPath);
            if (schemaHandler.hasDML(migration.getDetails().up)) {
                throw new Error("The generated schema has DML statements. Check the database objects");
            }
            await tracker.init();
            await (await tracker.save([migration.getDetails()])).commit();
            if (seedPath) await (await tracker.saveSeeds([basename(seedPath)], Migration.getPreciseNow())).commit();

            Baseline.consoleLogger.info(`Schema written to ${migrationPath} (${schema.tables.length} tables) and marked as applied`);
            if (seedPath) Baseline.consoleLogger.info(`Data written to ${seedPath} (${rows} rows) and marked as run`);
            else if (options.data) Baseline.consoleLogger.info("The tables have no rows. No seed file written");
            if (schema.skipped.length > 0) {
                Baseline.consoleLogger.warn(
                    `Not exported, add them to a migration by hand if you need them:\n${schema.skipped.join("\n")}`,
                );
            }
        } catch (err) {
            // Don't leave files that are not tracked: the next migrate would run them on the same database
            for (const path of written) rmSync(path, { force: true });
            throw err;
        } finally {
            await connection.close().catch(() => {});
            await tracker.close().catch(() => {});
        }
    }
}
