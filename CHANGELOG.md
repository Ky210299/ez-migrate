# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html):
`MAJOR.MINOR.PATCH`. While the version is `0.x`, a breaking change bumps MINOR.

## [Unreleased]

## [0.15.0] - 2026-10-15

### Added
- `ez-migrate alter <table> <column> <type>`: writes a migration that changes the type of a column without losing data. It converts every value to the new type and back to see which ones change, tests the migration (up and down) on a copy of the table, and writes it only if it is safe. The migration checks the values again before changing anything, so another database with other values (production) is not changed. Options: `--dry-run`, `--allow-changes`, `--skip-test`, `-y`, `-n`, `--json`.
- `enum('a','b')` as a type for `alter` on the three DBMS: native `ENUM` on MySQL, an enum type on PostgreSQL (new values at the end with `ADD VALUE`), `TEXT` with a `CHECK` on SQLite.
- SQLite: a migration section that starts with `PRAGMA foreign_keys = OFF;` runs with foreign keys off, and they are checked before commit. Needed to rebuild a table.

### Changed
- Migrations accept `INSERT INTO a (...) SELECT ... FROM b` without values: it copies rows that already exist (SQLite needs it to rebuild a table). Any other DML is still rejected.
- `not-atomic` (MySQL) only counts statements that MySQL commits on their own: `SET`, `SELECT` and temporary tables don't make a migration non atomic.
- `check`: dropping a table that the same section created or replaces with a renamed table is not `destructive`.

## [0.14.0] - 2026-10-15

### Added
- `ez-migrate check`: checks the migration and seed files without connecting to the database. Finds secrets (private keys, cloud and API keys, tokens, URLs with a password, database user passwords), DML in migrations, DDL in seeds, statements that delete data (`DROP TABLE`, `TRUNCATE`, `DROP COLUMN`...) and MySQL migrations that are not atomic. Exit code `1` on errors, `--strict` also fails on warnings. It never prints the value of a secret. A line with the comment `ez-migrate-allow-secret` is not checked for secrets.
- `ez-migrate schema`: prints the current schema of the database as SQL (the same SQL as `baseline`), without rows. Read only.
- `--json` on `status`, `check`, `schema` and `--dry-run` (`migrate`, `up`, `down`, `rollback`, `redo`, `reset`), for scripts and AI agents. `--json` without `--dry-run` fails before running anything.
- README section "Use with AI agents", with instructions to copy into `AGENTS.md` / `CLAUDE.md`.

## [0.13.1] - 2026-10-15

### Changed
- README checked against the code and made fit for the npm page:
  - Badges, a short feature list, `npx @ky210299/ez-migrate` without installing, and a quick start with a real `.env` example.
  - Fixed: with SQLite the history is in the separate file `<sqlitePath>/tracker.db`, not in the target database. With the default `sqlitePath` both `.db` files go in `./migrations`; the README now says to change it or ignore them in git.
  - Fixed: only the up section of a migration is checked for DML, and the check looks at the start of each statement.
  - Added what was missing: defaults of the `tracker` key (`mysql`, `TRACKER_*` env vars), the main `ssl` is not used for a separate tracker, `.env` doesn't replace env vars already set, missing `ez-migrate.json` uses the defaults, `$VISUAL`, confirmation also accepts `s` / `si`, `--trace` writes to stderr, `NO_COLOR`, and empty seed files are skipped.
  - Links to CHANGELOG, LICENSE and AGENTS.md are full GitHub URLs, so they work on npmjs.com.
- `package.json`: license is `MIT`, as in the LICENSE file (it said `ISC`). Added `homepage`, `bugs` and more keywords for npm search.

### Removed
- `migrations.config.json`: an old file not used by the code. It was published in the npm package.

## [0.13.0] - 2026-10-15

