import type DatabaseConnector from "./DatabaseConnector";
import type { Row } from "./DatabaseConnector";
import { MIGRATIONS_DIALECTS } from "./constants";
import { SEED_TABLE_NAME, TABLE_NAME } from "./Repository";
import type { Config } from "./types";
import { tracer } from "./Tracer";

/** Tables of ez-migrate itself. They are never exported */
const OWN_TABLES = [TABLE_NAME, SEED_TABLE_NAME];

/** A table of the database, with the tables it references by foreign key */
interface Table {
    /** Name as written in SQL (quoted if needed) */
    name: string;
    /** Name as stored in the database */
    raw: string;
    references: Array<string>;
    /** PostgreSQL: read the rows with ONLY, because child tables (INHERITS) have their own rows */
    only?: boolean;
}

/**
 * A trigger (or a PostgreSQL rule), with the statements that turn it off while
 * the data file loads the rows, and on again after
 */
interface Trigger {
    drop: string;
    create: string;
    off: Array<string>;
    on: Array<string>;
}

/** A foreign key, so the data file can drop it while it loads rows that reference rows inserted later */
interface ForeignKey {
    /** Table with the foreign key, as stored in the database */
    from: string;
    /** Referenced table, as stored in the database */
    to: string;
    drop: string;
    add: string;
}

export interface SchemaDump {
    /** SQL that creates the schema */
    up: string;
    /** SQL that drops the schema */
    down: string;
    /** Tables with data, in an order where every table comes after the tables it references */
    tables: Array<Table>;
    triggers: Array<Trigger>;
    /** Only for PostgreSQL. MySQL and SQLite can turn foreign key checks off for the data load */
    foreignKeys: Array<ForeignKey>;
    /** Objects that are not exported */
    skipped: Array<string>;
}

/**
 * Order the tables so every table comes after the tables it references.
 * Tables in a reference cycle are added at the end, in name order.
 */
export function sortByReferences<T extends { raw: string, references: Array<string> }>(tables: Array<T>): Array<T> {
    const pending = new Map(tables.map(t => [t.raw, t]));
    const sorted: Array<T> = [];
    let progress = true;
    while (pending.size && progress) {
        progress = false;
        for (const table of [...pending.values()]) {
            const waiting = table.references.some(r => r !== table.raw && pending.has(r));
            if (!waiting) {
                sorted.push(table);
                pending.delete(table.raw);
                progress = true;
            }
        }
    }
    return [...sorted, ...pending.values()];
}

const statements = (list: Array<string>) => list.filter(Boolean).join("\n\n");

/** Reads the schema of the target database and writes it as SQL */
export default class SchemaDumper {
    private readonly connection: DatabaseConnector;
    private readonly dialect: Config["dialect"];

    constructor(connection: DatabaseConnector, dialect: Config["dialect"]) {
        this.connection = connection;
        this.dialect = dialect;
    }

    private query(sql: string, values?: Array<unknown>) {
        return this.connection.query(sql, values);
    }

    async dumpSchema(): Promise<SchemaDump> {
        switch (this.dialect) {
            case MIGRATIONS_DIALECTS.MYSQL: return this.dumpMysql();
            case MIGRATIONS_DIALECTS.POSTGRES: return this.dumpPostgres();
            case MIGRATIONS_DIALECTS.SQLITE: return this.dumpSqlite();
            default: throw new Error(`Dialect not supported: ${this.dialect}`);
        }
    }

    // ------------------------------------------------------------------ MySQL

