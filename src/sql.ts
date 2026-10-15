/**
 * Index after the quoted text that starts at `start`, or null if no quoted
 * text starts there. Quoted text is a string ('...'), a quoted identifier
 * ("..." or `...`) or a PostgreSQL dollar-quoted string ($$...$$, $tag$...$tag$).
 */
function quotedEnd(sql: string, start: number): number | null {
    const ch = sql[start];
    if (ch === "'" || ch === '"' || ch === "`") return findClosingQuote(sql, start, ch);
    if (ch === "$" && !/[A-Za-z0-9_$]/.test(sql[start - 1] ?? "")) {
        const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(start, start + 64))?.[0];
        if (tag) {
            const end = sql.indexOf(tag, start + tag.length);
            return end === -1 ? sql.length : end + tag.length;
        }
    }
    return null;
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

/** Index after the comment that starts at `start`, or null if no comment starts there */
function commentEnd(sql: string, start: number): number | null {
    const ch = sql[start];
    const next = sql[start + 1];
    if ((ch === "-" && next === "-") || ch === "#") {
        const end = sql.indexOf("\n", start);
        return end === -1 ? sql.length : end;
    }
    if (ch === "/" && next === "*") {
        const end = sql.indexOf("*/", start + 2);
        return end === -1 ? sql.length : end + 2;
    }
    return null;
}

