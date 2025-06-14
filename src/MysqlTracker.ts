import { Pool, createPool, PoolOptions } from "mysql2/promise";

import { Persistency, TRACKER_SCHEMA, Commit, Rollback, TABLE_NAME, EXPECTED_SCHEMA } from "./Repository.js";
import Migration, { MigrationData } from "./Migration.js";
import { consoleLogger } from "./Logger.js";

type DBMigrationData =
    Pick<MigrationData, "path" | "up" | "down">
    &
    { batch_id: MigrationData["batchId"], migrated_at: MigrationData["migratedAt"] };

export default class MysqlTracker implements Persistency{
    private readonly MIGRATION_TABLE = TABLE_NAME;
    private readonly COMPARE_SQL = `
        SHOW COLUMNS FROM ${this.MIGRATION_TABLE}
      `;
    private readonly MIGRATION_DATABASE = "ez_migration";
    private readonly MIGRATION_COLUMNS = {
        BATCH_ID: "batch_id",
        MIGRATED_AT: "migrated_at",
        UP: "up",
        DOWN: "down",
        PATH: "path",
    };
    
    readonly DBMSName: string = "mysql";
    readonly host: string;
    readonly user: string;
    readonly password: string | undefined;
    readonly database: string | undefined;
    readonly port: string | number;
    private readonly db: Pool;

    constructor({ user, password, port, host, database }: PoolOptions) {
        this.host = host ?? "localhost";
        this.user = user ?? "root";
        this.password = password ?? "";
        this.port = port ?? 3306;
        this.database = database ?? this.MIGRATION_DATABASE;
        
        this.db = createPool({
            host: this.host,
            user: this.user,
            password: this.password,
            port: this.port,
            multipleStatements: true,
            connectionLimit: 1,
        });
        this.checkSchema().then().catch((err)=> consoleLogger.error(err))
    }

    private async checkSchema() {
        const connection = await this.db.getConnection()
            await connection?.query(`
                CREATE DATABASE IF NOT EXISTS ${this.database};
                USE ${this.database};
                ${TRACKER_SCHEMA}`)
            const [result] = await connection?.query(this.COMPARE_SQL) as unknown as [{
                Field: string
                Type: string
                Null: string
                Key: string
                Default: string | null
                Extra: string
            }[]];
            for (const column of EXPECTED_SCHEMA) {
                const checkedColum = result.find(col => col.Field === column.name)
                if (checkedColum == null) throw new Error("Wrong tracker schema")
                if (
                    column.name !== checkedColum.Field ||
                        column.type.toUpperCase().startsWith(checkedColum.Type.toUpperCase()) ||
                        column.nullable !== (checkedColum.Null !== "NO") ||
                        column.primary !== (checkedColum.Key === "PRI") ||
                        column.name === "path" ? column.unique === (checkedColum.Key !== "UNI") : false
                ) throw new Error(
                    `Invalid Schema. Needed: ${TRACKER_SCHEMA}`,
                );
            }
            connection.release()
    }
    async init() {
        // TODO: implement
    }
    async save(migrations: Array<MigrationData>) {
        const connection = await this.db.getConnection();
        await connection.beginTransaction();
        const columns = Object.values(this.MIGRATION_COLUMNS);

        const placeholders = new Array(migrations.length)
            .fill("(" + new Array(columns.length).fill("?").join(",") + ")")
            .join(",");

        const sql = `
            INSERT INTO ${this.MIGRATION_TABLE} (${columns.join(",")})
            VALUES ${placeholders}
            `;

        const values = migrations.flatMap((m) => Object.values(m));

        if (values.length !== migrations.length * columns.length) {
            throw new Error("Mismatch in values and placeholders count");
        }

        // Returns commit or rollback function that will be used
        // when the migration is done successfuly (commit) or not (rollback)
        const commit: Commit = async () => {
            await connection.commit()
            connection.release()
        };
        const rollback: Rollback = async () => {
            await connection.rollback()
            connection.release()
            console.warn("MySQL tracker rollback successfuly at save migration")
        }

        try {
            await connection.execute(sql, values);
        } catch (err) {
            console.error(err)
            throw new Error("Error tracking migration");
        } finally {
            return { commit, rollback }
        }
    };

