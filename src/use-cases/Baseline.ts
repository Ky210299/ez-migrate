import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import ConfigReader from "../ConfigReader";
import ConnectionFactory from "../ConnectionFactory";
import { consoleLogger } from "../Logger";
import SchemaDumper from "../SchemaDumper";
import SchemasHandler from "../SchemasHandler";
import TrackerFactory from "../TrackerFactory";

/** Default folder of the data file. It has its own .gitignore so the data never reaches git */
export const DEFAULT_DATA_PATH = "./ez-migrate-data";

export type BaselineOptions = {
    /** Also write the current data to a file outside git */
    data?: boolean,
    /** Folder of the data file */
    dataPath?: string,
    /** Name of the migration file (after the timestamp) */
    name?: string,
}

/**
 * Adopt ez-migrate on an existing database: write its current schema as one
 * migration and record it as applied, because the database already has it.
 * With --data the rows are written to a file in a folder ignored by git, to load
 * them in another database with `seed --file`. The data is not a seed: seeds are
 * committed, and real data must not be.
 */
export default class Baseline {
    private static consoleLogger = consoleLogger;
    constructor() { throw new Error("Baseline use case constructor not allowed") }

    /** Create the folder with a .gitignore that ignores everything in it */
    private static makeIgnoredFolder(path: string) {
        mkdirSync(path, { recursive: true });
        const gitignore = join(path, ".gitignore");
        if (!existsSync(gitignore)) {
            writeFileSync(gitignore, "# Created by ez-migrate: this folder has real data, keep it out of git\n*\n");
        }
    }

    static async run(options: BaselineOptions = {}) {
        const config = new ConfigReader().getConfig();
        const name = options.name ?? "baseline";
        const schemaHandler = new SchemasHandler({ migrationsPath: config.migrationsPath });
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
            let dataFile: string | null = null;
            let rows = 0;
            if (options.data) {
                const data = await dumper.dumpData(schema.tables);
                rows = data.rows;
                if (rows > 0) {
                    const dataPath = options.dataPath ?? DEFAULT_DATA_PATH;
                    Baseline.makeIgnoredFolder(dataPath);
                    dataFile = join(dataPath, basename(migrationPath).replace(/\.sql$/, "-data.sql"));
                    writeFileSync(dataFile, data.sql);
                    written.push(dataFile);
                }
            }

            // Read the file back so the tracked SQL is the same as the file and status doesn't mark it as changed
            const migration = schemaHandler.makeMigrationFromFile(migrationPath);
            if (schemaHandler.hasDML(migration.getDetails().up)) {
                throw new Error("The generated schema has DML statements. Check the database objects");
            }
            await tracker.init();
            await (await tracker.save([migration.getDetails()])).commit();

            Baseline.consoleLogger.info(`Schema written to ${migrationPath} (${schema.tables.length} tables) and marked as applied`);
            if (dataFile) {
                Baseline.consoleLogger.info(
                    `Data written to ${dataFile} (${rows} rows). It is ignored by git. Load it in another database with: ez-migrate seed --file ${dataFile}`,
                );
            }
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
