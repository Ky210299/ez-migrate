import type DatabaseConnector from "./DatabaseConnector";
import Migration from "./Migration";
import Repository from "./Repository";
import { basename } from "node:path";
import { tracer } from "./Tracer";

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
        path: string,
        direction: "up" | "down",
        sql: string,
        track: () => Promise<{ commit: () => Promise<void>, rollback: () => Promise<void> }>,
    ) {
        const file = basename(path);
        await tracer.span(`migration.${direction}`, { file }, async () => {
            const { commit, rollback } = await track();
            try {
                await this.dbconnector.runSQL(sql);
            } catch (err) {
                await rollback();
                // Say which file failed: the database error alone doesn't
                const message = err instanceof Error ? err.message : String(err);
                throw new Error(`Migration ${file} (${direction}) failed: ${message}`, { cause: err });
            }
            await commit();
        });
    }

    async executeSingleMigrationUp(migration: Migration) {
        await this.executeMigrationsUp([migration]);
    }

    async executeSingleMigrationDown(migration: Migration) {
        const migrationData = migration.getDetails();
        await this.dbconnector.testConnection();
        await this.dbconnector.initConnection(migrationData.path, "DOWN");
        await this.tracker.init()
        await this.runTracked(migrationData.path, "down", migrationData.down, () => this.tracker.removeMigration(migrationData));
    };

    async executeMigrationsUp(migrations: Array<Migration>) {
        await this.dbconnector.testConnection();
        await this.tracker.init()
        // Some DBMS (MySQL) autocommit DDL, so every migration is run and tracked separately
        for (const m of migrations) {
            const migrationData = m.getDetails();
            await this.dbconnector.initConnection(migrationData.path, "UP");
            await this.runTracked(migrationData.path, "up", migrationData.up, () => this.tracker.save([migrationData]));
        }
    }

    /** Revert the migrations one by one, in the given order */
    async executeMigrationsDown(migrations: Array<Migration>) {
        await this.dbconnector.testConnection();
        await this.tracker.init()
        for (const m of migrations) {
            const migrationData = m.getDetails();
            await this.dbconnector.initConnection(migrationData.path, "DOWN");
            await this.runTracked(migrationData.path, "down", migrationData.down, () => this.tracker.removeMigration(migrationData));
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
    
    /** Close the database connection. The tracker is closed by whoever created it */
    async close() {
        await this.dbconnector.close();
    }
}

export default MigrationExecutor;