    private mysqlName(name: string) {
        return "`" + name.replace(/`/g, "``") + "`";
    }

    /** CREATE statement of a trigger, routine or event, without DEFINER (the user may not exist in other servers) */
    private async mysqlCreate(kind: "TRIGGER" | "FUNCTION" | "PROCEDURE" | "EVENT", name: string): Promise<string | null> {
        const [row] = await this.query(`SHOW CREATE ${kind} ${this.mysqlName(name)}`);
        const column = kind === "TRIGGER" ? "SQL Original Statement" : `Create ${kind[0]}${kind.slice(1).toLowerCase()}`;
        // NULL when the user can't read the definition
        if (row?.[column] == null) return null;
        // The stored text can already end with ";", and a second one would be an empty statement
        return String(row[column]).replace(/ DEFINER=`[^`]*`@`[^`]*`/, "").trim().replace(/;+$/, "") + ";";
    }

    private async dumpMysql(): Promise<SchemaDump> {
        const [{ db }] = await this.query("SELECT DATABASE() AS db");
        const tableRows = await this.query(`
            SELECT TABLE_NAME AS name FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME
        `);
        const fks = await this.query(`
            SELECT DISTINCT TABLE_NAME AS t, REFERENCED_TABLE_NAME AS r FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
        `);
        const tables = sortByReferences(tableRows
            .map(row => String(row.name))
            .filter(name => !OWN_TABLES.includes(name))
            .map(raw => ({
                raw,
                name: this.mysqlName(raw),
                references: fks.filter(fk => fk.t === raw).map(fk => String(fk.r)),
            })));

        const creates: Array<string> = [];
        for (const table of tables) {
            const [row] = await this.query(`SHOW CREATE TABLE ${table.name}`);
            // The current AUTO_INCREMENT value is data, not schema
            creates.push(String(row["Create Table"]).replace(/ AUTO_INCREMENT=\d+/, "") + ";");
        }

        const viewRows = await this.query(`
            SELECT TABLE_NAME AS name FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME
        `);
        const views: Array<{ raw: string, name: string, sql: string, references: Array<string> }> = [];
        for (const { name } of viewRows) {
            const raw = String(name);
            const [row] = await this.query(`SHOW CREATE VIEW ${this.mysqlName(raw)}`);
            const sql = String(row["Create View"])
                .replace(/ DEFINER=`[^`]*`@`[^`]*`/, "")
                .replaceAll(`${this.mysqlName(String(db))}.`, "");
            views.push({ raw, name: this.mysqlName(raw), sql, references: [] });
        }
        for (const view of views) {
            view.references = views.filter(v => v !== view && view.sql.includes(v.name)).map(v => v.raw);
        }
        const sortedViews = sortByReferences(views);

        const skipped: Array<string> = [];
        // Routines go before the views, because a view can call a function
        const routines: Array<{ kind: "FUNCTION" | "PROCEDURE", name: string, sql: string }> = [];
        for (const r of await this.query(`
            SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type FROM information_schema.ROUTINES
            WHERE ROUTINE_SCHEMA = DATABASE() ORDER BY ROUTINE_TYPE, ROUTINE_NAME
        `)) {
            const kind = String(r.type) as "FUNCTION" | "PROCEDURE";
            const sql = await this.mysqlCreate(kind, String(r.name));
            if (sql == null) skipped.push(`${kind.toLowerCase()} ${r.name} (no permission to read it)`);
            else routines.push({ kind, name: this.mysqlName(String(r.name)), sql });
        }
        const triggers: Array<Trigger> = [];
        for (const t of await this.query(`
            SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS
            WHERE TRIGGER_SCHEMA = DATABASE() ORDER BY EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION, ACTION_ORDER
        `)) {
            const sql = await this.mysqlCreate("TRIGGER", String(t.name));
            if (sql == null) skipped.push(`trigger ${t.name} (no permission to read it)`);
            else {
                const drop = `DROP TRIGGER IF EXISTS ${this.mysqlName(String(t.name))};`;
                // MySQL can't turn a trigger off, so it is dropped and created again
                triggers.push({ drop, create: sql, off: [drop], on: [sql] });
            }
        }
        const events: Array<{ name: string, sql: string }> = [];
        for (const e of await this.query("SELECT EVENT_NAME AS name FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE() ORDER BY EVENT_NAME")) {
            const sql = await this.mysqlCreate("EVENT", String(e.name));
            if (sql == null) skipped.push(`event ${e.name} (no permission to read it)`);
            else events.push({ name: this.mysqlName(String(e.name)), sql });
        }

        const up = statements([
            // Lets tables with circular foreign keys be created
            "SET FOREIGN_KEY_CHECKS = 0;",
            ...creates,
            ...routines.map(r => r.sql),
            ...sortedViews.map(v => v.sql + ";"),
            ...triggers.map(t => t.create),
            ...events.map(e => e.sql),
            "SET FOREIGN_KEY_CHECKS = 1;",
        ]);
        const down = [
            "SET FOREIGN_KEY_CHECKS = 0;",
            ...events.map(e => `DROP EVENT IF EXISTS ${e.name};`),
            ...triggers.map(t => t.drop),
            ...[...sortedViews].reverse().map(v => `DROP VIEW IF EXISTS ${v.name};`),
            ...routines.map(r => `DROP ${r.kind} IF EXISTS ${r.name};`),
            ...[...tables].reverse().map(t => `DROP TABLE IF EXISTS ${t.name};`),
            "SET FOREIGN_KEY_CHECKS = 1;",
        ].join("\n");
        return { up, down, tables, triggers, foreignKeys: [], skipped };
    }

    // --------------------------------------------------------------- Postgres

    /** Objects that belong to an extension are created by the extension, so they are not exported */
    private static readonly NOT_FROM_EXTENSION = (oid: string) =>
        `NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = ${oid} AND d.deptype = 'e')`;

    private async dumpPostgres(): Promise<SchemaDump> {
        const notFromExtension = SchemaDumper.NOT_FROM_EXTENSION;
        const [{ schema }] = await this.query("SELECT quote_ident(current_schema()) AS schema");
        // Objects are created in the current schema of the target, so the schema name is removed
        const schemaPrefix = new RegExp(`(?<![\\w$"])${String(schema).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`, "g");
        const qualified = (sql: string) => sql.replace(schemaPrefix, "");

        const extensions = await this.query(`
            SELECT quote_ident(extname) AS name FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY extname
        `);
        const enums = await this.query(`
            SELECT quote_ident(t.typname) AS name,
                   string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder) AS labels
            FROM pg_type t
            JOIN pg_enum e ON e.enumtypid = t.oid
            JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname = current_schema() AND ${notFromExtension("t.oid")}
            GROUP BY t.oid, t.typname ORDER BY t.typname
        `);
        const domains = await this.query(`
            SELECT quote_ident(t.typname) AS name, format_type(t.typbasetype, t.typtypmod) AS base,
                   t.typnotnull AS notnull, t.typdefault AS def,
                   (SELECT string_agg('CONSTRAINT ' || quote_ident(c.conname) || ' ' || pg_get_constraintdef(c.oid), ' ' ORDER BY c.conname)
                    FROM pg_constraint c WHERE c.contypid = t.oid) AS checks
            FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE t.typtype = 'd' AND n.nspname = current_schema() AND ${notFromExtension("t.oid")}
            ORDER BY t.typname
        `);
        const composites = await this.query(`
            SELECT quote_ident(t.typname) AS name,
                   (SELECT string_agg(quote_ident(a.attname) || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
                    FROM pg_attribute a WHERE a.attrelid = t.typrelid AND a.attnum > 0 AND NOT a.attisdropped) AS columns
            FROM pg_type t JOIN pg_class c ON c.oid = t.typrelid JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE t.typtype = 'c' AND c.relkind = 'c' AND n.nspname = current_schema() AND ${notFromExtension("t.oid")}
            ORDER BY t.typname
        `);

        // Partitioned tables (relkind p) are created with their partitions after them
        const tableRows = await this.query(`
            SELECT c.oid, quote_ident(c.relname) AS name, c.relname AS raw, c.relkind AS kind,
                   c.relispartition AS partition,
                   CASE WHEN c.relkind = 'p' THEN pg_get_partkeydef(c.oid) END AS partkey,
                   CASE WHEN c.relispartition THEN (SELECT quote_ident(p.relname) FROM pg_inherits i JOIN pg_class p ON p.oid = i.inhparent WHERE i.inhrelid = c.oid) END AS parent,
                   CASE WHEN c.relispartition THEN pg_get_expr(c.relpartbound, c.oid) END AS bound,
                   CASE WHEN NOT c.relispartition THEN (SELECT string_agg(quote_ident(p.relname), ', ' ORDER BY i.inhseqno) FROM pg_inherits i JOIN pg_class p ON p.oid = i.inhparent WHERE i.inhrelid = c.oid) END AS inherits,
                   CASE WHEN NOT c.relispartition THEN (SELECT array_to_string(array_agg(p.relname), ',') FROM pg_inherits i JOIN pg_class p ON p.oid = i.inhparent WHERE i.inhrelid = c.oid) END AS inherits_raw,
                   EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhparent = c.oid) AS has_children
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p') AND ${notFromExtension("c.oid")}
            ORDER BY c.relname
        `);
        const fks = await this.query(`
            SELECT conrelid::regclass::text AS t, cl.relname AS traw, cr.relname AS rraw,
                   quote_ident(conname) AS name, pg_get_constraintdef(con.oid) AS def
            FROM pg_constraint con
            JOIN pg_class cl ON cl.oid = con.conrelid
            JOIN pg_class cr ON cr.oid = con.confrelid
            JOIN pg_namespace n ON n.oid = cl.relnamespace
            WHERE con.contype = 'f' AND n.nspname = current_schema() AND con.conparentid = 0
            ORDER BY cl.relname, con.conname
        `);
        const allTables = sortByReferences(tableRows
            .filter(row => !OWN_TABLES.includes(String(row.raw)))
            .map(row => ({
                oid: String(row.oid),
                raw: String(row.raw),
                name: String(row.name),
                kind: String(row.kind),
                partition: row.partition === "t",
                partkey: row.partkey == null ? null : String(row.partkey),
                parent: row.parent == null ? null : String(row.parent),
                bound: row.bound == null ? null : String(row.bound),
                inherits: row.inherits == null ? null : String(row.inherits),
                only: row.kind === "r" && row.has_children === "t",
                references: [
                    // A child table (INHERITS) is created after its parents
                    ...(row.inherits_raw == null ? [] : String(row.inherits_raw).split(",")),
                    ...fks.filter(fk => fk.traw === row.raw).map(fk => String(fk.rraw)),
                    // A partition is created after its parent
                    ...(row.parent == null ? [] : [String(row.parent).replace(/^"|"$/g, "")]),
                ],
            })));

        // Sequences that a serial column creates by itself, so they are not created again
        const serialSequences = new Set<string>();
        const creates: Array<string> = [];
        const indexes: Array<string> = [];
        for (const table of allTables) {
            if (table.partition) {
                creates.push(`CREATE TABLE ${table.name} PARTITION OF ${table.parent} ${table.bound};`);
            } else {
                const columns = await this.query(`
                    SELECT quote_ident(a.attname) AS name, format_type(a.atttypid, a.atttypmod) AS type,
                           a.attnotnull AS notnull, pg_get_expr(d.adbin, d.adrelid) AS def,
                           a.attidentity AS identity, a.attgenerated AS generated,
                           pg_get_serial_sequence($1, a.attname) AS seq
                    FROM pg_attribute a
                    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                    -- Columns that only come from a parent table (INHERITS) are created by the parent
                    WHERE a.attrelid = $2::oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attislocal
                    ORDER BY a.attnum
                `, [table.name, table.oid]);
                const lines = columns.map(col => {
                    let type = qualified(String(col.type));
                    let def = col.def == null ? null : qualified(String(col.def));
                    const serial: Record<string, string> = { integer: "serial", bigint: "bigserial", smallint: "smallserial" };
                    // Only a sequence named like serial creates it (table_column_seq), else it is created on its own
                    const serialName = `${table.raw}_${String(col.name).replace(/^"|"$/g, "")}_seq`;
                    if (col.identity === "" && col.seq != null && def?.startsWith(`nextval('${serialName}'`) && serial[type]) {
                        serialSequences.add(serialName);
                        type = serial[type];
                        def = null;
                    }
                    let line = `    ${col.name} ${type}`;
                    if (col.generated === "s") line += ` GENERATED ALWAYS AS (${def}) STORED`;
                    else if (col.identity === "a") line += " GENERATED ALWAYS AS IDENTITY";
                    else if (col.identity === "d") line += " GENERATED BY DEFAULT AS IDENTITY";
                    else if (def != null) line += ` DEFAULT ${def}`;
                    if (col.notnull === "t" && !type.endsWith("serial")) line += " NOT NULL";
                    return line;
                });
                const constraints = await this.query(`
                    SELECT quote_ident(conname) AS name, pg_get_constraintdef(oid) AS def
                    FROM pg_constraint WHERE conrelid = $1::oid AND contype IN ('p', 'u', 'c', 'x') AND conparentid = 0 AND conislocal
                    ORDER BY contype DESC, conname
                `, [table.oid]);
                for (const c of constraints) lines.push(`    CONSTRAINT ${c.name} ${qualified(String(c.def))}`);
                const inherits = table.inherits ? ` INHERITS (${table.inherits})` : "";
                const partitionBy = table.partkey ? ` PARTITION BY ${table.partkey}` : "";
                creates.push(`CREATE TABLE ${table.name} (\n${lines.join(",\n")}\n)${inherits}${partitionBy};`);
            }

            // Indexes of a partition that come from an index of its parent are created with it
            const tableIndexes = await this.query(`
                SELECT pg_get_indexdef(i.indexrelid) AS def FROM pg_index i
                WHERE i.indrelid = $1::oid
                  AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)
                  AND NOT EXISTS (SELECT 1 FROM pg_inherits h WHERE h.inhrelid = i.indexrelid)
                ORDER BY i.indexrelid
            `, [table.oid]);
            // The index of a partitioned table comes as "ON ONLY", which doesn't create it on the partitions
            for (const { def } of tableIndexes) indexes.push(qualified(String(def).replace(" ON ONLY ", " ON ")) + ";");
        }

        // Sequences that are not created by a serial or identity column
        const sequences = (await this.query(`
            SELECT c.relname AS raw, quote_ident(c.relname) AS name, format_type(s.seqtypid, NULL) AS type,
                   s.seqincrement AS increment, s.seqmin AS min, s.seqmax AS max, s.seqstart AS start,
                   s.seqcache AS cache, s.seqcycle AS cycle,
                   (SELECT quote_ident(t.relname) || '.' || quote_ident(a.attname)
                    FROM pg_depend d JOIN pg_class t ON t.oid = d.refobjid
                    JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
                    WHERE d.objid = c.oid AND d.deptype = 'a' AND d.classid = 'pg_class'::regclass) AS owner
            FROM pg_class c JOIN pg_sequence s ON s.seqrelid = c.oid JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'S' AND n.nspname = current_schema() AND ${notFromExtension("c.oid")}
              AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'i')
            ORDER BY c.relname
        `)).filter(s => !serialSequences.has(String(s.raw)));
        const sequenceSQL = sequences.map(s =>
            `CREATE SEQUENCE ${s.name} AS ${s.type} INCREMENT BY ${s.increment} MINVALUE ${s.min} MAXVALUE ${s.max} START WITH ${s.start} CACHE ${s.cache}${s.cycle === "t" ? " CYCLE" : ""};`);
        const sequenceOwners = sequences.filter(s => s.owner != null).map(s => `ALTER SEQUENCE ${s.name} OWNED BY ${s.owner};`);

        // Functions whose arguments or result use a table type need the table, so they go after the tables
        const functionRows = await this.query(`
            SELECT p.oid, p.prokind AS kind, quote_ident(p.proname) AS name,
                   pg_get_function_identity_arguments(p.oid) AS args,
                   EXISTS (SELECT 1 FROM unnest(p.proargtypes::oid[] || p.prorettype) t(oid)
                           JOIN pg_type ty ON ty.oid = t.oid WHERE ty.typrelid <> 0
                           AND EXISTS (SELECT 1 FROM pg_class r WHERE r.oid = ty.typrelid AND r.relkind IN ('r', 'p', 'v', 'm'))) AS uses_table,
                   CASE WHEN p.prokind <> 'a' THEN pg_get_functiondef(p.oid) END AS def,
                   a.aggtransfn::regproc::text AS sfunc, format_type(a.aggtranstype, NULL) AS stype,
                   NULLIF(a.aggfinalfn::regproc::text, '-') AS finalfunc, a.agginitval AS initcond
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            LEFT JOIN pg_aggregate a ON a.aggfnoid = p.oid
            WHERE n.nspname = current_schema() AND ${notFromExtension("p.oid")}
            ORDER BY p.prokind DESC, p.proname, p.oid
        `);
        const functions = functionRows.map(f => {
            const kind = f.kind === "a" ? "AGGREGATE" : f.kind === "p" ? "PROCEDURE" : "FUNCTION";
            let sql: string;
            if (f.kind === "a") {
                const options = [`SFUNC = ${f.sfunc}`, `STYPE = ${f.stype}`];
                if (f.finalfunc) options.push(`FINALFUNC = ${f.finalfunc}`);
                if (f.initcond != null) options.push(`INITCOND = ${this.literal(f.initcond)}`);
                sql = `CREATE AGGREGATE ${f.name}(${f.args}) (${options.map(o => qualified(o)).join(", ")});`;
            } else {
                sql = qualified(String(f.def).trim()) + ";";
            }
            return { sql, drop: `DROP ${kind} IF EXISTS ${f.name}(${f.args});`, usesTable: f.uses_table === "t", aggregate: f.kind === "a" };
        });
        // Aggregates need their functions, so they go last
        const beforeTables = functions.filter(f => !f.usesTable).sort((a, b) => Number(a.aggregate) - Number(b.aggregate));
        const afterTables = functions.filter(f => f.usesTable).sort((a, b) => Number(a.aggregate) - Number(b.aggregate));

        const foreignKeys: Array<ForeignKey> = fks
            .filter(fk => !OWN_TABLES.includes(String(fk.traw)))
            .map(fk => ({
                from: String(fk.traw),
                to: String(fk.rraw),
                drop: `ALTER TABLE ${qualified(String(fk.t))} DROP CONSTRAINT ${fk.name};`,
                add: `ALTER TABLE ${qualified(String(fk.t))} ADD CONSTRAINT ${fk.name} ${qualified(String(fk.def))};`,
            }));

        const views = await this.query(`
            SELECT quote_ident(c.relname) AS name, c.relkind AS kind, pg_get_viewdef(c.oid, true) AS def
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = current_schema() AND c.relkind IN ('v', 'm') AND ${notFromExtension("c.oid")}
            ORDER BY c.oid
        `);
        const viewSQL = views.map(v => {
            const kind = v.kind === "m" ? "MATERIALIZED VIEW" : "VIEW";
            return `CREATE ${kind} ${v.name} AS\n${qualified(String(v.def).trim().replace(/;$/, ""))};`;
        });
        const viewIndexes = await this.query(`
            SELECT pg_get_indexdef(i.indexrelid) AS def
            FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = current_schema() AND c.relkind = 'm' AND ${notFromExtension("c.oid")}
            ORDER BY i.indexrelid
        `);
        viewSQL.push(...viewIndexes.map(({ def }) => qualified(String(def)) + ";"));

        // Triggers and rules (except the ones of views). An enabled one is turned off while the data file loads
        const enabledStates: Record<string, string> = { D: "DISABLE", R: "ENABLE REPLICA", A: "ENABLE ALWAYS" };
        const triggers: Array<Trigger> = (await this.query(`
            SELECT 'TRIGGER' AS kind, quote_ident(t.tgname) AS name, quote_ident(c.relname) AS tbl, c.relname AS raw,
                   t.tgenabled AS enabled, pg_get_triggerdef(t.oid) AS def
            FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE NOT t.tgisinternal AND t.tgparentid = 0 AND n.nspname = current_schema()
            UNION ALL
            SELECT 'RULE', quote_ident(r.rulename), quote_ident(c.relname), c.relname, r.ev_enabled, pg_get_ruledef(r.oid)
            FROM pg_rewrite r JOIN pg_class c ON c.oid = r.ev_class JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE r.rulename <> '_RETURN' AND n.nspname = current_schema()
            ORDER BY 1 DESC, 4, 2
        `)).filter(t => !OWN_TABLES.includes(String(t.raw))).map(t => {
            const alter = (state: string) => `ALTER TABLE ${t.tbl} ${state} ${t.kind} ${t.name};`;
            const state = enabledStates[String(t.enabled)];
            const create = [qualified(String(t.def)).replace(/;$/, "") + ";", ...(state ? [alter(state)] : [])].join("\n");
            return {
                drop: `DROP ${t.kind} IF EXISTS ${t.name} ON ${t.tbl};`,
                create,
                off: t.enabled === "O" ? [alter("DISABLE")] : [],
                on: t.enabled === "O" ? [alter("ENABLE")] : [],
            };
        });

        const comments = (await this.query(`
            SELECT CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END
                   || ' ' || quote_ident(c.relname) AS target, c.relname AS raw, d.description AS text
            FROM pg_description d JOIN pg_class c ON c.oid = d.objoid AND d.classoid = 'pg_class'::regclass AND d.objsubid = 0
            JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema()
            UNION ALL
            SELECT 'COLUMN ' || quote_ident(c.relname) || '.' || quote_ident(a.attname), c.relname, d.description
            FROM pg_description d JOIN pg_class c ON c.oid = d.objoid AND d.classoid = 'pg_class'::regclass
            JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid
            JOIN pg_namespace n ON n.oid = c.relnamespace WHERE d.objsubid > 0 AND n.nspname = current_schema()
            UNION ALL
            SELECT CASE p.prokind WHEN 'a' THEN 'AGGREGATE' WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END
                   || ' ' || quote_ident(p.proname) || '(' || pg_get_function_identity_arguments(p.oid) || ')', NULL, d.description
            FROM pg_description d JOIN pg_proc p ON p.oid = d.objoid AND d.classoid = 'pg_proc'::regclass
            JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = current_schema() AND ${notFromExtension("p.oid")}
            UNION ALL
            SELECT CASE t.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END || ' ' || quote_ident(t.typname), NULL, d.description
            FROM pg_description d JOIN pg_type t ON t.oid = d.objoid AND d.classoid = 'pg_type'::regclass
            JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = current_schema() AND ${notFromExtension("t.oid")}
            ORDER BY 1
        `)).filter(c => !OWN_TABLES.includes(String(c.raw))).map(c => `COMMENT ON ${c.target} IS ${this.literal(c.text)};`);

        const up = statements([
            // Function bodies are checked when they run, not when they are created, so the order doesn't matter
            "SET check_function_bodies = false;",
            ...extensions.map(e => `CREATE EXTENSION IF NOT EXISTS ${e.name};`),
            ...enums.map(e => `CREATE TYPE ${e.name} AS ENUM (${e.labels});`),
            ...domains.map(d => `CREATE DOMAIN ${d.name} AS ${qualified(String(d.base))}${d.def != null ? ` DEFAULT ${qualified(String(d.def))}` : ""}${d.notnull === "t" ? " NOT NULL" : ""}${d.checks ? ` ${qualified(String(d.checks))}` : ""};`),
            ...composites.map(c => `CREATE TYPE ${c.name} AS (${qualified(String(c.columns))});`),
            ...sequenceSQL,
            ...beforeTables.map(f => f.sql),
            ...creates,
            ...sequenceOwners,
            ...indexes,
            ...foreignKeys.map(fk => fk.add),
            ...afterTables.map(f => f.sql),
            ...viewSQL,
            ...triggers.map(t => t.create),
            ...comments,
        ]);
        const topTables = allTables.filter(t => !t.partition);
        const down = [
            ...[...views].reverse().map(v => `DROP ${v.kind === "m" ? "MATERIALIZED VIEW" : "VIEW"} IF EXISTS ${v.name};`),
            // Functions that use a table type must be dropped before the table, the others after
            ...[...afterTables].reverse().map(f => f.drop),
            topTables.length ? `DROP TABLE IF EXISTS ${[...topTables].reverse().map(t => t.name).join(", ")};` : "",
            ...[...beforeTables].reverse().map(f => f.drop),
            ...sequences.map(s => `DROP SEQUENCE IF EXISTS ${s.name};`),
            ...composites.map(c => `DROP TYPE IF EXISTS ${c.name};`),
            ...domains.map(d => `DROP DOMAIN IF EXISTS ${d.name};`),
            ...enums.map(e => `DROP TYPE IF EXISTS ${e.name};`),
            // Extensions are not dropped: other schemas or databases objects may use them
        ].filter(Boolean).join("\n");
        // The rows of a partitioned table are read and inserted through the parent table
        const tables = allTables.filter(t => !t.partition).map(({ raw, name, references, only }) => ({ raw, name, references, only }));
        return { up, down, tables, triggers, foreignKeys, skipped: [] };
    }

    // ----------------------------------------------------------------- SQLite

    private sqliteName(name: string) {
        return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
    }

    private async dumpSqlite(): Promise<SchemaDump> {
        const objects = await this.query(`
            SELECT type, name, tbl_name AS tbl, sql FROM sqlite_schema
            WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
            ORDER BY rowid
        `);
        const own = (o: Row) => OWN_TABLES.includes(String(o.tbl));
        const tableObjects = objects.filter(o => o.type === "table" && !own(o));
        const tables: Array<Table> = [];
        for (const t of tableObjects) {
            const raw = String(t.name);
            const fks = await this.query("SELECT DISTINCT \"table\" AS r FROM pragma_foreign_key_list(?)", [raw]);
            tables.push({ raw, name: this.sqliteName(raw), references: fks.map(fk => String(fk.r)) });
        }
        const sorted = sortByReferences(tables);
        // sqlite_schema keeps the creation order, which is valid for the up SQL. Triggers go last
        const created = objects.filter(o => !own(o) && o.type !== "trigger");
        const views = created.filter(o => o.type === "view");
        const triggers: Array<Trigger> = objects.filter(o => o.type === "trigger" && !own(o)).map(o => {
            const drop = `DROP TRIGGER IF EXISTS ${this.sqliteName(String(o.name))};`;
            const create = `${String(o.sql).trim()};`;
            // SQLite can't turn a trigger off, so it is dropped and created again
            return { drop, create, off: [drop], on: [create] };
        });
        const up = statements([...created.map(o => `${String(o.sql).trim()};`), ...triggers.map(t => t.create)]);
        const down = [
            // Dropping a table deletes its rows, which fails if other rows still reference them. Check at the end
            "PRAGMA defer_foreign_keys = ON;",
            ...triggers.map(t => t.drop),
            ...[...views].reverse().map(v => `DROP VIEW IF EXISTS ${this.sqliteName(String(v.name))};`),
            ...[...sorted].reverse().map(t => `DROP TABLE IF EXISTS ${t.name};`),
        ].join("\n");
        return { up, down, tables: sorted, triggers, foreignKeys: [], skipped: [] };
    }

    /** Rows that break a foreign key. Only SQLite can have them: it doesn't check foreign keys unless they are turned on */
    async countForeignKeyViolations(): Promise<number> {
        if (this.dialect !== MIGRATIONS_DIALECTS.SQLITE) return 0;
        return (await this.query("PRAGMA foreign_key_check")).length;
    }

    // ------------------------------------------------------------------- Data

    /** Columns that can be inserted (generated columns excluded) and if the insert must override identity */
    private async insertableColumns(table: Table): Promise<{ columns: Array<{ raw: string, name: string }>, override: boolean }> {
        if (this.dialect === MIGRATIONS_DIALECTS.MYSQL) {
            const rows = await this.query(`
                SELECT COLUMN_NAME AS name, EXTRA AS extra FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION
            `, [table.raw]);
            const columns = rows
                .filter(r => !/(VIRTUAL|STORED) GENERATED/i.test(String(r.extra)))
                .map(r => ({ raw: String(r.name), name: this.mysqlName(String(r.name)) }));
            return { columns, override: false };
        }
        if (this.dialect === MIGRATIONS_DIALECTS.POSTGRES) {
            const rows = await this.query(`
                SELECT a.attname AS raw, quote_ident(a.attname) AS name, a.attidentity AS identity, a.attgenerated AS generated
                FROM pg_attribute a
                WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
                ORDER BY a.attnum
            `, [table.name]);
            const columns = rows.filter(r => r.generated !== "s").map(r => ({ raw: String(r.raw), name: String(r.name) }));
            return { columns, override: rows.some(r => r.identity === "a") };
        }
        const rows = await this.query("SELECT name, hidden FROM pragma_table_xinfo(?)", [table.raw]);
        const columns = rows
            .filter(r => Number(r.hidden) === 0)
            .map(r => ({ raw: String(r.name), name: this.sqliteName(String(r.name)) }));
        return { columns, override: false };
    }

    /** SQL literal of a value read with DatabaseConnector.query */
    private literal(value: unknown): string {
        if (value == null) return "NULL";
        if (typeof value === "number" || typeof value === "bigint") return String(value);
        if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
        if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString("hex")}'`;
        const text = typeof value === "object" ? JSON.stringify(value) : String(value);
        // MySQL treats backslash as an escape character in strings
        const escaped = this.dialect === MIGRATIONS_DIALECTS.MYSQL ? text.replace(/\\/g, "\\\\") : text;
        return `'${escaped.replace(/'/g, "''")}'`;
    }

