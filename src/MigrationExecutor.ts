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
    
    async executeSingleMigrationUp(migration: Migration) {
        await this.dbconnector.testConnection();
        await this.dbconnector.initConnection(migration.getDetails().path, "UP");
        const migrationData = migration.getDetails()
        const { commit, rollback } = await this.tracker.save([migrationData]);
        try {
            await this.dbconnector.runSQL(migrationData.up);
            await commit()
        } catch (err) {
            await rollback()
            throw err;
        }
    }
    async executeSingleMigrationDown(migration: Migration) {
        await this.dbconnector.testConnection();
        await this.dbconnector.initConnection(migration.getDetails().path, "DOWN");
        const migrationData = migration.getDetails();
        const { commit, rollback } = await this.tracker.removeMigration(migrationData);
        try {
            await this.dbconnector.runSQL(migrationData.down);
            await commit();
        } catch (err) {
            await rollback();
        }
    };
    async executeMigrationsUp(migrations: Array<Migration>) {
        await this.dbconnector.testConnection();
        // DDL is not transactional and autocommit after each statement, so we need to track every migration separately
        for (const m of migrations) {
            const migrationData = m.getDetails();
            await this.dbconnector.initConnection(migrationData.path, "UP");
            const { commit, rollback } = await this.tracker.save([migrationData]);
            try {
                await this.dbconnector.runSQL(migrationData.up);
                await commit()
            } catch (err) {
                await rollback()
                throw err
            }
        }
    }
    async executeMigrationsDown(migrations: Array<Migration>) {
        await this.dbconnector.testConnection();
        await this.dbconnector.initConnection("", "DOWN");
        const migrationsData = migrations.map(m => m.getDetails());
        const { commit, rollback } = await this.tracker.removeMigrations(migrationsData);
        try {
            await this.dbconnector.runSQL(migrationsData.map(m => m.down).join(""));
            await commit()
        } catch (err) {
            await rollback()
        }
    }
    async executeBatchDown(migrations: Array<Migration>) {
        if (migrations.length === 0) throw new Error("No migration for execute down");
        await this.dbconnector.testConnection();
        await this.dbconnector.initConnection();
        const migrationsData = migrations.map(m => m.getDetails());
        const { batchId } = migrationsData[0];
        if (!batchId) throw new Error("Invalid batch id");
        if (!migrationsData.every(m => m.batchId === batchId)) throw new Error("All migrations doesn't have the same batch id")
        const { commit, rollback } = await this.tracker.removeMigrations(migrationsData);
        try {
            await this.dbconnector.runSQL(migrationsData.map(m => m.down).join(""));
            await commit()
        } catch (err) {
            await rollback()
        }
    }
    
    /**
     * Close the tracker and connection
    */
    async close() {
        await this.dbconnector.close()
        await this.tracker.close()
    }
}

export default MigrationExecutor;
