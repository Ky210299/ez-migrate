import { basename } from "node:path";
import Migration from "./Migration";
import { nonAtomicWarning } from "./MigrationExecutor";

/**
 * Print the SQL that a command would run, without running it. It is the
 * output of the command, so it goes to stdout and not to the logger (logs
 * never contain SQL).
 */
export function printDryRun(dialect: string, direction: "up" | "down", migrations: Array<Migration>) {
    const action = direction === "up" ? "applied" : "reverted";
    if (migrations.length === 0) {
        console.log(`-- Dry run: no migration would be ${action}`);
        return;
    }
    const count = migrations.length === 1 ? "1 migration" : `${migrations.length} migrations`;
    const lines = [`-- Dry run: nothing was run. ${count} would be ${action}, in this order:`];
    for (const migration of migrations) {
        const details = migration.getDetails();
        const sql = details[direction].trim();
        lines.push("", `-- ${basename(details.path)} (${direction})`);
        const notAtomic = nonAtomicWarning(dialect, sql);
        if (notAtomic) lines.push(`-- Not atomic. ${notAtomic}`);
        lines.push(sql);
    }
    console.log(lines.join("\n"));
}
