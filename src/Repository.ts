import Migration from "./Migration";
export const TABLE_NAME = "ez_migration";
/**
 *  Don't put semicolon at the end of the schema query to
 *  allow comparing with the one that returns the databases
 */
export const TRACKER_SCHEMA = `
    CREATE TABLE ${TABLE_NAME} (
        id INT UNSIGNED,
        sql TEXT NOT NULL,
        date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        direction TINYINT NOT NULL,
        order_number INT UNSIGNED NOT NULL UNIQUE,
        PRIMARY KEY (id)
    )
    `.trim();
export type Commit = () => Promise<void>;
export type Rollback = () => Promise<void>;

export interface Persistency {
    /**
     *  Save begins a transaction and returns the commit and rollback functions that
     * are called if the migrations is done successfuly (commit) or  fails (rollback)
     */
    save: (migration: Array<Migration>) => Promise<{ commit: Commit; rollback: Rollback }>;
    list: () => Promise<Array<Migration>>;
}

export default class Repository {
    private readonly persistency: Persistency;
    constructor(persistency: Persistency) {
        this.persistency = persistency;
    }
    async save(migrations: Array<Migration>) {
        try {
            return await this.persistency.save(migrations);
        } catch (err) {
            console.error(err);
            process.exit("\n Error while saving the migrations registry\n");
        }
    }
    async listMigrations() {
        return await this.persistency.list();
    }
}
