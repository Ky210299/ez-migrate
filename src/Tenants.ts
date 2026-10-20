import { basename, dirname, extname, join } from "node:path";
import { MIGRATIONS_DIALECTS } from "./constants";
import { connectionOptions, type ConnectionData } from "./ConnectionOptions";
import { splitStatements, stripComments } from "./sql";
import { loadEnv } from "./utils";
import type { Config, ResolvedTenant, TenantEntry } from "./types";

/** Default folder of the migrations of each tenant: ./tenants/<name> */
export const DEFAULT_TENANTS_PATH = "./tenants";

/** It is a folder name and the default schema or database name, so it is kept simple */
const TENANT_NAME = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,62}$/;

/** Commands that can run for several tenants in one call */
export const MULTI_TENANT_COMMANDS = new Set(["migrate", "status", "list", "ez-migrate"]);

/** Tenants chosen in the command line. The CLI sets them before the command runs */
export const tenantSettings = {
    /** --all-tenants */
    all: false,
    /** Every tenant of the project */
    list: [] as Array<ResolvedTenant>,
    /** The tenants the command runs for */
    selected: [] as Array<ResolvedTenant>,
};

/** True if the command runs for more than one tenant (--all-tenants, or --tenant a,b) */
export function isMultiTenantRun() {
    return tenantSettings.all || tenantSettings.selected.length > 1;
}

/** The tenant of a command that runs for one tenant (--tenant a), or undefined */
export function currentTenant(): ResolvedTenant | undefined {
    return isMultiTenantRun() ? undefined : tenantSettings.selected[0];
}

/** Config of the base project for one tenant */
export function configForTenant(config: Config, tenant: ResolvedTenant): Config {
    return { ...config, tenant };
}

function optionalString(entry: Record<string, unknown>, key: keyof TenantEntry, name: string): string | undefined {
    const value = entry[key];
    if (value == null || value === "") return undefined;
    if (typeof value !== "string") throw new Error(`Tenant ${name}: "${key}" must be a text`);
    return value;
}

/**
 * Validate a tenant of the config and fill its defaults:
 * - PostgreSQL: the schema with its name in the main database. With `database` or `url`, the default schema of that database.
 * - MySQL: the database with its name (`schema` is the same as `database`).
 * - SQLite: the file <sqlitePath>/tenants/<name>.db.
 */
export function resolveTenant(config: Config, raw: unknown): ResolvedTenant {
    if (raw == null || typeof raw !== "object") throw new Error("Each tenant must be an object with a name");
    const entry = raw as Record<string, unknown>;
    const name = entry.name;
    if (typeof name !== "string" || !TENANT_NAME.test(name)) {
        throw new Error(`Invalid tenant name ${JSON.stringify(name)}. Use letters, numbers, _ and - (up to 63)`);
    }
    const schema = optionalString(entry, "schema", name);
    const database = optionalString(entry, "database", name);
    const url = optionalString(entry, "url", name);
    const base = (config.tenants?.migrationsPath ?? DEFAULT_TENANTS_PATH).replace(/\/+$/, "");
    const migrationsPath = `${base}/${name}`;
    switch (config.dialect) {
        case MIGRATIONS_DIALECTS.SQLITE: {
            if (schema || url) throw new Error(`Tenant ${name}: SQLite has no schemas or URLs. Use "database" with the path of its file`);
            return { name, database: database ?? join(config.sqlitePath, "tenants", `${name}.db`), migrationsPath };
        }
        case MIGRATIONS_DIALECTS.MYSQL: {
            if (schema && database && schema !== database) {
                throw new Error(`Tenant ${name}: in MySQL a schema is a database. Use only "database"`);
            }
            return { name, database: database ?? schema ?? (url ? undefined : name), url, migrationsPath };
        }
        default:
            return { name, schema: schema ?? (database || url ? undefined : name), database, url, migrationsPath };
    }
}

