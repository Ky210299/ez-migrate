import { createConnection, createPool } from "mysql2/promise";
import type { PoolOptions, Pool } from "mysql2/promise";
import { MySQLConnection } from "./DatabaseConnector.js";
import { ConsoleLoggerImpl } from "./Logger.js";
import { describeTarget } from "./utils.js";

export default class MysqlConnection implements MySQLConnection {
    private pool: Pool | null = null;
    readonly DBMSName: string = "mysql";
    readonly host: string;
    readonly user: string;
    readonly password: string | undefined;
    readonly database: string | undefined;
    readonly port: string | number;
    readonly logger: ConsoleLoggerImpl;
    constructor({ user, password, port, database, host, logger }: PoolOptions & { logger: ConsoleLoggerImpl }) {
        this.host = host ?? "localhost";
        this.user = user ?? "root";
        this.password = password ?? "";
        this.port = port ?? 3306;
        this.database = database;
        this.logger = logger
    }

    /** Returns a pool connected to the target database. Creates the database if it doesn't exist */
    private async getPool(): Promise<Pool> {
        if (this.pool != null) return this.pool;
        const options = {
            host: this.host,
            user: this.user,
            password: this.password,
            port: Number(this.port),
        };
        if (this.database != null) {
            const connection = await createConnection(options);
            try {
                const [result] = await connection.query(
                    `CREATE DATABASE IF NOT EXISTS \`${this.database.replace(/`/g, "``")}\``,
                ) as unknown as [{ warningStatus: number }];
                if (result.warningStatus === 0) this.logger.info(`Database ${this.database} created`);
            } finally {
                await connection.end();
            }
        } else {
            this.logger.warn("Undefined database. Running the migrations without selecting a database");
        }
        this.pool = createPool({
            ...options,
            database: this.database,
            multipleStatements: true,
            connectionLimit: 1,
        });
        return this.pool;
    }

    async init(migrationPath?: string, migrationDirection?: string) {
        await this.getPool();
        this.logger.info(describeTarget(this.database, migrationPath, migrationDirection));
    }

    async isConnected(): Promise<boolean> {
        try {
            const pool = await this.getPool();
            await pool.query("SELECT 1");
            return true;
        } catch (err) {
            this.logger.error(`Cannot connect to MySQL: ${err}`);
            return false;
        }
    }

    /**
     * Run the SQL in a transaction. MySQL commits DDL (CREATE, ALTER, DROP...) implicitly,
     * so only DML (seeds) can be rolled back.
     */
    async runSQL(sql: string, values?: Array<number | string>): Promise<unknown> {
        const pool = await this.getPool();
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const result = await connection.query(sql, values ?? undefined);
            await connection.commit();
            return result;
        } catch (err) {
            this.logger.error(`MySQL error doing migration:\n${err}`);
            await connection.rollback();
            throw err
        } finally {
            connection.release();
        }
    }
    
    async close() {
        await this.pool?.end()
        this.pool = null;
    }
}
