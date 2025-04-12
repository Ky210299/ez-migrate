import ConfigReader from "./ConfigReader";
import ConfigManager from "./ConfigManager";
export default class UseCases {
    public static init(path?: string) {
        if (ConfigManager.existsConfig()) return console.log("Configuration already exists");
        else ConfigManager.initConfig(path)
    }
    public static up() { }
    public static down() { }
    public static rollback() { }
    public static migrate(path?: string) { }
    public static status() { }
    public static list() { }
    public static reset() { }
    public static version() { }
    public static help() { }
}