    /** Statements that set every sequence to its current value, so new rows get the next ids */
    private async sequenceValues(): Promise<Array<string>> {
        if (this.dialect !== MIGRATIONS_DIALECTS.POSTGRES) return [];
        const rows = await this.query(`
            SELECT quote_ident(s.sequencename) AS name, s.last_value AS value, s.start_value AS start,
                   (SELECT quote_ident(t.relname) FROM pg_depend d JOIN pg_class t ON t.oid = d.refobjid
                    WHERE d.objid = c.oid AND d.deptype IN ('a', 'i') AND d.classid = 'pg_class'::regclass) AS tbl,
                   (SELECT a.attname FROM pg_depend d JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
                    WHERE d.objid = c.oid AND d.deptype IN ('a', 'i') AND d.classid = 'pg_class'::regclass) AS col
            FROM pg_sequences s
            JOIN pg_namespace n ON n.nspname = s.schemaname
            JOIN pg_class c ON c.relname = s.sequencename AND c.relnamespace = n.oid
            WHERE s.schemaname = current_schema() ORDER BY s.sequencename
        `);
        return rows.map(r => {
            // A sequence of a column is found from the column: its name can be different in the other database
            const sequence = r.tbl != null
                ? `pg_get_serial_sequence(${this.literal(String(r.tbl))}, ${this.literal(String(r.col))})`
                : this.literal(String(r.name));
            return r.value == null
                ? `SELECT setval(${sequence}, ${r.start}, false);`
                : `SELECT setval(${sequence}, ${r.value}, true);`;
        });
    }