/** Connection data of the tenant of the config, and its schema (PostgreSQL) */
export function tenantConnection(config: Config): { data: ConnectionData, schema?: string } {
    const tenant = config.tenant;
    if (tenant == null) throw new Error("No tenant selected");
    if (tenant.url) {
        loadEnv();
        // Without this check, an empty env var would use the main database
        if (!process.env[tenant.url]) throw new Error(`The env var ${tenant.url} of tenant ${tenant.name} is empty`);
    }
    const envKeys = tenant.url ? { ...config.envKeys, url: tenant.url } : config.envKeys;
    const data = connectionOptions(envKeys, config.ssl);
    if (tenant.database) data.database = tenant.database;
    if (config.dialect === MIGRATIONS_DIALECTS.MYSQL && !data.database) {
        throw new Error(`Tenant ${tenant.name} has no database. Set "database" or put it in its URL`);
    }
    return { data, schema: tenant.schema };
}

/** Text that is the same for two tenants only if they use the same database and schema */
export function tenantTarget(config: Config, tenant: ResolvedTenant): string {
    if (config.dialect === MIGRATIONS_DIALECTS.SQLITE) return join(process.cwd(), tenant.database ?? "");
    loadEnv();
    // Its env var is checked when the tenant runs, so other tenants still work
    if (tenant.url && !process.env[tenant.url]) return `env:${tenant.url}`;
    const { data, schema } = tenantConnection(configForTenant(config, tenant));
    return `${data.host ?? "localhost"}:${data.port ?? ""}/${data.database ?? ""}/${schema ?? ""}`;
}

/** File of the SQLite tracker of a tenant, next to its database: acme.db -> acme.tracker.db */
export function sqliteTrackerFile(database: string) {
    const ext = extname(database) || ".db";
    return join(dirname(database), `${basename(database, extname(database))}.tracker${ext}`);
}

// ----------------------------------------------------- Changes to other tenants

const IDENT = String.raw`(?:"(?:[^"]|"")+"|\`(?:[^\`]|\`\`)+\`|[A-Za-z_][\w$]*)`;

/** Statements that leave the tenant: they change the schema or database in use */
const LEAVES_TENANT: Array<{ regexp: RegExp, what: string }> = [
    { regexp: /^SET\s+(?:SESSION\s+|LOCAL\s+)?search_path\b/i, what: "changes the search_path" },
    { regexp: /^USE\s/i, what: "changes the database in use (USE)" },
    { regexp: /^(?:CREATE|ALTER|DROP)\s+(?:SCHEMA|DATABASE)\b/i, what: "creates, changes or drops a schema or database" },
    { regexp: /^(?:ATTACH|DETACH)\b/i, what: "attaches another database file" },
    { regexp: /\bSET\s+SCHEMA\b/i, what: "moves an object to another schema" },
];

/** Statements that change an object. The group is the schema or database before the dot */
const WRITE_TARGETS: Array<RegExp> = [
    new RegExp(String.raw`^(?:CREATE|ALTER|DROP)\s+(?:OR\s+REPLACE\s+)?(?:(?:UNIQUE|TEMP|TEMPORARY|UNLOGGED|MATERIALIZED|GLOBAL|LOCAL|RECURSIVE|CONSTRAINT|DEFINER\s*=\s*\S+|ALGORITHM\s*=\s*\w+|SQL\s+SECURITY\s+\w+)\s+)*(?:TABLE|VIEW|INDEX|SEQUENCE|TYPE|DOMAIN|FUNCTION|PROCEDURE|TRIGGER|EVENT|AGGREGATE|COLLATION|RULE|POLICY)\s+(?:CONCURRENTLY\s+)?(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(${IDENT})\s*\.\s*${IDENT}`, "i"),
    new RegExp(String.raw`^CREATE\b[\s\S]*?\bON\s+(?:ONLY\s+)?(${IDENT})\s*\.\s*${IDENT}\s*(?:\(|USING\b|FOR\b|EXECUTE\b|TO\b)`, "i"),
    new RegExp(String.raw`^TRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?(${IDENT})\s*\.`, "i"),
    new RegExp(String.raw`^INSERT\s+(?:IGNORE\s+)?INTO\s+(${IDENT})\s*\.`, "i"),
    new RegExp(String.raw`^UPDATE\s+(?:ONLY\s+)?(${IDENT})\s*\.\s*${IDENT}`, "i"),
    new RegExp(String.raw`^DELETE\s+FROM\s+(?:ONLY\s+)?(${IDENT})\s*\.`, "i"),
    new RegExp(String.raw`\bRENAME\s+(?:TABLE\s+[\s\S]*?\s+)?(?:TO|AS)\s+(${IDENT})\s*\.\s*${IDENT}`, "i"),
];

