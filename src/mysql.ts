import { createPool } from "mysql2/promise";
import type { PoolOptions, Pool } from "mysql2/promise";
import { Connection } from "./DatabaseConnector.js";

export default class MysqlConnection implements Connection {
    private readonly pool: Pool;
    constructor({ user, password, port, database }: PoolOptions) {
        this.pool = createPool({
            user: user ?? "root",
            password: password ?? "",
            port: port ?? 3306,
            database,
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
            connection.beginTransaction();
            const result = connection.execute(sql, values ?? undefined);
            connection.commit();
            return result;
        } catch (err) {
            console.error("MySQL error doing migration:\n", err);
            await connection?.rollback();
        } finally {
            connection?.release();
        }
    }
}
