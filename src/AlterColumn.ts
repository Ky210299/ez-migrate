import type DatabaseConnector from "./DatabaseConnector";
import { closingParen, quotedValues, stripComments, stripStrings } from "./sql";
import { tracer } from "./Tracer";

/*
 * `ez-migrate alter`: change the type of a column without losing data.
 * Each DBMS has its own class (AlterMysql, AlterPostgres, AlterSqlite) that
 * reads the column, writes the SQL and checks the values. This file has what
 * they share: the target type, the report and the test on a copy of the table.
 */

/** New type of the column. `enum('a','b')` works on every DBMS */
export type TargetType =
    | { kind: "enum", labels: Array<string> }
    | { kind: "sql", sql: string };

/** The column as it is now in the database */
export interface ColumnState {
    table: string;
    column: string;
    /** Type as the database shows it */
    type: string;
    /** Values of the enum, when the column is one (MySQL ENUM, PostgreSQL enum type, SQLite ez-migrate CHECK) */
    enumLabels: Array<string> | null;
    rows: number;
    /** Size of the table with its indexes, when the DBMS tells it */
    bytes: number | null;
    /** Why the column can't be changed with alter (foreign keys, views) */
    blockers: Array<string>;
}

export interface ValueExample {
    from: string | null;
    to: string | null;
    rows: number;
}

/**
 * What happens to the current values when they are converted to the new type.
 * A value stays the same if converting it back to the old type gives the same
 * value: 2.00 -> 2 -> 2.00 stays, 1.50 -> 2 -> 2.00 changes, 'Active' -> 'active' changes.
 */
export interface ValueReport {
    rows: number;
    unchanged: number;
    /** Values that are converted but are not the same after (rounded, cut, other format) */
    changed: number;
    changedExamples: Array<ValueExample>;
    /** Values that can't be converted (not in the enum, not a number...) */
    invalid: number;
    invalidExamples: Array<ValueExample>;
    /** Error of the database when it can't say which values fail */
    error: string | null;
}

export interface AlterSQL {
    up: string;
    down: string;
}

export interface PlanOptions {
    /** Add a check that stops the migration if any value would change */
    guard: boolean;
    /** The plan is for the copy of the table (the original keeps its objects) */
    replica?: boolean;
}

/** One DBMS */
export interface ColumnAlterer<S extends ColumnState = ColumnState> {
    inspect(table: string, column: string): Promise<S>;
    plan(state: S, target: TargetType, options: PlanOptions): AlterSQL;
    analyze(state: S, target: TargetType): Promise<ValueReport>;
    /** Create a copy of the table, with the rows and the column copied again in REPLICA_ORIGINAL. Returns its name */
    createReplica(state: S): Promise<string>;
    /**
     * Rows of the copy where the column, converted back to the type it had,
     * is not the same as REPLICA_ORIGINAL
     */
    differences(state: S, replica: string): Promise<number>;
    dropReplica(state: S, replica: string): Promise<void>;
    /** Leave the connection as it was after a failed up or down on the copy */
    recover?(): Promise<void>;
    /** Same type as the target: nothing to change */
    isSameType(state: S, target: TargetType): boolean;
}

/** Column of the copy with the value before the change, to compare row by row */
export const REPLICA_ORIGINAL = "__ezm_original";
/** The copy is `<table>__ezm_test` */
export const REPLICA_SUFFIX = "__ezm_test";
/** Tables with more rows or bytes than this are only copied after asking */
export const BIG_TABLE_ROWS = 1_000_000;
export const BIG_TABLE_BYTES = 1024 ** 3;
/** Examples of values shown in the report */
export const EXAMPLES = 5;

/** Name of the copy of a table. Short enough for every DBMS (MySQL: 64, PostgreSQL: 63) */
export function replicaName(table: string): string {
    return `${table.slice(0, 40)}${REPLICA_SUFFIX}`;
}

/**
 * Parse the type given by the user. `enum('a','b')` becomes an enum; any other
 * text is a type of the DBMS (`char(2)`, `bigint`, `varchar(50)`) and is used as is.
 */
