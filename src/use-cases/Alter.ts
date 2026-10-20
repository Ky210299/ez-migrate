import { basename } from "node:path";
import ConfigReader from "../ConfigReader";
import ConnectionFactory from "../ConnectionFactory";
import DatabaseConnector from "../DatabaseConnector";
import SchemasHandler from "../SchemasHandler";
import { withTracker } from "../TrackerSession";
import { tracer } from "../Tracer";
import { ask, mustConfirm } from "../RunPlan";
import { MIGRATIONS_DIALECTS } from "../constants";
import {
    AlterSQL, BIG_TABLE_BYTES, BIG_TABLE_ROWS, ColumnAlterer, ColumnState, CopyTest, ValueExample, ValueReport,
    describeType, parseTargetType, testOnCopy,
} from "../AlterColumn";
import type { Config } from "../types";

export type AlterOptions = {
    /** Check the values and test the change on a copy of the table, without writing the migration */
    dryRun?: boolean,
    /** Write the migration even if some values change (rounded, cut, other format). Values that can't be converted still stop it */
    allowChanges?: boolean,
    /** Don't test the change on a copy of the table (for very big tables) */
    skipTest?: boolean,
    /** Copy big tables without asking */
    yes?: boolean,
    /** Name of the migration file (after the timestamp) */
    name?: string,
    /** Print the result as JSON, for scripts and AI agents */
    json?: boolean,
}

/* eslint-disable @typescript-eslint/no-require-imports */
/** The code of the DBMS in use only. Like the drivers, the others are not loaded */
function createAlterer(config: Config, connection: DatabaseConnector): ColumnAlterer {
    switch (config.dialect) {
        case MIGRATIONS_DIALECTS.MYSQL: {
            const AlterMysql: typeof import("../AlterMysql").default = require("../AlterMysql").default;
            return new AlterMysql(connection) as unknown as ColumnAlterer;
        }
        case MIGRATIONS_DIALECTS.POSTGRES: {
            const AlterPostgres: typeof import("../AlterPostgres").default = require("../AlterPostgres").default;
            return new AlterPostgres(connection) as unknown as ColumnAlterer;
        }
        case MIGRATIONS_DIALECTS.SQLITE: {
            const AlterSqlite: typeof import("../AlterSqlite").default = require("../AlterSqlite").default;
            return new AlterSqlite(connection) as unknown as ColumnAlterer;
        }
        default:
            throw new Error(`alter doesn't support ${config.dialect}`);
    }
}
/* eslint-enable @typescript-eslint/no-require-imports */

