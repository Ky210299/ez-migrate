import { Client } from "pg";
import type { ClientConfig } from "pg";
import { ConsoleLoggerImpl } from "./Logger";
import { PostgresConnection } from "./DatabaseConnector";

export default class PostgresConnectionImpl implements PostgresConnection{
    readonly DBMSName: string = "postgres";
    readonly host: string;
    readonly user: string;
    readonly password: string | (() => string | Promise<string>);
    readonly database: string | undefined;
    readonly port: string | number;
    readonly logger: ConsoleLoggerImpl;
    
    initialized: boolean = false;
    private client: Client;

    constructor({
        user,
        password,
        port,
        database,
        host,
        logger,
    }: ClientConfig & { logger: ConsoleLoggerImpl }) {
        this.host = host ?? "localhost";
        this.user = user ?? "postgres";
        this.password = password ?? "";
        this.port = port ?? 5432;
        this.database = database;
        this.logger = logger;

        this.client = new Client({
            host: this.host,
            user: this.user,
            password: this.password,
            port: Number(this.port),
            database: "postgres",
        });
    }

    private async ensureUseDatabase() {
        const { rowCount } = await this.client.query(`
            SELECT * FROM pg_database WHERE datname = $1
            `, [this.database])
        
        if (rowCount != null && rowCount > 0) {
            this.client.end();
            this.client = new Client({
                host: this.host,
                user: this.user,
                password: this.password,
                port: Number(this.port),
                database: this.database
            });
            await this.client.connect();
            return;
        }
        this.logger.info(`"${this.database}" doest'n exists.`);
        await this.client.query(`
            CREATE DATABASE ${this.database}
            `);
        this.logger.info(`"${this.database}" database created`)
        this.client.end();
        this.client = new Client({
            host: this.host,
            user: this.user,
            password: this.password,
            port: Number(this.port),
            database: this.database
        });
        await this.client.connect();
        this.logger.info(`Using new "${this.database}" database`)
    }
    async init(migrationPath?: string, migrationDirection?: string) {
        if (this.initialized) return
        try {
            await this.client.connect()
            await this.ensureUseDatabase()
            await this.client.query("SELECT 1");
            this.logger.info(
                `Using ${this.database} as database target${
                    `${migrationDirection ? " for direction " : ""}`.concat(
                        migrationDirection?.concat(
                            `${migrationPath ? " and " : ""}`
                        ) ?? ""
                    ) + (migrationPath
                        ? `migration: ${migrationPath.substring(
                              migrationPath.lastIndexOf("/") + 1
                          )}`
                        : "")
                }`
            );
        } catch (err) {
            this.logger.warn(`Non-existing or unreachable database ${this.database}`);
            this.logger.warn(
                `Running migration ${migrationPath?.concat(" ") ?? ""}without using any database`
            );
        } finally {
            this.initialized = true
        }
    }

    async isConnected(): Promise<boolean> {
        return this.initialized;
    }

    async runSQL(sql: string, values?: Array<number | string>): Promise<any> {
        try {
            await this.client.query("BEGIN");
            const result = await this.client.query(sql, values ?? undefined);

            await this.client.query("COMMIT");
            return result;
        } catch (err) {
            this.logger.error(`Postgres error during migration:\n${err}`);
            await this.client.query("ROLLBACK").catch(() => {});
            throw err;
        }
    }

    async close(): Promise<void> {
        await this.client.end();
    }
}