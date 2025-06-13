import { createPool } from "mysql2/promise";
import type { PoolOptions, Pool } from "mysql2/promise";
import { MySQLConnection } from "./DatabaseConnector.js";
import { ConsoleLoggerImpl } from "./Logger.js";

export default class MysqlConnection implements MySQLConnection {
    private readonly pool: Pool;
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
        
        this.pool = createPool({
            host: this.host,
            user: this.user,
            password: this.password,
            port: this.port,
            multipleStatements: true,
            connectionLimit: 1,
        });
    }
    async init(migrationPath?: string, migrationDirection?: string) {
        try {
            await this.existsDatabase(this.pool, this.database ?? null)
            this.logger.info(`Using ${this.database} as database target${`${migrationDirection ? " for direction " : ""}`.concat(migrationDirection?.concat(`${migrationPath ? " and " : ""}`) ?? "")}${migrationPath ? `migration: ${migrationPath.substring(migrationPath.lastIndexOf("/") + 1)}` : ""}`)
        } catch (err) {
            this.logger.warn(`Non-existing database ${this.database}`);
            this.logger.warn(`Running migration ${migrationPath?.concat(" ") ?? ""}whihout use any database`);
        }
    }
    async existsDatabase(pool: Pool, database: string | null) {
        let connection;
        try {
            connection = await pool.getConnection();
            await connection.query(`USE ${database}`);
            return database
        } catch (err) {
            connection?.release()
            throw err
        } finally {
            connection?.release();
        }
    }
    async isConnected(): Promise<boolean> {
        let connection;
        try {
            connection = await this.pool.getConnection();
            await connection.query("SELECT 'MySQL connected successfuly!'");
            return true;
        } catch (err) {
            console.error("Error connecting with mysql:\n", err);
            return false;
        } finally {
            connection?.release();
        }
    }
    async runSQL(sql: string, values?: Array<number | string>): Promise<any> {
        let connection;
        try {
            connection = await this.pool.getConnection();
            await connection.beginTransaction();
            const result = await connection.query(sql, values ?? undefined);
            await connection.commit();
            return result;
        } catch (err) {
            this.logger.error(`MySQL error doing migration:\n${err}`);
            await connection?.rollback();
            throw err
        } finally {
            connection?.release();
        }
    }
    
    async close() {
        await this.pool.end()
    }
}
