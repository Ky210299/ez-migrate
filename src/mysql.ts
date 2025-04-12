import { createPool } from "mysql2/promise";
import type { PoolOptions, Pool } from "mysql2/promise";
import { MySQLConnection } from "./DatabaseConnector.js";

export default class MysqlConnection implements MySQLConnection {
    private readonly pool: Pool;
    readonly SGDBName: string = "mysql";
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
        this.database = database ?? "";
        
        this.pool = createPool({
            host: this.host,
            user: this.user,
            password: this.password,
            port: this.port,
            database: this.database,
            multipleStatements: true,
            connectionLimit: 1,
        });
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
