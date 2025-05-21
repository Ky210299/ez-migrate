import { readFileSync } from "node:fs";
import { isErrnoException, throwMessage } from "./Errors";
import { CONFIG_PATH, DEFAULT_CONFIG, MIGRATIONS_DILALECTS } from "./constants";

import { PinoConsoleLogger } from "./PinoLogger";
import { ConsoleLoggerImpl } from "./Logger";

const pino = new PinoConsoleLogger()
const logger = new ConsoleLoggerImpl(pino)

import type { Config } from "./types";

/**
 * Class for read the configuration file ez-migrate.json. By default returns the
 * default configuration 
*/
export default class ConfigReader {
    private config: Config = DEFAULT_CONFIG;
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
            if (!json) {
                logger.error("Configuration file not found. Use  \"ez-migrate init\" to create it")
                throw ""
            }
            return JSON.parse(json);
        } catch (err) {
            if (isErrnoException(err)) {
                logger.error("Error reading the config file: \nCheck if exist ez-migrate.json in your root");
                throwMessage(err as NodeJS.ErrnoException);
            }
            logger.error(`Error reading the config file: \n${err}`);
        }
    }

    /** Validate the essentials configuration and throw if are wrong */
    private validateConfig() {
        if (typeof this.config !== "object") {
            logger.error("Invalid configuration file.")
            throw ""
        }
        if (!this.config.envKeys.password) logger.warn("Password is not especified for database migration target")
        if (!this.config.envKeys.database) logger.warn("Database name is not especified");
        if (!this.config.tracker.envKeys.password) logger.warn("Password is not especified for tracker database")
        if (!this.config.tracker.envKeys.database) logger.warn("Tracker name is not especified");
        if (Object.values(MIGRATIONS_DILALECTS).includes(this.config.dialect) === false) {
            logger.error("Invalid dialect")
            throw ""
        }
    }

    /** Returns the config object */
    getConfig() {
        return this.config;
    }
}
