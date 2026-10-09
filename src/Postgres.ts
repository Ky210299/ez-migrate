import { Client } from "pg";
import type { ClientConfig, CustomTypesConfig } from "pg";
import { ConsoleLoggerImpl } from "./Logger";
import { PostgresConnection, Row } from "./DatabaseConnector";
import { describeTarget } from "./utils";

export default class PostgresConnectionImpl implements PostgresConnection{
    readonly DBMSName: string = "postgres";
    readonly host: string;
    readonly user: string;
    readonly password: string | (() => string | Promise<string>);
    database: string | undefined;
    readonly port: string | number;
    readonly logger: ConsoleLoggerImpl;
    
    private client: Client | null = null;

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
    }

    private newClient(database: string) {
        return new Client({
            host: this.host,
            user: this.user,
            password: this.password,
            port: Number(this.port),
            database,
        });
    }

    /** Connect to the target database. Creates the database if it doesn't exist */
    private async connect(): Promise<Client> {
        if (this.client != null) return this.client;
        if (this.database == null) {
            this.logger.warn("Undefined database. Using default database postgres");
            this.database = "postgres";
        }
        const admin = this.newClient("postgres");
        await admin.connect();
        try {
            const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [this.database]);
            if (!rowCount) {
                await admin.query(`CREATE DATABASE "${this.database.replace(/"/g, '""')}"`);
                this.logger.info(`"${this.database}" database created`);
            }
        } finally {
            await admin.end();
        }
        const client = this.newClient(this.database);
        await client.connect();
        this.client = client;
        return client;
    }

    async init(migrationPath?: string, migrationDirection?: string) {
        await this.connect();
        this.logger.info(describeTarget(this.database, migrationPath, migrationDirection));
    }

    async isConnected(): Promise<boolean> {
        try {
            const client = await this.connect();
            await client.query("SELECT 1");
            return true;
        } catch (err) {
            this.logger.error(`Cannot connect to Postgres: ${err}`);
            return false;
        }
    }

    /** Run the SQL in a transaction. Postgres DDL is transactional, so a failed migration leaves no changes */
    async runSQL(sql: string, values?: Array<number | string>): Promise<unknown> {
        const client = await this.connect();
        try {
            await client.query("BEGIN");
            const result = await client.query(sql, values ?? undefined);
            await client.query("COMMIT");
            return result;
        } catch (err) {
            this.logger.error(`Postgres error during migration:\n${err}`);
            await client.query("ROLLBACK").catch(() => {});
            throw err;
        }
    }

    async query(sql: string, values?: Array<unknown>): Promise<Array<Row>> {
        const client = await this.connect();
        // Keep every value as the text Postgres sends, so it can be written back as a literal
        const types = { getTypeParser: () => (value: string) => value } as unknown as CustomTypesConfig;
        const { rows } = await client.query({ text: sql, values, types });
        return rows;
    }

    async close(): Promise<void> {
        await this.client?.end();
        this.client = null;
    }
}
