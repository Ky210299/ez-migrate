import { Command } from "commander";

import Make from "./use-cases/Make";
import Help from "./use-cases/Help";
import Down from "./use-cases/Down";
import Init from "./use-cases/Init";
import List from "./use-cases/List";
import Migrate from "./use-cases/Migrate";
import Reset from "./use-cases/Reset";
import Redo from "./use-cases/Redo";
import Rollback from "./use-cases/Rollback";
import Status from "./use-cases/Status";
import Version from "./use-cases/Version";
import Up from "./use-cases/Up";
import MakeSeed from "./use-cases/MakeSeed";
import Seed from "./use-cases/Seed";

const program = new Command();

program.name("ez-migrate").description("A simple migrations CLI tool").action(Status.run);

program.command("make <name>")
    .description("Create a new migration file")
    .option("-s, --seed", "Create a seed file instead of a migration")
    .action((name, options) => {
        const { seed } = options
        if (seed) {
            MakeSeed.run(name) 
        } else Make.run(name)
    });

program.command("seed").description("Run all seeds").action(Seed.run);
program.command("down").description("Run down migration").action(Down.run);
program.command("up").description("Run up migration").action(Up.run);
program.command("init [path]").description("Initialize migration setup").action(Init.run);
program.command("list").description("List all migrations").action(List.run);
program.command("migrate").description("Run all pending migrations").action(Migrate.run);
program.command("reset").description("Reset all migrations").action(Reset.run);
program.command("redo").description("Redo the last migration").action(Redo.run);
program.command("rollback").description("Rollback the last migration batch").action(Rollback.run);
program.command("status").description("Show migration status").action(Status.run);
program.command("version").description("Show CLI version").action(Version.run);

program
    .showHelpAfterError()
    .showSuggestionAfterError();
export default program;