function size(bytes: number | null): string {
    if (bytes == null) return "";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `, ${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function rows(n: number): string {
    return n === 1 ? "1 row" : `${n} rows`;
}

function value(text: string | null): string {
    return text == null ? "NULL" : `'${text}'`;
}

function exampleLines(examples: Array<ValueExample>, total: number, withTo: boolean): Array<string> {
    const lines = examples.map(e => `    ${value(e.from)}${withTo ? ` -> ${value(e.to)}` : ""} (${rows(e.rows)})`);
    const shown = examples.reduce((sum, e) => sum + e.rows, 0);
    if (shown < total) lines.push(`    ... and ${rows(total - shown)} more`);
    return lines;
}

interface AlterResult {
    state: ColumnState;
    to: string;
    values: ValueReport | null;
    test: CopyTest | null;
    /** Why the test on the copy was not run */
    testSkipped: string | null;
    safe: boolean;
    reasons: Array<string>;
    sql: AlterSQL | null;
    file: string | null;
}

function printText(result: AlterResult, options: AlterOptions) {
    const { state, values, test } = result;
    const lines = [
        `Table ${state.table}, column ${state.column}`,
        `  Type: ${state.type} -> ${result.to}`,
        `  Rows: ${state.rows}${size(state.bytes)}`,
    ];
    if (values != null) {
        lines.push(`  Values: ${values.unchanged} stay the same, ${values.changed} change, ${values.invalid} can't be converted`);
        if (values.changed > 0) lines.push("  Values that change:", ...exampleLines(values.changedExamples, values.changed, true));
        if (values.invalid > 0) lines.push("  Values that can't be converted:", ...exampleLines(values.invalidExamples, values.invalid, false));
        if (values.error != null) lines.push(`  The database can't convert every value: ${values.error}`);
    }
    if (test != null) {
        lines.push(`  Test on a copy of the table (${test.table}, dropped after the test):`);
        lines.push(test.up.ok
            ? `    up: ok in ${test.up.ms} ms, ${test.up.changed === 0 ? "no value changed" : `${rows(test.up.changed ?? 0)} changed`}`
            : `    up: failed: ${test.up.error}`);
        if (test.down != null) {
            lines.push(test.down.ok
                ? `    down: ok in ${test.down.ms} ms, ${test.down.notRestored === 0 ? "every value is back as it was" : `${rows(test.down.notRestored ?? 0)} are not as they were`}`
                : `    down: failed: ${test.down.error}`);
        }
    } else if (result.testSkipped != null) {
        lines.push(`  Test on a copy of the table: not run. ${result.testSkipped}`);
    }
    lines.push(result.safe ? "  Result: safe" : "  Result: NOT safe", ...result.reasons.map(r => `    - ${r}`));
    if (result.sql != null && result.safe) {
        lines.push("", "-- up", result.sql.up, "", "-- down", result.sql.down, "");
        if (options.dryRun) lines.push("Dry run: no migration was written. Run it without --dry-run to write it");
        else if (result.file != null) lines.push(`Migration written: ${result.file}. Apply it with ez-migrate migrate`);
    } else if (!result.safe) {
        lines.push("", "No migration was written");
    }
    console.log(lines.join("\n"));
}

/**
 * Change the type of a column without losing data. ez-migrate reads the column,
 * converts every value to the new type to see which ones change, tests the
 * migration (up and down) on a copy of the table, and only then writes it.
 * The migration also checks the values again before changing anything, so it
 * stops if another database (production) has values that the test didn't have.
 */
export default class Alter {
    private constructor() { throw new Error("Alter is a static class") }

    static async run(table: string, column: string, type: string, options: AlterOptions = {}) {
        const config = new ConfigReader().getConfig();
        const target = parseTargetType(type);
        await Alter.checkNoPending(config);
        const connection = ConnectionFactory.create(config);
        let result: AlterResult;
        try {
            await connection.testConnection();
            result = await Alter.analyze(config, connection, table, column, target, options);
        } finally {
            await connection.close().catch(() => {});
        }
        if (result.safe && !options.dryRun && result.sql != null) {
            const name = options.name ?? `alter-${table}-${column}`.replace(/[^\w.-]+/g, "_");
            const schemaHandler = SchemasHandler.forConfig(config);
            result.file = schemaHandler.writeMigrationFile(name, result.sql.up, result.sql.down);
        }
        // The result is the output of the command, not a log line
        if (options.json) {
            console.log(JSON.stringify({
                table: result.state.table,
                column: result.state.column,
                from: result.state.type,
                to: result.to,
                rows: result.state.rows,
                bytes: result.state.bytes,
                values: result.values,
                test: result.test,
                testSkipped: result.testSkipped,
                safe: result.safe,
                reasons: result.reasons,
                dryRun: Boolean(options.dryRun),
                file: result.file == null ? null : basename(result.file),
                up: result.sql?.up ?? null,
                down: result.sql?.down ?? null,
            }, null, 2));
        } else {
            printText(result, options);
        }
        if (!result.safe) process.exitCode = 1;
    }

