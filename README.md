# @ky210299/ez-migrate

A lightweight CLI for database migrations and SQL seeds—designed for simplicity, speed, and reliability.

**What makes it unique?**

- **Unified workflow:** manage both migrations and data seeds with one tool.

- **Zero boilerplate:** generates timestamp-based SQL files out of the box.



---

## 🚀 Installation

```bash
# Global install (recommended)
npm install -g @ky210299/ez-migrate

# Local install
npm install @ky210299/ez-migrate
```

Run via:

```bash
# If installed globally:
ez-migrate <command> [options]

# If installed locally:
npx @ky210299/ez-migrate <command> [options]
```

---

## ⚙️ Configuration

Initialize a minimal config file in your project root:

```bash
ez-migrate init [path]
```

Generates `ez-migrate.json` with defaults:

```json
{
  "dialect": "mysql",
  "trackerDialect": "sqlite",
  "migrationsPath": "./migrations",
  "seedsPath": "./seeds",
  "envKeys": {
    "user": "DB_USER",
    "password": "DB_PASSWORD",
    "port": "DB_PORT",
    "host": "DB_HOST",
    "database": "DB_NAME"
  },
  "sqlite": { "trackerPath": "./migrations" }
}
```

Set your environment variables (`DB_HOST`, `DB_USER`, etc.) before running commands.

---

## 📚 Commands

```bash
ez-migrate <command> [options]
```

- \*\*make\*\*\
  Create a new migration file in `migrations/`.

  - `-s, --seed`: create a seed file in `seeds/` instead.

- **seed**\
  Execute all SQL seed files in order.

- **init [path]**\
  Generate config, migrations and seeds folders (if missing).

- **status**\
  Display applied vs pending migrations.

- **migrate**\
  Apply all pending migrations.

- **up**\
  Run the next pending migration.

- **down**\
  Roll back the most recent migration.

- **rollback**\
  Revert the last batch of migrations.

- **reset**\
  Roll back all migrations to zero.

- **redo**\
  Undo and reapply the last migration.



**Examples**

```bash
# Create a new migration
ez-migrate make add_users_table

# Create a new seed
ez-migrate make populate_demo_data --seed

# Apply pending migrations
ez-migrate migrate

# Roll back last batch
ez-migrate rollback

# Check current status
ez-migrate status
```

