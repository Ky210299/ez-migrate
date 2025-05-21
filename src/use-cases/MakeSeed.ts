import ConfigReader from "../ConfigReader";
import SeedHandler from "../SeedHandler";
import { consoleLogger } from "../Logger";

export default class MakeSeed {
    private static consoleLogger = consoleLogger;
    private constructor() { throw new Error("Make is a static class") }
    static run(name: string) {
        if (!name) {
            MakeSeed.consoleLogger.error("A name is necessary for the migration file")
            return
        }
        const config = new ConfigReader().getConfig()
        const seedHandler = new SeedHandler(config);
        seedHandler.makeSeedFile(name);
    }
}