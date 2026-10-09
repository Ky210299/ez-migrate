import { TranslatableKeyword } from "./DialectTraductor";
import Migration, { MigrationData } from "./Migration";
export const TABLE_NAME = "ez_migration";
/**
 *  Don't put semicolon at the end of the schema query to
 *  allow comparing with the one that returns the databases
 */
export const TRACKER_SCHEMA = `
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        batch_id CHAR(36),
        migrated_at CHAR(32) UNIQUE NOT NULL,
        up TEXT NOT NULL,
        down TEXT NOT NULL,
        path VARCHAR(255) NOT NULL UNIQUE,
        PRIMARY KEY (batch_id, migrated_at)
    )
    `.trim();
/** Table with the seed files already run */
export const SEED_TABLE_NAME = "ez_seed";
export const SEED_TRACKER_SCHEMA = `
    CREATE TABLE IF NOT EXISTS ${SEED_TABLE_NAME} (
        name VARCHAR(255) NOT NULL PRIMARY KEY,
        seeded_at CHAR(32) NOT NULL
    )
    `.trim();

/** SQL statements to record seeds as run. Replaces the rows of seeds that were run before */
export function saveSeedsStatements(names: Array<string>, seededAt: string, placeholder: (i: number) => string) {
    const deleteSQL = `DELETE FROM ${SEED_TABLE_NAME} WHERE name IN (${names.map((_, i) => placeholder(i + 1)).join(",")})`;
    let idx = 1;
    const insertSQL = `INSERT INTO ${SEED_TABLE_NAME} (name, seeded_at) VALUES ${names.map(() => `(${placeholder(idx++)},${placeholder(idx++)})`).join(",")}`;
    return [
        { sql: deleteSQL, values: names },
        { sql: insertSQL, values: names.flatMap(name => [name, seededAt]) },
    ];
}

type ColumnProperty = {
    name: string,
    type: TranslatableKeyword,
    maxChar?: number,
    nullable: boolean,
    primary: boolean,
    unique: boolean,
    
}
export const EXPECTED_SCHEMA: Array<ColumnProperty> = [
    { 
        name: 'batch_id',
        type: 'CHAR',
        maxChar: 36,
        nullable: false,
        primary: true,
        unique: false
    },
    { 
        name: 'migrated_at',
        type: 'CHAR',
        maxChar: 32,
        nullable: false,
        primary: true,
        unique: true
    },
    { 
        name: 'up',
        type: 'TEXT',
        nullable: false,
        primary: false,
        unique: false
    },
    { 
        name: 'down',
        type: 'TEXT',
        nullable: false,
        primary: false,
        unique: false
    },
    { 
        name: 'path',
        type: 'VARCHAR',
        maxChar: 255,
        nullable: false,
        primary: false,
        unique: true
    },
];

/** Tracker table columns, in the order used to insert */
export const MIGRATION_COLUMNS = ["batch_id", "migrated_at", "up", "down", "path"] as const;

/** Values of a migration in the same order as MIGRATION_COLUMNS */
export function migrationValues(m: MigrationData): Array<string | null> {
    return [m.batchId, m.migratedAt, m.up, m.down, m.path];
}

/** Commit is a async function that does a commit to a started transaction */
export type Commit = () => Promise<void>;
/** Rollback is a async function that does a rollback to a started transaction */
export type Rollback = () => Promise<void>;

export interface Persistency {
    /** 
     *  Save begins a transaction and returns the commit and rollback functions that
     *  are called if the migrations is done successfuly (commit) or fails (rollback)
     */
    save: (migrations: Array<MigrationData>) => Promise<{ commit: Commit; rollback: Rollback }>;
    
    /** 
     *  Begins a transaction and returns the commit and rollback functions that
     *  are called if the migrations is removed successfuly (commit) or fails (rollback)
     */
    removeMigrations: (migrations: Array<MigrationData>) => Promise<{ commit: Commit; rollback: Rollback }>;
    
    removeMigration: (migration: MigrationData) => Promise<{ commit: Commit; rollback: Rollback }>;
    /** List all migrations successfuly done */
    list: () => Promise<Array<Migration>>;
    /** Return the last migration done if exists, null otherwise */
    getLastMigrationDone: () => Promise<Migration | null>;
    getLastBatchMigrationDone: () => Promise<Array<Migration> | null>

    /** Names of the seed files already run */
    listSeeds: () => Promise<Array<string>>
    /** Begins a transaction that records the seeds as run and returns the commit and rollback functions */
    saveSeeds: (names: Array<string>, seededAt: string) => Promise<{ commit: Commit; rollback: Rollback }>
    
    init: () => Promise<void>
    close: () => Promise<void>
}

/** Repository for the migration tracker persistency */
export default class Repository {
    private readonly persistency: Persistency;
    constructor(persistency: Persistency) {
        this.persistency = persistency;
    }
    async save(migrations: Array<MigrationData>) {
        return await this.persistency.save(migrations);
    }
    async removeMigrations(migrations: Array<MigrationData>) {
        return await this.persistency.removeMigrations(migrations);
    }
    async removeMigration(migration: MigrationData) {
        return await this.persistency.removeMigration(migration);
    }
    async listMigrations() {
        await this.persistency.init();
        return await this.persistency.list();
    }
    async getLastMigrationDone() {
        return await this.persistency.getLastMigrationDone()
    }
    async getLastBatchMigrationDone(){
        return await this.persistency.getLastBatchMigrationDone();
    }
    
    async listSeeds() {
        await this.persistency.init();
        return await this.persistency.listSeeds();
    }
    async saveSeeds(names: Array<string>, seededAt: string) {
        return await this.persistency.saveSeeds(names, seededAt);
    }

    async init() {
        await this.persistency.init()
    }
    
    async close() {
        await this.persistency.close() 
    }
    
}
