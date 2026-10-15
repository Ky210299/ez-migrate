import { MIGRATIONS_DIALECTS, TRACKER_DIALECTS } from "./constants.js";

/** Names of the env vars with the connection data */
export type EnvKeys = {
    user: string,
    password: string,
    port: string | number,
    host: string,
    database: string,
    /** Optional. Env var with a connection URL (mysql://… or postgres://…). If it has a value, it is used instead of the other env vars */
    url?: string,
}

/**
 * TLS for MySQL and PostgreSQL. `true` encrypts and verifies the server
 * certificate. The object form sets the certificate files (paths) or turns
 * off the verification.
 */
export type SslConfig = boolean | {
    rejectUnauthorized?: boolean,
    ca?: string,
    cert?: string,
    key?: string,
}

export type Config = {
    dialect: (typeof MIGRATIONS_DIALECTS)[keyof typeof MIGRATIONS_DIALECTS] ,
    migrationsPath: string,
    seedsPath: string,
    sqlitePath: string,
    envKeys: EnvKeys,
    ssl?: SslConfig,
    /** false: never ask before running migrations at the terminal. Default true */
    confirm?: boolean,
    tracker: {
        dialect: (typeof TRACKER_DIALECTS)[keyof typeof TRACKER_DIALECTS],
        sqlitePath: string
        envKeys: EnvKeys,
        ssl?: SslConfig,
    }
}
