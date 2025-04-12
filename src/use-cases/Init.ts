import ConfigManager from "../ConfigManager";
export default class Init {
    public static async run(path?: string) {
        if (ConfigManager.existsConfig()) {
            return console.log("Configuration already exists");
        } else {
            ConfigManager.initConfig(path);
        }
    }
}