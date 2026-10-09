import { mkdirSync } from "node:fs";
import { join } from "node:path";
import ConfigManager from "../ConfigManager";
import { consoleLogger } from "../Logger";
import { CONFIG_PATH, CONFIG_FILE_NAME } from "../constants";

export default class Init {
    private static consoleLogger = consoleLogger
    /** Create ez-migrate.json in the directory (default: current directory) if it doesn't exist */
    public static async run(directory?: string) {
        let path = CONFIG_PATH;
        if (directory) {
            mkdirSync(directory, { recursive: true });
            path = join(directory, CONFIG_FILE_NAME);
        }
        if (ConfigManager.existsConfig(path)) {
            Init.consoleLogger.info("Configuration already exists");
            return;
        }
        ConfigManager.initConfig(path);
        Init.consoleLogger.info(`Configuration created in ${path}`);
    }
}
