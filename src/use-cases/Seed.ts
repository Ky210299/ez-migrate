import ConfigReader from "../ConfigReader";
import ConnectionFactory from "../ConnectionFactory";
import SeedExecutor from "../SeedExecutor";
import SeedHandler from "../SeedHandler"

export default class Seed{
    constructor() { throw new Error("Seed use case constructor not allowed") }
    
    static async run(){
        const config = new ConfigReader().getConfig()
        const seedHandler = new SeedHandler(config);
        const seeds = seedHandler.getSeeds();
        if (seeds.length === 0) throw new Error("Not seeds available");
        const connection = ConnectionFactory.create(config)
        const seedExecutor = new SeedExecutor(connection);
        await seedExecutor.execute(seeds)
        await seedExecutor.close()
    }
}