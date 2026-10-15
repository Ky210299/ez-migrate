import type DatabaseConnector from "./DatabaseConnector";
import {
    AlterSQL, ColumnAlterer, ColumnState, EXAMPLES, PlanOptions, REPLICA_ORIGINAL, TargetType, ValueExample, ValueReport,
    quote, replicaName, sameLabels, show,
} from "./AlterColumn";
import { quotedValues } from "./sql";

interface PostgresColumn extends ColumnState {
    schema: string;
    /** Table name in the catalog (without schema) */
    relname: string;
    oid: string;
    attnum: number;
    /** "schema"."table" */
    qualified: string;
    /** The enum type of the column, if it is one. Owned: no other column uses it, so it can be dropped */
    enumType: { name: string, owned: boolean } | null;
    /** Default as PostgreSQL writes it ('a'::text), and its value when it is a fixed text */
    defaultExpr: string | null;
    defaultValue: string | null;
    /** The name alter gives to a new enum type (<table>_<column>) is already used */
    enumNameTaken: boolean;
    /** Columns that can be inserted (generated columns can't) */
    columns: Array<string>;
}

/** A type before or after the change */
type PgType =
    | { kind: "enum", labels: Array<string>, name: string, owned: boolean, exists?: boolean }
    | { kind: "sql", sql: string };

function id(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
}

/** PostgreSQL names have at most 63 bytes */
function typeName(name: string): string {
    return name.slice(0, 63);
}

/** "users" or "app.users" -> the name to_regclass understands, without changing the case */
function regclassName(table: string): string {
    return table.split(".").map(id).join(".");
}

function startsWith(labels: Array<string>, prefix: Array<string>): boolean {
    return prefix.length < labels.length && prefix.every((label, i) => label === labels[i]);
}

/**
 * True if the value, converted to the new type and back to its type, is not
 * the same: 1.50 -> 2 -> 2.00 changes, 2.00 -> 2 -> 2.00 doesn't
 */
function changedCondition(column: string, conversion: string, oldType: string): string {
    return `CAST(CAST(CAST(${conversion} AS text) AS ${oldType}) AS text) IS DISTINCT FROM CAST(${column} AS text)`;
}

