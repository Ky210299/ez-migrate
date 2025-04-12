import { readFileSync } from "node:fs";
import { isErrnoException, throwMessage } from "./Errors";
import { CONFIG_PATH } from "./constants";
const Dialects = {
    MYSQL: "mysql",
} as const;

class ConfigReader {
    private config: Record<string, any>;
    constructor() {
        this.config = this.readConfig();
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
        else if (Object.values(Dialects).includes(this.config.dialect) === false)
            throw new Error("Invalid dialect");
    }

    getConfig() {
        return this.config;
    }
}

export default new ConfigReader();
