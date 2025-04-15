import { createPool } from "mysql2/promise";
import type { PoolOptions, Pool } from "mysql2/promise";
import { MySQLConnection } from "./DatabaseConnector.js";

export default class MysqlConnection implements MySQLConnection {
    private readonly pool: Pool;
    readonly DBMSName: string = "mysql";
    readonly host: string;
    readonly user: string;
    readonly password: string | undefined;
    readonly database: string | undefined;
    readonly port: string | number;
    constructor({ user, password, port, database, host }: PoolOptions) {
        this.host = host ?? "localhost";
        this.user = user ?? "root";
        this.password = password ?? "";
        this.port = port ?? 3306;
        this.database = database;
        
        this.pool = createPool({
            host: this.host,
            user: this.user,
            password: this.password,
            port: this.port,
            multipleStatements: true,
            connectionLimit: 1,
        });
    }
    async init() {
        try {
            await this.existsDatabase(this.pool, this.database ?? null)
            console.log(`Using ${this.database} as database target for migration`)
        } catch (err) {
            console.warn("Not existing database.\nRunning migration whihout use any dabase")
        }
    }
    async existsDatabase(pool: Pool, database: string | null) {
        const connection = await pool.getConnection();
        console.log("Trying to use ", database);
        try {
            await connection.query(`USE ${database}`);
            return database
        } catch (err) {
            throw err
        } finally {
            connection.release();
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
            console.error("MySQL error doing migration:\n", err);
            await connection?.rollback();
            throw err
        } finally {
            connection?.release();
        }
    }
}
