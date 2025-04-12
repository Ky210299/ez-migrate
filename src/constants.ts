import type { Config } from "./types";

export const CONFIG_PATH = "./ez-migrate.json";
export const DEFAULT_MIGRATION_PATH = "./migrations";

export const MIGRATIONS_DILALECTS = {
    MYSQL: "mysql",
} as const;

export const TRACKER_DIALECTS = {
    sqlite: "sqlite"
} as const

export const DEFAULT_CONFIG: Config = {
    dialect: MIGRATIONS_DILALECTS.MYSQL,
    trackerDialect: TRACKER_DIALECTS.sqlite,
    migrationsPath: DEFAULT_MIGRATION_PATH,
    envKeys: {
        user: "DB_USER",
        password: "DB_PASSWORD",
        port: "DB_PORT",
        host: "DB_HOST",
        database: "DB_NAME"
    }
}