    /**
     * INSERT statements with all the rows of the tables, in reference order.
     * Triggers are off while the rows are inserted, so they don't change or add rows.
     */
    async dumpData(schema: Pick<SchemaDump, "tables" | "triggers" | "foreignKeys">, batchSize = 100): Promise<{ sql: string, rows: number }> {
        const off = schema.triggers.flatMap(t => t.off);
        const on = schema.triggers.flatMap(t => t.on);
        // PostgreSQL checks each row: a foreign key to a table inserted later (a cycle) or to the same table
        // is dropped during the load and added again after, which also checks all the rows
        const order = new Map(schema.tables.map((t, i) => [t.raw, i]));
        const laterForeignKeys = schema.foreignKeys.filter(fk => (order.get(fk.to) ?? -1) >= (order.get(fk.from) ?? -1));
        const parts: Array<string> = [];
        let total = 0;
        if (this.dialect === MIGRATIONS_DIALECTS.MYSQL) {
            parts.push("SET FOREIGN_KEY_CHECKS = 0;", ...off);
            // DROP TRIGGER ends the transaction in MySQL, so the rows get their own
            if (off.length) parts.push("START TRANSACTION;");
        } else if (this.dialect === MIGRATIONS_DIALECTS.SQLITE) {
            // Rows can reference rows inserted later (cycles, or data that already broke them)
            parts.push("PRAGMA defer_foreign_keys = ON;", ...off);
        } else {
            parts.push(...off, ...laterForeignKeys.map(fk => fk.drop));
        }
        for (const table of schema.tables) {
            await tracer.span("baseline.table", { table: table.raw }, async () => {
                const { columns, override } = await this.insertableColumns(table);
                if (columns.length === 0) return;
                const rows = await this.query(`SELECT ${columns.map(c => c.name).join(", ")} FROM ${table.only ? "ONLY " : ""}${table.name}`);
                total += rows.length;
                for (let i = 0; i < rows.length; i += batchSize) {
                    const values = rows.slice(i, i + batchSize)
                        .map(row => `(${columns.map(c => this.literal(row[c.raw])).join(", ")})`)
                        .join(",\n");
                    parts.push(`INSERT INTO ${table.name} (${columns.map(c => c.name).join(", ")})${override ? " OVERRIDING SYSTEM VALUE" : ""} VALUES\n${values};`);
                }
            });
        }
        parts.push(...await this.sequenceValues(), ...laterForeignKeys.map(fk => fk.add), ...on);
        if (this.dialect === MIGRATIONS_DIALECTS.MYSQL) parts.push("SET FOREIGN_KEY_CHECKS = 1;");
        return { sql: parts.join("\n\n") + "\n", rows: total };
    }
}
