import ConfigReader from "../ConfigReader";
import SchemasHandler from "../SchemasHandler";
import TrackerFactory from "../TrackerFactory";

export default class Status {
    public static async run() {
        const config = new ConfigReader().getConfig();
        const schemaHandler = new SchemasHandler(config.migrationsPath);
        const allMigrations = schemaHandler.getSchemasFilesName();
        const tracker = TrackerFactory.create(config);
        const allMigrationsDone = (await tracker.listMigrations()).map(m => {
            const path = m.getDetails().path;
            return path.substring(path.lastIndexOf("/") + 1);
        })
        const status = new Array(Math.max(allMigrations.length, allMigrationsDone.length))
        for (const migration of allMigrations) {
            if (allMigrationsDone.includes(migration)) status.push(`✔ ${migration}`)
            else status.push(`✘ ${migration}`)
        }
        console.log(status)
    }
    
}