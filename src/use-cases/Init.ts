import ConfigManager from "../ConfigManager";
import { consoleLogger } from "../Logger";
import { CONFIG_PATH } from "../constants";

export default class Init {
    private static consoleLogger = consoleLogger
    /** Create the config file in path (default ./ez-migrate.json) if it doesn't exist */
    public static async run(path: string = CONFIG_PATH) {
        if (ConfigManager.existsConfig(path)) {
            Init.consoleLogger.info("Configuration already exists");
            return;
        }
        ConfigManager.initConfig(path);
        Init.consoleLogger.info(`Configuration created in ${path}`);
    }
}
