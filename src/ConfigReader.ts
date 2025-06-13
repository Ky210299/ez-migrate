import { readFileSync } from "node:fs";
import { isErrnoException, logErrorMessage } from "./Errors";
import { CONFIG_PATH, DEFAULT_CONFIG, MIGRATIONS_DIALECTS } from "./constants";

import { consoleLogger } from "./Logger";

import type { Config } from "./types";

/**
 * Class for read the configuration file ez-migrate.json. By default returns the
 * default configuration 
*/
export default class ConfigReader {
    private config: Config = structuredClone(DEFAULT_CONFIG);
    constructor() {
        const userConfig: Partial<Config> | null = this.readConfig();
        if (userConfig == null) {
            consoleLogger.warn("Using default configuration")
            return;
        }
        this.config = {
            ...this.config,
            ...userConfig,
            envKeys: {
                ...this.config.envKeys,
                ...userConfig.envKeys
            },
            tracker: {
                ...this.config.tracker,
                ...(userConfig.tracker != null ? { ...userConfig.tracker } : {}),
                envKeys: {
                    ...this.config.tracker.envKeys,
                    ...(userConfig.tracker?.envKeys != null ? { ...userConfig?.tracker.envKeys } : {})
                }
            }
        }
        if (userConfig.tracker == null) {
            this.config.tracker.dialect = userConfig.dialect ?? DEFAULT_CONFIG.dialect
            this.config.tracker.sqlitePath = userConfig.sqlitePath ?? DEFAULT_CONFIG.sqlitePath
            this.config.tracker.envKeys = {
                ...this.config.envKeys
            };
        }
        this.validateConfig();
    }

    private readConfig() {
        try {
            const json = readFileSync(CONFIG_PATH, "utf-8");
            if (!json) {
                consoleLogger.error("Configuration file not found. Use  \"ez-migrate init\" to create it")
                throw ""
            }
            return JSON.parse(json);
        } catch (err) {
            if (isErrnoException(err)) {
                consoleLogger.warn("Cannot read ez-migrate.json. Check if exists in your root.");
                logErrorMessage(err as NodeJS.ErrnoException);
                return null
            }
            consoleLogger.error(`Error reading the config file: \n${err}`);
            return null
        }
    }

    /** Validate the essentials configuration and throw if are wrong */
    private validateConfig() {
        if (typeof this.config !== "object") {
            consoleLogger.error("Invalid configuration file.")
            throw ""
        }
        if (!this.config.envKeys.password) consoleLogger.warn("Password is not especified for database migration target")
        if (!this.config.envKeys.database) {
            consoleLogger.error("Database name is not especified");
            throw ""
        }
        if (!this.config.tracker.envKeys.password) consoleLogger.warn("Password is not especified for tracker database")
        if (!this.config.tracker.envKeys.database) consoleLogger.warn("Tracker name is not especified");
        if (Object.values(MIGRATIONS_DIALECTS).includes(this.config.dialect) === false) {
            consoleLogger.error("Invalid dialect")
            throw ""
        }
    }

    /** Returns the config object */
    getConfig() {
        return this.config;
    }
}
