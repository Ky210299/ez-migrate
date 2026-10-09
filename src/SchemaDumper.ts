import type DatabaseConnector from "./DatabaseConnector";
import type { Row } from "./DatabaseConnector";
import { MIGRATIONS_DIALECTS } from "./constants";
import { SEED_TABLE_NAME, TABLE_NAME } from "./Repository";
import type { Config } from "./types";

/** Tables of ez-migrate itself. They are never exported */
const OWN_TABLES = [TABLE_NAME, SEED_TABLE_NAME];

/** A table of the database, with the tables it references by foreign key */
interface Table {
    /** Name as written in SQL (quoted if needed) */
    name: string;
    /** Name as stored in the database */
    raw: string;
    references: Array<string>;
}

export interface SchemaDump {
    /** SQL that creates the schema */
    up: string;
    /** SQL that drops the schema */
    down: string;
    /** Tables in an order where every table comes after the tables it references */
    tables: Array<Table>;
    /** Objects that are not exported, for example triggers and functions */
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

        const skipped = [
            ...(await this.query("SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()"))
                .map(r => `trigger ${r.name}`),
            ...(await this.query("SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()"))
                .map(r => `${String(r.type).toLowerCase()} ${r.name}`),
        ];

        const up = [
            // Lets tables with circular foreign keys be created
            "SET FOREIGN_KEY_CHECKS = 0;",
            ...creates,
            ...sortedViews.map(v => v.sql + ";"),
            "SET FOREIGN_KEY_CHECKS = 1;",
        ].join("\n\n");
        const down = [
            "SET FOREIGN_KEY_CHECKS = 0;",
            ...[...sortedViews].reverse().map(v => `DROP VIEW IF EXISTS ${v.name};`),
            ...[...tables].reverse().map(t => `DROP TABLE IF EXISTS ${t.name};`),
            "SET FOREIGN_KEY_CHECKS = 1;",
        ].join("\n");
        return { up, down, tables, skipped };
    }

    // --------------------------------------------------------------- Postgres

    private async dumpPostgres(): Promise<SchemaDump> {
        const [{ schema }] = await this.query("SELECT quote_ident(current_schema()) AS schema");
        const enums = await this.query(`
            SELECT quote_ident(t.typname) AS name,
                   string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder) AS labels
            FROM pg_type t
            JOIN pg_enum e ON e.enumtypid = t.oid
            JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname = current_schema()
            GROUP BY t.typname ORDER BY t.typname
        `);
        const tableRows = await this.query(`
            SELECT c.oid, quote_ident(c.relname) AS name, c.relname AS raw
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = current_schema() AND c.relkind = 'r' AND NOT c.relispartition
            ORDER BY c.relname
        `);
        const fks = await this.query(`
            SELECT conrelid::regclass::text AS t, confrelid::regclass::text AS r,
                   cl.relname AS traw, cr.relname AS rraw,
                   quote_ident(conname) AS name, pg_get_constraintdef(con.oid) AS def
            FROM pg_constraint con
            JOIN pg_class cl ON cl.oid = con.conrelid
            JOIN pg_class cr ON cr.oid = con.confrelid
            JOIN pg_namespace n ON n.oid = cl.relnamespace
            WHERE con.contype = 'f' AND n.nspname = current_schema()
            ORDER BY cl.relname, con.conname
        `);
        const tables = sortByReferences(tableRows
            .filter(row => !OWN_TABLES.includes(String(row.raw)))
            .map(row => ({
                oid: String(row.oid),
                raw: String(row.raw),
                name: String(row.name),
                references: fks.filter(fk => fk.traw === row.raw).map(fk => String(fk.rraw)),
            })));

        const creates: Array<string> = [];
        const indexes: Array<string> = [];
        for (const table of tables) {
            const columns = await this.query(`
                SELECT quote_ident(a.attname) AS name, format_type(a.atttypid, a.atttypmod) AS type,
                       a.attnotnull AS notnull, pg_get_expr(d.adbin, d.adrelid) AS def,
                       a.attidentity AS identity, a.attgenerated AS generated,
                       pg_get_serial_sequence($1, a.attname) AS seq
                FROM pg_attribute a
                LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                WHERE a.attrelid = $2::oid AND a.attnum > 0 AND NOT a.attisdropped
                ORDER BY a.attnum
            `, [table.name, table.oid]);
            const lines = columns.map(col => {
                let type = String(col.type);
                let def = col.def == null ? null : String(col.def);
                const serial: Record<string, string> = { integer: "serial", bigint: "bigserial", smallint: "smallserial" };
                if (col.identity === "" && col.seq != null && def?.startsWith("nextval(") && serial[type]) {
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
                FROM pg_constraint WHERE conrelid = $1::oid AND contype IN ('p', 'u', 'c', 'x')
                ORDER BY contype DESC, conname
            `, [table.oid]);
            for (const c of constraints) lines.push(`    CONSTRAINT ${c.name} ${c.def}`);
            creates.push(`CREATE TABLE ${table.name} (\n${lines.join(",\n")}\n);`);

            const tableIndexes = await this.query(`
                SELECT pg_get_indexdef(i.indexrelid) AS def FROM pg_index i
                WHERE i.indrelid = $1::oid
                  AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)
                ORDER BY i.indexrelid
            `, [table.oid]);
            for (const { def } of tableIndexes) indexes.push(String(def).replace(` ON ${schema}.`, " ON ") + ";");
        }

        const foreignKeys = fks
            .filter(fk => !OWN_TABLES.includes(String(fk.traw)))
            .map(fk => `ALTER TABLE ${fk.t} ADD CONSTRAINT ${fk.name} ${fk.def};`);

        const views = await this.query(`
            SELECT quote_ident(c.relname) AS name, c.relkind AS kind, pg_get_viewdef(c.oid, true) AS def
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = current_schema() AND c.relkind IN ('v', 'm')
            ORDER BY c.oid
        `);
        const viewSQL = views.map(v => {
            const kind = v.kind === "m" ? "MATERIALIZED VIEW" : "VIEW";
            return `CREATE ${kind} ${v.name} AS\n${String(v.def).trim().replace(/;$/, "")};`;
        });

        const skipped = [
            ...(await this.query(`
                SELECT t.tgname AS name FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE NOT t.tgisinternal AND n.nspname = current_schema()
            `)).map(r => `trigger ${r.name}`),
            ...(await this.query(`
                SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = current_schema()
                  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
            `)).map(r => `function ${r.name}`),
            ...(await this.query(`
                SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relkind = 'S' AND n.nspname = current_schema()
                  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a', 'i'))
            `)).map(r => `sequence ${r.name}`),
        ];

        const up = [
            ...enums.map(e => `CREATE TYPE ${e.name} AS ENUM (${e.labels});`),
            ...creates,
            ...indexes,
            ...foreignKeys,
            ...viewSQL,
        ].join("\n\n");
        const down = [
            ...[...views].reverse().map(v => `DROP ${v.kind === "m" ? "MATERIALIZED VIEW" : "VIEW"} IF EXISTS ${v.name};`),
            tables.length ? `DROP TABLE IF EXISTS ${[...tables].reverse().map(t => t.name).join(", ")};` : "",
            ...enums.map(e => `DROP TYPE IF EXISTS ${e.name};`),
        ].filter(Boolean).join("\n");
        return { up, down, tables, skipped };
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
        // sqlite_schema keeps the creation order, which is valid for the up SQL
        const created = objects.filter(o => !own(o) && o.type !== "trigger");
        const views = created.filter(o => o.type === "view");
        const up = created.map(o => `${String(o.sql).trim()};`).join("\n\n");
        const down = [
            ...[...views].reverse().map(v => `DROP VIEW IF EXISTS ${this.sqliteName(String(v.name))};`),
            ...[...tableObjects].reverse().map(t => `DROP TABLE IF EXISTS ${this.sqliteName(String(t.name))};`),
        ].join("\n");
        const skipped = objects.filter(o => o.type === "trigger" && !own(o)).map(o => `trigger ${o.name}`);
        return { up, down, tables: sortByReferences(tables), skipped };
    }

    // ------------------------------------------------------------------- Data

    /** Columns that can be inserted (generated columns excluded) and if the insert must override identity */
    private async insertableColumns(table: Table): Promise<{ columns: Array<{ raw: string, name: string }>, override: boolean, serials: Array<string> }> {
        if (this.dialect === MIGRATIONS_DIALECTS.MYSQL) {
            const rows = await this.query(`
                SELECT COLUMN_NAME AS name, EXTRA AS extra FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION
            `, [table.raw]);
            const columns = rows
                .filter(r => !/(VIRTUAL|STORED) GENERATED/i.test(String(r.extra)))
                .map(r => ({ raw: String(r.name), name: this.mysqlName(String(r.name)) }));
            return { columns, override: false, serials: [] };
        }
        if (this.dialect === MIGRATIONS_DIALECTS.POSTGRES) {
            const rows = await this.query(`
                SELECT a.attname AS raw, quote_ident(a.attname) AS name, a.attidentity AS identity,
                       a.attgenerated AS generated, pg_get_serial_sequence($1, a.attname) AS seq
                FROM pg_attribute a
                WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
                ORDER BY a.attnum
            `, [table.name]);
            const columns = rows.filter(r => r.generated !== "s").map(r => ({ raw: String(r.raw), name: String(r.name) }));
            return {
                columns,
                override: rows.some(r => r.identity === "a"),
                serials: rows.filter(r => r.seq != null).map(r => String(r.raw)),
            };
        }
        const rows = await this.query("SELECT name, hidden FROM pragma_table_xinfo(?)", [table.raw]);
        const columns = rows
            .filter(r => Number(r.hidden) === 0)
            .map(r => ({ raw: String(r.name), name: this.sqliteName(String(r.name)) }));
        return { columns, override: false, serials: [] };
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

    /** INSERT statements with all the rows of the tables, in reference order */
    async dumpData(tables: Array<Table>, batchSize = 100): Promise<{ sql: string, rows: number }> {
        const parts: Array<string> = [];
        let total = 0;
        if (this.dialect === MIGRATIONS_DIALECTS.MYSQL) parts.push("SET FOREIGN_KEY_CHECKS = 0;");
        for (const table of tables) {
            const { columns, override, serials } = await this.insertableColumns(table);
            if (columns.length === 0) continue;
            const rows = await this.query(`SELECT ${columns.map(c => c.name).join(", ")} FROM ${table.name}`);
            total += rows.length;
            for (let i = 0; i < rows.length; i += batchSize) {
                const values = rows.slice(i, i + batchSize)
                    .map(row => `(${columns.map(c => this.literal(row[c.raw])).join(", ")})`)
                    .join(",\n");
                parts.push(`INSERT INTO ${table.name} (${columns.map(c => c.name).join(", ")})${override ? " OVERRIDING SYSTEM VALUE" : ""} VALUES\n${values};`);
            }
            // Postgres doesn't move sequences when ids are inserted, so set them to the max id
            for (const column of serials) {
                const name = columns.find(c => c.raw === column)?.name ?? column;
                parts.push(`SELECT setval(pg_get_serial_sequence(${this.literal(table.name)}, ${this.literal(column)}), COALESCE(MAX(${name}), 1), MAX(${name}) IS NOT NULL) FROM ${table.name};`);
            }
        }
        if (this.dialect === MIGRATIONS_DIALECTS.MYSQL) parts.push("SET FOREIGN_KEY_CHECKS = 1;");
        return { sql: parts.join("\n\n") + "\n", rows: total };
    }
}
