import type { Config } from "./types";

export const CONFIG_PATH = "./ez-migrate.json";
export const DEFAULT_MIGRATION_PATH = "./migrations";
export const DEFAULT_SEEDS_PATH = "./seeds";

export const MIGRATIONS_DIALECTS = {
    MYSQL: "mysql",
    SQLITE: "sqlite",
    POSTGRES: "postgres",
} as const;

export const TRACKER_DIALECTS = {
    SQLITE: "sqlite",
    MYSQL: "mysql",
    POSTGRES: "postgres"
} as const


export const DEFAULT_CONFIG: Config = {
    dialect: MIGRATIONS_DIALECTS.MYSQL,
    migrationsPath: DEFAULT_MIGRATION_PATH,
    seedsPath: DEFAULT_SEEDS_PATH,
    sqlitePath: DEFAULT_MIGRATION_PATH,
    envKeys: {                                 
        user: "DB_USER",
        password: "DB_PASSWORD",
        port: "DB_PORT",
        host: "DB_HOST",
        database: "DB_NAME"
    },
    tracker: {
        envKeys: {
            user: "TRACKER_USER",
            password: "TRACKER_PASSWORD",
            port: "TRACKER_PORT",
            host: "TRACKER_HOST",
            database: "TRACKER_NAME"
        },
        dialect: TRACKER_DIALECTS.MYSQL,
        sqlitePath: DEFAULT_MIGRATION_PATH
    }
}