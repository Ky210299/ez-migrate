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

/**
 * One tenant (a client) of a multi-tenant project. Every field but the name is
 * optional: by default a tenant is the schema with its name (PostgreSQL), the
 * database with its name (MySQL) or <sqlitePath>/tenants/<name>.db (SQLite).
 */
export type TenantEntry = {
    /** Letters, numbers, _ and -. It is the name of its folder of migrations */
    name: string,
    /** PostgreSQL: schema of the tenant. MySQL: same as database */
    schema?: string,
    /** MySQL and PostgreSQL: database of the tenant on the same server. SQLite: path of its file */
    database?: string,
    /** Name of the env var with the connection URL of the tenant, when it is on another server */
    url?: string,
}

/** Where the list of tenants comes from: only one of list, file or query */
export type TenantsConfig = {
    /** Folder with one folder of migrations per tenant: <migrationsPath>/<name>/*.sql. Default ./tenants */
    migrationsPath?: string,
    /** The tenants, written in the config */
    list?: Array<TenantEntry>,
    /** JSON file with the array of tenants */
    file?: string,
    /** SELECT run on the main database that returns the columns name, schema, database and url */
    query?: string,
}

/** A tenant with everything needed to connect to it. Made by Tenants.ts */
export type ResolvedTenant = {
    name: string,
    /** PostgreSQL schema. Undefined: the default schema of the database */
    schema?: string,
    /** Database name (MySQL, PostgreSQL) or file path (SQLite) */
    database?: string,
    /** Env var with the connection URL */
    url?: string,
    /** Folder of the migrations of only this tenant */
    migrationsPath: string,
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
    /** Multi-tenant projects: the same migrations in many databases, schemas or files */
    tenants?: TenantsConfig,
    /** Set when a command runs for one tenant (--tenant). Not read from the file */
    tenant?: ResolvedTenant,
    tracker: {
        dialect: (typeof TRACKER_DIALECTS)[keyof typeof TRACKER_DIALECTS],
        sqlitePath: string
        envKeys: EnvKeys,
        ssl?: SslConfig,
    }
}
