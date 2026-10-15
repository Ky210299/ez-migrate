import ConfigReader from "../ConfigReader";
import { runPlan, withExecutor, type RunOptions } from "../RunPlan";
import { consoleLogger } from "../Logger";

export default class Rollback {
    static consoleLogger = consoleLogger;
    /** Revert all migrations of the last batch, newest first */
    public static async run(options: RunOptions = {}) {
        const config = new ConfigReader().getConfig();
        await runPlan(
            config,
            options,
            async tracker => [{ direction: "down", migrations: await tracker.getLastBatchMigrationDone() ?? [] }],
            async (tracker, [down]) => {
                if (down.migrations.length === 0) {
                    Rollback.consoleLogger.info("Not migration done for rollback.")
                    return
                }
                await withExecutor(config, tracker, executor => executor.executeBatchDown(down.migrations));
            },
        );
    }
}
