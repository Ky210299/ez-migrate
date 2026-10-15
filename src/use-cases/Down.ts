import ConfigReader from "../ConfigReader";
import { runPlan, withExecutor, type RunOptions } from "../RunPlan";
import { consoleLogger } from "../Logger";

/** Class for running the Down use case */
export default class Down {
    /** Revert the last migration done */
    public static async run(options: RunOptions = {}) {
        const config = new ConfigReader().getConfig();
        await runPlan(
            config,
            options,
            async tracker => {
                const last = await tracker.getLastMigrationDone();
                return [{ direction: "down", migrations: last ? [last] : [] }];
            },
            async (tracker, [down]) => {
                if (down.migrations.length === 0) {
                    consoleLogger.info("There is not migrations done")
                    return
                }
                await withExecutor(config, tracker, executor => executor.executeSingleMigrationDown(down.migrations[0]));
            },
        );
    }
}
