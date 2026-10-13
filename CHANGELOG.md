# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html):
`MAJOR.MINOR.PATCH`. While the version is `0.x`, a breaking change bumps MINOR.

## [Unreleased]

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
