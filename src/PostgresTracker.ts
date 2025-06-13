import { Client, ClientConfig, QueryResult } from "pg"
import { consoleLogger } from "./Logger.js";

import { Persistency, TRACKER_SCHEMA, Commit, Rollback, TABLE_NAME, EXPECTED_SCHEMA } from "./Repository.js";
import Migration, { MigrationData } from "./Migration.js";
import { MigrateError } from "./Errors.js";
import DialectTranslator from "./DialectTraductor.js";

type DBMigrationData =
    Pick<MigrationData, "path" | "up" | "down">
    &
    { batch_id: MigrationData["batchId"], migrated_at: MigrationData["migratedAt"] };
    
export default class PGTracker implements Persistency {
    private readonly MIGRATION_TABLE = TABLE_NAME;
    private readonly MIGRATION_COLUMNS = {
        BATCH_ID: "batch_id",
        MIGRATED_AT: "migrated_at",
        UP: "up",
        DOWN: "down",
        PATH: "path",
    };
    initialized: boolean = false;
    
    readonly DBMSName: string = "mysql";
    readonly host: string;
    readonly user: string;
    readonly password: string | (() => string | Promise<string>);
    readonly database: string | undefined;
    readonly port: number;
    private db: Client;
    constructor({ user, password, port, host, database }: ClientConfig) {
        this.host = host ?? "localhost";
        this.user = user ?? "postgres";
        this.password = password ?? "";
        this.port = port ?? 5432;
        this.database = database ?? "postgres";
            
        this.db = new Client({
            host: this.host,
            user: this.user,
            password: this.password,
            port: this.port,
            // need to use default database postgress at the begining of the connection
            // to check if the tracker database exists and is valid before use it
            database: "postgres"
        });
        
    }
    private async ensureUseTrackerDatabase() {
        const { rowCount } = await this.db.query(`
            SELECT * FROM pg_database WHERE datname = $1
            `, [this.database])
        
        if (rowCount != null && rowCount > 0) {
            this.db.end();
            this.db = new Client({
                host: this.host,
                user: this.user,
                password: this.password,
                port: this.port,
                database: this.database
            });
            await this.db.connect();
            consoleLogger.info(`Using existing ${this.database} database for tracking`)
            return;
        }
        consoleLogger.info(`"${this.database}" doest'n exists.`)
        await this.db.query(`
            CREATE DATABASE ${this.database}
            `);
        consoleLogger.info(`"${this.database}" database created`)
        this.db.end();
        this.db = new Client({
            host: this.host,
            user: this.user,
            password: this.password,
            port: this.port,
            database: this.database
        });
        await this.db.connect();
        consoleLogger.info(`Using new "${this.database}" database`)
    }
    
    private async checkSchema() {
        const { rows: tablas } = await this.db.query(`
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_type = 'BASE TABLE'
              AND table_schema NOT IN ('pg_catalog','information_schema');
          `);
        if (!tablas.some(t => t.table_name === this.MIGRATION_TABLE)) {
            await this.db.query(TRACKER_SCHEMA);
            consoleLogger.info(`Created unnexisting table ${this.MIGRATION_TABLE} for migration tracking`);
            return
        }
        // 2) Traer columnas y propiedades de cada tabla pública
        const { rows: cols } = await this.db.query(`
            SELECT
                c.ordinal_position,
                c.is_nullable, 
                c.data_type,
                c.table_schema,
                c.table_name,
                c.column_name,
                c.character_maximum_length,
                array_agg(tc.constraint_type ORDER BY tc.constraint_type) AS constraints
            FROM information_schema.columns c
            LEFT JOIN information_schema.key_column_usage kcu
                ON c.table_schema = kcu.table_schema
                AND c.table_name   = kcu.table_name
                AND c.column_name  = kcu.column_name
            LEFT JOIN information_schema.table_constraints tc
                ON kcu.constraint_schema = tc.constraint_schema
                AND kcu.constraint_name   = tc.constraint_name
                AND tc.constraint_type IN ('PRIMARY KEY','UNIQUE','FOREIGN KEY')
            WHERE c.table_schema = 'public'
            GROUP BY
                c.ordinal_position,
                c.is_nullable,
                c.data_type,
                c.table_schema,
                c.table_name,
                c.column_name,
                c.character_maximum_length
            ORDER BY
                c.table_name,
                c.ordinal_position;
            `
        );
        EXPECTED_SCHEMA.forEach(expectedField => {
            const currentField = cols.find(c => c.column_name === expectedField.name)
            if (!currentField) throw new MigrateError("Missing column in tracker table");
            if (
                expectedField.nullable !== (currentField.is_nullable === "YES") ||
                expectedField.primary !== (currentField.constraints.includes("PRIMARY KEY")) ||
                expectedField.type !== (DialectTranslator.translate("postgres", "mysql", currentField.data_type.toUpperCase())) || 
                expectedField.unique !== (currentField.constraints.includes("UNIQUE"))
            ) { 
                throw new MigrateError("Invalid tracker table properties");
            }
        })
    }
    
    async init() {
        if (this.initialized) return
        await this.db.connect();
        await this.ensureUseTrackerDatabase();
        await this.checkSchema();
        this.initialized = true;
    }
    async save(migrations: Array<MigrationData>): Promise<{ commit: Commit; rollback: Rollback; }> {
        await this.db.query("BEGIN;");
        const columns = Object.values(this.MIGRATION_COLUMNS);
        
        let idx = 1;
        const placeholders = migrations.map(() =>
            "(" +
            columns
                .map(() => `$${idx++}`)
                .join(",") +
            ")"
        ).join(",");

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
        };
        const rollback: Rollback = async () => {
            await this.db.query("ROLLBACK;")
            consoleLogger.warn("Postgrest rollback successfuly at save migration")
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
        
        let idx = 1;
        const placeholders = migrations.map(() => `$${idx++}`).join(",")
        const values = migrations.map(m => m.migratedAt);
        const sql = `
                DELETE FROM ${TABLE_NAME} WHERE
                ${this.MIGRATION_COLUMNS.MIGRATED_AT} IN (${placeholders})
        `
        // Returns commit or rollback function that will be used
        // when the migration is done successfuly (commit) or not (rollback)
        const commit: Commit = async () => {
            await this.db.query("COMMIT;")
        };
        const rollback: Rollback = async () => {
            await this.db.query("ROLLBACK;")
            consoleLogger.warn("Postgres tracker rollback successfuly at remove migrations")
        }
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
                ${this.MIGRATION_COLUMNS.MIGRATED_AT} = $1
        `
        // Returns commit or rollback function that will be used
        // when the migration is done successfuly (commit) or not (rollback)
        const commit: Commit = async () => {
            await this.db.query("COMMIT;")
        };
        const rollback: Rollback = async () => {
            await this.db.query("ROLLBACK;")
            consoleLogger.warn("Postgres tracker rollback successfuly remove migration ")
        }
        
        try {
            await this.db.query(sql, [migration.migratedAt]);
        } catch (err) {
            if (err instanceof Error) consoleLogger.error(`Error tracking migration: ${err.message}`);
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
        if (rows.length === 0) return null
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
        this.initialized = false;
    };
}