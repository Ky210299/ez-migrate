import { CONFIG_PATH, DEFAULT_CONFIG } from "./constants"
import { existsSync, writeFileSync } from "node:fs"
import { MigrateError } from "./Errors";
import { PinoConsoleLogger } from "./PinoLogger";
import { ConsoleLoggerImpl } from "./Logger";

const pino = new PinoConsoleLogger()
const logger = new ConsoleLoggerImpl(pino)

/** Class for modify and create the configuration file */
export default class ConfigManager {
    private constructor() { throw "ConfigManager is a Static class" }
    
    static existsConfig(path: string = CONFIG_PATH) {
        return existsSync(path ?? CONFIG_PATH);
    }
    
    /** Make the config file */
    static initConfig(path: string = CONFIG_PATH) {
        if (this.existsConfig(path)) {
            logger.info("Config Already exists");
            throw new MigrateError("Config Already exists");
        }
        writeFileSync(path, JSON.stringify(DEFAULT_CONFIG, null, 4), "utf-8")
    }
}