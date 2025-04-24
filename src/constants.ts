import type { Config } from "./types";

export const CONFIG_PATH = "./ez-migrate.json";
export const DEFAULT_MIGRATION_PATH = "./migrations";
export const DEFAULT_SEEDS_PATH = "./seeds";

export const MIGRATIONS_DILALECTS = {
    MYSQL: "mysql",
    SQLITE: "sqlite",
} as const;

export const TRACKER_DIALECTS = {
    SQLITE: "sqlite"
} as const

export const DEFAULT_CONFIG: Config = {
    dialect: MIGRATIONS_DILALECTS.MYSQL,
    trackerDialect: TRACKER_DIALECTS.SQLITE,
    migrationsPath: DEFAULT_MIGRATION_PATH,
    seedsPath: DEFAULT_SEEDS_PATH,
    envKeys: {
        user: "DB_USER",
        password: "DB_PASSWORD",
        port: "DB_PORT",
        host: "DB_HOST",
        database: "DB_NAME"
    },
    sqlite: {
        trackerPath: DEFAULT_MIGRATION_PATH,
    }
}