/** Text for RAISE: % is a placeholder and ' ends the string */
function raiseText(text: string): string {
    return text.replace(/'/g, "''").replace(/%/g, "%%");
}

export default class AlterPostgres implements ColumnAlterer<PostgresColumn> {
    private serverVersion: number | null = null;

    constructor(private readonly connection: DatabaseConnector) { }

    async inspect(table: string, column: string): Promise<PostgresColumn> {
        const [rel] = await this.connection.query(
            `SELECT n.nspname AS schema, c.relname AS name, c.oid::text AS oid FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = to_regclass($1) AND c.relkind IN ('r', 'p')`,
            [regclassName(table)],
        );
        if (rel == null) throw new Error(`Table ${table} doesn't exist`);
        const oid = String(rel.oid);
        const [attr] = await this.connection.query(
            `SELECT a.attnum, format_type(a.atttypid, a.atttypmod) AS type, t.typtype, t.typname, a.atttypid::text AS type_oid,
                    pg_get_expr(d.adbin, d.adrelid) AS default_expr
             FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
             LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
             WHERE a.attrelid = $1::oid AND a.attname = $2 AND NOT a.attisdropped AND a.attnum > 0`,
            [oid, column],
        );
        if (attr == null) throw new Error(`Column ${column} doesn't exist in table ${table}`);
        const attnum = Number(attr.attnum);

        let enumLabels: Array<string> | null = null;
        let enumType: PostgresColumn["enumType"] = null;
        if (attr.typtype === "e") {
            const labels = await this.connection.query("SELECT enumlabel FROM pg_enum WHERE enumtypid = $1::oid ORDER BY enumsortorder", [attr.type_oid]);
            enumLabels = labels.map(l => String(l.enumlabel));
            // Columns of tables, views and types that use the enum. Indexes don't count
            const [{ n }] = await this.connection.query(
                `SELECT count(*) AS n FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
                 WHERE a.atttypid = $1::oid AND NOT a.attisdropped AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'c')`,
                [attr.type_oid],
            );
            enumType = { name: String(attr.typname), owned: Number(n) === 1 };
        }
        const defaultExpr = attr.default_expr == null ? null : String(attr.default_expr);
        // Only a fixed text ('a' or 'a'::type) can be moved to the new type
        const defaultValue = defaultExpr != null && /^'(?:[^']|'')*'(?:::[\w." ]+(?:\(\d+(?:,\d+)?\))?)?$/.test(defaultExpr)
            ? quotedValues(defaultExpr)[0]
            : null;

        const views = await this.connection.query(
            `SELECT DISTINCT v.oid::regclass::text AS name FROM pg_depend d
             JOIN pg_rewrite r ON r.oid = d.objid JOIN pg_class v ON v.oid = r.ev_class
             WHERE d.classid = 'pg_rewrite'::regclass AND d.refobjid = $1::oid AND d.refobjsubid = $2::int AND v.oid <> $1::oid`,
            [oid, attnum],
        );
        const foreignKeys = await this.connection.query(
            `SELECT conname AS name, conrelid::regclass::text AS child FROM pg_constraint
             WHERE contype = 'f' AND ((conrelid = $1::oid AND $2::int2 = ANY(conkey)) OR (confrelid = $1::oid AND $2::int2 = ANY(confkey)))`,
            [oid, attnum],
        );
        const [taken] = await this.connection.query(
            "SELECT 1 AS taken FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = $1 AND t.typname = $2",
            [rel.schema, typeName(`${rel.name}_${column}`)],
        );
        const columns = await this.connection.query(
            "SELECT attname FROM pg_attribute WHERE attrelid = $1::oid AND attnum > 0 AND NOT attisdropped AND attgenerated = '' ORDER BY attnum",
            [oid],
        );
        const [size] = await this.connection.query(`SELECT count(*) AS n, pg_total_relation_size($1::oid) AS bytes FROM ${id(String(rel.schema))}.${id(String(rel.name))}`, [oid]);

        return {
            table, column, oid, attnum, enumLabels, enumType, defaultExpr, defaultValue,
            schema: String(rel.schema),
            relname: String(rel.name),
            qualified: `${id(String(rel.schema))}.${id(String(rel.name))}`,
            type: enumLabels != null ? `enum(${enumLabels.map(quote).join(",")}) (type ${attr.typname})` : String(attr.type),
            rows: Number(size.n),
            bytes: Number(size.bytes),
            enumNameTaken: taken != null,
            columns: columns.map(c => String(c.attname)),
            blockers: [
                ...views.map(v => `The view ${v.name} uses it, and PostgreSQL can't change the type of a column used by a view. Drop the view in a migration first, and create it again after`),
                ...foreignKeys.map(fk => `It is part of the foreign key ${fk.name} (table ${fk.child}). Drop the foreign key in a migration first, and create it again after`),
            ],
        };
    }

    isSameType(state: PostgresColumn, target: TargetType): boolean {
        if (target.kind === "enum") return sameLabels(state.enumLabels, target.labels);
        return state.enumLabels == null && state.type.replace(/\s+/g, " ").toLowerCase() === target.sql.replace(/\s+/g, " ").toLowerCase();
    }

    /** Type name in SQL, with its schema */
    private typeRef(state: PostgresColumn, type: PgType): string {
        return type.kind === "enum" ? `${id(state.schema)}.${id(type.name)}` : type.sql;
    }

    plan(state: PostgresColumn, target: TargetType, options: PlanOptions): AlterSQL {
        const from: PgType = state.enumType != null
            ? { kind: "enum", labels: state.enumLabels!, name: state.enumType.name, owned: state.enumType.owned }
            : { kind: "sql", sql: state.type };
        let to: PgType;
        if (target.kind === "enum") {
            // An enum type of this column only is changed in place. Otherwise a new type <table>_<column> is created
            if (from.kind === "enum" && from.owned) {
                to = { kind: "enum", labels: target.labels, name: from.name, owned: true };
            } else {
                const name = typeName(`${state.relname}_${state.column}`);
                if (state.enumNameTaken) throw new Error(`The type ${name} already exists. Drop it or rename it first`);
                to = { kind: "enum", labels: target.labels, name, owned: true };
            }
        } else {
            to = { kind: "sql", sql: target.sql };
        }
        const enumInvolved = from.kind === "enum" || to.kind === "enum";
        if (enumInvolved && state.defaultExpr != null && state.defaultValue == null) {
            throw new Error(`The default of ${state.column} (${state.defaultExpr}) is not a fixed text, so it can't be moved to the new type. Change it in a migration first`);
        }
        const upDefault = enumInvolved && state.defaultValue != null ? state.defaultValue : null;
        // The down goes back to the old type. An old enum used by other columns was not dropped, so it is used again
        const back: PgType = from.kind === "enum" ? { ...from, exists: !from.owned && from.name !== (to.kind === "enum" ? to.name : null) } : from;
        return {
            up: this.change(state, from, to, options.guard, upDefault == null ? null : (ref) => `${quote(upDefault)}::${ref}`),
            down: this.change(state, to, back, true, enumInvolved && state.defaultExpr != null ? () => state.defaultExpr! : null),
        };
    }

    /**
     * SQL that changes the column from one type to the other. PostgreSQL runs
     * a migration in a transaction, so if the guard or the ALTER fails nothing changes.
     */
    private change(
        state: PostgresColumn,
        from: PgType,
        to: PgType,
        guard: boolean,
        defaultFor: ((typeRef: string) => string) | null,
    ): string {
        const table = state.qualified;
        const column = id(state.column);
        const lines = ["-- Generated by ez-migrate alter"];
        const labels = (type: { labels: Array<string> }) => type.labels.map(quote).join(", ");

        // Only new values at the end: ADD VALUE doesn't touch the rows
        if (from.kind === "enum" && to.kind === "enum" && from.name === to.name && startsWith(to.labels, from.labels)) {
            for (const label of to.labels.slice(from.labels.length)) {
                lines.push(`ALTER TYPE ${this.typeRef(state, to)} ADD VALUE ${quote(label)};`);
            }
            return lines.join("\n");
        }

        let ref = this.typeRef(state, to);
        // Same enum type with other values: a new type replaces it, and takes its name at the end
        const swap = from.kind === "enum" && to.kind === "enum" && from.name === to.name;
        if (to.kind === "enum") {
            if (swap) {
                ref = `${id(state.schema)}.${id(typeName(`${to.name}__ezm_new`))}`;
                lines.push(`CREATE TYPE ${ref} AS ENUM (${labels(to)});`);
            } else if (!to.exists) {
                lines.push(`CREATE TYPE ${ref} AS ENUM (${labels(to)});`);
            }
        }
        // An enum is converted through text
        const conversion = from.kind === "enum" || to.kind === "enum"
            ? `CAST(CAST(${column} AS text) AS ${ref})`
            : `CAST(${column} AS ${ref})`;
        if (guard) {
            const message = `ez-migrate alter: % values of column ${raiseText(state.column)} of table ${raiseText(state.relname)} would not be the same after the change. Nothing was changed`;
            lines.push(
                "-- Stops here, before changing anything, if a value would not be the same after the change",
                "DO $ezm$",
                "DECLARE changed bigint;",
                "BEGIN",
                `    SELECT count(*) INTO changed FROM ${table} WHERE ${changedCondition(column, conversion, this.typeRef(state, from))};`,
                `    IF changed > 0 THEN RAISE EXCEPTION '${message}', changed; END IF;`,
                "END",
                "$ezm$;",
            );
        }
        if (defaultFor != null) lines.push(`ALTER TABLE ${table} ALTER COLUMN ${column} DROP DEFAULT;`);
        lines.push(`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE ${ref} USING ${conversion};`);
        if (from.kind === "enum" && from.owned) {
            lines.push(`DROP TYPE ${this.typeRef(state, from)};`);
        }
        if (swap) {
            lines.push(`ALTER TYPE ${ref} RENAME TO ${id(to.name)};`);
            ref = this.typeRef(state, to);
        }
        if (defaultFor != null) lines.push(`ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT ${defaultFor(ref)};`);
        return lines.join("\n");
    }

    private async version(): Promise<number> {
        if (this.serverVersion == null) {
            const [{ v }] = await this.connection.query("SELECT current_setting('server_version_num') AS v");
            this.serverVersion = Number(v);
        }
        return this.serverVersion;
    }

    async analyze(state: PostgresColumn, target: TargetType): Promise<ValueReport> {
        const table = state.qualified;
        const column = id(state.column);
        const text = `CAST(${column} AS text)`;
        const examples = (rows: Array<Record<string, unknown>>, withTo: boolean): Array<ValueExample> =>
            rows.slice(0, EXAMPLES).map(r => ({ from: show(r.old_value), to: withTo ? show(r.new_value) : null, rows: Number(r.n) }));
        const sum = (rows: Array<Record<string, unknown>>) => rows.reduce((total, r) => total + Number(r.n), 0);
        const report = (invalid: Array<Record<string, unknown>>, changed: Array<Record<string, unknown>>, error: string | null = null): ValueReport => ({
            rows: state.rows,
            unchanged: state.rows - sum(invalid) - sum(changed),
            changed: sum(changed),
            changedExamples: examples(changed, true),
            invalid: sum(invalid),
            invalidExamples: examples(invalid, false),
            error,
        });

        if (target.kind === "enum") {
            // A value of the enum is the same text after the change, any other text fails
            const invalid = await this.connection.query(
                `SELECT ${text} AS old_value, count(*) AS n FROM ${table} WHERE ${column} IS NOT NULL AND ${text} NOT IN (${target.labels.map(quote).join(", ")}) GROUP BY 1 ORDER BY 2 DESC`,
            );
            return report(invalid, []);
        }
        const conversion = state.enumType != null ? `CAST(${text} AS ${target.sql})` : `CAST(${column} AS ${target.sql})`;
        const oldType = this.oldTypeRef(state);
        const changedSQL = (where: string, value: string) =>
            `SELECT ${text} AS old_value, CAST(${value} AS text) AS new_value, count(*) AS n FROM ${table} WHERE ${where} GROUP BY 1, 2 ORDER BY 3 DESC`;
        try {
            return report([], await this.connection.query(changedSQL(changedCondition(column, conversion, oldType), conversion)));
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // PostgreSQL 16 can tell which texts are not valid for a type without failing
            if (await this.version() < 160000) return report([], [], message);
            const valid = `pg_input_is_valid(${text}, ${quote(target.sql)})`;
            try {
                const invalid = await this.connection.query(
                    `SELECT ${text} AS old_value, count(*) AS n FROM ${table} WHERE ${column} IS NOT NULL AND NOT ${valid} GROUP BY 1 ORDER BY 2 DESC`,
                );
                const converted = `CASE WHEN ${valid} THEN ${conversion} END`;
                const changed = await this.connection.query(changedSQL(`${valid} AND ${changedCondition(column, converted, oldType)}`, converted));
                return report(invalid, changed);
            } catch {
                return report([], [], message);
            }
        }
    }

    /** The type of the column now, in SQL */
    private oldTypeRef(state: PostgresColumn): string {
        return state.enumType != null ? `${id(state.schema)}.${id(state.enumType.name)}` : state.type;
    }

    async createReplica(state: PostgresColumn): Promise<string> {
        const replica = replicaName(state.relname);
        const qualified = `${id(state.schema)}.${id(replica)}`;
        const columns = state.columns.map(id).join(", ");
        await this.dropReplica(state, replica);
        await this.connection.query(`CREATE TABLE ${qualified} (LIKE ${state.qualified} INCLUDING ALL)`);
        await this.connection.query(`ALTER TABLE ${qualified} ADD COLUMN ${id(REPLICA_ORIGINAL)} ${this.oldTypeRef(state)}`);
        await this.connection.query(
            `INSERT INTO ${qualified} (${columns}, ${id(REPLICA_ORIGINAL)}) OVERRIDING SYSTEM VALUE SELECT ${columns}, ${id(state.column)} FROM ${state.qualified}`,
        );
        return state.schema === "public" ? replica : `${state.schema}.${replica}`;
    }

    async differences(state: PostgresColumn, replica: string): Promise<number> {
        const [{ n }] = await this.connection.query(
            `SELECT count(*) AS n FROM ${regclassName(replica)} WHERE ${changedCondition(id(REPLICA_ORIGINAL), id(state.column), this.oldTypeRef(state))}`,
        );
        return Number(n);
    }

    async dropReplica(state: PostgresColumn, replica: string) {
        const name = replica.includes(".") ? replica.slice(replica.indexOf(".") + 1) : replica;
        const schema = id(state.schema);
        await this.connection.query(`DROP TABLE IF EXISTS ${schema}.${id(name)}`);
        // Enum types the plan creates for the copy
        const type = typeName(`${name}_${state.column}`);
        await this.connection.query(`DROP TYPE IF EXISTS ${schema}.${id(typeName(`${type}__ezm_new`))}, ${schema}.${id(type)}`);
    }
}
