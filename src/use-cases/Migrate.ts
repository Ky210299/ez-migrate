import ConfigReader from "../ConfigReader";
import Migration from "../Migration";
import SchemasHandler from "../SchemasHandler";
import { runPlan, withExecutor, type RunOptions } from "../RunPlan";
import { consoleLogger } from "../Logger";
import type Repository from "../Repository";
import type { Config } from "../types";
import { assertOnlyChangesTenant, isMultiTenantRun } from "../Tenants";
import { runPlanForTenants, type TenantRunOptions } from "../TenantRunner";

export type MigrateOptions = RunOptions & TenantRunOptions & {
    /** Run even if an applied migration file changed */
    allowChanged?: boolean,
}

export default class Migrate {
    static consoleLogger = consoleLogger

    /** Apply all pending migrations in one new batch */
    public static async run(options: MigrateOptions = {}) {
        const config = new ConfigReader().getConfig();
        if (isMultiTenantRun()) {
            await runPlanForTenants(
                config,
                options,
                async (tenantConfig, tracker) => [{ direction: "up", migrations: Migrate.pending(tenantConfig, await tracker.listMigrations(), options) }],
                (tenantConfig, tracker, [up]) => Migrate.apply(tenantConfig, tracker, up.migrations),
            );
            return;
        }
        await runPlan(
            config,
            options,
            async tracker => [{ direction: "up", migrations: Migrate.pending(config, await tracker.listMigrations(), options) }],
            (tracker, [up]) => Migrate.apply(config, tracker, up.migrations),
        );
    }

    /** Apply the migrations in one new batch with a tracker that is already locked */
    static async apply(config: Config, tracker: Repository, migrations: Array<Migration>) {
        if (migrations.length === 0) {
            Migrate.consoleLogger.info("No pending migrations")
            return
        }
        await withExecutor(config, tracker, executor => executor.executeMigrationsUp(migrations));
    }

    /**
     * Pending migrations, in order. Fails if an applied file changed, a pending
     * file has DML or, with a tenant, would change something outside the tenant
     */
    static pending(config: Config, done: Array<Migration>, options: MigrateOptions = {}): Array<Migration> {
        const schemaHandler = SchemasHandler.forConfig(config)
        schemaHandler.checkAppliedUnchanged(done, options.allowChanged);
        const pending = schemaHandler.getPendingMigrations(done);
        const migrationWithDML = pending.find(m => schemaHandler.hasDML(m.getDetails().up));
        if (migrationWithDML != null) {
            throw new Error(`File ${migrationWithDML.getDetails().path} has DML. Migrations files cannot have DML statements. Use Seeds instead`)
        }
        assertOnlyChangesTenant(config, pending.map(m => m.getDetails()));
        return pending;
    }
}