/** Characters that can start quoted text or a comment */
const SPECIAL = /['"`$#/-]/g;

/**
 * Copy the SQL, calling `quoted` for each quoted text and `comment` for each
 * comment. Plain text is copied in chunks, which keeps big data files fast.
 */
function transform(sql: string, quoted: (text: string) => string, comment: (text: string) => string): string {
    const parts: Array<string> = [];
    let i = 0;
    while (i < sql.length) {
        SPECIAL.lastIndex = i;
        const found = SPECIAL.exec(sql);
        if (found == null) break;
        const at = found.index;
        const quotedTo = quotedEnd(sql, at);
        const commentTo = quotedTo == null ? commentEnd(sql, at) : null;
        if (quotedTo == null && commentTo == null) {
            parts.push(sql.slice(i, at + 1));
            i = at + 1;
            continue;
        }
        parts.push(sql.slice(i, at));
        const to = (quotedTo ?? commentTo)!;
        parts.push(quotedTo != null ? quoted(sql.slice(at, to)) : comment(sql.slice(at, to)));
        i = to;
    }
    parts.push(sql.slice(i));
    return parts.join("");
}

/**
 * Remove SQL comments (`-- ...`, `# ...` and `/* ... *\/`) without touching
 * text inside quotes, so values like 'http://x' or '-- not a comment' are kept.
 */
export function stripComments(sql: string): string {
    return transform(sql, text => text, () => " ");
}

/** Replaces the text inside quotes with nothing ('a; DROP x' -> ''), so checks don't look inside values */
export function stripStrings(sql: string): string {
    return transform(sql, emptyQuoted, text => text);
}

function emptyQuoted(text: string): string {
    return text[0] === "$" ? "$$" : text[0] + text[0];
}

/** SQL without comments and with all whitespace collapsed. Used to inspect and compare SQL, not to run it */
export function normalizeSQL(sql: string): string {
    return stripComments(sql).replace(/\s+/g, " ").trim();
}

/** True if the SQL has no statements, only comments or whitespace */
export function isEmptySQL(sql: string): boolean {
    return normalizeSQL(sql).replace(/;/g, "").trim() === "";
}

/** Words after END that close a block not opened by BEGIN or CASE (END IF, END LOOP...) */
const END_OF_OTHER_BLOCK = new Set(["IF", "LOOP", "WHILE", "REPEAT", "FOR"]);
/** Words after BEGIN that start a transaction, not a block */
const TRANSACTION_BEGIN = new Set(["TRANSACTION", "WORK", "DEFERRED", "IMMEDIATE", "EXCLUSIVE", "ISOLATION", "READ"]);

/**
 * Statements of the SQL, without comments and with quoted text emptied, for
 * checks (never to run them). A `;` ends a statement only outside quotes,
 * parentheses and BEGIN ... END blocks, so a trigger or procedure body is one
 * statement.
 */
export function splitStatements(sql: string): Array<string> {
    // One pass for comments and quoted text: data files can have many MB
    const text = transform(sql, emptyQuoted, () => " ").replace(/\s+/g, " ");
    const statements: Array<string> = [];
    const token = /[A-Za-z_][A-Za-z0-9_$]*|[();]/g;
    const nextWord = /\s*([A-Za-z_][A-Za-z0-9_$]*|;)?/y;
    let depth = 0;
    let parens = 0;
    let start = 0;
    let match: RegExpExecArray | null;
    while ((match = token.exec(text)) != null) {
        const current = match[0];
        if (current === "(") parens++;
        else if (current === ")") parens = Math.max(0, parens - 1);
        else if (current === ";") {
            if (depth === 0 && parens === 0) {
                statements.push(text.slice(start, match.index).trim());
                start = match.index + 1;
            }
        } else if (!/[0-9$]/.test(text[match.index - 1] ?? "")) {
            const word = current.toUpperCase();
            nextWord.lastIndex = token.lastIndex;
            const following = nextWord.exec(text)!;
            const next = following[1]?.toUpperCase() ?? "";
            if (word === "CASE") depth++;
            else if (word === "BEGIN" && next !== ";" && next !== "" && !TRANSACTION_BEGIN.has(next)) depth++;
            else if (word === "END") {
                // END IF, END LOOP...: skip the word so it doesn't count as an opening
                if (END_OF_OTHER_BLOCK.has(next)) token.lastIndex += following[0].length;
                else if (depth > 0) {
                    depth--;
                    // END CASE closes the CASE counted before: skip CASE so it isn't counted again
                    if (next === "CASE") token.lastIndex += following[0].length;
                }
            }
        }
    }
    statements.push(text.slice(start).trim());
    return statements.filter(s => s !== "");
}

/** Number of statements in the SQL. See splitStatements */
export function countStatements(sql: string): number {
    return splitStatements(sql).length;
}

/** Index of the `)` that closes the `(` at `open`, skipping quoted text. -1 if it is not closed */
export function closingParen(sql: string, open: number): number {
    let depth = 0;
    let i = open;
    while (i < sql.length) {
        const quotedTo = quotedEnd(sql, i);
        if (quotedTo != null) {
            i = quotedTo;
            continue;
        }
        if (sql[i] === "(") depth++;
        else if (sql[i] === ")" && --depth === 0) return i;
        i++;
    }
    return -1;
}

/** Split the text on `separator`, only outside quotes and parentheses. Parts are not trimmed */
export function splitTopLevel(sql: string, separator: string): Array<string> {
    const parts: Array<string> = [];
    let depth = 0;
    let start = 0;
    let i = 0;
    while (i < sql.length) {
        const quotedTo = quotedEnd(sql, i);
        if (quotedTo != null) {
            i = quotedTo;
            continue;
        }
        const ch = sql[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (ch === separator && depth === 0) {
            parts.push(sql.slice(start, i));
            start = i + 1;
        }
        i++;
    }
    parts.push(sql.slice(start));
    return parts;
}

/**
 * Index of the first of `words` (upper case) that is outside quotes and
 * parentheses, as a whole word. -1 if there is none.
 */
export function findTopLevelWord(sql: string, words: Array<string>): number {
    let depth = 0;
    let i = 0;
    while (i < sql.length) {
        const quotedTo = quotedEnd(sql, i);
        if (quotedTo != null) {
            i = quotedTo;
            continue;
        }
        const ch = sql[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (depth === 0 && /[A-Za-z]/.test(ch) && !/[A-Za-z0-9_$]/.test(sql[i - 1] ?? "")) {
            const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(i, i + 64))![0];
            if (words.includes(word.toUpperCase())) return i;
            i += word.length;
            continue;
        }
        i++;
    }
    return -1;
}

/** Values of the quoted strings in the text, in order: `'a', 'it''s'` -> ["a", "it's"] */
export function quotedValues(sql: string): Array<string> {
    const values: Array<string> = [];
    transform(sql, text => {
        if (text[0] === "'") values.push(text.slice(1, -1).replace(/''/g, "'"));
        return text;
    }, text => text);
    return values;
}
