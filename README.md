# @ky210299/ez-migrate

A small CLI to run database migrations and seeds written in plain `.sql` files.
Supports **MySQL**, **PostgreSQL** and **SQLite**.

You write the SQL. ez-migrate runs it in order, records what was applied, and can revert it.

---

## Table of contents

1. [Install](#install)
2. [Quick start](#quick-start)
3. [Migration and seed files](#migration-and-seed-files)
4. [Configuration](#configuration)
5. [Commands](#commands)
6. [Running at the same time](#running-at-the-same-time)
7. [Edited migrations](#edited-migrations)
8. [Logs and traces](#logs-and-traces)
9. [Adopt ez-migrate on an existing database](#adopt-ez-migrate-on-an-existing-database)
10. [How tracking works](#how-tracking-works)
11. [Advantages, disadvantages and use cases](#advantages-disadvantages-and-use-cases)
12. [Development and tests](#development-and-tests)
13. [Changelog](#changelog)

---

## Install

Requires Node.js 22.13 or newer.

```bash
# Global
npm install -g @ky210299/ez-migrate
ez-migrate <command>

# In a project
npm install --save-dev @ky210299/ez-migrate
npx ez-migrate <command>
```

---

## Quick start

```bash
ez-migrate init                       # creates ez-migrate.json
# edit ez-migrate.json and set the env vars (see Configuration)

ez-migrate make create_users          # creates migrations/<timestamp>-create_users.sql
# write the SQL in the file

ez-migrate migrate                    # applies all pending migrations
ez-migrate status                     # shows what is applied
ez-migrate rollback                   # reverts the last migrate
```

---

## Migration and seed files

### Migration

`ez-migrate make <name>` creates `migrations/<timestamp>-<name>.sql`:

```sql
-- ez-migration-up
CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name VARCHAR(50)
);
-- ez-migration-up
-- ez-migration-down
DROP TABLE users;
-- ez-migration-down
```

- The SQL between the two `-- ez-migration-up` lines applies the change.
- The SQL between the two `-- ez-migration-down` lines reverts it.
- Both sections are required and can have several statements.
- Files run in file name order. The timestamp prefix (`YYYYMMDDHHmmssSSS`, UTC) keeps the creation order.
- Migrations can't have DML (`INSERT`, `UPDATE`, `DELETE`). Use seeds for data.
- The SQL is sent to the database as written, so it must be valid for your DBMS.

### Seed

`ez-migrate make --seed <name>` creates `seeds/<timestamp>-<name>.sql`. Put DML in it:

```sql
INSERT INTO users (id, name) VALUES (1, 'ana');
INSERT INTO users (id, name) VALUES (2, 'bob');
```

- Seeds can't have DDL (`CREATE`, `ALTER`, `DROP`, `TRUNCATE`, `RENAME`).
- `ez-migrate seed` runs the seed files **not run yet**, in file name order, in one transaction. If one fails, nothing is inserted and nothing is recorded.
- Run seeds are recorded in the table `ez_seed`, so running `seed` again only runs new files. It is safe to run it on every deploy.
- `seed --all` runs every seed file again. Your SQL must handle data that already exists (for example `DELETE` first, or `INSERT ... ON CONFLICT DO NOTHING`).
- `seed --fake` records the pending seeds as run without running them. Use it when the data is already in the database.
- `seed --file <path>` runs only that file, from any folder, in one transaction, and doesn't record it. Use it for data that must not be in git, like the data file of `baseline --data`.

Add `-e` to `make` to open the new file in `$EDITOR`.

---

## Configuration

`ez-migrate init` creates `ez-migrate.json` in the current folder (or `ez-migrate init <folder>` in another folder). ez-migrate always reads `./ez-migrate.json` from the folder where you run it.

```json
{
    "dialect": "mysql",
    "migrationsPath": "./migrations",
    "seedsPath": "./seeds",
    "sqlitePath": "./migrations",
    "envKeys": {
        "user": "DB_USER",
        "password": "DB_PASSWORD",
        "port": "DB_PORT",
        "host": "DB_HOST",
        "database": "DB_NAME"
    }
}
```

| Key | Description | Default |
| --- | --- | --- |
| `dialect` | DBMS of the target database: `mysql`, `postgres` or `sqlite` | `mysql` |
| `migrationsPath` | Folder of the migration files | `./migrations` |
| `seedsPath` | Folder of the seed files | `./seeds` |
| `sqlitePath` | Folder of the SQLite tracker file `tracker.db` | `./migrations` |
| `envKeys` | **Names** of the env vars with the connection data of the target database | `DB_*` |
| `envKeys.url` | Optional. **Name** of an env var with a connection URL. See below | Not used |
| `ssl` | Optional. SSL for MySQL and PostgreSQL. See below | No SSL |
| `tracker` | Optional. Where to store the migrations history. See below | Same as the target |

The connection data is read from the env vars named in `envKeys`. A `.env` file in the current folder is loaded if it exists:

```dotenv
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=secret
DB_NAME=my_app
```

- If the database doesn't exist, ez-migrate creates it (the user needs permission for that).
- **SQLite:** only the `database` env var is used, and it is the path of the database file (`DB_NAME=./data/app.db`). Without it, `<sqlitePath>/database.db` is used.

### Connection URL

Many hosting services give one connection string. Add its env var name as `envKeys.url`:

```json
"envKeys": { "url": "DATABASE_URL", "user": "DB_USER", "password": "DB_PASSWORD", "port": "DB_PORT", "host": "DB_HOST", "database": "DB_NAME" }
```

```dotenv
DATABASE_URL=postgres://app:secret@db.example.com:5432/my_app?sslmode=verify-full
```

- If that env var has a value, it is used and the other env vars are ignored. If it is empty, the other env vars are used.
- Accepted: `mysql://`, `postgres://` and `postgresql://`. Special characters in the password must be URL-encoded.
- SSL from the URL: `sslmode` (PostgreSQL) or `ssl-mode` (MySQL). `require` / `required` encrypts without checking the certificate; `verify-ca`, `verify-full`, `verify_ca`, `verify_identity` also check it. The `ssl` key below has priority over the URL.
- The URL is never printed, not even in errors, because it has the password.

### SSL

```json
{
    "ssl": true
}
```

- `true`: encrypts and checks the server certificate with the CAs that Node.js trusts.
- An object to set the certificate files or turn off the check:

```json
{
    "ssl": { "ca": "./certs/ca.pem", "cert": "./certs/client.pem", "key": "./certs/client-key.pem", "rejectUnauthorized": true }
}
```

| Key | Description | Default |
| --- | --- | --- |
| `ca` | Path of the CA certificate of the server (for private or self-signed CAs) | Node.js CAs |
| `cert`, `key` | Paths of the client certificate and key, if the server asks for them | None |
| `rejectUnauthorized` | `false` encrypts but does not check the certificate. Use it only for tests | `true` |

- `ssl` is not used with SQLite.
- `ssl` is also used for the tracker when the tracker uses the same database. A tracker in another database has its own `tracker.ssl`.

### Tracker in another database

By default the history is stored in the table `ez_migration` of the target database. To store it somewhere else, add `tracker`:

```json
{
    "dialect": "postgres",
    "envKeys": { "user": "DB_USER", "password": "DB_PASSWORD", "port": "DB_PORT", "host": "DB_HOST", "database": "DB_NAME" },
    "tracker": {
        "dialect": "sqlite",
        "sqlitePath": "./db",
        "envKeys": { "user": "TRACKER_USER", "password": "TRACKER_PASSWORD", "port": "TRACKER_PORT", "host": "TRACKER_HOST", "database": "TRACKER_NAME" }
    }
}
```

- `tracker.dialect` can be `mysql`, `postgres` or `sqlite`, different from the target.
- With a SQLite tracker the history is in `<tracker.sqlitePath>/tracker.db` and `envKeys` are not used.
- `tracker.envKeys.url` and `tracker.ssl` work the same as in the main config.

---

## Commands

| Command | What it does |
| --- | --- |
| `init [folder]` | Creates `ez-migrate.json`. Does nothing if it exists. |
| `make <name>` | Creates a migration file. `-s, --seed` creates a seed file. `-e, --edit` opens it in `$EDITOR`. |
| `migrate` | Applies all pending migrations as one batch. Stops if an applied file changed (see [Edited migrations](#edited-migrations)); `--allow-changed` runs anyway. `--dry-run` prints the SQL without running it. |
| `up` | Applies only the next pending migration (one batch). Same `--allow-changed` and `--dry-run` options as `migrate`. |
| `down` | Reverts the last applied migration. `--dry-run` prints the SQL without running it. |
| `rollback` | Reverts all migrations of the last batch, newest first. `--dry-run` prints the SQL without running it. |
| `redo` | Reverts the last migration and applies the same file again. |
| `reset` | Reverts all applied migrations, newest first, then runs `migrate`. |
| `status` | Lists the migration files (`✔` applied, `✘` pending, `⚠️` applied but the file changed after) and the seed files (`✔` run, `✘` pending). Also `list` or no command. |
| `seed` | Runs the seed files not run yet, in one transaction. `-a, --all` runs all again. `--fake` records them without running them. `-f, --file <path>` runs only that file and doesn't record it. |
| `baseline` | Writes the schema of an existing database as the first migration and marks it as applied. `-d, --data` also writes the current rows to a file ignored by git (`--data-path <folder>`, default `./ez-migrate-data`). `-n, --name <name>` sets the file name. See [Adopt ez-migrate](#adopt-ez-migrate-on-an-existing-database). |
| `version` | Prints the version. Also `-v, --version`. |

The CLI exits with code `0` on success and `1` on any error, so it can stop a deploy script or CI job.

### Dry run

`--dry-run` on `migrate`, `up`, `down` and `rollback` prints the SQL the command would run, in order, and runs nothing:

```text
$ ez-migrate migrate --dry-run
-- Dry run: nothing was run. 2 migrations would be applied, in this order:

-- 20260101000000000-users.sql (up)
CREATE TABLE users (id INTEGER PRIMARY KEY);

-- 20260102000000000-posts.sql (up)
CREATE TABLE posts (id INTEGER PRIMARY KEY);
```

- It does the same checks as the real run, so it also fails on [edited migrations](#edited-migrations) and on DML in migrations.
- `down` and `rollback` print the down SQL saved in the tracker, which is what they would run.
- It doesn't connect to the target database (only to the tracker) and doesn't take the lock.
- The SQL is the output of the command, on stdout. It is never written to the logs.

---

## Running at the same time

Commands that change the database (`migrate`, `up`, `down`, `rollback`, `redo`, `reset`, `seed`, `baseline`) take a lock on the tracker first. If two servers deploy at the same time, the second one waits until the first ends, then sees that there is nothing left to apply. No migration runs twice.

| Option | Env var | What it does |
| --- | --- | --- |
| `--lock-timeout <seconds>` | `EZ_MIGRATE_LOCK_TIMEOUT` | How long to wait for the lock. Default `60`. `0` fails at once if another run has it. |

- If the wait ends, the command fails with code `1`: `Another ez-migrate is changing this database (...). Waited 60 s.`
- **MySQL:** `GET_LOCK`. **PostgreSQL:** advisory lock. Both are freed by the database if the process dies or the connection is lost.
- **SQLite tracker:** a file `tracker.db.lock` next to `tracker.db`, with the process id and host. If that process is no longer running on the same host, the file is removed and the lock is taken. A lock file from another host is only removed by hand.
- The lock is per tracker. Two projects with different tracker databases don't block each other.
- `status` and `seed --file` don't take the lock.

---

## Edited migrations

A file that was already applied should not change: the database has the old version, and other environments may have it too. `migrate` and `up` compare each applied file with the SQL saved in the tracker. If one changed, they stop before applying anything:

```text
Applied migrations changed after they were applied:
  - 20260101000000000-users.sql
The database doesn't have these changes. Put the files back as they were and write the change in a new migration. Use --allow-changed to run anyway
```

- Only the up section is compared. Comments, spaces and line breaks are ignored.
- `--allow-changed` shows the same list as a warning and continues. The changed file is **not** applied again.
- `status` marks these files with `⚠️`.

---

## Logs and traces

These options work with every command:

| Option | Env var | What it does |
| --- | --- | --- |
| `--log-level <level>` | `EZ_MIGRATE_LOG_LEVEL` | `error`, `warn`, `info` (default) or `debug`. |
| `--verbose` | | Same as `--log-level debug`. Logs the start and end of every step, with its duration in ms. |
| `--log-format <format>` | `EZ_MIGRATE_LOG_FORMAT` | `pretty` (default) or `json`: one JSON object per line, for log tools in CI or servers. |
| `--trace` | `EZ_MIGRATE_TRACE=1` | At the end, prints a tree with the time of each step. |
| `--trace-file <path>` | `EZ_MIGRATE_TRACE_FILE` | Writes the same timings as a Chrome trace file. Open it in [ui.perfetto.dev](https://ui.perfetto.dev) or `chrome://tracing` to see a timeline. |

Example:

```text
$ ez-migrate migrate --trace
...
Trace (process 64.6 ms, startup 57 ms)
       7.3 ms  command migrate
         0.3 ms  tracker.init
         0.3 ms  db.connect  db=postgres
         3.1 ms  migration.up  file=20260101000000000-users.sql
           0.3 ms  tracker.save
           1.7 ms  db.run  db=postgres chars=40
```

- **Find a bottleneck:** the slowest line in the tree is the step to look at. `migration.up` / `migration.down` is one migration file, `db.run` is the SQL sent to the database, `db.connect` is the connection, and `tracker.*` are the reads and writes of the history tables. `baseline.table` is the time to read one table with `baseline --data`.
- **Find an error:** a failed migration says which file failed (`Migration <file> (up) failed: <database error>`), and the failed steps are marked `FAILED` in the trace. With `--verbose` you also get the stack trace and the original database error.
- **Privacy:** logs and traces never include the SQL text or its values, only file names and sizes. They are safe to keep in CI logs.
- Logs `info` and `debug` go to stdout, `warn` and `error` to stderr. The output of `status` is always printed, whatever the log level.

---

## Adopt ez-migrate on an existing database

If you already have a database with tables, `baseline` turns it into ez-migrate files:

```bash
ez-migrate init                 # set the dialect and env vars of the existing database
ez-migrate baseline --data
```

This writes:

- `migrations/<timestamp>-baseline.sql`: `CREATE` statements for the schema, in an order that works. The down section drops them. It has no data, so you commit it like any migration. It includes:
  - All DBMS: tables, indexes, foreign keys, views and triggers.
  - MySQL: functions, procedures and events.
  - PostgreSQL: extensions, enums, domains, composite types, sequences, functions and aggregates, partitioned tables and their partitions, table inheritance, rules, materialized views and their indexes, and comments.
- `ez-migrate-data/<timestamp>-baseline-data.sql` (only with `--data`): `INSERT` statements with all the current rows. The folder gets its own `.gitignore`, so **the data never goes to git**. Change the folder with `--data-path <folder>`.

The migration is **recorded as applied** in the existing database, without running it, because that database already has the schema. From now on you add new migrations with `make` as usual.

On a new empty database (local, CI, a new server), create the schema and, if you need it, load the data file:

```bash
ez-migrate migrate
ez-migrate seed --file ez-migrate-data/<timestamp>-baseline-data.sql
```

Share the data file only through a private channel (or don't share it). It has all the rows, including personal data.

Notes:

- `baseline` stops if the tracker already has migrations, or if the database has no tables. It never changes the existing tables.
- The data file copies the rows exactly as they are. While it loads, triggers are off (so they don't change or add rows) and foreign keys are checked at the end (so rows that reference each other in a cycle load). Sequences and auto increment counters continue after the copied rows. Load it into a new database, not into one that others are using at the same time.
- SQLite doesn't check foreign keys unless they are turned on, so an old SQLite database can have rows that reference rows that don't exist. `baseline` warns about them, and `seed --file` fails without loading anything until you fix them (`PRAGMA foreign_key_check` lists them).
- Not exported: permissions (`GRANT`), owners, row level security policies, and objects in other schemas (PostgreSQL uses the current schema). Objects the user can't read are listed by `baseline`, so you can add them by hand.
- Tested on the Sakila, Pagila, Chinook and Northwind sample databases: the database built from the files has the same schema and data as the original.
- `--data` reads every table into memory. For big databases, use `baseline` without `--data` and copy the data with the DBMS tools (`pg_dump --data-only`, `mysqldump --no-create-info`).
- The data file is not a seed. It is not recorded, so `seed --file` runs it every time you call it. Data that belongs in git (roles, countries, settings) goes in normal seed files.
- Review the generated SQL. It is plain SQL for your DBMS, so you can edit it before committing.
- With SQLite the `CREATE` statements are copied exactly as they are stored in the database file.

---

## How tracking works

- Each applied migration is a row in the table `ez_migration`: batch id, time, the up and down SQL, and the file path.
- Each run seed file is a row in the table `ez_seed`: file name and time. Both tables are in the tracker database.
- A **pending** migration is a file whose name is not in the table. A file with an older name added later (for example after a merge) is also applied.
- `down`, `rollback` and `reset` use the **down SQL saved in the table**, not the current file. Editing a file after applying it does not change how it is reverted.
- Each migration is applied and tracked on its own. If migration 3 of 5 fails, migrations 1 and 2 stay applied and tracked, and the command stops with code `1`.
- **PostgreSQL and SQLite:** a migration runs in a transaction. If any statement fails, none of its changes stay.
- **MySQL:** `CREATE`, `ALTER` and `DROP` are committed by MySQL one by one. If the second statement of a migration fails, the first stays applied but the migration is not tracked. Keep one DDL statement per migration to avoid this. ez-migrate helps with it:
  - Before running a migration with more than one statement, it warns: `Migration <file> (up) is not atomic. It has 2 statements...`. `--dry-run` shows the same note.
  - If such a migration fails, the error says that the statements before the error stayed applied and must be undone by hand before running it again.

---

## Advantages, disadvantages and use cases

This section is updated with each version, based on what the tests and real use show.
*Last review: 0.12.0.*

### Advantages

- **Plain SQL.** No ORM, no DSL, no JavaScript in migrations. You write exactly what the database runs.
- **Small and fast.** One CLI, one JSON config, three runtime dependencies. A command starts in about 70 ms, and only the driver of the database in use is loaded.
- **See before you run.** `--dry-run` prints the exact SQL that `migrate`, `up`, `down` or `rollback` would run.
- **Easy to debug.** `--trace` shows the time of each step and `--verbose` logs every step, without printing your SQL or data.
- **Up and down in one file.** Easy to review in a pull request.
- **Safe on PostgreSQL and SQLite.** A failed migration leaves no partial changes.
- **Flexible tracker.** The history can live in the same database, in a SQLite file, or in another server and DBMS.
- **Schema and data are separated.** Migrations reject DML and seeds reject DDL, so data scripts don't hide in schema changes.
- **Stops on edited migrations.** `migrate` and `up` fail if an applied file changed, so a change that never reached the database doesn't go unnoticed.
- **Safe to run from several servers.** A lock on the tracker makes concurrent runs wait, so no migration runs twice.
- **Connects to managed databases.** Connection URL and SSL with certificate checks, on MySQL and PostgreSQL.
- **Seeds run once.** `seed` only runs new seed files, so it can run on every deploy.
- **Easy to adopt.** `baseline` turns an existing database into a first migration in one command, on all three DBMS, including triggers, functions, procedures, sequences and partitions. The current data can be exported too, to a folder that git ignores, and loads with the same result as the original. Tested on the Sakila, Pagila, Chinook and Northwind sample databases.
- **Works with branches.** Migrations merged later with an older name are still applied.
- **Script friendly.** Exit code `1` on errors.

### Disadvantages

- **MySQL migrations are not atomic.** A migration with several DDL statements can be left half applied. ez-migrate warns before running it and says what to undo if it fails, but it can't undo it for you. See [How tracking works](#how-tracking-works).
- **No data migrations.** You can't run an `UPDATE` to fill a new column inside a migration. You need a seed or a separate script.
- **Edited seeds don't run again.** A seed is recorded by file name. If you change a seed that already ran, create a new seed file or use `seed --all`.
- **`baseline` has limits.** It doesn't export permissions, row level security policies or other PostgreSQL schemas, and `--data` loads all rows in memory, so it is not for big databases.
- **SQL is not portable.** A migration written for PostgreSQL may not run on MySQL.
- **Not 1.0 yet.** The config and the CLI may still change between minor versions. Read the changelog before updating.
- **CLI only.** There is no JavaScript API to run migrations from code.
- **Needs Node.js 22.13+**.

### Recommended use cases

- Small and medium projects that want versioned schema changes without an ORM.
- Teams that already write and review SQL by hand.
- PostgreSQL or SQLite projects, where each migration is atomic.
- Creating and filling local and CI databases with `migrate` + `seed`.
- Existing databases without versioned migrations: `baseline` gives them a starting point.
- Services deployed on several servers that run `migrate` on start: the lock makes them wait for each other.
- Managed cloud databases that need SSL or a connection URL.
- Prototypes with SQLite that may move to PostgreSQL later (with SQL rewritten where needed).

### Not recommended

- Projects that need data migrations (backfills, data transforms) as part of the migration history.
- Critical MySQL databases with complex multi-statement migrations, unless you keep one DDL statement per migration.
- Projects that must run the same migrations on several DBMS.
- Running migrations from application code.
- Copying big production databases with `baseline --data`. Use the DBMS backup tools for the data.
- PostgreSQL databases split in several schemas, or that depend on permissions and row level security in the migrations.

---

## Development and tests

```bash
pnpm install
pnpm run db:up      # MySQL 8.4 on port 33306 and PostgreSQL 16 on port 55432 (Docker)
pnpm test           # build and run all tests
pnpm run lint
pnpm run db:down
```

Tests run the built CLI against real databases: every command on MySQL, PostgreSQL and SQLite, and with the tracker on a different DBMS. CI runs the same on every push and pull request.

Contributions: create a branch, add a test for your change, add an entry to [CHANGELOG.md](CHANGELOG.md) and open a pull request. Guidelines for coding agents are in [.github/AGENTS.md](.github/AGENTS.md).

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md). Versions follow [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`).

## Author

[@ky210299](https://github.com/ky210299)
