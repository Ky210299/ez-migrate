import ConfigReader from "../ConfigReader";
import { assertSqlOnlyChangesTenant } from "../Tenants";
import ConnectionFactory from "../ConnectionFactory";
import { consoleLogger } from "../Logger";
import Migration from "../Migration";
import SeedExecutor from "../SeedExecutor";
import SeedHandler from "../SeedHandler"
import { withLockedTracker } from "../TrackerSession";

export type SeedOptions = {
    /** Run every seed file, also the ones already run */
    all?: boolean,
    /** Record the pending seeds as run without running them */
    fake?: boolean,
    /** Run only this file, without recording it */
    file?: string,
}

export default class Seed {
    private static consoleLogger = consoleLogger;
    constructor() { throw new Error("Seed use case constructor not allowed") }
    
    /**
     * Run one SQL file in one transaction, without recording it. For data that
     * must not be in the seeds folder, like the data file written by baseline
     */
    static async runFile(path: string) {
        const config = new ConfigReader().getConfig()
        const sql = new SeedHandler(config).readDataFile(path);
        assertSqlOnlyChangesTenant(config, `File ${path}`, sql);
        const seedExecutor = new SeedExecutor(ConnectionFactory.create(config));
        try {
            await seedExecutor.executeDataFile(sql);
        } finally {
            await seedExecutor.close()
        }
        Seed.consoleLogger.info(`File run: ${path}`);
    }

    /**
     * Run the seed files not run yet, in one transaction, and record them in
     * the tracker. If one seed fails, nothing is inserted and nothing is recorded.
     */
    static async run(options: SeedOptions = {}){
        if (options.file) return Seed.runFile(options.file);
        const config = new ConfigReader().getConfig()
        const seeds = new SeedHandler(config).getSeeds();
        await withLockedTracker(config, async tracker => {
            const done = new Set(options.all ? [] : await tracker.listSeeds());
            const pending = seeds.filter(seed => !done.has(seed.name));
            if (pending.length === 0) {
                Seed.consoleLogger.info("No pending seeds")
                return
            }
            for (const seed of pending) assertSqlOnlyChangesTenant(config, `Seed ${seed.name}`, seed.sql);
            const names = pending.map(seed => seed.name);
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
        });
    }
}
