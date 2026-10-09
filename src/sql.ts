/**
 * Remove SQL comments (`-- ...`, `# ...` and `/* ... *\/`) without touching
 * text inside quotes, so values like 'http://x' or '-- not a comment' are kept.
 */
export function stripComments(sql: string): string {
    let out = "";
    let i = 0;
    while (i < sql.length) {
        const ch = sql[i];
        const next = sql[i + 1];
        if (ch === "'" || ch === '"' || ch === "`") {
            const end = findClosingQuote(sql, i, ch);
            out += sql.slice(i, end);
            i = end;
        } else if ((ch === "-" && next === "-") || ch === "#") {
            const end = sql.indexOf("\n", i);
            i = end === -1 ? sql.length : end;
            out += " ";
        } else if (ch === "/" && next === "*") {
            const end = sql.indexOf("*/", i + 2);
            i = end === -1 ? sql.length : end + 2;
            out += " ";
        } else {
            out += ch;
            i++;
        }
    }
    return out;
}

/** Returns the index after the closing quote. A doubled quote ('') is an escaped quote */
function findClosingQuote(sql: string, start: number, quote: string): number {
    let i = start + 1;
    while (i < sql.length) {
        if (sql[i] === "\\") {
            i += 2;
            continue;
        }
        if (sql[i] === quote) {
            if (sql[i + 1] === quote) {
                i += 2;
                continue;
            }
            return i + 1;
        }
        i++;
    }
    return sql.length;
}

/** Replaces the text inside quotes with nothing ('a; DROP x' -> ''), so checks don't look inside values */
export function stripStrings(sql: string): string {
    let out = "";
    let i = 0;
    while (i < sql.length) {
        const ch = sql[i];
        if (ch === "'" || ch === '"' || ch === "`") {
            const end = findClosingQuote(sql, i, ch);
            out += ch + ch;
            i = end;
        } else {
            out += ch;
            i++;
        }
    }
    return out;
}

/** SQL without comments and with all whitespace collapsed. Used to inspect and compare SQL, not to run it */
export function normalizeSQL(sql: string): string {
    return stripComments(sql).replace(/\s+/g, " ").trim();
}

/** True if the SQL has no statements, only comments or whitespace */
export function isEmptySQL(sql: string): boolean {
    return normalizeSQL(sql).replace(/;/g, "").trim() === "";
}
