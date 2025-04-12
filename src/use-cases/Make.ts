import ConfigReader from "../ConfigReader";
import SchemasHandler from "../SchemasHandler"

export default class Make {
    private constructor() { throw new Error("Make is a static class") }
    static run(name: string) {
        if (!name) throw new Error("A name is necessary for the migration file");
        const config = new ConfigReader().getConfig()
        const { migrationsPath } = config
        const schemaHandler = new SchemasHandler({ migrationsPath });
        schemaHandler.makeMigrationFile(name);
    }
}