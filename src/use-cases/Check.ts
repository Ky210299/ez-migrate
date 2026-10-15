import ConfigReader from "../ConfigReader";
import { checkFiles } from "../Checker";

export type CheckOptions = {
    /** Print the result as JSON, for scripts and AI agents */
    json?: boolean,
    /** Also fail on warnings */
    strict?: boolean,
}

function plural(n: number, word: string) {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Check the migration and seed files without connecting to the database:
 * secrets, DML in migrations, DDL in seeds, statements that delete data and,
 * on MySQL, migrations that are not atomic. Fails (exit code 1) on errors,
 * and on warnings with --strict. It never prints the value of a secret.
 */
export default class Check {
    private constructor() { throw new Error("Check is a static class") }

    static run(options: CheckOptions = {}) {
        const config = new ConfigReader().getConfig();
        const { files, problems } = checkFiles(config);
        const errors = problems.filter(p => p.level === "error").length;
        const warnings = problems.length - errors;
        const ok = errors === 0 && !(options.strict && warnings > 0);

        // The result is the output of the command, not a log line
        if (options.json) {
            console.log(JSON.stringify({ ok, files, errors, warnings, problems }, null, 2));
        } else {
            for (const p of problems) {
                console.log(`${p.file}${p.line != null ? `:${p.line}` : ""} ${p.level} ${p.rule}: ${p.message}`);
            }
            console.log(problems.length === 0
                ? `No problems found in ${plural(files, "file")}`
                : `${plural(errors, "error")} and ${plural(warnings, "warning")} in ${plural(files, "file")}`);
        }
        if (!ok) process.exitCode = 1;
    }
}
