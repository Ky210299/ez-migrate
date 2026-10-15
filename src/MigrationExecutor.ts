import type DatabaseConnector from "./DatabaseConnector";
import Migration from "./Migration";
import Repository from "./Repository";
import { basename } from "node:path";
import { tracer } from "./Tracer";
import { consoleLogger } from "./Logger";
import { splitStatements } from "./sql";

/**
 * MySQL commits every DDL statement (CREATE, ALTER, DROP...) on its own, so a
 * migration with several statements can't be rolled back as a whole.
 * Returns the warning for that SQL, or null if it is atomic.
 */
export function nonAtomicWarning(dialect: string, sql: string): string | null {
    if (dialect !== "mysql") return null;
    // SET, SELECT and temporary tables don't commit: only DDL on real tables does
    const statements = splitStatements(sql).filter(s => IMPLICIT_COMMIT.test(s) && !TEMPORARY_TABLE.test(s)).length;
    if (statements < 2) return null;
    return `It has ${statements} statements and MySQL commits each one on its own: if one fails, the ones before it stay applied`;
}

/** Statements that MySQL commits on their own */
const IMPLICIT_COMMIT = /^(?:CREATE|ALTER|DROP|RENAME|TRUNCATE)\b/i;
const TEMPORARY_TABLE = /^(?:CREATE|DROP)\s+TEMPORARY\s+TABLE\b/i;

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
        const notAtomic = nonAtomicWarning(this.dbconnector.connection.DBMSName, sql);
        if (notAtomic) consoleLogger.warn(`Migration ${file} (${direction}) is not atomic. ${notAtomic}`);
        await tracer.span(`migration.${direction}`, { file }, async () => {
            const { commit, rollback } = await track();
            try {
                await this.dbconnector.runSQL(sql);
            } catch (err) {
                await rollback();
                // Say which file failed: the database error alone doesn't
                const message = err instanceof Error ? err.message : String(err);
                const fixByHand = notAtomic
                    ? ". MySQL kept the statements that ran before the error: undo them by hand before running it again"
                    : "";
                throw new Error(`Migration ${file} (${direction}) failed: ${message}${fixByHand}`, { cause: err });
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
