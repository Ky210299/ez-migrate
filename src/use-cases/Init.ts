import ConfigManager from "../ConfigManager";
import { consoleLogger } from "../Logger";

export default class Init {
    private static consoleLogger = consoleLogger
    public static async run(path?: string) {
        if (ConfigManager.existsConfig()) {
            Init.consoleLogger.info("Configuration already exists");
            return;
        } else {
            ConfigManager.initConfig(path);
        }
    }
}