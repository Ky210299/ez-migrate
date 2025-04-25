import { Pool, createPool, PoolOptions } from "mysql2/promise";

import { Persistency, TRACKER_SCHEMA, Commit, Rollback, TABLE_NAME } from "./Repository.js";
import Migration, { MigrationData } from "./Migration.js";

type DBMigrationData =
    Pick<MigrationData, "path" | "up" | "down">
    &
    { batch_id: MigrationData["batchId"], migrated_at: MigrationData["migratedAt"] };

export default class MysqlTracker implements Persistency{
    private readonly MIGRATION_TABLE = TABLE_NAME;
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

    constructor({ user, password, port, database, host }: PoolOptions) {
        this.host = host ?? "localhost";
        this.user = user ?? "root";
        this.password = password ?? "";
        this.port = port ?? 3306;
        this.database = database;
        
        this.db = createPool({
            host: this.host,
            user: this.user,
            password: this.password,
            port: this.port,
            multipleStatements: true,
            connectionLimit: 1,
        });
        this.checkSchema().then()
    }

    private async checkSchema() {
        try {
            await this.db.query(`USE ${this.database}`)
        } catch (err) {
            await this.db.query(`CREATE DATABASE ${this.database}`)
        }
        const [schema] = await this.db.query(`DESCRIBE ${this.database}.${this.MIGRATION_TABLE}`)
        console.log(schema)
        // if (currentSchema == null) this.db.exec(TRACKER_SCHEMA);
        // else if (currentSchema.sql !== TRACKER_SCHEMA) {
        //     throw new Error(
        //         `Invalid Schema:\ncurrent: ${currentSchema.sql}\nvs\nneeded: ${TRACKER_SCHEMA}`,
        //     );
        // }
    }
    async save(migrations: Array<MigrationData>) {
        await this.db.beginTransaction();
        const columns = Object.values(this.MIGRATION_COLUMNS);

        const placeholders = new Array(migrations.length)
            .fill("(" + new Array(columns.length).fill("?").join(",") + ")")
            .join(",");

        const insert = await this.db.prepare(`
            INSERT INTO ${this.MIGRATION_TABLE} (${columns.join(",")})
            VALUES ${placeholders}
            `);

        const values = migrations.flatMap((m) => Object.values(m));

        if (values.length !== migrations.length * columns.length) {
            throw new Error("Mismatch in values and placeholders count");
        }

        // Returns commit or rollback function that will be used
        // when the migration is done successfuly (commit) or not (rollback)
        const commit: Commit = async () => {
            await this.db.commit()
        };
        const rollback: Rollback = async () => {
            await this.db.rollback()
            console.warn("Rollback successfuly")
        }

        try {
            await insert.execute(values);
        } catch (err) {
            console.error(err)
            throw new Error("Error tracking migration");
        } finally {
            return { commit, rollback }
        }
    };

    async removeMigrations(migrations: Array<MigrationData>) {
        await this.db.beginTransaction();
        const placeholders = new Array(migrations.length).fill("?").join(",")
        const values = migrations.map(m => m.migratedAt);
        const sql = `
                DELETE FROM ${TABLE_NAME} WHERE
                ${this.MIGRATION_COLUMNS.MIGRATED_AT} IN (${placeholders})
        `
        const q = await this.db.prepare(sql)
        
        // Returns commit or rollback function that will be used
        // when the migration is done successfuly (commit) or not (rollback)
        const commit: Commit = async () => {
            await this.db.commit()
        };
        const rollback: Rollback = async () => {
            await this.db.rollback();
            console.warn("Rollback tracker successfuly")
        }

        try {
            await q.execute(values);
        } catch (err) {
            console.error(err);
            throw new Error("Error tracking the migration")
        } finally {
            return { commit, rollback };
        }
    };
    async removeMigration(migration: MigrationData) {
        await this.db.beginTransaction();
        const sql = `
                DELETE FROM ${TABLE_NAME} WHERE
                ${this.MIGRATION_COLUMNS.MIGRATED_AT} = ?
        `
        const q = await this.db.prepare(sql)

        // Returns commit or rollback function that will be used
        // when the migration is done successfuly (commit) or not (rollback)
        const commit: Commit = async () => {
            await this.db.commit()
        };
        const rollback: Rollback = async () => {
            await this.db.rollback()
            console.warn("Rollback tracker successfuly")
        }
        try {
            await q.execute(migration.migratedAt);
        } catch (err) {
            console.error(err);
            throw new Error("Error tracking the migration")
        } finally {
            return { commit, rollback };
        }
    };
    async list(): Promise<Array<Migration>> {
        const query = await this.db.prepare(`
            SELECT * FROM ${this.MIGRATION_TABLE};
            `);
        const [migrations] = await query.execute([]) as unknown as [Array<DBMigrationData>];
        return migrations.map(m => new Migration({
            ...m,
            batchId: m.batch_id,
            migratedAt: m.migrated_at,
        }));
    };

    async getLastMigrationDone() {
        const query = await this.db.prepare(`
                SELECT * FROM ${TABLE_NAME} 
                ORDER BY ${this.MIGRATION_COLUMNS.MIGRATED_AT} DESC LIMIT 1
            `);
        const [migrationData] = await query.execute([]) as unknown as [DBMigrationData]
        return migrationData != null ? new Migration({
            ...migrationData,
            migratedAt: migrationData.migrated_at,
            batchId: migrationData.batch_id
        }) : null;
    };
    async getLastBatchMigrationDone(): Promise<Array<Migration> | null>{
        const query = await this.db.prepare(`
                SELECT * FROM ${TABLE_NAME}
                WHERE ${this.MIGRATION_COLUMNS.BATCH_ID} = (
                    SELECT ${this.MIGRATION_COLUMNS.BATCH_ID} FROM ${TABLE_NAME} 
                    ORDER BY ${this.MIGRATION_COLUMNS.MIGRATED_AT} DESC LIMIT 1
                )
                ORDER BY ${this.MIGRATION_COLUMNS.MIGRATED_AT} DESC
            `);
        const [migrationsData] = await query.execute([]) as unknown as [DBMigrationData[]]
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