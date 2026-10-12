import { join } from "node:path";
import { MIGRATIONS_DIALECTS } from "./constants"
import DatabaseConnector from "./DatabaseConnector"
import { Config } from "./types";
import { consoleLogger } from "./Logger";
import { connectionOptions } from "./ConnectionOptions";

/*
 * The database drivers are loaded only for the dialect in use: loading mysql2
 * and pg on every run made each command slower, also commands that don't connect.
 */
/* eslint-disable @typescript-eslint/no-require-imports */

/** Create DBMS connections by they dialect. Throw if doesn't support the dialect */
export default class ConnectionFactory {
    private constructor() { throw new Error("Not constructor allow for ConnectionFactory") };
    static create(config: Config) {
        const { dialect, envKeys } = config
        switch (dialect) {
            case MIGRATIONS_DIALECTS.MYSQL: {
                const MysqlConnection: typeof import("./mysql").default = require("./mysql").default;
                const mysqlConnection = new MysqlConnection({ ...connectionOptions(envKeys, config.ssl), logger: consoleLogger })
                return new DatabaseConnector(mysqlConnection, {logger: consoleLogger})
            }
            case MIGRATIONS_DIALECTS.SQLITE: {
                // For SQLite the "database" env var is the path of the database file
                const { database } = connectionOptions(envKeys);
                const path = database ?? join(config.sqlitePath, "database.db");
                const SqliteConnection: typeof import("./sqlite").default = require("./sqlite").default;
                const sqliteConnection = new SqliteConnection(path);
                return new DatabaseConnector(sqliteConnection, {logger: consoleLogger})
            }
            case MIGRATIONS_DIALECTS.POSTGRES: {
                const PostgresConnectionImpl: typeof import("./Postgres").default = require("./Postgres").default;
                const postgresConnection = new PostgresConnectionImpl({ ...connectionOptions(envKeys, config.ssl), logger: consoleLogger });
                return new DatabaseConnector(postgresConnection, { logger: consoleLogger });
            }
            default: {
                throw new Error(`Migration dialect not supported: ${dialect}`);
            }
        }
    }
}
