import type DatabaseConnector from "./DatabaseConnector";
import {
    AlterSQL, ColumnAlterer, ColumnState, EXAMPLES, PlanOptions, REPLICA_ORIGINAL, TargetType, ValueReport,
    quote, replicaName, sameLabels, show,
} from "./AlterColumn";
import { findTopLevelWord, quotedValues } from "./sql";

interface MysqlColumn extends ColumnState {
    /** Definition of the column as SHOW CREATE TABLE writes it */
    definition: string;
    /** Type part of the definition: varchar(20), enum('a','b'), int unsigned */
    typeText: string;
    /** CHARACTER SET / COLLATE after the type, if any */
    charset: string;
    /** The rest of the definition: NOT NULL, DEFAULT, COMMENT... */
    rest: string;
    /** Columns that can be inserted (generated columns can't) */
    columns: Array<string>;
}

/** Words that end the type in a column definition */
const AFTER_TYPE = [
    "CHARACTER", "CHARSET", "COLLATE", "NOT", "NULL", "DEFAULT", "AUTO_INCREMENT", "COMMENT", "GENERATED", "AS",
    "ON", "INVISIBLE", "VISIBLE", "SRID", "UNIQUE", "PRIMARY", "KEY", "STORAGE", "COLUMN_FORMAT",
    "ENGINE_ATTRIBUTE", "SECONDARY_ENGINE_ATTRIBUTE", "CHECK", "REFERENCES",
];

const STRING_TYPE = /^\s*(?:national\s+)?(?:var)?char\b|^\s*(?:tiny|medium|long)?text\b|^\s*(?:enum|set)\s*\(/i;

function id(name: string): string {
    return `\`${name.replace(/`/g, "``")}\``;
}

/** MySQL also reads \ as an escape inside strings */
function mysqlQuote(value: string): string {
    return quote(value.replace(/\\/g, "\\\\"));
}

/** True if the two values are not exactly the same text: no collation (case, trailing spaces) */
function different(a: string, b: string): string {
    const exact = (expression: string) => `CAST(CONVERT(${expression} USING utf8mb4) AS BINARY)`;
    return `NOT (${exact(a)} <=> ${exact(b)})`;
}

