import Migration, { MigrationData } from "./Migration";
export const TABLE_NAME = "ez_migration";
/**
 *  Don't put semicolon at the end of the schema query to
 *  allow comparing with the one that returns the databases
 */
export const TRACKER_SCHEMA = `
    CREATE TABLE ${TABLE_NAME} (
        migrated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        up TEXT NOT NULL,
        down TEXT NOT NULL,
        path VARCHAR(255) NOT NULL UNIQUE,
        PRIMARY KEY (migrated_at)
    )
    `.trim();
/** Commit is a async function that does a commit to a started transaction */
export type Commit = () => Promise<void>;
/** Rollback is a async function that does a rollback to a started transaction */
export type Rollback = () => Promise<void>;

export interface Persistency {
    /** 
     *  Save begins a transaction and returns the commit and rollback functions that
     *  are called if the migrations is done successfuly (commit) or  fails (rollback)
     */
    save: (migrations: Array<MigrationData>) => Promise<{ commit: Commit; rollback: Rollback }>;
    
    /** 
     *  Begins a transaction and returns the commit and rollback functions that
     *  are called if the migrations is removed successfuly (commit) or  fails (rollback)
     */
    remove: (migrations: Array<MigrationData>) => Promise<{ commit: Commit; rollback: Rollback }>;
    /** List all migrations successfuly done */
    list: () => Promise<Array<Migration>>;
    /** Return the last migration done if exists, null otherwise */
    getLastMigrationDone: () => Promise<Migration | null>;
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
    async remove(migrations: Array<MigrationData>) {
        try {
            return await this.persistency.remove(migrations);
        } catch (err) {
            console.error(err);
            process.exit("\n Error while removing the migrations registry\n");
        }
    }
    async listMigrations() {
        return await this.persistency.list();
    }
    async getLastMigrationDone() {
        return await this.persistency.getLastMigrationDone()
    }
}