### Added
- Confirmation at the terminal: `migrate`, `up`, `down`, `rollback`, `redo` and `reset` show the SQL they will run and ask `Run it? [y/N]` first. Only when the input and output are a terminal and `CI` is not set: CI, deploys and scripts run as before.
- `-y, --yes`, env var `EZ_MIGRATE_YES=1` and config key `"confirm": false` to skip the question.
- `--dry-run` on `redo` and `reset`. They print the down SQL and then the up SQL.

### Changed
- `redo` checks that the migration file exists before reverting. Before, it reverted the migration and then failed, leaving it reverted.
- `reset` checks the migration files (DML) before reverting anything.

## [0.12.0] - 2026-10-15

### Added
- `baseline` exports more objects, so an existing database is copied in full:
  - All DBMS: triggers.
  - MySQL: functions, procedures and events (without `DEFINER`, so they run with any user).
  - PostgreSQL: extensions, domains, composite types, standalone sequences (with their current value), functions and aggregates, partitioned tables and partitions, table inheritance, rules, indexes of materialized views, disabled triggers, and comments.
- `baseline --data` warns when a SQLite database has rows that reference rows that don't exist.
- Tested on the Sakila (MySQL, PostgreSQL, SQLite), Pagila, Chinook (MySQL, PostgreSQL, SQLite) and Northwind sample databases: the database built from the files has the same schema and data as the original.

### Changed
- The data file of `baseline --data` loads rows exactly as they are: triggers are off while it loads, foreign keys are checked at the end (rows that reference each other in a cycle load), and sequences continue after the copied rows. Data files may turn triggers and foreign keys off and on again; other DDL is still rejected.
- SQLite: `seed --file` turns foreign keys off while it loads and checks them all at the end. A 46k row file loads in 0.6 s instead of 9 s. If a row references a row that doesn't exist, nothing is loaded and the error names the tables.
- Checks that look for DDL in seeds and DML in migrations read whole statements, so a trigger or procedure body with an `INSERT` is not taken as DML. They also ignore text inside PostgreSQL `$$` strings, and parse each file once.

### Fixed
- PostgreSQL: an index on a partitioned table is created on its partitions too.
- PostgreSQL: a column only becomes `SERIAL` when its default uses its own sequence.
- MySQL: a routine body that already ends with `;` is not exported with a second one.

## [0.11.0] - 2026-10-13

### Added
- `--dry-run` on `migrate`, `up`, `down` and `rollback`: prints the SQL that would run, in order, and runs nothing. It does the same checks as the real run. It doesn't connect to the target database or take the lock.
- MySQL: a warning before running a migration with more than one statement, because MySQL commits each DDL statement on its own and the migration can be left half applied. `--dry-run` shows the same note.

### Changed
- MySQL: when a migration with several statements fails, the error says that the statements before the error stayed applied and must be undone by hand.

## [0.10.0] - 2026-10-12

### Added
- Lock: commands that change the database wait for each other, so two servers that run `migrate` at the same time don't apply the same migration twice. MySQL uses `GET_LOCK`, PostgreSQL an advisory lock, and a SQLite tracker a `tracker.db.lock` file (a lock left by a dead process on the same host is removed). `status` and `seed --file` don't take the lock.
- Global option `--lock-timeout <seconds>` (env var `EZ_MIGRATE_LOCK_TIMEOUT`, default `60`, `0` fails at once).
- `ssl` config key (and `tracker.ssl`) for MySQL and PostgreSQL: `true` to encrypt and check the certificate, or `{ ca, cert, key, rejectUnauthorized }` with paths of the certificate files.
- `envKeys.url`: name of an env var with a connection URL (`mysql://`, `postgres://`). It reads `sslmode` / `ssl-mode`. The URL is never printed, not even in errors.
- `--allow-changed` option for `migrate` and `up`.
- Tests for the lock, SSL, connection URLs and changed migrations on every DBMS. The tests create a user that can only connect with SSL. The PostgreSQL test container uses a test-only certificate from `tests/fixtures/ssl`.

