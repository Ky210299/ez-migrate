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
        const { migrationsPath } = config
        const schemaHandler = new SchemasHandler({ migrationsPath });
        schemaHandler.makeMigrationFile(name);
    }
}