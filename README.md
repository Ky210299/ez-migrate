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
6. [How tracking works](#how-tracking-works)
7. [Advantages, disadvantages and use cases](#advantages-disadvantages-and-use-cases)
8. [Development and tests](#development-and-tests)
9. [Changelog](#changelog)

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
- Files run in file name order. The timestamp prefix keeps the creation order.
- Migrations can't have DML (`INSERT`, `UPDATE`, `DELETE`). Use seeds for data.
- The SQL is sent to the database as written, so it must be valid for your DBMS.

### Seed

`ez-migrate make --seed <name>` creates `seeds/<timestamp>-<name>.sql`. Put DML in it:

```sql
INSERT INTO users (id, name) VALUES (1, 'ana');
INSERT INTO users (id, name) VALUES (2, 'bob');
```

- Seeds can't have DDL (`CREATE`, `ALTER`, `DROP`, `TRUNCATE`, `RENAME`).
- `ez-migrate seed` runs all seed files, in file name order, in one transaction. If one fails, nothing is inserted.
- Seeds are not tracked. Running `seed` twice runs every file twice.

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

---

## Commands

| Command | What it does |
| --- | --- |
| `init [folder]` | Creates `ez-migrate.json`. Does nothing if it exists. |
| `make <name>` | Creates a migration file. `-s, --seed` creates a seed file. `-e, --edit` opens it in `$EDITOR`. |
| `migrate` | Applies all pending migrations as one batch. |
| `up` | Applies only the next pending migration (one batch). |
| `down` | Reverts the last applied migration. |
| `rollback` | Reverts all migrations of the last batch, newest first. |
| `redo` | Reverts the last migration and applies the same file again. |
| `reset` | Reverts all applied migrations, newest first, then runs `migrate`. |
| `status` | Lists the migration files: `✔` applied, `✘` pending, `⚠️` applied but the file changed after. Also `list` or no command. |
| `seed` | Runs all seed files in one transaction. |
| `version` | Prints the version. Also `-v, --version`. |

The CLI exits with code `0` on success and `1` on any error, so it can stop a deploy script or CI job.

---

## How tracking works

- Each applied migration is a row in the table `ez_migration`: batch id, time, the up and down SQL, and the file path.
- A **pending** migration is a file whose name is not in the table. A file with an older name added later (for example after a merge) is also applied.
- `down`, `rollback` and `reset` use the **down SQL saved in the table**, not the current file. Editing a file after applying it does not change how it is reverted.
- Each migration is applied and tracked on its own. If migration 3 of 5 fails, migrations 1 and 2 stay applied and tracked, and the command stops with code `1`.
- **PostgreSQL and SQLite:** a migration runs in a transaction. If any statement fails, none of its changes stay.
- **MySQL:** `CREATE`, `ALTER` and `DROP` are committed by MySQL one by one. If the second statement of a migration fails, the first stays applied but the migration is not tracked. Fix it by hand, or keep one DDL statement per migration.

---

## Advantages, disadvantages and use cases

This section is updated with each version, based on what the tests and real use show.
*Last review: 0.5.0.*

### Advantages

- **Plain SQL.** No ORM, no DSL, no JavaScript in migrations. You write exactly what the database runs.
- **Small.** One CLI, one JSON config, five runtime dependencies.
- **Up and down in one file.** Easy to review in a pull request.
- **Safe on PostgreSQL and SQLite.** A failed migration leaves no partial changes.
- **Flexible tracker.** The history can live in the same database, in a SQLite file, or in another server and DBMS.
- **Schema and data are separated.** Migrations reject DML and seeds reject DDL, so data scripts don't hide in schema changes.
- **Detects edited migrations.** `status` marks applied files that changed after being applied.
- **Works with branches.** Migrations merged later with an older name are still applied.
- **Script friendly.** Exit code `1` on errors.

### Disadvantages

- **MySQL migrations are not atomic.** A migration with several DDL statements can be left half applied. See [How tracking works](#how-tracking-works).
- **No data migrations.** You can't run an `UPDATE` to fill a new column inside a migration. You need a seed or a separate script.
- **Seeds are not tracked.** Running `seed` twice inserts the data twice unless your SQL avoids it (`INSERT ... ON CONFLICT DO NOTHING`, `INSERT IGNORE`).
- **No lock.** Two `migrate` commands at the same time against the same database can both run the same migration. Run migrations from one place only.
- **SQL is not portable.** A migration written for PostgreSQL may not run on MySQL.
- **Limited connection options.** Only host, port, user, password and database from env vars. No connection URL and no SSL options yet, so some managed cloud databases that require SSL may not work.
- **Windows:** generated file names contain `:`, which Windows does not allow. Use WSL or rename the files.
- **CLI only.** There is no JavaScript API to run migrations from code.
- **Needs Node.js 22.13+**.

### Recommended use cases

- Small and medium projects that want versioned schema changes without an ORM.
- Teams that already write and review SQL by hand.
- PostgreSQL or SQLite projects, where each migration is atomic.
- Creating and filling local and CI databases with `migrate` + `seed`.
- Services that each own one database and deploy from one pipeline.
- Prototypes with SQLite that may move to PostgreSQL later (with SQL rewritten where needed).

### Not recommended

- Several apps or servers running migrations at the same time on the same database (no lock).
- Projects that need data migrations (backfills, data transforms) as part of the migration history.
- Critical MySQL databases with complex multi-statement migrations, unless you keep one DDL statement per migration.
- Projects that must run the same migrations on several DBMS.
- Databases that need SSL or connection strings to connect.
- Running migrations from application code.

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
