import { basename } from "node:path";
import Migration from "./Migration";
import { nonAtomicWarning } from "./MigrationExecutor";

/** Migrations a command runs in one direction, in order */
export type Step = { direction: "up" | "down", migrations: Array<Migration> };
/** Everything a command runs, in order. reset and redo have a down step and an up step */
export type Plan = Array<Step>;

/** True if the plan runs no migration */
export function isEmptyPlan(plan: Plan): boolean {
    return plan.every(step => step.migrations.length === 0);
}

function count(n: number) {
    return n === 1 ? "1 migration" : `${n} migrations`;
}

/** "2 migrations would be reverted and 3 applied" */
function summary(plan: Plan, verb: string): string {
    const parts = plan.filter(step => step.migrations.length > 0).map((step, i) => {
        const action = step.direction === "up" ? "applied" : "reverted";
        return i === 0 ? `${count(step.migrations.length)} ${verb} ${action}` : `${step.migrations.length} ${action}`;
    });
    return parts.join(" and ");
}

/** The SQL of the plan, in order, with a note on the migrations that are not atomic */
function planSQL(dialect: string, plan: Plan): Array<string> {
    const lines: Array<string> = [];
    for (const { direction, migrations } of plan) {
        for (const migration of migrations) {
            const details = migration.getDetails();
            const sql = details[direction].trim();
            lines.push("", `-- ${basename(details.path)} (${direction})`);
            const notAtomic = nonAtomicWarning(dialect, sql);
            if (notAtomic) lines.push(`-- Not atomic. ${notAtomic}`);
            lines.push(sql);
        }
    }
    return lines;
}

/**
 * Print the SQL that a command would run, without running it. It is the
 * output of the command, so it goes to stdout and not to the logger (logs
 * never contain SQL).
 */
export function printDryRun(dialect: string, plan: Plan) {
    if (isEmptyPlan(plan)) {
        const action = plan.every(step => step.direction === "down") ? "reverted" : "applied";
        console.log(`-- Dry run: no migration would be ${action}`);
        return;
    }
    console.log([`-- Dry run: nothing was run. ${summary(plan, "would be")}, in this order:`, ...planSQL(dialect, plan)].join("\n"));
}

/** Print the SQL that a command is about to run, before asking to run it */
export function printPlan(dialect: string, plan: Plan) {
    console.log([`-- ${summary(plan, "will be")}, in this order:`, ...planSQL(dialect, plan)].join("\n"));
}

/**
 * The same as printDryRun, as one JSON object for scripts and AI agents:
 * `{ dryRun, steps: [{ direction, migrations: [{ file, sql, notAtomic }] }] }`
 */
export function printDryRunJson(dialect: string, plan: Plan) {
    const steps = plan.map(({ direction, migrations }) => ({
        direction,
        migrations: migrations.map(migration => {
            const details = migration.getDetails();
            const sql = details[direction].trim();
            return { file: basename(details.path), sql, notAtomic: nonAtomicWarning(dialect, sql) };
        }),
    }));
    console.log(JSON.stringify({ dryRun: true, steps }, null, 2));
}
