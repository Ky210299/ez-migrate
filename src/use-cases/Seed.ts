import ConfigReader from "../ConfigReader";
import ConnectionFactory from "../ConnectionFactory";
import { consoleLogger } from "../Logger";
import SeedExecutor from "../SeedExecutor";
import SeedHandler from "../SeedHandler"

export default class Seed {
    private static consoleLogger = consoleLogger;
    constructor() { throw new Error("Seed use case constructor not allowed") }
    
    /** Run all seed files in one transaction */
    static async run(){
        const config = new ConfigReader().getConfig()
        const seedHandler = new SeedHandler(config);
        const seeds = seedHandler.getSeeds();
        if (seeds.length === 0) {
            Seed.consoleLogger.info("No seeds available")
            return
        }
        const seedExecutor = new SeedExecutor(ConnectionFactory.create(config));
        try {
            await seedExecutor.execute(seeds)
        } finally {
            await seedExecutor.close()
        }
    }
}
