import ConfigReader from "../ConfigReader";
import { runPlan, withExecutor, type RunOptions } from "../RunPlan";
import Migrate from "./Migrate";

export default class Reset {
    /** Revert all migrations, newest first, and apply them again in one batch, holding the lock for both steps */
    public static async run(options: RunOptions = {}) {
        const config = new ConfigReader().getConfig();
        await runPlan(
            config,
            options,
            async tracker => [
                { direction: "down", migrations: (await tracker.listMigrations()).reverse() },
                // After reverting everything, every file is pending
                { direction: "up", migrations: Migrate.pending(config, []) },
            ],
            async (tracker, [down, up]) => {
                if (down.migrations.length) {
                    await withExecutor(config, tracker, executor => executor.executeMigrationsDown(down.migrations));
                }
                await Migrate.apply(config, tracker, up.migrations);
            },
        );
    }
}
