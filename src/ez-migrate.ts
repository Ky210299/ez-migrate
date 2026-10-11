#!/usr/bin/env node
import program from "./CLI";
import { consoleLogger } from "./Logger";
import { tracer } from "./Tracer";

// node:sqlite prints an ExperimentalWarning on every run. It is noise for users of
// the CLI, so it is hidden; other warnings are still shown, through the logger
process.removeAllListeners("warning");
process.on("warning", (warning) => {
    if (warning.name === "ExperimentalWarning" && /SQLite/i.test(warning.message)) return;
    consoleLogger.warn(`${warning.name}: ${warning.message}`);
});

/** Print or write the trace if asked with --trace / --trace-file or their env vars */
function reportTrace() {
    const { trace, traceFile } = program.opts();
    const file = traceFile ?? process.env.EZ_MIGRATE_TRACE_FILE;
    if (trace || process.env.EZ_MIGRATE_TRACE === "1") process.stderr.write(tracer.summary() + "\n");
    if (file) {
        tracer.writeChromeTrace(file);
        consoleLogger.info(`Trace written to ${file}`);
    }
}

program.parseAsync(process.argv).then(reportTrace).catch(e => {
    const message = e instanceof Error ? e.message : String(e);
    if (message) consoleLogger.error(message);
    // The stack and the original database error only help when debugging
    if (e instanceof Error && consoleLogger.isEnabled("debug")) {
        consoleLogger.debug(e.stack ?? "");
        if (e.cause instanceof Error) consoleLogger.debug(`Caused by: ${e.cause.stack ?? e.cause.message}`);
    }
    try { reportTrace() } catch { /* the error above matters more */ }
    process.exitCode = 1;
})
