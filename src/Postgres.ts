import { Client } from "pg";
import type { CustomTypesConfig } from "pg";
import type { ConnectionData, TlsOptions } from "./ConnectionOptions";
import { ConsoleLoggerImpl } from "./Logger";
import { PostgresConnection, Row } from "./DatabaseConnector";
import { describeTarget } from "./utils";

/**
 * Postgres error codes when a database or schema is created by another process
 * at the same time: "already exists", or a unique violation in the catalog
 */
const CREATED_AT_SAME_TIME = new Set(["42P04", "42P06", "23505"]);

function createdAtSameTime(err: unknown) {
    return CREATED_AT_SAME_TIME.has((err as { code?: string }).code ?? "");
}

/** Create the database if it doesn't exist. Returns true if it was created */
export async function createDatabaseIfMissing(admin: Client, database: string): Promise<boolean> {
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
    if (rowCount) return false;
    try {
        await admin.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
        return true;
    } catch (err) {
        if (createdAtSameTime(err)) return false;
        throw err;
    }
}

/**
 * Create the schema if it doesn't exist and make it the only schema of the
 * session, so the migrations create and find their objects only there.
 * Returns true if it was created.
 */
export async function useSchema(client: Client, schema: string): Promise<boolean> {
    const quoted = `"${schema.replace(/"/g, '""')}"`;
    let created = false;
    const { rowCount } = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [schema]);
    if (!rowCount) {
        try {
            await client.query(`CREATE SCHEMA ${quoted}`);
            created = true;
        } catch (err) {
            if (!createdAtSameTime(err)) throw err;
        }
    }
    await client.query(`SET search_path TO ${quoted}`);
    return created;
}

export default class PostgresConnectionImpl implements PostgresConnection{
    readonly DBMSName: string = "postgres";
    readonly host: string;
    readonly user: string;
    readonly password: string;
    database: string | undefined;
    readonly port: string | number;
    readonly ssl: TlsOptions | undefined;
    /** Schema of a tenant. Undefined: the default schema of the database */
    readonly schema: string | undefined;
    readonly logger: ConsoleLoggerImpl;
    
    private client: Client | null = null;

    constructor({
        user,
        password,
        port,
        database,
        host,
        ssl,
        schema,
        logger,
    }: ConnectionData & { schema?: string, logger: ConsoleLoggerImpl }) {
        this.host = host ?? "localhost";
        this.user = user ?? "postgres";
        this.password = password ?? "";
        this.port = port ?? 5432;
        this.database = database;
        this.ssl = ssl;
        this.schema = schema;
        this.logger = logger;
    }

    private newClient(database: string) {
        return new Client({
            host: this.host,
            user: this.user,
            password: this.password,
            port: Number(this.port),
            database,
            ssl: this.ssl,
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
            if (await createDatabaseIfMissing(admin, this.database)) this.logger.info(`"${this.database}" database created`);
        } finally {
            await admin.end();
        }
        const client = this.newClient(this.database);
        await client.connect();
        if (this.schema != null) {
            try {
                if (await useSchema(client, this.schema)) this.logger.info(`Schema ${this.schema} created`);
            } catch (err) {
                await client.end().catch(() => {});
                throw err;
            }
        }
        this.client = client;
        return client;
    }

    async init(migrationPath?: string, migrationDirection?: string) {
        await this.connect();
        const target = this.schema != null ? `${this.database} (schema ${this.schema})` : this.database;
        this.logger.info(describeTarget(target, migrationPath, migrationDirection));
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
            this.logger.debug(`Postgres error, transaction rolled back: ${err}`);
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