### Changed
- **Breaking:** `migrate` and `up` fail, without applying anything, if an applied migration file changed after it was applied. Before, they only applied the pending files and the change was silently lost. Put the file back, or use `--allow-changed` to run anyway.
- `reset` and `redo` run under one lock from start to end, so no other run can apply migrations between the down and the up.
- PostgreSQL: two runs creating the tracker database at the same time no longer fail.
- SQLite tracker waits up to 5 s when another process writes it, instead of failing with `database is locked`.

## [0.9.0] - 2026-10-11

### Added
- Global options for logs: `--log-level <error|warn|info|debug>`, `--verbose` (same as `debug`), `--log-format <pretty|json>`. Env vars: `EZ_MIGRATE_LOG_LEVEL`, `EZ_MIGRATE_LOG_FORMAT`.
- Traces: `--trace` prints the time of each step (connection, tracker, each migration, each SQL run). `--trace-file <path>` writes them as a Chrome trace file for https://ui.perfetto.dev. Env vars: `EZ_MIGRATE_TRACE=1`, `EZ_MIGRATE_TRACE_FILE`.
- With `--verbose`, errors also show the stack trace and the original database error.

### Changed
- Commands start about 4 times faster (about 300 ms to about 70 ms). The logger (pino with pino-pretty) started a worker thread on every run; it is replaced by a small logger without dependencies. The database drivers are loaded only for the dialect in use.
- A failed migration says which file failed: `Migration <file> (up) failed: <database error>`.
- A failed migration is reported once. Before, the database error was also logged by the connection, and the tracker rollback was logged as a warning.
- `status` prints its list directly to stdout, so it shows with any log level and format.
- The SQLite `ExperimentalWarning` of Node is no longer printed.

### Removed
- Dependencies `pino` and `pino-pretty`.

## [0.8.0] - 2026-10-11

### Changed
- `baseline --data` no longer writes the data as a seed. Seeds are committed to git, and real data (often personal data) must not be. The data now goes to `./ez-migrate-data/<timestamp>-baseline-data.sql`, a folder with its own `.gitignore`, and it is not recorded as a seed. If you used 0.7.0, move the `*-baseline-data.sql` file out of the seeds folder and out of git history.

### Added
- `baseline --data-path <folder>` sets the folder of the data file.
- `seed --file <path>` runs one SQL file from any folder, in one transaction, without recording it. Use it to load the baseline data file in another database.

## [0.7.0] - 2026-10-09

### Added
- `ez-migrate baseline` to adopt ez-migrate on an existing database. It reads the schema (tables, columns, keys, indexes, views, and PostgreSQL enums) and writes it as one migration file. The migration is marked as applied without running it, because the database already has that schema. Running `migrate` on an empty database then creates the same schema.
- `baseline --data` also writes the current rows as one seed file (`INSERT` statements, in foreign key order) and marks it as run. On PostgreSQL the seed also moves the `serial` and identity sequences to the max id.
- `baseline --name <name>` sets the file name (default `baseline`).
- Triggers, functions, procedures and standalone sequences are not exported. `baseline` lists them so you can add them by hand.

### Fixed
- The DDL check of seeds and the DML check of migrations no longer look inside quoted values. A seed with `INSERT INTO t VALUES ('drop table')` was rejected.

### Changed
- The TypeScript build targets ES2022 (Node 22 is already required).

## [0.6.0] - 2026-10-09

### Added
- Seeds are recorded in a new tracker table `ez_seed`. `seed` runs only the seed files not run yet, so it is safe to run on every deploy.
- `seed --all` runs every seed file again.
- `seed --fake` records the pending seeds as run without running them (for data that is already in the database).
- `status` also lists the seed files: `✔` run, `✘` pending.

### Changed
- **Upgrade note:** `seed` no longer runs files that already ran. The first `seed` after upgrading runs every file once more, because no seed is recorded yet. If your seeds already ran, run `ez-migrate seed --fake` once after upgrading.
- New migration and seed files are named `YYYYMMDDHHmmssSSS-name.sql` (UTC). The old names had `:`, which Windows does not allow. Old files keep working and still run first, because the new names sort after them.

