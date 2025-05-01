import { MIGRATIONS_DILALECTS, TRACKER_DIALECTS } from "./constants.js";
export type Config = {
    dialect: (typeof MIGRATIONS_DILALECTS)[keyof typeof MIGRATIONS_DILALECTS] ,
    migrationsPath: string,
    seedsPath: string,
    envKeys: {
        user: string,
        password: string,
        port: string | number,
        host: string,
        database: string,
    }
    tracker: {
        dialect: (typeof TRACKER_DIALECTS)[keyof typeof TRACKER_DIALECTS],
        sqlitePath: string
        envKeys: {
            user: string,
            password: string,
            port: string | number,
            host: string,
            database: string,
        }
    }
}