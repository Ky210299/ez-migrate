import ConfigReader from "../ConfigReader";
import SchemasHandler from "../SchemasHandler"
import { consoleLogger } from "../Logger";

export default class Make {
    private static consoleLogger = consoleLogger
    private constructor() { throw new Error("Make is a static class") }
    static run(name: string) {
        if (!name) {
            Make.consoleLogger.error("A name is necessary for the migration file")
            return
        }
        const config = new ConfigReader().getConfig()
        // With --tenant the file goes to the folder of that tenant
        const schemaHandler = SchemasHandler.forConfig(config);
        const path = schemaHandler.makeMigrationFile(name);
        return path
    }
}
