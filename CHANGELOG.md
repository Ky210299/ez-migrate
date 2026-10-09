# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html):
`MAJOR.MINOR.PATCH`. While the version is `0.x`, a breaking change bumps MINOR.

## [Unreleased]

## [0.5.0] - 2026-10-09

### Added
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