    /** The change is planned on the database as it is now: pending migrations would change it */
    private static async checkNoPending(config: Config) {
        const schemaHandler = SchemasHandler.forConfig(config);
        const files = schemaHandler.getAllMigrations().map(path => basename(path));
        const pending = await withTracker(config, async tracker => {
            const applied = new Set((await tracker.listMigrations()).map(m => basename(m.getDetails().path)));
            return files.filter(file => !applied.has(file));
        });
        if (pending.length > 0) {
            throw new Error(`${pending.length === 1 ? "1 migration is" : `${pending.length} migrations are`} pending (${pending.join(", ")}). alter looks at the database as it is now: apply them first with ez-migrate migrate`);
        }
    }

    private static async analyze(
        config: Config,
        connection: DatabaseConnector,
        table: string,
        column: string,
        target: ReturnType<typeof parseTargetType>,
        options: AlterOptions,
    ): Promise<AlterResult> {
        const alterer = createAlterer(config, connection);
        const state = await tracer.span("alter.inspect", {}, () => alterer.inspect(table, column));
        const result: AlterResult = {
            state, to: describeType(target), values: null, test: null, testSkipped: null,
            safe: false, reasons: [], sql: null, file: null,
        };
        if (state.blockers.length > 0) {
            result.reasons.push(...state.blockers);
            return result;
        }
        if (alterer.isSameType(state, target)) {
            result.reasons.push("The column already has this type. Nothing to change");
            return result;
        }
        const guard = !options.allowChanges;
        result.sql = alterer.plan(state, target, { guard });
        const values = await tracer.span("alter.values", { rows: state.rows }, () => alterer.analyze(state, target));
        result.values = values;

        if (values.invalid > 0) result.reasons.push(`Values in ${rows(values.invalid)} can't be converted to ${result.to}. Change those values first (with a seed) or choose another type`);
        if (values.error != null) result.reasons.push("The database can't convert every value (see the error above)");
        if (values.changed > 0 && !options.allowChanges) {
            result.reasons.push(`Values in ${rows(values.changed)} would not be the same after the change. If that is what you want, run it again with --allow-changes`);
        }
        if (result.reasons.length > 0) {
            result.testSkipped = "Fix the values first";
            return result;
        }
        if (values.changed > 0) result.reasons.push(`Values in ${rows(values.changed)} change (allowed with --allow-changes)`);

        if (options.skipTest) {
            result.testSkipped = "--skip-test";
        } else if (!await Alter.approveCopy(config, state, options)) {
            result.testSkipped = "Not approved";
            result.reasons.push("The change was not tested on a copy of the table. Run it with --skip-test to write the migration without the test");
            return result;
        } else {
            result.test = await testOnCopy(connection, alterer, state, target, guard);
            const { up, down } = result.test;
            if (!up.ok) {
                result.reasons.push("The migration failed on the copy of the table, so it would fail on this table too");
                return result;
            }
            if (up.changed !== values.changed) {
                result.reasons.push(`The copy has ${rows(up.changed ?? 0)} that changed, and the check said ${values.changed}. Look at the values before applying it`);
                return result;
            }
            if (down != null && !down.ok) result.reasons.push("The down section failed on the copy: the migration can't be reverted. Look at the error above");
            else if (down != null && down.notRestored !== 0 && values.changed === 0) result.reasons.push(`After the down section ${rows(down.notRestored ?? 0)} are not as they were`);
        }
        result.safe = true;
        return result;
    }

    /** Copying a big table takes time and disk: ask first, or need --yes */
    private static async approveCopy(config: Config, state: ColumnState, options: AlterOptions): Promise<boolean> {
        const big = state.rows > BIG_TABLE_ROWS || (state.bytes ?? 0) > BIG_TABLE_BYTES;
        if (!big || options.yes) return true;
        const question = `The table ${state.table} has ${rows(state.rows)}${size(state.bytes)}. The test copies it into the same database, which takes time and disk.`;
        if (mustConfirm(config, options)) return ask(`${question}\nCopy it? [y/N] `);
        throw new Error(`${question} Run it with --yes to copy it, or with --skip-test to not test it`);
    }
}
