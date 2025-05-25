import { Client, ClientConfig, Connection, QueryResult } from "pg"
import { consoleLogger } from "./Logger.js";

import { Persistency, TRACKER_SCHEMA, Commit, Rollback, TABLE_NAME, EXPECTED_SCHEMA } from "./Repository.js";
import Migration, { MigrationData } from "./Migration.js";

type DBMigrationData =
    Pick<MigrationData, "path" | "up" | "down">
    &
    { batch_id: MigrationData["batchId"], migrated_at: MigrationData["migratedAt"] };
    
type PGInformationSchemaResult = {
    table_catalog: string,
    table_schema: string,  
    table_name: string,  
    column_name: string,
    ordinal_position: string,
    column_default: string,
    is_nullable: string,
    data_type: string,
    character_maximum_lengt: string,
    character_octet_length: string,
    numeric_precision: string,
    numeric_precision_radix: string,
    numeric_scale: string,
    datetime_precision: string,
    interval_type: string,
    interval_precision: string,
    character_set_catalog: string,
    character_set_schema: string,
    character_set_name: string,
    collation_catalog: string,
    collation_schema: string,
    collation_name: string,
    domain_catalog: string,
    domain_schema: string,
    domain_name: string,
    udt_catalog: string,
    udt_schema: string,  
    udt_name: string,
    scope_catalog: string,
    scope_schema: string,
    scope_name: string,
    maximum_cardinality: string,
    dtd_identifier: string,
    is_self_referencing: string,
    is_identity: string,
    identity_generation: string,
    identity_start: string,
    identity_increment: string,
    identity_maximum: string,
    identity_minimum: string,
    identity_cycle: string,
    is_generated: string,
    generation_expression: string,
    is_updatable: string,
}
    