    async removeMigrations(migrations: Array<MigrationData>) {
        const connection = await this.db.getConnection();
        await connection.beginTransaction();
        const placeholders = new Array(migrations.length).fill("?").join(",")
        const values = migrations.map(m => m.migratedAt);
        const sql = `
                DELETE FROM ${TABLE_NAME} WHERE
                ${this.MIGRATION_COLUMNS.MIGRATED_AT} IN (${placeholders})
        `
        const commit: Commit = async () => {
            await connection.commit()
        };
        const rollback: Rollback = async () => {
            await connection.rollback();
            console.warn("MySQL tracker rollback successfuly at remove migrations")
            connection.release()
        }

        try {
            await connection.execute(sql, values);
        } catch (err) {
            console.error(err);
            throw new Error("Error tracking the migration")
        } finally {
            return { commit, rollback };
        }
    };
    async removeMigration(migration: MigrationData) {
        const connection = await this.db.getConnection()
        await connection.beginTransaction();
        const sql = `
                DELETE FROM ${TABLE_NAME} WHERE
                ${this.MIGRATION_COLUMNS.MIGRATED_AT} = ?
        `
        // Returns commit or rollback function that will be used
        // when the migration is done successfuly (commit) or not (rollback)
        const commit: Commit = async () => {
            await connection.commit()
            connection.release()
        };
        const rollback: Rollback = async () => {
            await connection.rollback()
            connection.release()
            console.warn("MySQL tracker rollback successfuly at remove migration")
        }
        try {
            await connection.execute(sql, [migration.migratedAt]);
        } catch (err) {
            console.error(err);
            throw new Error("Error tracking the migration")
        } finally {
            return { commit, rollback };
        }
    };
    async list(): Promise<Array<Migration>> {
        const connection = await this.db.getConnection()
        const sql = `SELECT * FROM ${this.MIGRATION_TABLE};`
        const [migrations] = await connection.execute(sql, []) as [Array<DBMigrationData>, any];
        connection.release()
        return migrations.map(m => new Migration({
            ...m,
            batchId: m.batch_id,
            migratedAt: m.migrated_at,
        }));
    };

    async getLastMigrationDone() {
        const connection = await this.db.getConnection()
        const sql = ` 
            SELECT * FROM ${TABLE_NAME} 
            ORDER BY ${this.MIGRATION_COLUMNS.MIGRATED_AT} DESC LIMIT 1
        `
        const [rows] = await connection.execute(sql, []) as [Array<DBMigrationData>, any];
        connection.release();
        if (rows.length === 0) return null
        const migrationData = rows[0];
        return migrationData != null ? new Migration({
            ...migrationData,
            migratedAt: migrationData.migrated_at,
            batchId: migrationData.batch_id
        }) : null;
    };
    async getLastBatchMigrationDone(): Promise<Array<Migration> | null>{
        const connection = await this.db.getConnection();
        const sql = `
            SELECT * FROM ${TABLE_NAME}
            WHERE ${this.MIGRATION_COLUMNS.BATCH_ID} = (
                SELECT ${this.MIGRATION_COLUMNS.BATCH_ID} FROM ${TABLE_NAME} 
                ORDER BY ${this.MIGRATION_COLUMNS.MIGRATED_AT} DESC LIMIT 1
            )
            ORDER BY ${this.MIGRATION_COLUMNS.MIGRATED_AT} DESC
        `
        const [migrationsData] = await connection.execute(sql, []) as [Array<DBMigrationData>, unknown]
        connection.release()
        if (migrationsData.length === 0) return null;
        
        return migrationsData.map(m => new Migration({
            ...m,
            migratedAt: m.migrated_at,
            batchId: m.batch_id
        }))
    };
    async close(): Promise<void>{
        await this.db.end();
    };
}