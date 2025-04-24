import ConfigReader from "../ConfigReader";
import SchemasHandler from "../SchemasHandler";
import TrackerFactory from "../TrackerFactory";

export default class Status {
    public static async run() {
        const config = new ConfigReader().getConfig();
        const schemaHandler = new SchemasHandler(config.migrationsPath);
        const allMigrations = schemaHandler.getAllMigrations().map(m => schemaHandler.makeMigrationFromFile(m));
        const tracker = TrackerFactory.create(config);
        const allMigrationsDone = await tracker.listMigrations();
        
        const status = new Array(Math.max(allMigrations.length, allMigrationsDone.length))
        
        for (const migration of allMigrations) {
            const { path, up } = migration.getDetails()
            const name = path.substring(path.lastIndexOf("/") + 1)
            
            const migrationDone =allMigrationsDone.find(m => m.getDetails().path === path);
            const isDone = migrationDone != null;
            
            const hasDifferentUp = up.trim() !== migrationDone?.getDetails().up.trim();
            
            if (isDone && hasDifferentUp) status.push(`⚠️ - ${name}`)
            else if (isDone) status.push(`✔ - ${name}`)
            else status.push(`✘ - ${name}`);
        }
        console.log(status.reverse())
        await tracker.close()
    }
    
}