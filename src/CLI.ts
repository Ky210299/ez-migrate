import { Command } from "commander";

import Make from "./use-cases/Make";
import Down from "./use-cases/Down";
import Init from "./use-cases/Init";
import Migrate from "./use-cases/Migrate";
import Reset from "./use-cases/Reset";
import Redo from "./use-cases/Redo";
import Rollback from "./use-cases/Rollback";
import Status from "./use-cases/Status";
import Version from "./use-cases/Version";
import Up from "./use-cases/Up";
import MakeSeed from "./use-cases/MakeSeed";
import Seed from "./use-cases/Seed";
import Baseline from "./use-cases/Baseline";
import Check from "./use-cases/Check";
import Schema from "./use-cases/Schema";
import { openEditor } from "./utils";
import { consoleLogger, LOG_FORMATS, LOG_LEVELS } from "./Logger";
import { tracer } from "./Tracer";
import { DEFAULT_LOCK_TIMEOUT_S, lockSettings, parseLockTimeout } from "./Lock";

const program = new Command();

/** Run a command as the root span of the trace */
function traced<A extends Array<unknown>>(name: string, run: (...args: A) => unknown) {
  return (...args: A) => tracer.span(`command ${name}`, {}, async () => { await run(...args) });
}

program
  .name("ez-migrate")
  .version(Version.get(), "-v, --version")
  .description("A simple migrations CLI tool")
  .option("--log-level <level>", `Log level: ${LOG_LEVELS.join(", ")} (env EZ_MIGRATE_LOG_LEVEL)`)
  .option("--verbose", "Same as --log-level debug: logs every step with its duration")
  .option("--log-format <format>", `Log format: ${LOG_FORMATS.join(", ")} (env EZ_MIGRATE_LOG_FORMAT)`)
  .option("--trace", "Print how long each step took at the end (env EZ_MIGRATE_TRACE=1)")
  .option("--trace-file <path>", "Write the timings as a Chrome trace file, to open in https://ui.perfetto.dev (env EZ_MIGRATE_TRACE_FILE)")
  .option("--lock-timeout <seconds>", `Seconds to wait while another ez-migrate changes the same database (default ${DEFAULT_LOCK_TIMEOUT_S}, env EZ_MIGRATE_LOCK_TIMEOUT)`)
  .hook("preAction", () => {
    const { logLevel, verbose, logFormat, lockTimeout } = program.opts();
    consoleLogger.configure({ level: verbose ? "debug" : logLevel, format: logFormat });
    if (lockTimeout != null) lockSettings.timeoutMs = parseLockTimeout(lockTimeout);
  })
  .action(traced("status", Status.run));

program
  .command("make <name>")
  .description("Create a new migration file")
  .option("-s, --seed", "Create a seed file instead of a migration")
  .option(
    "-e, --edit",
    "Automatically open the new file in your editor set it in $EDITOR",
  )
  .action(traced("make", (name: string, options: { seed?: boolean, edit?: boolean }) => {
    const { seed, edit } = options;
    const filePath = seed ? MakeSeed.run(name) : Make.run(name);
    if (edit && filePath) {
      openEditor(filePath);
    }
  }));

program
  .command("seed")
  .description("Run the seed files not run yet")
  .option("-a, --all", "Run all seed files, also the ones already run")
  .option("--fake", "Record the pending seeds as run without running them")
  .option("-f, --file <path>", "Run only this SQL file, without recording it (for example a baseline data file)")
  .action(traced("seed", Seed.run));
program
  .command("baseline")
  .description("Write the schema of an existing database as the first migration and mark it as applied")
  .option("-d, --data", "Also write the current data to a file ignored by git")
  .option("--data-path <folder>", "Folder of the data file", "./ez-migrate-data")
  .option("-n, --name <name>", "Name of the generated files", "baseline")
  .action(traced("baseline", Baseline.run));
program
  .command("down")
  .description("Revert the last migration")
  .option("--dry-run", "Print the SQL that would run, without running it")
  .option("--json", "With --dry-run: print the plan as JSON")
  .option("-y, --yes", "Run without showing the plan and asking first (env EZ_MIGRATE_YES=1)")
  .action(traced("down", Down.run));
program
  .command("up")
  .description("Apply the next pending migration")
  .option("--allow-changed", "Run even if a migration file changed after it was applied")
  .option("--dry-run", "Print the SQL that would run, without running it")
  .option("--json", "With --dry-run: print the plan as JSON")
  .option("-y, --yes", "Run without showing the plan and asking first (env EZ_MIGRATE_YES=1)")
  .action(traced("up", Up.run));
program .command("init [path]") .description("Initialize migration setup") .action(traced("init", Init.run));
program
  .command("migrate")
  .description("Run all pending migrations")
  .option("--allow-changed", "Run even if a migration file changed after it was applied")
  .option("--dry-run", "Print the SQL that would run, without running it")
  .option("--json", "With --dry-run: print the plan as JSON")
  .option("-y, --yes", "Run without showing the plan and asking first (env EZ_MIGRATE_YES=1)")
  .action(traced("migrate", Migrate.run));
program
  .command("reset")
  .description("Reset all migrations")
  .option("--dry-run", "Print the SQL that would run, without running it")
  .option("--json", "With --dry-run: print the plan as JSON")
  .option("-y, --yes", "Run without showing the plan and asking first (env EZ_MIGRATE_YES=1)")
  .action(traced("reset", Reset.run));
program
  .command("redo")
  .description("Redo the last migration")
  .option("--dry-run", "Print the SQL that would run, without running it")
  .option("--json", "With --dry-run: print the plan as JSON")
  .option("-y, --yes", "Run without showing the plan and asking first (env EZ_MIGRATE_YES=1)")
  .action(traced("redo", Redo.run));
program
  .command("rollback")
  .description("Rollback the last migration batch")
  .option("--dry-run", "Print the SQL that would run, without running it")
  .option("--json", "With --dry-run: print the plan as JSON")
  .option("-y, --yes", "Run without showing the plan and asking first (env EZ_MIGRATE_YES=1)")
  .action(traced("rollback", Rollback.run));
program.command("status").description("Show migration status").option("--json", "Print the status as JSON").action(traced("status", Status.run));
program.command("list").description("Alias of status").option("--json", "Print the status as JSON").action(traced("status", Status.run));
program
  .command("check")
  .description("Check the migration and seed files without connecting: secrets, DML in migrations, DDL in seeds, statements that delete data")
  .option("--json", "Print the result as JSON")
  .option("--strict", "Also fail on warnings")
  .action(traced("check", Check.run));
program
  .command("schema")
  .description("Print the current schema of the database as SQL (no data)")
  .option("--json", "Print the schema as JSON")
  .action(traced("schema", Schema.run));
program.command("version").description("Show CLI version").action(traced("version", Version.run));
program.showHelpAfterError().showSuggestionAfterError();
export default program;