/** Split a column definition of SHOW CREATE TABLE in name, type, charset and the rest */
function parseDefinition(definition: string) {
    const name = /^`(?:[^`]|``)*`/.exec(definition)![0];
    const afterName = definition.slice(name.length);
    // Version comments (/*!80023 INVISIBLE */) also end the type
    const ends = [findTopLevelWord(afterName, AFTER_TYPE), afterName.indexOf("/*")].filter(i => i !== -1);
    const end = ends.length > 0 ? Math.min(...ends) : afterName.length;
    const typeText = afterName.slice(0, end).trim();
    const tail = afterName.slice(end);
    const charset = /^\s*(?:(?:CHARACTER\s+SET|CHARSET)\s+\w+\s*)?(?:COLLATE\s+\w+\s*)?/i.exec(tail)![0];
    return { typeText, charset: charset.trim(), rest: tail.slice(charset.length).trim() };
}

export default class AlterMysql implements ColumnAlterer<MysqlColumn> {
    constructor(private readonly connection: DatabaseConnector) { }

    async inspect(table: string, column: string): Promise<MysqlColumn> {
        const exists = await this.connection.query(
            "SELECT TABLE_ROWS, DATA_LENGTH + INDEX_LENGTH AS bytes FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND TABLE_TYPE = 'BASE TABLE'",
            [table],
        );
        if (exists.length === 0) throw new Error(`Table ${table} doesn't exist`);
        const created = await this.connection.query(`SHOW CREATE TABLE ${id(table)}`);
        const createSQL = String(Object.values(created[0])[1]);
        const prefix = `${id(column)} `;
        const line = createSQL.split("\n").map(l => l.trim()).find(l => l.startsWith(prefix));
        if (line == null) throw new Error(`Column ${column} doesn't exist in table ${table}`);
        const definition = line.replace(/,$/, "");
        const { typeText, charset, rest } = parseDefinition(definition);

        const columns = await this.connection.query(
            "SELECT COLUMN_NAME AS name, EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
            [table],
        );
        const foreignKeys = await this.connection.query(
            `SELECT CONSTRAINT_NAME AS name, TABLE_NAME AS child FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
               AND ((TABLE_NAME = ? AND COLUMN_NAME = ?) OR (REFERENCED_TABLE_NAME = ? AND REFERENCED_COLUMN_NAME = ?))`,
            [table, column, table, column],
        );
        const [{ n }] = await this.connection.query(`SELECT COUNT(*) AS n FROM ${id(table)}`);
        const enumLabels = /^enum\s*\(/i.test(typeText) ? quotedValues(typeText.slice(typeText.indexOf("("))) : null;
        return {
            table, column, definition, typeText, charset, rest, enumLabels,
            type: typeText,
            rows: Number(n),
            bytes: exists[0].bytes == null ? null : Number(exists[0].bytes),
            columns: columns.filter(c => !/GENERATED/i.test(String(c.extra))).map(c => String(c.name)),
            blockers: foreignKeys.map(fk => `It is part of the foreign key ${fk.name} (table ${fk.child}). Drop the foreign key in a migration first, and create it again after`),
        };
    }

    isSameType(state: MysqlColumn, target: TargetType): boolean {
        if (target.kind === "enum") return sameLabels(state.enumLabels, target.labels);
        return state.typeText.replace(/\s+/g, " ").toLowerCase() === target.sql.replace(/\s+/g, " ").toLowerCase();
    }

    /** Type of the target, with the charset of the column when both are text */
    private targetType(state: MysqlColumn, target: TargetType): string {
        const type = target.kind === "enum" ? `enum(${target.labels.map(mysqlQuote).join(",")})` : target.sql;
        return STRING_TYPE.test(type) && state.charset ? `${type} ${state.charset}` : type;
    }

    private oldType(state: MysqlColumn): string {
        return state.charset ? `${state.typeText} ${state.charset}` : state.typeText;
    }

    plan(state: MysqlColumn, target: TargetType, options: PlanOptions): AlterSQL {
        const newType = this.targetType(state, target);
        const oldType = this.oldType(state);
        const newDefinition = [id(state.column), newType, state.rest].filter(Boolean).join(" ");
        return {
            up: this.change(state, oldType, newType, newDefinition, options.guard),
            down: this.change(state, newType, oldType, state.definition, true),
        };
    }

    /**
     * Strict mode makes MySQL fail instead of cutting a value. The guard
     * converts every value to the new type and back in temporary tables and
     * compares it with the original: the CHECK fails if one is not the same,
     * before the ALTER. Temporary tables and SET don't commit, so a failed
     * check changes nothing.
     */
    private change(state: MysqlColumn, fromType: string, toType: string, definition: string, guard: boolean): string {
        const table = id(state.table);
        const column = id(state.column);
        const lines = [
            "-- Generated by ez-migrate alter. Strict mode: MySQL fails instead of cutting values",
            "SET @ezm_sql_mode = @@SESSION.sql_mode;",
            "SET SESSION sql_mode = CONCAT_WS(',', NULLIF(@@SESSION.sql_mode, ''), 'STRICT_ALL_TABLES');",
        ];
        if (guard) {
            lines.push(
                "-- Stops here, before changing anything, if a value would not be the same after the change",
                "DROP TEMPORARY TABLE IF EXISTS ezm_alter_check, ezm_alter_back, ezm_alter_guard;",
                `CREATE TEMPORARY TABLE ezm_alter_check (old_value ${fromType}, new_value ${toType}) SELECT ${column} AS old_value, ${column} AS new_value FROM ${table};`,
                `CREATE TEMPORARY TABLE ezm_alter_back (old_value ${fromType}, back_value ${fromType}) SELECT old_value, new_value AS back_value FROM ezm_alter_check;`,
                `CREATE TEMPORARY TABLE ezm_alter_guard (changed_values BIGINT, CONSTRAINT ez_migrate_alter_values_would_change CHECK (changed_values = 0)) SELECT COUNT(*) AS changed_values FROM ezm_alter_back WHERE ${different("old_value", "back_value")};`,
                "DROP TEMPORARY TABLE ezm_alter_check, ezm_alter_back, ezm_alter_guard;",
            );
        }
        lines.push(
            `ALTER TABLE ${table} MODIFY COLUMN ${definition};`,
            "SET SESSION sql_mode = @ezm_sql_mode;",
        );
        return lines.join("\n");
    }

    async recover() {
        await this.connection.query("SET SESSION sql_mode = COALESCE(@ezm_sql_mode, @@SESSION.sql_mode)");
        await this.connection.query("DROP TEMPORARY TABLE IF EXISTS ezm_alter_check, ezm_alter_back, ezm_alter_guard");
    }

    /** Run fn without strict mode: values are cut or changed instead of failing, so all of them can be counted */
    private async withoutStrictMode<T>(fn: () => Promise<T>): Promise<T> {
        await this.connection.query("SET @ezm_sql_mode = @@SESSION.sql_mode");
        await this.connection.query("SET SESSION sql_mode = ''");
        try {
            return await fn();
        } finally {
            await this.connection.query("SET SESSION sql_mode = @ezm_sql_mode");
        }
    }

    /**
     * Convert the values to the new type and back in temporary tables, without
     * strict mode, so every value that would change is counted (strict mode
     * stops at the first one)
     */
    async analyze(state: MysqlColumn, target: TargetType): Promise<ValueReport> {
        const table = id(state.table);
        const column = id(state.column);
        const oldType = this.oldType(state);
        const valid = target.kind === "enum" ? `${column} IN (${target.labels.map(mysqlQuote).join(",")})` : "TRUE";
        const invalidRows = target.kind === "enum"
            ? await this.connection.query(
                `SELECT ${column} AS value, COUNT(*) AS n FROM ${table} WHERE ${column} IS NOT NULL AND NOT (${valid}) GROUP BY ${column} ORDER BY n DESC`,
            )
            : [];
        const changed = await this.withoutStrictMode(async () => {
            try {
                await this.connection.query("DROP TEMPORARY TABLE IF EXISTS ezm_alter_values, ezm_alter_back");
                await this.connection.query(
                    `CREATE TEMPORARY TABLE ezm_alter_values (old_value ${oldType}, new_value ${this.targetType(state, target)}) SELECT ${column} AS old_value, ${column} AS new_value FROM ${table} WHERE ${column} IS NULL OR ${valid}`,
                );
                await this.connection.query(
                    `CREATE TEMPORARY TABLE ezm_alter_back (old_value ${oldType}, new_value ${this.targetType(state, target)}, back_value ${oldType}) SELECT old_value, new_value, new_value AS back_value FROM ezm_alter_values`,
                );
                return await this.connection.query(
                    `SELECT CAST(old_value AS CHAR) AS old_value, CAST(new_value AS CHAR) AS new_value, COUNT(*) AS n FROM ezm_alter_back WHERE ${different("old_value", "back_value")} GROUP BY 1, 2 ORDER BY n DESC`,
                );
            } finally {
                await this.connection.query("DROP TEMPORARY TABLE IF EXISTS ezm_alter_values, ezm_alter_back");
            }
        });
        const invalid = invalidRows.reduce((sum, r) => sum + Number(r.n), 0);
        const changedCount = changed.reduce((sum, r) => sum + Number(r.n), 0);
        return {
            rows: state.rows,
            unchanged: state.rows - invalid - changedCount,
            changed: changedCount,
            changedExamples: changed.slice(0, EXAMPLES).map(r => ({ from: show(r.old_value), to: show(r.new_value), rows: Number(r.n) })),
            invalid,
            invalidExamples: invalidRows.slice(0, EXAMPLES).map(r => ({ from: show(r.value), to: null, rows: Number(r.n) })),
            error: null,
        };
    }

    async createReplica(state: MysqlColumn): Promise<string> {
        const replica = replicaName(state.table);
        const columns = state.columns.map(id).join(", ");
        await this.connection.query(`DROP TABLE IF EXISTS ${id(replica)}`);
        await this.connection.query(`CREATE TABLE ${id(replica)} LIKE ${id(state.table)}`);
        await this.connection.query(`ALTER TABLE ${id(replica)} ADD COLUMN ${id(REPLICA_ORIGINAL)} ${this.oldType(state)} NULL`);
        await this.connection.query(
            `INSERT INTO ${id(replica)} (${columns}, ${id(REPLICA_ORIGINAL)}) SELECT ${columns}, ${id(state.column)} FROM ${id(state.table)}`,
        );
        return replica;
    }

    async differences(state: MysqlColumn, replica: string): Promise<number> {
        const oldType = this.oldType(state);
        return this.withoutStrictMode(async () => {
            try {
                await this.connection.query("DROP TEMPORARY TABLE IF EXISTS ezm_alter_back");
                await this.connection.query(
                    `CREATE TEMPORARY TABLE ezm_alter_back (old_value ${oldType}, back_value ${oldType}) SELECT ${id(REPLICA_ORIGINAL)} AS old_value, ${id(state.column)} AS back_value FROM ${id(replica)}`,
                );
                const [{ n }] = await this.connection.query(`SELECT COUNT(*) AS n FROM ezm_alter_back WHERE ${different("old_value", "back_value")}`);
                return Number(n);
            } finally {
                await this.connection.query("DROP TEMPORARY TABLE IF EXISTS ezm_alter_back");
            }
        });
    }

    async dropReplica(_state: MysqlColumn, replica: string) {
        await this.connection.query(`DROP TABLE IF EXISTS ${id(replica)}`);
    }
}