## [0.5.0] - 2026-10-09

### Added
- GitHub Actions workflow `release.yml`: runs the tests and publishes to npm with trusted publishing (no npm token stored). It starts when a tag `vX.Y.Z` is pushed, or by hand from the Actions tab, which also creates the tag.
- Integration tests (Vitest) for every command on MySQL, PostgreSQL and SQLite, plus a target and tracker on different DBMS.
- `docker-compose.yml` with MySQL 8.4 and PostgreSQL 16 for the tests (`pnpm run db:up`).
- GitHub Actions workflow that runs lint and tests on every push and pull request.
- `ez-migrate version` and `ez-migrate --version` print the package version.
- `migrate` and `up` apply every migration file that is not tracked, also a file with an older name added later (for example after merging a branch).
- `list` is an alias of `status` (it did nothing before).
- `CHANGELOG.md` and the README section "Advantages, disadvantages and use cases".

### Changed
- `init` writes a config without `tracker`, so migrations are tracked in the target database by default. Before, it pointed the tracker to `TRACKER_*` env vars that were usually not set.
- `init [path]` takes a directory and creates `<path>/ez-migrate.json` (before it used `path` as the file name).
- SQLite target: the database file is the value of the `database` env var (for example `DB_NAME=./app.db`). Without it, `<sqlitePath>/database.db` is used.
- Migration and seed SQL is sent to the database as written. Comments are removed only to check for DML/DDL and to compare files in `status`.
- `rollback` and `reset` revert the migrations one by one (newest first), so the tracker always matches the database even if one `down` fails.
- The `.env` file is loaded only if it exists, without a warning.
- `AGENTS.md` moved to `.github/AGENTS.md`.
- Requires Node.js >= 22.13 (uses `node:sqlite` without flags).

### Fixed
- The CLI exited with code 0 on errors. Now it exits with code 1.
- The CLI hung for ever when a migration failed on MySQL or PostgreSQL.
- SQLite as migration target did not work: it opened the tracker folder as the database and ran only the first statement.
- The SQLite tracker failed on the second run with "Invalid Schema".
- `make --seed` failed when the seeds folder already existed.
- `seed` inserted nothing on MySQL and PostgreSQL (it added an empty statement), and the error was hidden.
- `seed` and `migrate` did not report DDL/DML validation errors with a failing exit code.
- `reset` crashed on MySQL because it closed the tracker twice.
- `down`, `rollback` and `reset` reported success when the `down` SQL failed.
- Tracker errors were swallowed and left transactions open.
- The MySQL tracker did not release connections after removing migrations and checked its schema before the database existed.
- The PostgreSQL tracker checked columns of every table in the database, so a user table with a column named `path` or `up` could break it.
- Comment markers inside quoted text (`'http://x'`, `'a--b'`, `'#tag'`) were removed from the SQL.
- `status` showed migrations as changed when only comments or spaces changed.

## [0.4.0] - 2026-05-24

### Added
- `make -e/--edit` opens the new migration or seed in `$EDITOR`.

## [0.3.5] - 2026-05-24

### Fixed
- Error when the migrations or seeds folder already existed.
- Migrations and seeds folders are created automatically.

## [0.3.0] - 2025-06-13

### Added
- PostgreSQL support for migrations and tracking.
- The MySQL tracker uses the database name set by the user.

### Fixed
- Nested configuration was not overridden by the user configuration.
- Missing `sqlitePath` in the configuration.

## [0.2.0] - 2025-05-21

### Added
- Pino logger with readable output.

## [0.1.2] - 2025-05-08

### Added
- First npm release: `make`, `migrate`, `up`, `down`, `rollback`, `reset`, `redo`, `status`, `seed` and `init` for MySQL with MySQL or SQLite tracker.

[Unreleased]: https://github.com/Ky210299/ez-migrate/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/Ky210299/ez-migrate/compare/ca28afa...v0.5.0
