import type DatabaseConnector from "./DatabaseConnector";
import Migration from "./Migration";
import Repository from "./Repository";

class MigrationExecutor {
    private readonly dbconnector: DatabaseConnector;
    private readonly tracker: Repository
    constructor(dbconnector: DatabaseConnector, tracker: Repository) {
        this.dbconnector = dbconnector;
        this.tracker = tracker;
    }
    
    async executeSingleMigrationUp(migration: Migration) {
        await this.dbconnector.testConnection();
        await this.dbconnector.initConnection();
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
        const migrationData = migration.getDetails()
        const { commit, rollback } = await this.tracker.save([migrationData]);
        try {
            await this.dbconnector.runSQL(migrationData.down);
            await commit()
        } catch (err) {
            await rollback()
        }
    };
    async executeMigrationsUp(migrations: Array<Migration>) {
        await this.dbconnector.testConnection();
        const migrationsData = migrations.map(m => m.getDetails());
        const { commit, rollback } = await this.tracker.save(migrationsData);
        try {
            await this.dbconnector.runSQL(migrationsData.map(m => m.up).join(""));
            await commit()
        } catch (err) {
            await rollback()
        }
    }
    async executeMigrationsDown(migrations: Array<Migration>) {
        await this.dbconnector.testConnection();
        const migrationsData = migrations.map(m => m.getDetails());
        const { commit, rollback } = await this.tracker.save(migrationsData);
        try {
            await this.dbconnector.runSQL(migrationsData.map(m => m.down).join(""));
            await commit()
        } catch (err) {
            await rollback()
        }
    }
}

export default MigrationExecutor;
