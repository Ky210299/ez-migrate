import Migration, { MigrationData } from "./Migration";
export const TABLE_NAME = "ez_migration";
/**
 *  Don't put semicolon at the end of the schema query to
 *  allow comparing with the one that returns the databases
 */
export const TRACKER_SCHEMA = `
    CREATE TABLE ${TABLE_NAME} (
        batch_id CHAR(36),
        migrated_at DATETIME UNIQUE NOT NULL,
        up TEXT NOT NULL,
        down TEXT NOT NULL,
        path VARCHAR(255) NOT NULL UNIQUE,
        PRIMARY KEY (batch_id, migrated_at)
    )
    `.trim();
export const EXPECTED_SCHEMA = [
    { 
        name: 'batch_id',
        type: 'CHAR(36)',
        nullable: false,
        primary: true,
        unique: false
    },
    { 
        name: 'migrated_at',
        type: 'DATETIME',
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
        type: 'VARCHAR(255)',
        nullable: false,
        primary: false,
        unique: true
    },
];

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
    
    close: () => Promise<void>
}

/** Repository for the migration tracker persistency */
export default class Repository {
    private readonly persistency: Persistency;
    constructor(persistency: Persistency) {
        this.persistency = persistency;
    }
    async save(migrations: Array<MigrationData>) {
        try {
            return await this.persistency.save(migrations);
        } catch (err) {
            console.error(err);
            process.exit("\n Error while saving the migrations registry\n");
        }
    }
    async removeMigrations(migrations: Array<MigrationData>) {
        try {
            return await this.persistency.removeMigrations(migrations);
        } catch (err) {
            console.error(err);
            process.exit("\n Error while removing the migrations registry\n");
        }
    }
    async removeMigration(migration: MigrationData) {
        try {
            return await this.persistency.removeMigration(migration);
        } catch (err) {
            console.error(err);
            process.exit("\n Error while removing the migration registry\n");
        }
    }
    async listMigrations() {
        return await this.persistency.list();
    }
    async getLastMigrationDone() {
        return await this.persistency.getLastMigrationDone()
    }
    async getLastBatchMigrationDone(){
        return await this.persistency.getLastBatchMigrationDone();
    }
    
    async close() {
        await this.persistency.close() 
    }
    
}
