import { readFileSync } from "node:fs";
import ConfigReader from "./ConfigReader";
import ConnectionFactory from "./ConnectionFactory";
import { consoleLogger } from "./Logger";
import { ask, mustConfirm, planKey, type RunOptions } from "./RunPlan";
import { dryRunSteps, isEmptyPlan, planSummary, printDryRun, type Plan } from "./DryRun";
import { withLockedTracker, withTracker } from "./TrackerSession";
import { configForTenant, isMultiTenantRun, MULTI_TENANT_COMMANDS, resolveTenant, tenantSettings, tenantTarget } from "./Tenants";
import type Repository from "./Repository";
import type { Config, ResolvedTenant } from "./types";

/** Entries of the tenants config, from its list, its JSON file or its query */
async function readTenantEntries(config: Config): Promise<Array<unknown>> {
    const tenants = config.tenants ?? {};
    const sources = (["list", "file", "query"] as const).filter(key => tenants[key] != null);
    if (sources.length !== 1) throw new Error('"tenants" needs one of "list", "file" or "query"');
    if (tenants.list != null) {
        if (!Array.isArray(tenants.list)) throw new Error('"tenants.list" must be an array');
        return tenants.list;
    }
    if (tenants.file != null) {
        let entries: unknown;
        try {
            entries = JSON.parse(readFileSync(tenants.file, "utf8"));
        } catch (err) {
            throw new Error(`Cannot read the tenants file ${tenants.file}: ${err instanceof Error ? err.message : err}`);
        }
        if (!Array.isArray(entries)) throw new Error(`The tenants file ${tenants.file} must have an array of tenants`);
        return entries;
    }
    // The query runs on the main database, the one of the config without --tenant
    const connection = ConnectionFactory.create({ ...config, tenant: undefined });
    try {
        const rows = await connection.query(String(tenants.query));
        // Columns with no value (NULL) use the defaults
        return rows.map(row => Object.fromEntries(Object.entries(row)
            .filter(([, value]) => value != null)
            .map(([key, value]) => [key.toLowerCase(), String(value)])));
    } finally {
        await connection.close();
    }
}

/** Every tenant of the config, validated. Throws on repeated names or two tenants on the same target */
export async function loadTenants(config: Config): Promise<Array<ResolvedTenant>> {
    const tenants = (await readTenantEntries(config)).map(entry => resolveTenant(config, entry));
    const byName = new Map<string, ResolvedTenant>();
    const byTarget = new Map<string, ResolvedTenant>();
    for (const tenant of tenants) {
        if (byName.has(tenant.name)) throw new Error(`Tenant ${tenant.name} is twice in the list of tenants`);
        byName.set(tenant.name, tenant);
        const target = tenantTarget(config, tenant);
        const other = byTarget.get(target);
        if (other) throw new Error(`Tenants ${other.name} and ${tenant.name} use the same database${config.dialect === "postgres" ? " and schema" : ""}. Each tenant needs its own`);
        byTarget.set(target, tenant);
    }
    return tenants;
}

/** Commands that don't use the database or the config: they ignore the tenant options */
const WITHOUT_TENANTS = new Set(["init", "version"]);

/**
 * Read the tenant options before a command runs: --tenant a,b (or the env var
 * EZ_MIGRATE_TENANT) and --all-tenants. Loads the list of tenants and chooses
 * the ones the command runs for.
 */
export async function prepareTenants(command: string, options: { tenant?: string, allTenants?: boolean }) {
    tenantSettings.all = false;
    tenantSettings.list = [];
    tenantSettings.selected = [];
    const requested = options.tenant ?? process.env.EZ_MIGRATE_TENANT;
    if ((!requested && !options.allTenants) || WITHOUT_TENANTS.has(command)) return;
    if (requested && options.allTenants) throw new Error("Use --tenant or --all-tenants, not both");
    const config = new ConfigReader().getConfig();
    if (config.tenants == null) throw new Error('There are no "tenants" in ez-migrate.json. Add them to use --tenant or --all-tenants');
    const list = await loadTenants(config);
    tenantSettings.list = list;
    if (options.allTenants) {
        tenantSettings.all = true;
        tenantSettings.selected = list;
    } else {
        const names = String(requested).split(",").map(name => name.trim()).filter(Boolean);
        if (names.length === 0) throw new Error("--tenant needs the name of a tenant");
        tenantSettings.selected = [...new Set(names)].map(name => {
            const tenant = list.find(t => t.name === name);
            if (tenant == null) {
                const known = list.slice(0, 10).map(t => t.name).join(", ");
                throw new Error(`Unknown tenant ${name}. Tenants: ${known || "none"}${list.length > 10 ? ", ..." : ""}`);
            }
            return tenant;
        });
    }
    if (isMultiTenantRun() && !MULTI_TENANT_COMMANDS.has(command)) {
        throw new Error(`${command} runs for one tenant at a time. Use --tenant <name>. Only migrate and status run for several`);
    }
    // One tenant: every log line of the command says which one
    if (!isMultiTenantRun()) consoleLogger.setContext({ tenant: tenantSettings.selected[0].name });
}

/** Run fn with the logs of one tenant: every line has tenant=<name> */
export async function inTenant<T>(tenant: ResolvedTenant, fn: () => Promise<T>): Promise<T> {
    consoleLogger.setContext({ tenant: tenant.name });
    try {
        return await fn();
    } finally {
        consoleLogger.setContext();
    }
}

