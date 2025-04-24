import ConfigReader from "../ConfigReader";
import SeedHandler from "../SeedHandler";

export default class MakeSeed {
    private constructor() { throw new Error("Make is a static class") }
    static run(name: string) {
        if (!name) throw new Error("A name is necessary for the migration file");
        const config = new ConfigReader().getConfig()
        const seedHandler = new SeedHandler(config);
        seedHandler.makeSeedFile(name);
    }
}