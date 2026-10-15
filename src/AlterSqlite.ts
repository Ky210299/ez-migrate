import type DatabaseConnector from "./DatabaseConnector";
import {
    AlterSQL, ColumnAlterer, ColumnState, EXAMPLES, PlanOptions, REPLICA_ORIGINAL, TargetType, ValueReport,
    quote, replicaName, REPLICA_SUFFIX, sameLabels, show,
} from "./AlterColumn";
import { closingParen, findTopLevelWord, quotedValues, splitTopLevel } from "./sql";

interface SqliteColumn extends ColumnState {
    /** CREATE TABLE as it is in sqlite_schema, split around the column definition */
    body: Array<string>;
    index: number;
    /** After the closing parenthesis: WITHOUT ROWID, STRICT */
    tail: string;
    /** The column definition split in name, type and the rest */
    nameText: string;
    typeText: string;
    rest: string;
    /** CREATE INDEX and CREATE TRIGGER of the table, created again after the rebuild */
    indexes: Array<string>;
    triggers: Array<string>;
    /** Columns that can be inserted (generated columns can't) */
    columns: Array<string>;
}

/** Words that end the type in a column definition */
const AFTER_TYPE = ["CONSTRAINT", "PRIMARY", "NOT", "NULL", "UNIQUE", "CHECK", "DEFAULT", "COLLATE", "REFERENCES", "GENERATED", "AS"];
/** First word of a table constraint, which is not a column */
const TABLE_CONSTRAINT = ["CONSTRAINT", "PRIMARY", "UNIQUE", "CHECK", "FOREIGN"];
const NAME = /^\s*("(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|[A-Za-z_][\w$]*)/;

/** The value converted to the new type and back (back_value) is not the same as before */
const CHANGED = "CAST(old_value AS TEXT) IS NOT CAST(back_value AS TEXT)";

function id(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
}

function unquote(name: string): string {
    if (/^["`]/.test(name)) return name.slice(1, -1).replace(/""|``/g, m => m[0]);
    if (name.startsWith("[")) return name.slice(1, -1);
    return name;
}

/** SQLite has no enum: ez-migrate uses a CHECK with this name */
function enumConstraintName(column: string): string {
    return `ezm_enum_${column}`;
}

/** The enum CHECK that ez-migrate added to the column definition, if any */
function findEnumConstraint(rest: string, column: string): { start: number, end: number, labels: Array<string> } | null {
    const match = new RegExp(`CONSTRAINT\\s+${id(enumConstraintName(column)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+CHECK\\s*\\(`, "i").exec(rest);
    if (match == null) return null;
    const open = match.index + match[0].length - 1;
    const end = closingParen(rest, open);
    if (end === -1) return null;
    return { start: match.index, end: end + 1, labels: quotedValues(rest.slice(open, end)) };
}

export default class AlterSqlite implements ColumnAlterer<SqliteColumn> {
    constructor(private readonly connection: DatabaseConnector) { }

    async inspect(table: string, column: string): Promise<SqliteColumn> {
        const [row] = await this.connection.query("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?", [table]);
        if (row == null) throw new Error(`Table ${table} doesn't exist`);
        const sql = String(row.sql);
        const open = sql.indexOf("(");
        const close = closingParen(sql, open);
        const body = splitTopLevel(sql.slice(open + 1, close), ",");
        const index = body.findIndex(part => {
            const name = NAME.exec(part)?.[1];
            if (name == null) return false;
            if (!/^["`[]/.test(name) && TABLE_CONSTRAINT.includes(name.toUpperCase())) return false;
            return unquote(name).toLowerCase() === column.toLowerCase();
        });
        if (index === -1) throw new Error(`Column ${column} doesn't exist in table ${table}`);
        const definition = body[index];
        const nameText = NAME.exec(definition)![0].trim();
        const afterName = definition.slice(NAME.exec(definition)![0].length);
        const typeEnd = findTopLevelWord(afterName, AFTER_TYPE);
        const typeText = (typeEnd === -1 ? afterName : afterName.slice(0, typeEnd)).trim();
        const rest = typeEnd === -1 ? "" : afterName.slice(typeEnd).trim();
        const enumConstraint = findEnumConstraint(rest, unquote(nameText));

        const objects = await this.connection.query(
            "SELECT type, sql FROM sqlite_schema WHERE tbl_name = ? AND type IN ('index', 'trigger') AND sql IS NOT NULL ORDER BY rowid",
            [table],
        );
        const columns = await this.connection.query(`SELECT name, hidden FROM pragma_table_xinfo(${quote(table)})`);
        const [{ n }] = await this.connection.query(`SELECT COUNT(*) AS n FROM ${id(table)}`);
        let bytes: number | null = null;
        try {
            const [size] = await this.connection.query("SELECT SUM(pgsize) AS bytes FROM dbstat WHERE name = ? OR name IN (SELECT name FROM sqlite_schema WHERE tbl_name = ? AND type = 'index')", [table, table]);
            bytes = size?.bytes == null ? null : Number(size.bytes);
        } catch {
            // SQLite without the dbstat table
        }
        return {
            table, body, index, nameText, typeText, rest,
            column: unquote(nameText),
            tail: sql.slice(close + 1),
            type: enumConstraint ? `enum(${enumConstraint.labels.map(quote).join(",")})` : typeText,
            enumLabels: enumConstraint?.labels ?? null,
            indexes: objects.filter(o => o.type === "index").map(o => String(o.sql)),
            triggers: objects.filter(o => o.type === "trigger").map(o => String(o.sql)),
            columns: columns.filter(c => Number(c.hidden) === 0).map(c => String(c.name)),
            rows: Number(n),
            bytes,
            // SQLite keeps the foreign keys in the rebuild and checks them all at the end
            blockers: [],
        };
    }

    isSameType(state: SqliteColumn, target: TargetType): boolean {
        if (target.kind === "enum") return sameLabels(state.enumLabels, target.labels);
        return state.enumLabels == null && state.typeText.replace(/\s+/g, " ").toLowerCase() === target.sql.replace(/\s+/g, " ").toLowerCase();
    }

    /** Definition of the column with the new type. An enum is TEXT with a CHECK */
    private definition(state: SqliteColumn, target: TargetType): string {
        const old = findEnumConstraint(state.rest, state.column);
        const rest = old ? `${state.rest.slice(0, old.start)}${state.rest.slice(old.end)}`.replace(/\s+/g, " ").trim() : state.rest;
        const parts = [state.nameText, target.kind === "enum" ? "TEXT" : target.sql, rest];
        if (target.kind === "enum") {
            parts.push(`CONSTRAINT ${id(enumConstraintName(state.column))} CHECK (${id(state.column)} IN (${target.labels.map(quote).join(", ")}))`);
        }
        return parts.filter(Boolean).join(" ");
    }

    private createTable(name: string, body: Array<string>, tail: string): string {
        return `CREATE TABLE ${id(name)} (${body.join(",")})${tail}`;
    }

    /** Column type of the check table: the type, and the values of the enum */
    private checkType(target: TargetType): string {
        return target.kind === "enum"
            ? `TEXT CONSTRAINT ez_migrate_alter_value_not_in_enum CHECK (new_value IN (${target.labels.map(quote).join(", ")}))`
            : target.sql;
    }

    plan(state: SqliteColumn, target: TargetType, options: PlanOptions): AlterSQL {
        const newBody = [...state.body];
        newBody[state.index] = ` ${this.definition(state, target)}`;
        const oldTarget: TargetType = state.enumLabels ? { kind: "enum", labels: state.enumLabels } : { kind: "sql", sql: state.typeText || "BLOB" };
        const plainType = (type: TargetType) => type.kind === "enum" ? "TEXT" : type.sql;
        return {
            up: this.rebuild(state, newBody, options.guard ? { from: plainType(oldTarget), to: this.checkType(target) } : null),
            down: this.rebuild(state, state.body, { from: plainType(target), to: this.checkType(oldTarget) }),
        };
    }

    /**
     * SQLite can't change a column type: the table is created again with the
     * new definition (https://www.sqlite.org/lang_altertable.html#otheralter).
     * Foreign keys are off during the rebuild (ez-migrate checks them all before
     * commit), and legacy_alter_table keeps the views that use the table valid.
     * Everything runs in one transaction.
     */
    private rebuild(state: SqliteColumn, body: Array<string>, guard: { from: string, to: string } | null): string {
        const table = id(state.table);
        const column = id(state.column);
        const temporary = `${state.table}__ezm_new`;
        const columns = state.columns.map(id).join(", ");
        const lines = [
            "-- Generated by ez-migrate alter. SQLite runs it in a transaction with foreign keys off and checks them before commit",
            "PRAGMA foreign_keys = OFF;",
        ];
        if (guard) {
            lines.push(
                "-- Stops here, before changing anything, if a value would not be the same after the change",
                `CREATE TEMP TABLE ezm_alter_check (old_value ${guard.from}, new_value ${guard.to});`,
                `INSERT INTO temp.ezm_alter_check SELECT ${column}, ${column} FROM ${table};`,
                `CREATE TEMP TABLE ezm_alter_back (old_value ${guard.from}, back_value ${guard.from});`,
                "INSERT INTO temp.ezm_alter_back SELECT old_value, new_value FROM temp.ezm_alter_check;",
                "CREATE TEMP TABLE ezm_alter_guard (changed_values INTEGER CONSTRAINT ez_migrate_alter_values_would_change CHECK (changed_values = 0));",
                `INSERT INTO temp.ezm_alter_guard SELECT COUNT(*) FROM temp.ezm_alter_back WHERE ${CHANGED};`,
                "DROP TABLE temp.ezm_alter_check;",
                "DROP TABLE temp.ezm_alter_back;",
                "DROP TABLE temp.ezm_alter_guard;",
            );
        }
        lines.push(
            `${this.createTable(temporary, body, state.tail)};`,
            `INSERT INTO ${id(temporary)} (${columns}) SELECT ${columns} FROM ${table};`,
            `DROP TABLE ${table};`,
            "PRAGMA legacy_alter_table = ON;",
            `ALTER TABLE ${id(temporary)} RENAME TO ${table};`,
            "PRAGMA legacy_alter_table = OFF;",
            ...[...state.indexes, ...state.triggers].map(sql => `${sql.trim().replace(/;$/, "")};`),
        );
        return lines.join("\n");
    }

    async analyze(state: SqliteColumn, target: TargetType): Promise<ValueReport> {
        const table = id(state.table);
        const column = id(state.column);
        const valid = target.kind === "enum" ? `CAST(${column} AS TEXT) IN (${target.labels.map(quote).join(", ")})` : "1";
        const invalid = target.kind === "enum"
            ? await this.connection.query(`SELECT ${column} AS old_value, COUNT(*) AS n FROM ${table} WHERE ${column} IS NOT NULL AND NOT (${valid}) GROUP BY 1 ORDER BY 2 DESC`)
            : [];
        const newType = target.kind === "enum" ? "TEXT" : target.sql;
        const oldType = state.typeText || "BLOB";
        await this.connection.runSQL(
            `DROP TABLE IF EXISTS temp.ezm_alter_values;
             CREATE TEMP TABLE ezm_alter_values (old_value ${oldType}, new_value ${newType}, back_value ${oldType});
             INSERT INTO temp.ezm_alter_values (old_value, new_value) SELECT ${column}, ${column} FROM ${table} WHERE ${column} IS NULL OR ${valid};
             UPDATE temp.ezm_alter_values SET back_value = new_value;`,
        );
        try {
            const changed = await this.connection.query(
                `SELECT old_value, new_value, COUNT(*) AS n FROM temp.ezm_alter_values WHERE ${CHANGED} GROUP BY 1, 2 ORDER BY 3 DESC`,
            );
            const sum = (rows: Array<Record<string, unknown>>) => rows.reduce((total, r) => total + Number(r.n), 0);
            return {
                rows: state.rows,
                unchanged: state.rows - sum(invalid) - sum(changed),
                changed: sum(changed),
                changedExamples: changed.slice(0, EXAMPLES).map(r => ({ from: show(r.old_value), to: show(r.new_value), rows: Number(r.n) })),
                invalid: sum(invalid),
                invalidExamples: invalid.slice(0, EXAMPLES).map(r => ({ from: show(r.old_value), to: null, rows: Number(r.n) })),
                error: null,
            };
        } finally {
            await this.connection.runSQL("DROP TABLE IF EXISTS temp.ezm_alter_values;");
        }
    }

    async createReplica(state: SqliteColumn): Promise<string> {
        const replica = replicaName(state.table);
        const columns = state.columns.map(id).join(", ");
        // Indexes are copied with new names, so unique values are checked on the copy too
        const indexes = state.indexes.map(sql => sql.replace(
            /^(\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?)("(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|[\w$]+)(\s+ON\s+)("(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|[\w$]+)/i,
            (_all, start, name, on) => `${start}${id(`${unquote(name)}${REPLICA_SUFFIX}`)}${on}${id(replica)}`,
        ));
        await this.connection.runSQL([
            `DROP TABLE IF EXISTS ${id(replica)};`,
            `${this.createTable(replica, state.body, state.tail)};`,
            `ALTER TABLE ${id(replica)} ADD COLUMN ${id(REPLICA_ORIGINAL)} ${state.typeText};`,
            ...indexes.map(sql => `${sql.trim().replace(/;$/, "")};`),
            `INSERT INTO ${id(replica)} (${columns}, ${id(REPLICA_ORIGINAL)}) SELECT ${columns}, ${id(state.column)} FROM ${id(state.table)};`,
        ].join("\n"));
        return replica;
    }

    async differences(state: SqliteColumn, replica: string): Promise<number> {
        const oldType = state.typeText || "BLOB";
        await this.connection.runSQL(
            `DROP TABLE IF EXISTS temp.ezm_alter_back;
             CREATE TEMP TABLE ezm_alter_back (old_value ${oldType}, back_value ${oldType});
             INSERT INTO temp.ezm_alter_back SELECT ${id(REPLICA_ORIGINAL)}, ${id(state.column)} FROM ${id(replica)};`,
        );
        try {
            const [{ n }] = await this.connection.query(`SELECT COUNT(*) AS n FROM temp.ezm_alter_back WHERE ${CHANGED}`);
            return Number(n);
        } finally {
            await this.connection.runSQL("DROP TABLE IF EXISTS temp.ezm_alter_back;");
        }
    }

    async dropReplica(_state: SqliteColumn, replica: string) {
        await this.connection.runSQL(`DROP TABLE IF EXISTS ${id(replica)};`);
    }
}
