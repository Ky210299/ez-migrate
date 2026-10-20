import ConfigReader from "../ConfigReader";
import Migration from "../Migration";
import SchemasHandler from "../SchemasHandler";
import { runPlan, withExecutor } from "../RunPlan";
import { consoleLogger } from "../Logger";
import type Repository from "../Repository";
import type { Config } from "../types";
import type { MigrateOptions } from "./Migrate";
import { assertOnlyChangesTenant } from "../Tenants";

/** Class for running the Up use case */
export default class Up {
    static consoleLogger = consoleLogger

    /** Execute the next pending migration */
    public static async run(options: MigrateOptions = {}) {
        const config = new ConfigReader().getConfig();
        await runPlan(
            config,
            options,
            async tracker => {
                const next = await Up.next(config, tracker, options);
                return [{ direction: "up", migrations: next ? [next] : [] }];
            },
            async (tracker, [up]) => {
                if (up.migrations.length === 0) {
                    Up.consoleLogger.info("There is not a next migration available");
                    return
                }
                await withExecutor(config, tracker, executor => executor.executeSingleMigrationUp(up.migrations[0]));
            },
        );
    }

    /** Next pending migration, or null. Fails if an applied file changed or the next file has DML */
    private static async next(config: Config, tracker: Repository, options: MigrateOptions): Promise<Migration | null> {
        const schemaHandler = SchemasHandler.forConfig(config);
        const done = await tracker.listMigrations();
        schemaHandler.checkAppliedUnchanged(done, options.allowChanged);
        const nextMigration = schemaHandler.getPendingMigrations(done).at(0) ?? null;
        if (nextMigration != null && schemaHandler.hasDML(nextMigration.getDetails().up)) {
            throw new Error(`Migration file with DML: ${nextMigration.getDetails().path}. Migrations files cannot have DML statements. Use Seeds instead`);
        }
        if (nextMigration != null) assertOnlyChangesTenant(config, [nextMigration.getDetails()]);
        return nextMigration;
    }
}
