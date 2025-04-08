export type Migration = {
    id: string;
    sql: string;
    date: string;
    direction: 1 | 0; // 1 up and 0 down
    orderNumber: number;
};
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
