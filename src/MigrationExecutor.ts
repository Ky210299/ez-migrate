import type DatabaseConnector from "./DatabaseConnector";
import Migration from "./Migration";
import Repository from "./Repository";

/** Class that execute and track the migration(s) */
class MigrationExecutor {
    private readonly dbconnector: DatabaseConnector;
    private readonly tracker: Repository
    constructor(dbconnector: DatabaseConnector, tracker: Repository) {
        this.dbconnector = dbconnector;
        this.tracker = tracker;
    }

    /**
     * Track the change and run the SQL. The tracker change is committed only
     * if the SQL succeeds.
     */
    private async runTracked(
        sql: string,
        track: () => Promise<{ commit: () => Promise<void>, rollback: () => Promise<void> }>,
    ) {
        const { commit, rollback } = await track();
        try {
            await this.dbconnector.runSQL(sql);
        } catch (err) {
            await rollback();
            throw err;
        }
        await commit();
    }

    async executeSingleMigrationUp(migration: Migration) {
        await this.executeMigrationsUp([migration]);
    }

    async executeSingleMigrationDown(migration: Migration) {
        const migrationData = migration.getDetails();
        await this.dbconnector.testConnection();
        await this.dbconnector.initConnection(migrationData.path, "DOWN");
        await this.tracker.init()
        await this.runTracked(migrationData.down, () => this.tracker.removeMigration(migrationData));
    };

    async executeMigrationsUp(migrations: Array<Migration>) {
        await this.dbconnector.testConnection();
        await this.tracker.init()
        // Some DBMS (MySQL) autocommit DDL, so every migration is run and tracked separately
        for (const m of migrations) {
            const migrationData = m.getDetails();
            await this.dbconnector.initConnection(migrationData.path, "UP");
            await this.runTracked(migrationData.up, () => this.tracker.save([migrationData]));
        }
    }

    /** Revert the migrations one by one, in the given order */
    async executeMigrationsDown(migrations: Array<Migration>) {
        await this.dbconnector.testConnection();
        await this.tracker.init()
        for (const m of migrations) {
            const migrationData = m.getDetails();
            await this.dbconnector.initConnection(migrationData.path, "DOWN");
            await this.runTracked(migrationData.down, () => this.tracker.removeMigration(migrationData));
        }
    }

    /** Revert a batch of migrations. All must have the same batch id */
    async executeBatchDown(migrations: Array<Migration>) {
        if (migrations.length === 0) throw new Error("No migration for execute down");
        const migrationsData = migrations.map(m => m.getDetails());
        const { batchId } = migrationsData[0];
        if (!batchId) throw new Error("Invalid batch id");
        if (!migrationsData.every(m => m.batchId === batchId)) throw new Error("All migrations doesn't have the same batch id")
        await this.executeMigrationsDown(migrations);
    }
    
    /**
     * Close the tracker and connection
    */
    async close() {
        await Promise.allSettled([this.dbconnector.close(), this.tracker.close()]);
    }
}

export default MigrationExecutor;
