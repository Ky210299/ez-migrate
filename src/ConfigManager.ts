import { CONFIG_PATH, DEFAULT_CONFIG } from "./constants"
import { existsSync, writeFileSync } from "node:fs"
import { MigrateError } from "./Errors";
export default class ConfigManager {
    constructor() { }
    
    public existsConfig(path: string = CONFIG_PATH) {
        return existsSync(path ?? CONFIG_PATH);
    }
    
    public initConfig(path: string = CONFIG_PATH) {
        if (this.existsConfig(path)) {
            throw new MigrateError("Config Already exists");
        }
        writeFileSync(path, JSON.stringify(DEFAULT_CONFIG, null, 4), "utf-8")
    }
}