export default class PGTracker implements Persistency{
    private readonly MIGRATION_TABLE = TABLE_NAME;
    // TODO:
    private readonly COMPARE_SQL = `
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = ${this.MIGRATION_TABLE};
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
    readonly password: string | (() => string | Promise<string>);
    readonly database: string | undefined;
    readonly port: number;
    private db: Client;
    constructor({ user, password, port, host }: ClientConfig) {
        this.host = host ?? "localhost";
        this.user = user ?? "root";
        this.password = password ?? "";
        this.port = port ?? 3306;
        this.database = this.MIGRATION_DATABASE;
            
        this.db = new Client({
            host: this.host,
            user: this.user,
            password: this.password,
            port: this.port,
            // need to use default database postgress at the begining of the connection
            // to check if the tracker database exists and is valid before use it
            database: "postgres"
        });
        this.db.connect().then()
        this.ensureUseTrackerDatabase().then()
        this.checkSchema().then()
        
    }
    private async ensureUseTrackerDatabase() {
        const { rowCount } = await this.db.query(`
            SELECT 1 FROM pg_database WHERE datname = $1
            `, [this.MIGRATION_DATABASE])
        if (rowCount != null && rowCount > 0) {
            this.db.end();
            this.db = new Client({
                host: this.host,
                user: this.user,
                password: this.password,
                port: this.port,
                database: this.MIGRATION_DATABASE
            });
            await this.db.connect();
            return;
        }
        await this.db.query(`
            CREATE DATABASE ${this.MIGRATION_DATABASE}
            `)
        this.db.end();
        this.db = new Client({
            host: this.host,
            user: this.user,
            password: this.password,
            port: this.port,
            database: this.MIGRATION_DATABASE
        });
        await this.db.connect();
    }
    
    private async checkSchema() {
        // TODO:
    }
    async save(migrations: Array<MigrationData>): Promise<{ commit: Commit; rollback: Rollback; }> {
        await this.db.query("BEGIN;");
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
            await this.db.query("COMMIT;")
            await this.db.end()
        };
        const rollback: Rollback = async () => {
            await this.db.query("ROLLBACK;")
            await this.db.end()
            console.warn("Rollback successfuly")
        }
        try {
            await this.db.query(sql, values);
        } catch (err) {
            console.error(err)
            throw new Error("Error tracking migration");
        } finally {
            return { commit, rollback }
        }
    };
    
    async removeMigrations(migrations: Array<MigrationData>): Promise<{ commit: Commit; rollback: Rollback; }> { 
        await this.db.query("BEGIN;");
        
        const placeholders = new Array(migrations.length).fill("?").join(",")
        const values = migrations.map(m => m.migratedAt);
        const sql = `
                DELETE FROM ${TABLE_NAME} WHERE
                ${this.MIGRATION_COLUMNS.MIGRATED_AT} IN (${placeholders})
        `
        try {
            await this.db.query(sql, values);
        } catch (err) {
            consoleLogger.error("Error tracking migration")
            throw new Error("Error tracking migration");
        } finally {
            return { commit, rollback }
        }
        
    };
    
    async removeMigration(migration: MigrationData): Promise<{ commit: Commit; rollback: Rollback; }> { 
        this.db.query("BEGIN;");
        const sql = `
                DELETE FROM ${TABLE_NAME} WHERE
                ${this.MIGRATION_COLUMNS.MIGRATED_AT} = ?
        `
        // Returns commit or rollback function that will be used
        // when the migration is done successfuly (commit) or not (rollback)
        const commit: Commit = async () => {
            await this.db.query("COMMIT;")
            this.db.end()
        };
        const rollback: Rollback = async () => {
            await this.db.query("ROLLBACK;")
            this.db.end()
            consoleLogger.warn("Tracker rollback successfuly")
        }
        
        try {
            await this.db.query(sql, [migration.migratedAt]);
        } catch (err) {
            if (err instanceof Error) consoleLogger.error(err.message);
            else consoleLogger.error("Error tracking the migration")
            throw err
        } finally {
            return { commit, rollback };
        }
    };
    
    async list(): Promise<Array<Migration>> { 
        await this.db.query("BEGIN;")
        const sql = `SELECT * FROM ${this.MIGRATION_TABLE};`
        const { rows: migrations } = await this.db.query(sql) as QueryResult<DBMigrationData>;
        return migrations.map(m => new Migration({
            ...m,
            batchId: m.batch_id,
            migratedAt: m.migrated_at,
        }));
    };
    
    async getLastMigrationDone(): Promise<Migration | null> { 
        const sql = ` 
            SELECT * FROM ${TABLE_NAME} 
            ORDER BY ${this.MIGRATION_COLUMNS.MIGRATED_AT} DESC LIMIT 1
        `
        const { rows } = await this.db.query(sql, []) as QueryResult<DBMigrationData>;
        const migrationData = rows[0];
        const {
            migrated_at: migratedAt,
            batch_id: batchId,
            ...rest 
        } = migrationData;
        
        return migrationData != null ? new Migration({
            ...rest,
            migratedAt,
            batchId
        }) : null;
    };
    
    async getLastBatchMigrationDone(): Promise<Array<Migration> | null> {
        const sql = `
            SELECT * FROM ${TABLE_NAME}
            WHERE ${this.MIGRATION_COLUMNS.BATCH_ID} = (
                SELECT ${this.MIGRATION_COLUMNS.BATCH_ID} FROM ${TABLE_NAME} 
                ORDER BY ${this.MIGRATION_COLUMNS.MIGRATED_AT} DESC LIMIT 1
            )
            ORDER BY ${this.MIGRATION_COLUMNS.MIGRATED_AT} DESC
        `
        const { rows: migrationsData } = await this.db.query(sql, []) as QueryResult<DBMigrationData>
        if (migrationsData.length === 0) return null;
        
        return migrationsData.map(m => new Migration({
            ...m,
            migratedAt: m.migrated_at,
            batchId: m.batch_id
        }))
    };
    
    async close(): Promise<void> { 
        await this.db.end()
    };
}