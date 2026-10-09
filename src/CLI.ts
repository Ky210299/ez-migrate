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
import { openEditor } from "./utils";

const program = new Command();

program
  .name("ez-migrate")
  .version(Version.get(), "-v, --version")
  .description("A simple migrations CLI tool")
  .action(Status.run);

program
  .command("make <name>")
  .description("Create a new migration file")
  .option("-s, --seed", "Create a seed file instead of a migration")
  .option(
    "-e, --edit",
    "Automatically open the new file in your editor set it in $EDITOR",
  )
  .action((name, options) => {
    const { seed, edit } = options;
    const filePath = seed ? MakeSeed.run(name) : Make.run(name);
    if (edit && filePath) {
      openEditor(filePath);
    }
  });

program
  .command("seed")
  .description("Run the seed files not run yet")
  .option("-a, --all", "Run all seed files, also the ones already run")
  .option("--fake", "Record the pending seeds as run without running them")
  .action((options) => Seed.run(options));
program
  .command("baseline")
  .description("Write the schema of an existing database as the first migration and mark it as applied")
  .option("-d, --data", "Also write the current data as a seed file and mark it as run")
  .option("-n, --name <name>", "Name of the generated files", "baseline")
  .action((options) => Baseline.run(options));
program.command("down").description("Revert the last migration").action(async () => { await Down.run() });
program.command("up").description("Apply the next pending migration").action(Up.run);
program .command("init [path]") .description("Initialize migration setup") .action(Init.run);
program .command("migrate") .description("Run all pending migrations") .action(Migrate.run);
program.command("reset").description("Reset all migrations").action(Reset.run);
program.command("redo").description("Redo the last migration").action(Redo.run);
program .command("rollback") .description("Rollback the last migration batch") .action(Rollback.run);
program .command("status") .description("Show migration status") .action(Status.run);
program.command("list").description("Alias of status").action(Status.run);
program.command("version").description("Show CLI version").action(Version.run);
program.showHelpAfterError().showSuggestionAfterError();
export default program;
