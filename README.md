# @ky210299/ez-migrate

A lightweight CLI for database migrations and SQL seeds—designed for simplicity, speed, and reliability.  
Perfect for small-to-medium projects that need an easy, zero-boilerplate way to version your schema and seed data.

---

## 📑 Table of Contents

1. [Installation](#-installation)  
2. [Usage](#-usage)  
3. [Configuration](#-configuration)  
   - [ez-migrate.json](#ez-migratejson)  
   - [dialect](#-dialect)  
   - [migrationsPath](#-migrationspath)  
   - [seedsPath](#-seedspath)  
   - [envKeys](#-envkeys)  
   - [tracker](#-tracker)  
4. [Commands](#-commands)  
5. [Examples](#-examples)  
6. [Environment Variables](#-environment-variables)  
7. [Contributing](#-contributing)  
8. [Author](#-author)
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
npx ez-migrate <command> [options]
```

---

## 🔧 Usage

Initialize a minimal config file in your project root:

```bash
ez-migrate init [path]
```

---

## ⚙️ Configuration

When you run `ez-migrate init`, it will generate an `ez-migrate.json` file (and create the migrations/seeds folders if missing)

### ez-migrate.json

This file defines how database migrations and seeds are managed and executed.

#### 🔹 `dialect`
The database type where migrations will be applied.  
**Possible values:** `"mysql"`, `"sqlite"`, `"postgres"` (others may be added in the future).

#### 🔹 `migrationsPath`
Path to the directory where SQL migration files are stored.  
**Example:** `"./migrations"`

#### 🔹 `seedsPath`
Path to the directory where SQL seed files are stored.  
**Example:** `"./seeds"`

#### 🔸 `envKeys`
Specifies the environment variable names used to connect to the database target of migrations.

```json
{
  "user": "DB_USER",         
  "password": "DB_PASSWORD", 
  "port": "DB_PORT",         
  "host": "DB_HOST",         
  "database": "DB"      
}
```

#### 🔸 `tracker`
Configuration for the **tracker database**, used to record which migrations have been applied.

```json
{
  "envKeys": {
    "user": "TRACKER_USER",         
    "password": "TRACKER_PASSWORD",
    "port": "TRACKER_PORT",         
    "host": "TRACKER_HOST",         
    "database": "TRACKER_NAME"      
  },
  "dialect": "postgres",
  "sqlitePath": "./migrations" 
}
```

### Example 1:
```json
{
    "dialect": "postgres",
    "envKeys": {
        "user": "DB_USER",
        "password": "DB_PASSWORD",
        "port": "DB_PORT",
        "host": "DB_HOST",
        "database": "DB"
    },
    "tracker": {
        "envKeys": {
            "user": "TRACKER_USER",
            "password": "TRACKER_PASSWORD",
            "port": "TRACKER_PORT",
            "host": "TRACKER_HOST",
            "database": "TRACKER_DB"
        },
        "dialect": "mysql"
    }
}
```
.env file that fit with the ez-migrate.json:
```dotenv
DB_USER=leonardobazanmarquez
DB_PASSWORD=my_super_password
DB_PORT=5432
DB_HOST=exampledbhost.com
DB=my_db_name

TRACKER_USER=root
TRACKER_PASSWORD=xyzabc122
TRACKER_PORT=3306
TRACKER_HOST=mytrackerhost.com
TRACKER_DB=my_tracker_database_name
```

### Example 2:
```json
# ez-migrate.json
{
    "dialect": "mysql",
    "envKeys": {
        "user": "DB_USER",
        "password": "DB_PASSWORD",
        "port": "DB_PORT",
        "host": "DB_HOST",
        "database": "DB"
    },
}
```
.env file that fit with the previous ez-migrate.json:
```dotenv
DB_USER=leonardobazanmarquez
DB_PASSWORD=my_super_password
DB_PORT=5432
DB_HOST=exampledbhost.com
DB=my_db_name
```
The previous example uses the same database and DBMS as the migration target.
---
This setup uses the same MySQL database for both migrations and tracking.

## 📚 Commands

```bash
ez-migrate <command> [options]
```

- **make**  
  Create a new migration file in `migrations/`.  
  - `-s, --seed`: create a seed file in `seeds/` instead.

- **seed**  
  Execute all SQL seed files in order.

- **init [path]**  
  Generate config file

- **status**  
  Display applied vs pending migrations.

- **migrate**  
  Apply all pending migrations.

- **up**  
  Run the next pending migration.

- **down**  
  Roll back the most recent migration.

- **rollback**  
  Revert the last batch of migrations done.

- **reset**  
  Roll back and apply all migrations

- **redo**  
  Undo and reapply the last migration.

---

## 💡 Examples

```bash
# Create a new migration
ez-migrate make add_users_table

# Create a new seed
ez-migrate make --seed populate_demo_data

# Apply pending migrations
ez-migrate migrate

# Roll back last batch
ez-migrate rollback

# Check current status
ez-migrate status
```

---

## 🔑 Environment Variables

Make sure you have set your environment variables and are specified in your ez-migrate.json before running any commands.
You can use a `.env` file
If you use it without .env or ez-migrate.json, default configurations are used (MySQL for migrations and tracking)

```dotenv
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=secret
DB_PORT=3306
DB=my_database_name
```

---

## 🤝 Contributing

1. Fork the repo  
2. Create a feature branch (`git switch -c feat/my-feature`)  
3. Commit your changes (`git commit -m '{feat|fix|ref|chore}: Add this ..'`)  
4. Push to the branch (`git push origin feat/my-feature`)
5. Open a Pull Request  

---

## 👤 Author

[@ky210299](https://github.com/ky210299)
