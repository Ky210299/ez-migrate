import { readFileSync } from "node:fs";
import { isErrnoException, throwMessage } from "./Errors";
import { CONFIG_PATH, DEFAULT_CONFIG, MIGRATIONS_DILALECTS } from "./constants";

class ConfigReader {
    private config: Record<string, any> = DEFAULT_CONFIG;
    constructor() {
        this.config = {
            ...this.config,
            ...this.readConfig()
        }
        this.validateConfig();
    }

    private readConfig() {
        try {
            const json = readFileSync(CONFIG_PATH, "utf-8");
            if (!json) throw new Error("Configuration file not found");
            return JSON.parse(json);
        } catch (err) {
            if (isErrnoException(err)) {
                throwMessage(err as NodeJS.ErrnoException);
            }
            console.error("Error reading the config file: \n", err);
        }
    }

    private validateConfig() {
        if (typeof this.config !== "object") throw new Error("Invalid configuration file.");
        else if (Object.values(MIGRATIONS_DILALECTS).includes(this.config.dialect) === false)
            throw new Error("Invalid dialect");
    }

    getConfig() {
        return this.config;
    }
}

export default new ConfigReader();
