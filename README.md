# @ky210299/ez-migrate

[![npm version](https://img.shields.io/npm/v/@ky210299/ez-migrate)](https://www.npmjs.com/package/@ky210299/ez-migrate)
[![Tests](https://github.com/Ky210299/ez-migrate/actions/workflows/test.yml/badge.svg)](https://github.com/Ky210299/ez-migrate/actions/workflows/test.yml)
[![license](https://img.shields.io/npm/l/@ky210299/ez-migrate)](https://github.com/Ky210299/ez-migrate/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@ky210299/ez-migrate)](https://nodejs.org)
[![AI friendly](https://img.shields.io/badge/AI-friendly-8A2BE2)](https://github.com/Ky210299/ez-migrate#use-with-ai-agents)

A small CLI to run database migrations and seeds written in plain `.sql` files.
Supports **MySQL**, **PostgreSQL** and **SQLite**.

You write the SQL. ez-migrate runs it in order, records what was applied, and can revert it.

- Up and down SQL in one file, no ORM and no JavaScript.
- Shows the SQL and asks before running it at the terminal; runs without asking in CI.
- Lock so several servers can run `migrate` at the same time.
- Seeds that run once, and `baseline` to adopt an existing database.
- **Tenants:** the same migrations for many clients, each in its own schema, database, server or SQLite file, with its own history and lock. See [Tenants](#tenants-many-clients).
- `alter` changes the type of a column (for example to an enum) without losing data: it checks every value and tests the change on a copy of the table before writing the migration.
- Three runtime dependencies. SQLite uses the `node:sqlite` module of Node.js.
- **AI friendly:** JSON output, `schema` to read the real schema and `check` to find secrets and risky SQL, so AI coding agents (Claude Code, Cursor, Copilot...) can work with your migrations. ez-migrate never calls an AI model and never sends your schema or data anywhere. See [Use with AI agents](#use-with-ai-agents).

---

## Table of contents

1. [Install](#install)
2. [Quick start](#quick-start)
3. [Migration and seed files](#migration-and-seed-files)
4. [Configuration](#configuration)
5. [Commands](#commands)
6. [Use with AI agents](#use-with-ai-agents)
7. [Running at the same time](#running-at-the-same-time)
8. [Tenants (many clients)](#tenants-many-clients)
9. [Edited migrations](#edited-migrations)
10. [Logs and traces](#logs-and-traces)
11. [Adopt ez-migrate on an existing database](#adopt-ez-migrate-on-an-existing-database)
12. [Change a column type (alter)](#change-a-column-type-alter)
13. [How tracking works](#how-tracking-works)
14. [Advantages, disadvantages and use cases](#advantages-disadvantages-and-use-cases)
15. [Development and tests](#development-and-tests)
16. [Changelog](#changelog)
17. [License](#license)

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

# Without installing
npx @ky210299/ez-migrate <command>
```

The package name is `@ky210299/ez-migrate`. The command is `ez-migrate`.

---

## Quick start

```bash
ez-migrate init                       # creates ez-migrate.json (dialect mysql by default)
```

Set `"dialect"` in `ez-migrate.json` to `mysql`, `postgres` or `sqlite`, and put the connection data in a `.env` file (or in env vars):

```dotenv
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=secret
DB_NAME=my_app
```

For SQLite only `DB_NAME` is needed, and it is the path of the database file (`DB_NAME=./data/app.db`).

```bash
ez-migrate make create_users          # creates migrations/<timestamp>-create_users.sql
# write the up and down SQL in the file (see below)

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
- Both sections are required and can have several statements. The new file has only comments, so `migrate` fails with `The UP migration section is empty` until you write the SQL.
- Text outside the two sections is ignored.
- Files run in file name order. The timestamp prefix (`YYYYMMDDHHmmssSSS`, UTC) keeps the creation order.
- The up section can't have DML (statements that start with `INSERT INTO`, `UPDATE` or `DELETE FROM`). Use seeds for data. `migrate` and `up` fail before running anything if a pending file has it. One exception: `INSERT INTO a (...) SELECT ... FROM b` without values (no strings or numbers) copies rows that already exist from one table to another, which SQLite needs to rebuild a table, so it is allowed.
- SQLite: if the first statement of a section is `PRAGMA foreign_keys = OFF;`, ez-migrate turns foreign keys off before the transaction (SQLite ignores it inside one), checks them all before commit and turns them on again. This is what SQLite needs to [rebuild a table](https://www.sqlite.org/lang_altertable.html#otheralter).
- The SQL is sent to the database as written, so it must be valid for your DBMS.

### Seed

`ez-migrate make --seed <name>` creates `seeds/<timestamp>-<name>.sql`. Put DML in it:

```sql
INSERT INTO users (id, name) VALUES (1, 'ana');
INSERT INTO users (id, name) VALUES (2, 'bob');
```

- Seeds can't have DDL (statements that start with `CREATE`, `ALTER`, `DROP`, `TRUNCATE` or `RENAME`).
- Empty seed files (only comments) are skipped.
- `ez-migrate seed` runs the seed files **not run yet**, in file name order, in one transaction. If one fails, nothing is inserted and nothing is recorded.
- Run seeds are recorded in the table `ez_seed`, so running `seed` again only runs new files. It is safe to run it on every deploy.
- `seed --all` runs every seed file again. Your SQL must handle data that already exists (for example `DELETE` first, or `INSERT ... ON CONFLICT DO NOTHING`).
- `seed --fake` records the pending seeds as run without running them. Use it when the data is already in the database.
- `seed --file <path>` runs only that file, from any folder, in one transaction, and doesn't record it. Use it for data that must not be in git, like the data file of `baseline --data`.

Add `-e` to `make` to open the new file in `$EDITOR` (or `$VISUAL`).

---

## Configuration

`ez-migrate init` creates `ez-migrate.json` in the current folder (or `ez-migrate init <folder>` in another folder). ez-migrate always reads `./ez-migrate.json` from the folder where you run it. If the file doesn't exist, it warns and uses the defaults below.

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
| `sqlitePath` | SQLite only: folder of the tracker file `tracker.db`, and of `database.db` when `DB_NAME` is not set | `./migrations` |
| `envKeys` | **Names** of the env vars with the connection data of the target database | `DB_*` |
| `envKeys.url` | Optional. **Name** of an env var with a connection URL. See below | Not used |
| `ssl` | Optional. SSL for MySQL and PostgreSQL. See below | No SSL |
| `tracker` | Optional. Where to store the migrations history. See below | Same as the target |
| `confirm` | Optional. `false` never asks before running migrations at the terminal. See [Confirmation](#confirmation) | `true` |

The connection data is read from the env vars named in `envKeys`. A `.env` file in the current folder is loaded if it exists:

```dotenv
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=secret
DB_NAME=my_app
```

- Env vars already set in the shell are not replaced by the `.env` file.
- If the database doesn't exist, ez-migrate creates it (the user needs permission for that).
- **SQLite:** only the `database` env var is used, and it is the path of the database file (`DB_NAME=./data/app.db`). Without it, `<sqlitePath>/database.db` is used. The history goes in a separate file, `<sqlitePath>/tracker.db`. With the default `sqlitePath` both files are created in `./migrations`, so set `sqlitePath` to another folder or add `*.db` to `.gitignore`.

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

By default the history is stored in the table `ez_migration` of the target database (with SQLite, in the file `<sqlitePath>/tracker.db`). To store it somewhere else, add `tracker`:

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

- `tracker.dialect` can be `mysql`, `postgres` or `sqlite`, different from the target. Default `mysql`.
- `tracker.envKeys` defaults to `TRACKER_USER`, `TRACKER_PASSWORD`, `TRACKER_PORT`, `TRACKER_HOST` and `TRACKER_NAME`.
- With a SQLite tracker the history is in `<tracker.sqlitePath>/tracker.db` (default `./migrations`) and `envKeys` are not used.
- `tracker.envKeys.url` and `tracker.ssl` work the same as in the main config. The main `ssl` is not used for a tracker set with `tracker`.

---

## Commands

| Command | What it does |
| --- | --- |
| `init [folder]` | Creates `ez-migrate.json`. Does nothing if it exists. |
| `make <name>` | Creates a migration file. `-s, --seed` creates a seed file. `-e, --edit` opens it in `$EDITOR`. |
| `migrate` | Applies all pending migrations as one batch. Stops if an applied file changed (see [Edited migrations](#edited-migrations)); `--allow-changed` runs anyway. |
| `up` | Applies only the next pending migration (one batch). Same `--allow-changed` option as `migrate`. |
| `down` | Reverts the last applied migration. |
| `rollback` | Reverts all migrations of the last batch, newest first. |
| `redo` | Reverts the last migration and applies the same file again. |
| `reset` | Reverts all applied migrations, newest first, then runs `migrate`. |
| `status` | Lists the migration files (`✔` applied, `✘` pending, `⚠️` applied but the file changed after) and the seed files (`✔` run, `✘` pending). Also `list` or no command. |
| `seed` | Runs the seed files not run yet, in one transaction. `-a, --all` runs all again. `--fake` records them without running them. `-f, --file <path>` runs only that file and doesn't record it. |
| `baseline` | Writes the schema of an existing database as the first migration and marks it as applied. `-d, --data` also writes the current rows to a file ignored by git (`--data-path <folder>`, default `./ez-migrate-data`). `-n, --name <name>` sets the file name. See [Adopt ez-migrate](#adopt-ez-migrate-on-an-existing-database). |
| `check` | Checks the migration and seed files without connecting to the database: secrets, DML in migrations, DDL in seeds, statements that delete data. Exit code `1` on errors; `--strict` also fails on warnings. See [Check](#check). |
| `schema` | Prints the current schema of the database as SQL, without data. Read only. |
| `alter <table> <column> <type>` | Writes a migration that changes the type of a column, after checking every value and testing it on a copy of the table. `--dry-run` writes nothing. See [Change a column type](#change-a-column-type-alter). |
| `version` | Prints the version. Also `-v, --version`. |

`migrate`, `up`, `down`, `rollback`, `redo` and `reset` also take `--dry-run` (print the SQL, run nothing) and `-y, --yes` (don't ask first, see [Confirmation](#confirmation)).

`status`, `check`, `schema`, `alter` and `--dry-run` take `--json` to print their output as JSON, for scripts and AI agents.

With [tenants](#tenants-many-clients), `--tenant <name>` runs any of these commands for one client, and `--all-tenants` runs `migrate` and `status` for all of them.

The CLI exits with code `0` on success and `1` on any error, so it can stop a deploy script or CI job.

### Dry run

`--dry-run` on `migrate`, `up`, `down`, `rollback`, `redo` and `reset` prints the SQL the command would run, in order, and runs nothing:

```text
$ ez-migrate migrate --dry-run
-- Dry run: nothing was run. 2 migrations would be applied, in this order:

-- 20260101000000000-users.sql (up)
CREATE TABLE users (id INTEGER PRIMARY KEY);

-- 20260102000000000-posts.sql (up)
CREATE TABLE posts (id INTEGER PRIMARY KEY);
```

- It does the same checks as the real run, so it also fails on [edited migrations](#edited-migrations) and on DML in migrations.
- `down`, `rollback`, `redo` and `reset` print the down SQL saved in the tracker, which is what they would run. `redo` and `reset` print the down SQL first and then the up SQL.
- It doesn't connect to the target database (only to the tracker) and doesn't take the lock.
- The SQL is the output of the command, on stdout. It is never written to the logs.

### Confirmation

When you run `migrate`, `up`, `down`, `rollback`, `redo` or `reset` yourself at a terminal, ez-migrate first shows the SQL it will run (the same as `--dry-run`) and asks before running it:

```text
$ ez-migrate migrate
-- 1 migration will be applied, in this order:

-- 20260101000000000-users.sql (up)
CREATE TABLE users (id INTEGER PRIMARY KEY);

Run it? [y/N] y
```

- Any answer other than `y`, `yes`, `s`, `si` or `sí` runs nothing.
- **In CI, deploys and scripts it never asks** and runs as before: it only asks when the input and the output are a terminal and the `CI` env var is not set.
- To skip the question: `-y, --yes`, the env var `EZ_MIGRATE_YES=1`, or `"confirm": false` in `ez-migrate.json`.
- If there is nothing to run, it doesn't ask.
- The plan is made again after the answer, under the lock. If it changed while you answered (another run applied migrations, or a new file appeared), nothing runs and it asks you to run the command again.

---

## Use with AI agents

ez-migrate has no AI inside. It gives AI coding agents (and scripts) what they need to work with your migrations without guessing:

| Command | What the agent gets |
| --- | --- |
| `ez-migrate schema` | The real schema of the database as SQL (no rows). Add `--json` for `{ dialect, tables, sql, skipped }`. |
| `ez-migrate status --json` | Every migration (`applied`, `pending`, `changed`) and seed (`run`, `pending`). |
| `ez-migrate make <name>` | A new migration file with the right name and template, to fill in. |
| `ez-migrate check --json` | Problems in the files, before anything runs. Exit code `1` on errors. |
| `ez-migrate migrate --dry-run --json` | The exact SQL that would run, in order, with a note on MySQL migrations that are not atomic. |

Why it is safe:

- **Nothing leaves your machine.** ez-migrate doesn't call any model or service. What the agent sees is what you let it run.
- **`schema` never reads rows.** Only the structure: tables, columns, indexes, triggers, functions.
- **`check` never prints a secret.** It gives the file, line and kind of secret, not the value.
- **Logs never contain SQL or data**, also with `--log-format json`.
- **A person still approves.** At a terminal, `migrate` shows the SQL and asks before running it. In CI it runs as always.

Copy this into the instructions file of your agent (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`...):

```markdown
## Database migrations (ez-migrate)
- Read the current schema with `npx ez-migrate schema` before writing a migration. Don't guess it.
- Create migrations with `npx ez-migrate make <name>` and write both sections: `-- ez-migration-up` and `-- ez-migration-down`.
- Migrations only have DDL (CREATE, ALTER, DROP). Data (INSERT, UPDATE, DELETE) goes in seeds: `npx ez-migrate make --seed <name>`.
- Never write passwords, keys or real data in migration or seed files.
- After writing files run `npx ez-migrate check` and fix every error.
- Show the plan with `npx ez-migrate migrate --dry-run`. Don't run `migrate`, `down`, `rollback`, `redo` or `reset` unless I ask.
```

### Check

`ez-migrate check` reads the migration and seed files. It doesn't connect to the database, so it runs in CI and in pre-commit hooks in a few milliseconds.

| Rule | Level | What it finds |
| --- | --- | --- |
| `secret` | error | Private keys, AWS / GitHub / Slack / Stripe / Google keys, `sk-...` API keys, JWTs, URLs with a password, `IDENTIFIED BY '...'` and `PASSWORD '...'` of database users. Also in comments. |
| `possible-secret` | warning | A name like `password`, `token` or `api_key` followed by a value. |
| `format` | error | A migration without the up and down sections. |
| `dml-in-migration` | error | `INSERT`, `UPDATE` or `DELETE` in the up section of a migration. |
| `ddl-in-seed` | error | `CREATE`, `ALTER`, `DROP`, `TRUNCATE` or `RENAME` in a seed. |
| `destructive` | warning | `DROP TABLE`, `DROP DATABASE`, `TRUNCATE` or `DROP COLUMN` in the up section. The data can't be recovered with the down section. Dropping a table that the same section created (a temporary table) or replaces with a renamed one (a rebuild) is not a warning. |
| `not-atomic` | warning | MySQL: a migration with several statements that MySQL commits on their own (`CREATE`, `ALTER`, `DROP`, `RENAME`, `TRUNCATE`). If one fails, the ones before it stay applied. `SET`, `SELECT` and temporary tables don't count. |

```text
$ ez-migrate check
./migrations/20260102000000000-users.sql:3 error secret: Looks like a database user password. Don't commit secrets: ...
./migrations/20260103000000000-drop_name.sql warning destructive: The up section has DROP COLUMN. ...
1 error and 1 warning in 4 files
```

- If a line is not a secret (a test key, a public example), add the comment `ez-migrate-allow-secret` to that line.
- `--json` prints `{ ok, files, errors, warnings, problems: [{ file, line, level, rule, message }] }`.
- Edited migrations need the tracker, so `check` doesn't look for them. `status` and `migrate` do.

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

## Tenants (many clients)

For a project where each client has its own copy of the schema: a schema per client in one database, a database per client, a server per client, or a SQLite file per client. The same migration files run for every client, a client can also have its own migrations, and a client that fails doesn't change the others.

Add `tenants` to `ez-migrate.json`:

```json
{
    "dialect": "postgres",
    "migrationsPath": "./migrations",
    "envKeys": { "user": "DB_USER", "password": "DB_PASSWORD", "port": "DB_PORT", "host": "DB_HOST", "database": "DB_NAME" },
    "tenants": {
        "migrationsPath": "./tenants",
        "list": [
            { "name": "acme" },
            { "name": "beta", "schema": "client_beta" },
            { "name": "gamma", "database": "gamma_db" },
            { "name": "delta", "url": "DELTA_DB_URL" }
        ]
    }
}
```

Each tenant has a `name` (letters, numbers, `_` and `-`) and, if needed, where it is:

| Key | PostgreSQL | MySQL | SQLite |
| --- | --- | --- | --- |
| nothing | schema `<name>` in the main database | database `<name>` | file `<sqlitePath>/tenants/<name>.db` |
| `schema` | that schema in the main database | same as `database` | not allowed |
| `database` | that database on the same server (schema `public`) | that database | path of its file |
| `url` | name of the env var with its connection URL (another server). It can be used with `schema` / `database` | same | not allowed |

The URL is never written in the config: `url` is the name of an env var. If that env var is empty, the tenant fails; it never falls back to the main database.

The list can come from three places (only one):
- `"list": [...]` in the config.
- `"file": "./tenants.json"`: a JSON file with the same array.
- `"query": "SELECT name, schema FROM clients WHERE active"`: a query on the main database. It returns the columns `name`, `schema`, `database` and `url` (the ones you need). Adding a client is adding a row.

### Commands

| Option | What it does |
| --- | --- |
| `--tenant <name>` | Runs the command for that tenant. Works with every command that uses the database (`migrate`, `up`, `down`, `rollback`, `redo`, `reset`, `seed`, `status`, `baseline`, `schema`, `alter`, `check`, `make`). Also the env var `EZ_MIGRATE_TENANT`. |
| `--tenant a,b` | `migrate` and `status` for those tenants. |
| `--all-tenants` | `migrate` and `status` for every tenant of the list. |
| `--continue-on-error` | `migrate` with several tenants: keeps going after a tenant fails. |

```bash
ez-migrate status --all-tenants                 # one line per tenant: applied, pending, changed
ez-migrate migrate --all-tenants --dry-run      # the SQL each tenant would run
ez-migrate migrate --tenant acme                # first one client
ez-migrate migrate --all-tenants                # then the rest
ez-migrate make add-vip --tenant acme           # a migration only for acme: tenants/acme/<time>-add-vip.sql
ez-migrate rollback --tenant acme               # undo only acme
```

`migrate --all-tenants` prints a summary at the end:

```
Tenants: 1 done, 1 failed, 1 not run
✔ acme   2 migrations were applied
✘ beta   Migration 20261020101500123-vip.sql (up) failed: relation "vip" already exists
- gamma  not run: an earlier tenant failed (use --continue-on-error to run the rest)
```

- **Order:** tenants run one after the other, in the order of the list. By default it **stops at the first tenant that fails**, because the same files would likely fail on the next tenants too. Fix it and run again: the tenants that are done have nothing to run. `--continue-on-error` runs the rest. Exit code `1` if a tenant failed.
- **At the terminal** it shows the files of each tenant and asks once. A tenant whose plan changed while you answered runs nothing.
- **Without `--tenant` or `--all-tenants`** nothing changes: commands run on the main database, as before.

### Own migrations of a tenant

Files in `<tenants.migrationsPath>/<name>/` (default `./tenants/<name>/`) run only for that tenant, together with the common files in `migrationsPath`, in file name order. The same file name can't be in both folders. Keep these for real differences: the more tenants differ, the harder it is for a common migration to work on all of them. To roll out a risky change, run it first on one tenant (`--tenant acme`) and then on all.

### Isolation

- **History and lock per tenant.** The tracker of a tenant is in the tenant: table `ez_migration` in its schema or database, or the file `<name>.tracker.db` next to its SQLite file. Each tenant has its own lock, so two servers can migrate two tenants at the same time. The `tracker` config is not used for tenants.
- **PostgreSQL:** the connection uses only the schema of the tenant (`search_path`), and the schema is created if it doesn't exist. Write migrations without a schema name (`CREATE TABLE users`, not `acme.users`). Each migration runs in a transaction: if it fails, that tenant has no changes left.
- **MySQL:** each tenant is a database. DDL is not atomic, so a migration with several statements that fails can leave that tenant half done (see [How tracking works](#how-tracking-works)). The other tenants are not touched.
- **Protection:** before running anything, a tenant migration (up and down) or seed is rejected if it would change something outside its tenant: it names the schema or database of another tenant (`beta.orders`), changes an object of another schema (`CREATE TABLE public.x`, `ALTER TABLE x SET SCHEMA y`), or changes the schema or database in use (`SET search_path`, `USE`, `ATTACH`). Reading a shared schema is allowed (`REFERENCES public.plans`, `public.gen_random_uuid()`). `check --tenant <name>` shows the same problems without connecting.
- **Logs** of a tenant have `tenant=<name>` in every line (and a `tenant` field with `--log-format json`). They never have its URL.

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
| `--trace` | `EZ_MIGRATE_TRACE=1` | At the end, prints a tree with the time of each step (to stderr). |
| `--trace-file <path>` | `EZ_MIGRATE_TRACE_FILE` | Writes the same timings as a Chrome trace file. Open it in [ui.perfetto.dev](https://ui.perfetto.dev) or `chrome://tracing` to see a timeline. |

They can go before or after the command (`ez-migrate --verbose migrate` or `ez-migrate migrate --verbose`).

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
- Colors are used only at a terminal. Set `NO_COLOR` to turn them off.

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

## Change a column type (alter)

Changing the type of a column with data is risky: a value can be cut (`'ARG'` in `CHAR(2)`), rounded (`1.50` in `INTEGER`) or not fit (`'banned'` in an enum without it), and MySQL without strict mode does it without an error. `ez-migrate alter` checks this for you and writes the migration only when it is safe:

```text
$ ez-migrate alter users status "enum('active','blocked')"
Table users, column status
  Type: varchar(20) -> enum('active','blocked')
  Rows: 12430, 1.2 MB
  Values: 12427 stay the same, 0 change, 3 can't be converted
  Values that can't be converted:
    'banned' (3 rows)
  Test on a copy of the table: not run. Fix the values first
  Result: NOT safe
    - Values in 3 rows can't be converted to enum('active','blocked'). Change those values first (with a seed) or choose another type

No migration was written
```

What it does, in order:

1. Reads the column from the database. Pending migrations must be applied first, because they could change it.
2. Converts every value to the new type and back, and compares it with the original. A value stays the same if the round trip gives the same value: `2.00 -> 2 -> 2.00` stays, `1.50 -> 2` changes, `'Active' -> 'active'` changes. It shows how many values change and which ones.
3. Copies the table (`<table>__ezm_test`, in the same database), runs the up SQL on the copy and compares every row, runs the down SQL and checks that every value is back as it was. The copy is always dropped, also on errors and Ctrl+C. This finds what the values alone don't: a default not in the new enum, a unique index that two cut values break.
4. Writes `migrations/<timestamp>-alter-<table>-<column>.sql`. Apply it with `ez-migrate migrate` as any migration.

The migration also checks the values again before changing anything, and stops without changes if one would change. So a database with other values than yours (production) is not changed by mistake.

| Option | What it does |
| --- | --- |
| `--dry-run` | Checks the values and tests on the copy, without writing the migration. |
| `--allow-changes` | Writes it even if some values change (rounded, other format). Values that can't be converted still stop it, and MySQL still never cuts text. |
| `--skip-test` | Doesn't test on a copy. For very big tables. |
| `-y, --yes` | Copies big tables (more than 1,000,000 rows or 1 GB) without asking. Without a terminal, big tables need `--yes` or `--skip-test`. |
| `-n, --name <name>` | Name of the migration file. |
| `--json` | Prints the result as JSON. |

`<type>` is a type of your database (`char(2)`, `bigint`, `numeric(10,2)`), or `enum('a','b')`, which works on the three DBMS:

- **MySQL:** a native `ENUM`. The column keeps its `NOT NULL`, default, comment and charset. The migration runs in strict mode, so MySQL fails instead of cutting a value.
- **PostgreSQL:** an enum type named `<table>_<column>`. Adding values at the end uses `ALTER TYPE ... ADD VALUE`, which doesn't touch the rows. Removing or reordering values creates a new type, converts the column and takes the old name. Everything runs in one transaction.
- **SQLite:** `TEXT` with a `CHECK (column IN (...))` named `ezm_enum_<column>`. SQLite can't change a column, so the table is rebuilt as the [SQLite docs](https://www.sqlite.org/lang_altertable.html#otheralter) say, in one transaction: new table, copy of the rows, rename, and the same indexes and triggers. Views and the rows of other tables are kept, and foreign keys are checked before commit.

Limits:

- MySQL and PostgreSQL can't change a column that is part of a foreign key, and PostgreSQL can't change a column used by a view. `alter` says so and writes nothing: drop the foreign key or view in a migration first and create it again after.
- The test copies the whole table into the same database. On a big production table that takes time and disk: run it on a copy of the data, or use `--skip-test`.
- The values shown in the result are your data. They are printed to the terminal (stdout), never to the logs.

---

## How tracking works

- Each applied migration is a row in the table `ez_migration`: batch id, time, the up and down SQL, and the file path.
- Each run seed file is a row in the table `ez_seed`: file name and time. Both tables are in the tracker database (by default the target database; with SQLite, `tracker.db`).
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
*Last review: 0.16.0.*

### Advantages

- **Plain SQL.** No ORM, no DSL, no JavaScript in migrations. You write exactly what the database runs.
- **Small and fast.** One CLI, one JSON config, three runtime dependencies. A command starts in about 100 ms, Node.js included, and only the driver of the database in use is loaded.
- **See before you run.** At the terminal, every command that changes the schema shows the exact SQL and asks before running it. `--dry-run` prints it without asking. In CI and deploys nothing changes: it never asks there.
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
- **Safe column type changes.** `alter` checks every value, tests the migration (up and down) on a copy of the table and writes it only if no value is lost. The migration checks the values again on each database, so production is not changed if it has other values. Enums work the same on the three DBMS.
- **Many clients.** With `tenants`, the same files migrate a schema, database, server or SQLite file per client, each with its own history and lock. The list can come from a query, so a new client is a new row. A client that fails doesn't change the others, migrations that would touch another client are rejected before running, and `status --all-tenants` shows who is behind.
- **Script and AI friendly.** Exit code `1` on errors, `--json` output, `schema` to read the real schema and `check` to find secrets and risky SQL before running. AI agents can write and review migrations without ez-migrate sending anything to a model.

### Disadvantages

- **`check` uses patterns.** It finds common secrets and risky statements, not all of them. It is a safety net, not a full secret scanner or SQL linter.
- **MySQL migrations are not atomic.** A migration with several DDL statements can be left half applied. ez-migrate warns before running it and says what to undo if it fails, but it can't undo it for you. See [How tracking works](#how-tracking-works).
- **No data migrations.** You can't run an `UPDATE` to fill a new column inside a migration. You need a seed or a separate script.
- **`alter` changes one column type at a time.** It doesn't rename columns, change foreign keys or columns used by views, and its test copies the whole table, which is slow on very big tables. It doesn't change a big MySQL table without locking it: for that use gh-ost or pt-online-schema-change.
- **Edited seeds don't run again.** A seed is recorded by file name. If you change a seed that already ran, create a new seed file or use `seed --all`.
- **`baseline` has limits.** It doesn't export permissions, row level security policies or other PostgreSQL schemas, and `--data` loads all rows in memory, so it is not for big databases.
- **SQL is not portable.** A migration written for PostgreSQL may not run on MySQL.
- **Tenants run one after the other.** 1,000 tenants take 1,000 times one tenant. There are no groups of tenants yet (a migration for "all premium clients"), and `rollback` runs for one tenant at a time.
- **The tenant protection uses patterns.** A table alias with the same name as another tenant's schema (`beta.id` where `beta` is a table) is rejected; rename the alias. Changes inside a function body are only checked for names of other tenants.
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
- Projects where AI agents write migrations: `schema`, `check` and `--dry-run --json` let the agent work from the real schema and let a person see the SQL before it runs.
- Prototypes with SQLite that may move to PostgreSQL later (with SQL rewritten where needed).
- Starting with simple types (`VARCHAR`) and moving to better ones later (enums, smaller types), with `alter` checking that no value is lost.
- SaaS with one schema, database or SQLite file per client (tens to a few hundred clients), including clients with a few own migrations.

### Not recommended

- Projects that need data migrations (backfills, data transforms) as part of the migration history.
- Critical MySQL databases with complex multi-statement migrations, unless you keep one DDL statement per migration.
- Projects that must run the same migrations on several DBMS.
- Running migrations from application code.
- Copying big production databases with `baseline --data`. Use the DBMS backup tools for the data.
- Changing the type of columns of very big, busy MySQL tables: the `ALTER` locks the table while it copies it.
- PostgreSQL databases split in several schemas that reference and change each other (other than one schema per tenant), or that depend on permissions and row level security in the migrations.
- Thousands of tenants that must be migrated in a few minutes: tenants run one at a time.

---

## Development and tests

```bash
pnpm install
pnpm run db:up      # MySQL 8.4 on port 33306 and PostgreSQL 16 on port 55432 (Docker)
pnpm test           # build and run all tests
pnpm run lint
pnpm run db:down
```

Tests run the built CLI against real databases: every command on MySQL, PostgreSQL and SQLite, with the tracker on a different DBMS, and with tenants (schemas, databases, URLs and SQLite files). CI runs the same on every push and pull request.

Contributions: create a branch, add a test for your change, add an entry to [CHANGELOG.md](https://github.com/Ky210299/ez-migrate/blob/main/CHANGELOG.md) and open a pull request. Guidelines for coding agents are in [.github/AGENTS.md](https://github.com/Ky210299/ez-migrate/blob/main/.github/AGENTS.md).

---

## Changelog

See [CHANGELOG.md](https://github.com/Ky210299/ez-migrate/blob/main/CHANGELOG.md). Versions follow [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`).

## License

[MIT](https://github.com/Ky210299/ez-migrate/blob/main/LICENSE) © Leonardo Bazán Márquez ([@ky210299](https://github.com/ky210299))

Issues and ideas: [github.com/Ky210299/ez-migrate/issues](https://github.com/Ky210299/ez-migrate/issues)
