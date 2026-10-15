import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitStatements, stripComments } from "./sql";
import { nonAtomicWarning } from "./MigrationExecutor";
import SchemasHandler from "./SchemasHandler";
import SeedHandler from "./SeedHandler";
import type { Config } from "./types";

export type ProblemLevel = "error" | "warning";

export interface Problem {
    /** Path of the file, as configured (for example migrations/<file>.sql) */
    file: string;
    /** Line of the problem, when it is known */
    line?: number;
    level: ProblemLevel;
    /** Short id of the check, for scripts */
    rule: string;
    message: string;
}

/**
 * A line with this text is not checked for secrets. For values that look like
 * a secret but are not (a test key, a public example)
 */
export const ALLOW_SECRET_MARK = "ez-migrate-allow-secret";

/** Text that is almost always a real secret. Checked on every line, also comments */
const SECRETS: Array<{ name: string, regexp: RegExp }> = [
    { name: "a private key", regexp: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
    { name: "an AWS access key", regexp: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
    { name: "a GitHub token", regexp: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})/ },
    { name: "a Slack token", regexp: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
    { name: "a Stripe live key", regexp: /\b[sr]k_live_[A-Za-z0-9]{16,}/ },
    { name: "a Google API key", regexp: /\bAIza[0-9A-Za-z_-]{35}\b/ },
    { name: "an API key (sk-...)", regexp: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}/ },
    { name: "a JSON Web Token", regexp: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
    { name: "a URL with a password", regexp: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"]+:[^\s@'"/]+@/i },
    { name: "a database user password", regexp: /\bIDENTIFIED\s+(?:WITH\s+\S+\s+)?BY\s+'[^']+'/i },
    { name: "a database user password", regexp: /\b(?:ROLE|USER)\b.*\bPASSWORD\s+'[^']+'/i },
    { name: "a database user password", regexp: /\bSET\s+PASSWORD\b.*=\s*'[^']+'/i },
];

/** Text that may be a secret: a name like password or api_key followed by a value */
const MAYBE_SECRET = /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|passw(?:or)?d|secret|token)\b["']?\s*[:=]\s*["']?[^\s"',;)]{8,}/i;

/** Statements that delete data that can't be recovered with the down section */
const DESTRUCTIVE: Array<{ name: string, regexp: RegExp }> = [
    { name: "DROP TABLE", regexp: /^DROP\s+TABLE\b/i },
    { name: "DROP DATABASE", regexp: /^DROP\s+(?:DATABASE|SCHEMA)\b/i },
    { name: "TRUNCATE", regexp: /^TRUNCATE\b/i },
    { name: "DROP COLUMN", regexp: /^ALTER\s+TABLE\b.*\bDROP\s+(?:COLUMN\b|(?!CONSTRAINT|INDEX|KEY|PRIMARY|FOREIGN|CHECK|DEFAULT|PARTITION|TRIGGER|IDENTITY|EXPRESSION|NOT\b|IF\s+EXISTS\s+(?:CONSTRAINT|INDEX))[A-Za-z_`"])/i },
];

const TABLE_NAME = String.raw`("(?:[^"]|"")*"|\`(?:[^\`]|\`\`)*\`|\[[^\]]*\]|[\w$.]+)`;

/** Table name without quotes and without the temp. / main. schema of SQLite */
function tableKey(name: string): string {
    return name.replace(/^["`[]|["`\]]$/g, "").replace(/^(?:temp|main)\./i, "").toLowerCase();
}

/**
 * True if the SQL drops a table that existed before it. Dropping a table the
 * same SQL created (a temporary table), or one that a renamed table replaces
 * (rebuilding a table, as ez-migrate alter does on SQLite), doesn't delete data.
 */
function dropsExistingTable(sql: string): boolean {
    const text = stripComments(sql);
    const names = (regexp: string) => [...text.matchAll(new RegExp(regexp, "gi"))].map(m => tableKey(m[1]));
    const replaced = new Set([
        ...names(String.raw`CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${TABLE_NAME}`),
        ...names(String.raw`ALTER\s+TABLE\s+${TABLE_NAME}\s+RENAME\s+TO\s+${TABLE_NAME}`.replace(TABLE_NAME, TABLE_NAME.replace("(", "(?:"))),
    ]);
    return names(String.raw`(?:^|;)\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?${TABLE_NAME}`).some(name => !replaced.has(name));
}

/** Secrets in the file: one problem per line, with the line number and never the value */
function findSecrets(file: string, text: string): Array<Problem> {
    const problems: Array<Problem> = [];
    text.split("\n").forEach((content, i) => {
        if (content.includes(ALLOW_SECRET_MARK)) return;
        const sure = SECRETS.find(s => s.regexp.test(content));
        if (sure != null) {
            problems.push({
                file, line: i + 1, level: "error", rule: "secret",
                message: `Looks like ${sure.name}. Don't commit secrets: create users and keys outside the migrations, or read them from env vars. If it is not a secret, add the comment ${ALLOW_SECRET_MARK} to the line`,
            });
        } else if (MAYBE_SECRET.test(content)) {
            problems.push({
                file, line: i + 1, level: "warning", rule: "possible-secret",
                message: `May have a password, token or key. If it is not a secret, add the comment ${ALLOW_SECRET_MARK} to the line`,
            });
        }
    });
    return problems;
}

/**
 * Check the migration and seed files without connecting to the database.
 * Errors are problems that make the command fail or leak secrets; warnings
 * are things to look at before running the files.
 */
export function checkFiles(config: Config): { files: number, problems: Array<Problem> } {
    const problems: Array<Problem> = [];
    const schemaHandler = new SchemasHandler({ migrationsPath: config.migrationsPath });
    const migrations = schemaHandler.getAllMigrations();
    for (const path of migrations) {
        const text = readFileSync(path, "utf8");
        problems.push(...findSecrets(path, text));
        let up: string;
        try {
            up = schemaHandler.makeMigrationFromFile(path).getDetails().up;
        } catch (err) {
            problems.push({ file: path, level: "error", rule: "format", message: err instanceof Error ? err.message : String(err) });
            continue;
        }
        const statements = splitStatements(up);
        if (schemaHandler.hasDML(up)) {
            problems.push({ file: path, level: "error", rule: "dml-in-migration", message: "The up section has DML (INSERT, UPDATE, DELETE). Migrations can't have DML: use a seed" });
        }
        for (const { name } of DESTRUCTIVE.filter(d => d.name === "DROP TABLE" ? dropsExistingTable(up) : statements.some(s => d.regexp.test(s)))) {
            problems.push({ file: path, level: "warning", rule: "destructive", message: `The up section has ${name}. The data it deletes can't be recovered with the down section` });
        }
        const notAtomic = nonAtomicWarning(config.dialect, up);
        if (notAtomic) problems.push({ file: path, level: "warning", rule: "not-atomic", message: notAtomic });
    }

    const seedHandler = new SeedHandler(config);
    const seeds = seedHandler.getSeedsFileNames();
    for (const name of seeds) {
        const path = join(config.seedsPath, name);
        const text = readFileSync(path, "utf8");
        problems.push(...findSecrets(path, text));
        if (seedHandler.hasDDL(text)) {
            problems.push({ file: path, level: "error", rule: "ddl-in-seed", message: "Has DDL (CREATE, ALTER, DROP, TRUNCATE, RENAME). Seeds can only have DML: use a migration" });
        }
    }
    return { files: migrations.length + seeds.length, problems };
}
