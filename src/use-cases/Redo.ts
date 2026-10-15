import ConfigReader from "../ConfigReader";
import SchemasHandler from "../SchemasHandler";
import { runPlan, withExecutor, type RunOptions } from "../RunPlan";
import { consoleLogger } from "../Logger";

export default class Redo {
    private constructor() { throw new Error("Not constructor available for Redo") }
    /** Revert the last migration and apply the same migration file again, holding the lock for both steps */
    static async run(options: RunOptions = {}) {
        const config = new ConfigReader().getConfig();
        const schemaHandler = new SchemasHandler({ migrationsPath: config.migrationsPath });
        await runPlan(
            config,
            options,
            async tracker => {
                const last = await tracker.getLastMigrationDone();
                if (last == null) return [{ direction: "down", migrations: [] }];
                // Checked before reverting, so a missing file doesn't leave the migration reverted
                const file = schemaHandler.findMigrationFile(last);
                if (file == null) throw new Error(`Migration file ${last.getDetails().path} not found. It cannot be applied again, so nothing was reverted`);
                return [
                    { direction: "down", migrations: [last] },
                    { direction: "up", migrations: [schemaHandler.makeMigrationFromFile(file)] },
                ];
            },
            async (tracker, [down, up]) => {
                if (down.migrations.length === 0) {
                    consoleLogger.info("There is not migrations done")
                    return
                }
                await withExecutor(config, tracker, async executor => {
                    await executor.executeSingleMigrationDown(down.migrations[0]);
                    await executor.executeSingleMigrationUp(up.migrations[0]);
                });
            },
        );
    }
}