function unquote(identifier: string): string {
    if (/^["`]/.test(identifier)) return identifier.slice(1, -1).replace(/""|``/g, m => m[0]);
    return identifier.toLowerCase();
}

function escapeRegExp(text: string) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Name that qualifies the objects of a tenant: its schema (PostgreSQL) or database (MySQL) */
function qualifier(dialect: string, tenant: ResolvedTenant): string | undefined {
    if (dialect === MIGRATIONS_DIALECTS.POSTGRES) return tenant.schema;
    if (dialect === MIGRATIONS_DIALECTS.MYSQL) return tenant.database;
    return undefined;
}

/**
 * Why the SQL would change something outside its tenant, or null. A migration
 * of a tenant runs in the tenant's schema or database, so it must not:
 * - name another tenant (`beta.orders`),
 * - change an object of another schema or database (`CREATE TABLE public.x`),
 * - change the schema or database in use (search_path, USE, ATTACH).
 * Comments and text values ('acme.com') are not checked.
 */
export function crossTenantProblem(dialect: string, sql: string, tenant: ResolvedTenant, others: Array<ResolvedTenant>): string | null {
    const text = stripComments(sql).replace(/'(?:[^']|'')*'/g, "''");
    const own = qualifier(dialect, tenant);
    for (const other of others) {
        const name = qualifier(dialect, other);
        if (!name || name === own) continue;
        const reference = new RegExp(String.raw`(?<![\w$"\`.])(?:"${escapeRegExp(name)}"|\`${escapeRegExp(name)}\`|${escapeRegExp(name)})\s*\.\s*["\`A-Za-z_]`, "i");
        if (reference.test(text)) return `it uses ${name}, the ${dialect === MIGRATIONS_DIALECTS.MYSQL ? "database" : "schema"} of tenant ${other.name}`;
    }
    // A tenant in its own PostgreSQL database uses the default schema
    const ownSchema = own ?? (dialect === MIGRATIONS_DIALECTS.POSTGRES ? "public" : undefined);
    // splitStatements empties quoted names ("acme"), so they are kept as tokens while splitting
    const quoted: Array<string> = [];
    const tokens = text.replace(/"(?:[^"]|"")+"|`(?:[^`]|``)+`/g, name => `ezmq${quoted.push(name) - 1}ezmq`);
    const statements = splitStatements(tokens).map(s => s.replace(/ezmq(\d+)ezmq/g, (_, i) => quoted[Number(i)]));
    for (const statement of statements) {
        const leaves = LEAVES_TENANT.find(({ regexp }) => regexp.test(statement));
        if (leaves) return `it ${leaves.what}`;
        for (const regexp of WRITE_TARGETS) {
            const target = statement.match(regexp)?.[1];
            if (target == null) continue;
            const schema = unquote(target);
            if (ownSchema != null && schema.toLowerCase() === ownSchema.toLowerCase()) continue;
            return `it changes an object of ${schema}, outside the tenant`;
        }
    }
    return null;
}

/** Throws if the SQL of a file would change something outside the tenant of the config */
export function assertSqlOnlyChangesTenant(config: Config, what: string, sql: string) {
    const tenant = config.tenant;
    if (tenant == null) return;
    const others = tenantSettings.list.filter(t => t.name !== tenant.name);
    const problem = crossTenantProblem(config.dialect, sql, tenant, others);
    if (problem) {
        throw new Error(
            `${what} can't run for tenant ${tenant.name}: ${problem}. ` +
            "SQL of a tenant must only change its own schema or database. Nothing was run",
        );
    }
}

/** Throws if a migration of the list (up or down) would change something outside the tenant of the config */
export function assertOnlyChangesTenant(config: Config, migrations: Array<{ path: string, up: string, down: string }>) {
    for (const migration of migrations) {
        for (const direction of ["up", "down"] as const) {
            assertSqlOnlyChangesTenant(config, `Migration ${basename(migration.path)} (${direction})`, migration[direction]);
        }
    }
}
