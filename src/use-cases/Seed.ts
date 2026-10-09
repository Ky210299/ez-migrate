import ConfigReader from "../ConfigReader";
import ConnectionFactory from "../ConnectionFactory";
import { consoleLogger } from "../Logger";
import Migration from "../Migration";
import SeedExecutor from "../SeedExecutor";
import SeedHandler from "../SeedHandler"
import TrackerFactory from "../TrackerFactory";

export type SeedOptions = {
    /** Run every seed file, also the ones already run */
    all?: boolean,
    /** Record the pending seeds as run without running them */
    fake?: boolean,
}

export default class Seed {
    private static consoleLogger = consoleLogger;
    constructor() { throw new Error("Seed use case constructor not allowed") }
    
    /**
     * Run the seed files not run yet, in one transaction, and record them in
     * the tracker. If one seed fails, nothing is inserted and nothing is recorded.
     */
    static async run(options: SeedOptions = {}){
        const config = new ConfigReader().getConfig()
        const seeds = new SeedHandler(config).getSeeds();
        const tracker = TrackerFactory.create(config);
        try {
            const done = new Set(options.all ? [] : await tracker.listSeeds());
            const pending = seeds.filter(seed => !done.has(seed.name));
            if (pending.length === 0) {
                Seed.consoleLogger.info("No pending seeds")
                return
            }
            const names = pending.map(seed => seed.name);
            await tracker.init();
            const { commit, rollback } = await tracker.saveSeeds(names, Migration.getPreciseNow());
            if (options.fake) {
                await commit();
                Seed.consoleLogger.info(`Marked as run without running them:\n${names.join("\n")}`);
                return
            }
            const seedExecutor = new SeedExecutor(ConnectionFactory.create(config));
            try {
                await seedExecutor.execute(pending.map(seed => seed.sql))
            } catch (err) {
                await rollback();
                throw err;
            } finally {
                await seedExecutor.close()
            }
            await commit();
            Seed.consoleLogger.info(`Seeds run:\n${names.join("\n")}`);
        } finally {
            await tracker.close().catch(() => {})
        }
    }
}
