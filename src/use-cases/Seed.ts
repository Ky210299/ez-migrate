import ConfigReader from "../ConfigReader";
import ConnectionFactory from "../ConnectionFactory";
import { ConsoleLoggerImpl } from "../Logger";
import { PinoConsoleLogger } from "../PinoLogger";
import SeedExecutor from "../SeedExecutor";
import SeedHandler from "../SeedHandler"

const pino = new PinoConsoleLogger()
const consoleLogger = new ConsoleLoggerImpl(pino)

export default class Seed {
    private static consoleLogger = consoleLogger;
    constructor() { throw new Error("Seed use case constructor not allowed") }
    
    static async run(){
        const config = new ConfigReader().getConfig()
        const seedHandler = new SeedHandler(config);
        const seeds = seedHandler.getSeeds();
        if (seeds.length === 0) {
            Seed.consoleLogger.info("Not seeds available")
            return
        }
        const connection = ConnectionFactory.create(config)
        const seedExecutor = new SeedExecutor(connection);
        await seedExecutor.execute(seeds)
        await seedExecutor.close()
    }
}