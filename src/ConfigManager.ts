import { CONFIG_PATH, DEFAULT_CONFIG } from "./constants"
import { existsSync, writeFileSync } from "node:fs"
import { MigrateError } from "./Errors";

/** Class for modify and create the configuration file */
export default class ConfigManager {
    private constructor() { throw "ConfigManager is a Static class" }
    
    static existsConfig(path: string = CONFIG_PATH) {
        return existsSync(path ?? CONFIG_PATH);
    }
    
    /**
     * Make the config file. It has no "tracker" key, so the migrations are
     * tracked in the target database until the user adds one.
     */
    static initConfig(path: string = CONFIG_PATH) {
        if (this.existsConfig(path)) throw new MigrateError("Config Already exists");
        const { dialect, migrationsPath, seedsPath, sqlitePath, envKeys } = DEFAULT_CONFIG;
        const config = { dialect, migrationsPath, seedsPath, sqlitePath, envKeys };
        writeFileSync(path, JSON.stringify(config, null, 4) + "\n", "utf-8")
    }
}
