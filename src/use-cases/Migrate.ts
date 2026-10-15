import ConfigReader from "../ConfigReader";
import Migration from "../Migration";
import SchemasHandler from "../SchemasHandler";
import { runPlan, withExecutor, type RunOptions } from "../RunPlan";
import { consoleLogger } from "../Logger";
import type Repository from "../Repository";
import type { Config } from "../types";

export type MigrateOptions = RunOptions & {
    /** Run even if an applied migration file changed */
    allowChanged?: boolean,
}

export default class Migrate {
    static consoleLogger = consoleLogger

    /** Apply all pending migrations in one new batch */
    public static async run(options: MigrateOptions = {}) {
        const config = new ConfigReader().getConfig();
        await runPlan(
            config,
            options,
            async tracker => [{ direction: "up", migrations: Migrate.pending(config, await tracker.listMigrations(), options) }],
            (tracker, [up]) => Migrate.apply(config, tracker, up.migrations),
        );
    }

    /** Apply the migrations in one new batch with a tracker that is already locked */
    static async apply(config: Config, tracker: Repository, migrations: Array<Migration>) {
        if (migrations.length === 0) {
            Migrate.consoleLogger.info("No pending migrations")
            return
        }
        await withExecutor(config, tracker, executor => executor.executeMigrationsUp(migrations));
    }

    /** Pending migrations, in order. Fails if an applied file changed or a pending file has DML */
    static pending(config: Config, done: Array<Migration>, options: MigrateOptions = {}): Array<Migration> {
        const schemaHandler = new SchemasHandler({ migrationsPath: config.migrationsPath })
        schemaHandler.checkAppliedUnchanged(done, options.allowChanged);
        const pending = schemaHandler.getPendingMigrations(done);
        const migrationWithDML = pending.find(m => schemaHandler.hasDML(m.getDetails().up));
        if (migrationWithDML != null) {
            throw new Error(`File ${migrationWithDML.getDetails().path} has DML. Migrations files cannot have DML statements. Use Seeds instead`)
        }
        return pending;
    }
}