export function parseTargetType(text: string): TargetType {
    const type = text.trim();
    const enumMatch = /^enum\s*\(/i.exec(type);
    if (enumMatch) {
        const open = enumMatch[0].length - 1;
        const close = closingParen(type, open);
        if (close !== type.length - 1) throw new Error(`Invalid enum: ${type}. Write it as enum('a','b')`);
        const inside = type.slice(open + 1, close);
        if (stripStrings(inside).replace(/['\s,]/g, "") !== "") {
            throw new Error(`Invalid enum: ${type}. Write the values in single quotes: enum('a','b')`);
        }
        const labels = quotedValues(inside);
        if (labels.length === 0) throw new Error("An enum needs at least one value: enum('a','b')");
        if (new Set(labels).size !== labels.length) throw new Error(`The enum has repeated values: ${type}`);
        return { kind: "enum", labels };
    }
    if (type === "") throw new Error("The new type is empty");
    // The type goes into the SQL: one type, without statements or comments
    const plain = stripStrings(type);
    if (/;|--|\/\*|#/.test(plain) || stripComments(type) !== type) {
        throw new Error(`Invalid type: ${type}`);
    }
    return { kind: "sql", sql: type };
}

/** The type as the user writes it, for the report */
export function describeType(target: TargetType): string {
    return target.kind === "enum" ? `enum(${target.labels.map(l => quote(l)).join(",")})` : target.sql;
}

/** SQL string literal ('it''s') */
export function quote(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

/** Order of the values matters: same values in the same order */
export function sameLabels(a: Array<string> | null, b: Array<string>): boolean {
    return a != null && a.length === b.length && a.every((label, i) => label === b[i]);
}

/** Text of a value for the report: short, and NULL for null */
export function show(value: unknown): string | null {
    if (value == null) return null;
    const text = String(value);
    return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

/** Result of running the generated SQL on the copy of the table */
export interface CopyTest {
    table: string;
    up: { ok: boolean, ms: number, error: string | null, changed: number | null };
    down: { ok: boolean, ms: number, error: string | null, notRestored: number | null } | null;
}

function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

async function timed(fn: () => Promise<unknown>): Promise<{ ms: number, error: string | null }> {
    const start = performance.now();
    try {
        await fn();
        return { ms: Math.round(performance.now() - start), error: null };
    } catch (err) {
        return { ms: Math.round(performance.now() - start), error: errorText(err) };
    }
}

/**
 * Copy the table, run the up SQL on the copy, compare every row with its value
 * before, run the down SQL and compare again. The copy is always dropped, also
 * when something fails or the user presses Ctrl+C.
 */
export async function testOnCopy<S extends ColumnState>(
    connection: DatabaseConnector,
    alterer: ColumnAlterer<S>,
    state: S,
    target: TargetType,
    guard: boolean,
): Promise<CopyTest> {
    let replica: string | null = null;
    const cleanup = async () => {
        if (replica != null) await alterer.dropReplica(state, replica);
        replica = null;
    };
    const onInterrupt = () => {
        cleanup().finally(() => process.exit(130));
    };
    process.once("SIGINT", onInterrupt);
    try {
        replica = await tracer.span("alter.copy", { rows: state.rows }, () => alterer.createReplica(state));
        const table = replica;
        const copyState = await alterer.inspect(table, state.column);
        const sql = alterer.plan(copyState, target, { guard, replica: true });

        const up = await tracer.span("alter.test.up", {}, () => timed(() => connection.runSQL(sql.up)));
        if (up.error != null) {
            await alterer.recover?.();
            return { table, up: { ok: false, ms: up.ms, error: up.error, changed: null }, down: null };
        }
        const changed = await alterer.differences(state, table);
        const down = await tracer.span("alter.test.down", {}, () => timed(() => connection.runSQL(sql.down)));
        if (down.error != null) await alterer.recover?.();
        const notRestored = down.error == null ? await alterer.differences(state, table) : null;
        return {
            table,
            up: { ok: true, ms: up.ms, error: null, changed },
            down: { ok: down.error == null, ms: down.ms, error: down.error, notRestored },
        };
    } finally {
        process.removeListener("SIGINT", onInterrupt);
        await cleanup();
    }
}
