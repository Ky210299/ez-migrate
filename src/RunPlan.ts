import { createInterface } from "node:readline/promises";
import Repository from "./Repository";
import ConnectionFactory from "./ConnectionFactory";
import MigrationExecutor from "./MigrationExecutor";
import { withLockedTracker, withTracker } from "./TrackerSession";
import { isEmptyPlan, Plan, printDryRun, printDryRunJson, printPlan } from "./DryRun";
import type { Config } from "./types";

export type RunOptions = {
    /** Print the SQL that would run, without running it */
    dryRun?: boolean,
    /** With dryRun: print the plan as JSON */
    json?: boolean,
    /** Run without asking first */
    yes?: boolean,
}

/**
 * True when ez-migrate must show the plan and ask before running it. It only
 * asks when a person is at the terminal: in CI, deploys and pipes it runs as before.
 * It doesn't ask with --yes, EZ_MIGRATE_YES=1 or "confirm": false in the config.
 */
export function mustConfirm(config: Config, options: RunOptions): boolean {
    if (options.yes || config.confirm === false || process.env.EZ_MIGRATE_YES === "1") return false;
    // Some CI runners have a terminal, but nobody can answer there
    if (process.env.CI) return false;
    return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export async function ask(question: string): Promise<boolean> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        return /^(y|yes|s|si|sí)$/i.test((await rl.question(question)).trim());
    } finally {
        rl.close();
    }
}

/** Text that is the same for two plans only if they run the same migrations in the same order */
function planKey(plan: Plan): string {
    return plan.flatMap(step => step.migrations.map(m => `${step.direction} ${m.getDetails().path}`)).join("\n");
}

/**
 * Run a command that applies or reverts migrations.
 * - With --dry-run: print the plan and run nothing.
 * - With a person at the terminal: print the plan and run it only if they say yes.
 *   The plan is made again under the lock; if it changed while they answered
 *   (another run, a new file), nothing runs.
 * - Otherwise (CI, deploys, --yes): run it.
 * `makePlan` must be the only place that chooses the migrations, so the three always agree.
 */
export async function runPlan(
    config: Config,
    options: RunOptions,
    makePlan: (tracker: Repository) => Promise<Plan>,
    execute: (tracker: Repository, plan: Plan) => Promise<void>,
) {
    if (options.json && !options.dryRun) {
        throw new Error("--json only works with --dry-run. Nothing was run");
    }
    if (options.dryRun) {
        const print = options.json ? printDryRunJson : printDryRun;
        await withTracker(config, async tracker => print(config.dialect, await makePlan(tracker)));
        return;
    }
    let approved: string | null = null;
    if (mustConfirm(config, options)) {
        const plan = await withTracker(config, makePlan);
        // Nothing to run: the real run says so, there is nothing to ask
        if (!isEmptyPlan(plan)) {
            printPlan(config.dialect, plan);
            if (!await ask("\nRun it? [y/N] ")) {
                console.log("Cancelled. Nothing was run");
                return;
            }
            approved = planKey(plan);
        }
    }
    await withLockedTracker(config, async tracker => {
        const plan = await makePlan(tracker);
        if (approved != null && planKey(plan) !== approved) {
            throw new Error("The migrations to run changed while you answered (another run or a new file). Nothing was run. Run the command again to see the new plan");
        }
        await execute(tracker, plan);
    });
}

/** Run fn with an executor on the target database, and always close its connection */
export async function withExecutor(config: Config, tracker: Repository, fn: (executor: MigrationExecutor) => Promise<void>) {
    const executor = new MigrationExecutor(ConnectionFactory.create(config), tracker);
    try {
        await fn(executor);
    } finally {
        await executor.close();
    }
}
