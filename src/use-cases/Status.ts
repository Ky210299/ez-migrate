import ConfigReader from "../ConfigReader";
import SchemasHandler from "../SchemasHandler";
import TrackerFactory from "../TrackerFactory";
import { consoleLogger } from "../Logger";

export default class Status {
    static consoleLogger = consoleLogger;
    public static async run() {
        const config = new ConfigReader().getConfig();
        const schemaHandler = new SchemasHandler({ migrationsPath: config.migrationsPath });
        const allMigrations = schemaHandler.getAllMigrations().map(m => schemaHandler.makeMigrationFromFile(m));
        const tracker = TrackerFactory.create(config);
        const allMigrationsDone = await tracker.listMigrations();
        
        
        const status = []
        
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
        Status.consoleLogger.info("\n" + (status
            .reverse()
            .map((s, i) => `${Math.abs(i - status.length)} ${s.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+\.\d+-/, "")}`))
            .join("\n")
            .trim());
        await tracker.close()
    }
    
}