function errorMessage(err: unknown) {
    return err instanceof Error ? err.message : String(err);
}

export type TenantRunOptions = RunOptions & {
    /** Keep running the other tenants after one fails */
    continueOnError?: boolean,
};

type TenantResult = { tenant: string, state: "done" | "failed" | "not run", message: string };

/** One line per tenant and a total. It is the output of the command, so it goes to stdout */
function printSummary(results: Array<TenantResult>) {
    const count = (state: TenantResult["state"]) => results.filter(r => r.state === state).length;
    const width = Math.max(...results.map(r => r.tenant.length), 0);
    const marks = { "done": "✔", "failed": "✘", "not run": "-" };
    console.log([
        "",
        `Tenants: ${count("done")} done, ${count("failed")} failed, ${count("not run")} not run`,
        ...results.map(r => `${marks[r.state]} ${r.tenant.padEnd(width)}  ${r.message}`),
    ].join("\n"));
}

/**
 * runPlan for several tenants, one after the other. Each tenant has its own
 * lock and history, and a tenant that fails doesn't change the others.
 * - --dry-run: the plan of each tenant.
 * - With a person at the terminal: the files of each tenant, then one question.
 * - Then each tenant runs. By default it stops at the first tenant that fails,
 *   because the same files would likely fail on the next ones too
 *   (--continue-on-error runs the rest). A summary is printed at the end.
 */
export async function runPlanForTenants(
    base: Config,
    options: TenantRunOptions,
    makePlan: (config: Config, tracker: Repository) => Promise<Plan>,
    execute: (config: Config, tracker: Repository, plan: Plan) => Promise<void>,
) {
    if (options.json && !options.dryRun) throw new Error("--json only works with --dry-run. Nothing was run");
    const tenants = tenantSettings.selected;
    if (tenants.length === 0) {
        console.log("No tenants");
        return;
    }
    const planOf = (tenant: ResolvedTenant) => {
        const config = configForTenant(base, tenant);
        return inTenant(tenant, () => withTracker(config, tracker => makePlan(config, tracker)));
    };

    if (options.dryRun) {
        const plans: Array<{ tenant: string, plan?: Plan, error?: string }> = [];
        for (const tenant of tenants) {
            try {
                plans.push({ tenant: tenant.name, plan: await planOf(tenant) });
            } catch (err) {
                plans.push({ tenant: tenant.name, error: errorMessage(err) });
            }
        }
        if (options.json) {
            console.log(JSON.stringify({
                dryRun: true,
                tenants: plans.map(p => p.plan ? { tenant: p.tenant, steps: dryRunSteps(base.dialect, p.plan) } : p),
            }, null, 2));
        } else {
            for (const p of plans) {
                console.log(`-- Tenant ${p.tenant}`);
                if (p.plan) printDryRun(base.dialect, p.plan);
                else console.log(`-- Error: ${p.error}`);
                console.log("");
            }
        }
        if (plans.some(p => p.error != null)) process.exitCode = 1;
        return;
    }

    // Tenants whose plan failed before running anything, with the reason
    const failedPlans = new Map<string, string>();
    const approved = new Map<string, string>();
    if (mustConfirm(base, options)) {
        const lines: Array<string> = [];
        for (const tenant of tenants) {
            try {
                const plan = await planOf(tenant);
                approved.set(tenant.name, planKey(plan));
                const files = plan.flatMap(step => step.migrations.map(m => m.getDetails().path.replace(/^.*\//, "")));
                lines.push(isEmptyPlan(plan) ? `${tenant.name}: nothing to run` : `${tenant.name}: ${planSummary(plan, "will be")}: ${files.join(", ")}`);
            } catch (err) {
                failedPlans.set(tenant.name, errorMessage(err));
                lines.push(`${tenant.name}: error: ${errorMessage(err)}`);
            }
        }
        if (failedPlans.size > 0 || [...approved.values()].some(key => key !== "")) {
            console.log(lines.join("\n"));
            if (!await ask("\nRun it? [y/N] ")) {
                console.log("Cancelled. Nothing was run");
                return;
            }
        }
    }

    const results: Array<TenantResult> = [];
    let stopped = false;
    for (const tenant of tenants) {
        if (stopped) {
            results.push({ tenant: tenant.name, state: "not run", message: "not run: an earlier tenant failed (use --continue-on-error to run the rest)" });
            continue;
        }
        const config = configForTenant(base, tenant);
        try {
            const planError = failedPlans.get(tenant.name);
            if (planError != null) throw new Error(planError);
            const message = await inTenant(tenant, () => withLockedTracker(config, async tracker => {
                const plan = await makePlan(config, tracker);
                if (approved.has(tenant.name) && planKey(plan) !== approved.get(tenant.name)) {
                    throw new Error("The migrations to run changed while you answered (another run or a new file). Nothing was run for this tenant");
                }
                if (isEmptyPlan(plan)) return "nothing to run";
                await execute(config, tracker, plan);
                return planSummary(plan, n => n === 1 ? "was" : "were");
            }));
            results.push({ tenant: tenant.name, state: "done", message });
        } catch (err) {
            results.push({ tenant: tenant.name, state: "failed", message: errorMessage(err) });
            consoleLogger.error(`Tenant ${tenant.name} failed: ${errorMessage(err)}`);
            if (!options.continueOnError) stopped = true;
        }
    }
    printSummary(results);
    if (results.some(r => r.state !== "done")) process.exitCode = 1;
}
