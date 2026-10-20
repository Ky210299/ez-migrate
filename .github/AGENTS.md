# AGENTS.md

This file contains guidelines and commands for agentic coding agents working on the ez-migrate project.

## Project Overview

ez-migrate is a lightweight CLI tool for database migrations and SQL seeds. It's written in TypeScript and supports MySQL, PostgreSQL, and SQLite databases.

## Build Commands

```bash
# Build the project
pnpm run build
# OR
npm run build

# Type checking
npx tsc --noEmit

# Linting
pnpm run lint
```

## Testing

Integration tests run the built CLI against real databases. MySQL and Postgres run in
containers (`docker-compose.yml`); SQLite uses files in a temp folder.

```bash
pnpm run db:up      # start MySQL (port 33306) and Postgres (port 55432)
pnpm test           # build + run all tests (Vitest)
pnpm exec vitest run -t "postgres > migrate"   # run a subset by name
pnpm run db:down    # stop the databases
```

- Tests live in `tests/`. `tests/helpers.ts` creates a temp project per test with its own database.
- Every use case is tested against every dialect with `describe.each(DIALECTS)`.
- A new feature or bug fix needs a test that fails without the change.
- CI (`.github/workflows/test.yml`) runs lint and the full suite on every push and PR.

## Versioning and changelog

- Semantic Versioning: MAJOR.MINOR.PATCH. Breaking change: MAJOR (MINOR while < 1.0.0). New feature: MINOR. Fix: PATCH.
- Every change adds an entry to `CHANGELOG.md` under `## [Unreleased]` (Added, Changed, Fixed, Removed).
- On release, rename `[Unreleased]` to the new version with the date and bump `package.json`, merge, then run the `Release` workflow on main (or push the tag `vX.Y.Z`). `.github/workflows/release.yml` tests, publishes to npm and creates the tag.
- Keep the README section "Advantages, disadvantages and use cases" up to date with what you learn.
- Markdown files written for agents go in `.github/`, not in the repository root.

## Code Style Guidelines

### TypeScript Configuration
- Strict mode enabled (`"strict": true`)
- Target: ES2022
- Module system: CommonJS
- Output directory: `./dist/`
- Skip lib checking: true

### ESLint Configuration
- Uses ESLint 9.x with TypeScript ESLint
- Follows recommended configs from `@eslint/js` and `typescript-eslint`
- Configuration is in `eslint.config.mjs`

### Import Conventions
- Use relative imports for internal modules: `import ConfigReader from "../ConfigReader"`
- Import external packages: `import { Command } from "commander"`
- File extensions in imports should use `.js` for TypeScript files (due to CommonJS output)
- Group imports: external packages first, then internal modules

### Naming Conventions
- Classes: PascalCase (e.g., `ConfigReader`, `Make`)
- Files: PascalCase for classes (e.g., `ConfigReader.ts`), camelCase for others
- Constants: UPPER_SNAKE_CASE (e.g., `CONFIG_PATH`, `DEFAULT_CONFIG`)
- Variables and functions: camelCase
- Interfaces: PascalCase with descriptive names (e.g., `ConsoleLogger`, `FileLogger`)

### Class Structure
- Static classes should have private constructors and throw errors if instantiated
- Use static methods for utility operations
- Example:
```typescript
export default class Make {
    private constructor() { throw new Error("Make is a static class") }
    static run(name: string) {
        // implementation
    }
}
```

### Error Handling
- Custom error classes should extend `Error` and have a clear constructor
- Use type guards for error checking
- Log errors using the configured logger
- Example error handling patterns are in `src/Errors.ts`

### Type Definitions
- All type definitions should be in `src/types.d.ts`
- Use `as const` for constants that should be literal types
- Prefer interfaces over type aliases for object shapes
- Use proper TypeScript typing with strict mode enabled

### Directory Structure
- `src/use-cases/`: CLI command implementations
- `src/`: Core functionality (database connectors, config management, etc.)
- Each use case should be a default export class with static `run` method

### Database Abstractions
- Support for MySQL, PostgreSQL, and SQLite
- Each database dialect has its own tracker implementation
- Use factory pattern for database connections and trackers

### Schema export (`baseline`)
- `src/SchemaDumper.ts` reads the schema and data of the target database, one method per dialect, through `DatabaseConnector.query` (raw text values, no driver parsing).
- `tests/baseline.test.ts` checks the round trip: database A → `baseline --data` → migrate + seed on empty database B → same schema and data. Add a column type or object there when you change the dumper.
- Objects that depend on others are ordered by hand in each `dump*` method (PostgreSQL: functions whose signature uses a table type go after the tables). The down section drops in the reverse order.
- `dumpData` returns a data file that turns triggers and foreign keys off and on again around the inserts. `SeedHandler.readDataFile` only accepts those DDL statements (`DataLoadToggleRegExp`); keep both in sync.
- `seed --file` runs through `DatabaseConnector.loadData`. A connector can define `loadData` when its DBMS loads data faster another way (SQLite: foreign keys off, then `PRAGMA foreign_key_check` before commit).
- Before a release that changes the dumper, also try real sample databases (Sakila, Pagila, Chinook, Northwind): load one into database A, run `baseline --data`, migrate and `seed --file` into B, and compare `pg_dump`/`mysqldump`/`sqlite_schema` and row checksums. The samples are not in the repo (`*.sql` is ignored).

### Column type changes (`alter`)
- `src/use-cases/Alter.ts` is the command. `src/AlterColumn.ts` has the shared parts (target type, report types, `testOnCopy`), and `src/AlterMysql.ts`, `src/AlterPostgres.ts`, `src/AlterSqlite.ts` one class per DBMS (`inspect`, `plan`, `analyze`, `createReplica`, `differences`). They are loaded with `require` like the drivers.
- A value "stays the same" if converting it to the new type and back gives the same text. The value check (`analyze`), the guard inside the generated migration and the comparison on the copy (`differences`) must use the same rule, or the report and the real run disagree.
- The generated SQL can't start statements with `INSERT INTO ... VALUES`, `UPDATE` or `DELETE` (migrations reject DML). MySQL uses `CREATE TEMPORARY TABLE ... SELECT` with a `CHECK`, PostgreSQL a `DO` block with `RAISE`, SQLite `INSERT INTO ... SELECT ... FROM` (allowed: `COPY_ROWS` in `SchemasHandler`).
- The guard must stop before any change: MySQL commits DDL, so the guard runs before the `ALTER` and only uses `SET` and temporary tables (not counted by `nonAtomicWarning`).
- SQLite rebuilds the table (`PRAGMA foreign_keys = OFF;` first, handled by `sqlite.ts` `runSQL`; `legacy_alter_table` around the rename so views stay valid; indexes and triggers created again).
- Tests: `tests/alter.test.ts`, every case on the three DBMS.

### SQL parsing
- All SQL inspection goes through `src/sql.ts`. `splitStatements` returns statements without comments and with quoted text emptied, for checks only (never to run them). A `;` inside quotes, `$$` strings, parentheses or a `BEGIN ... END` / `CASE ... END` block doesn't split.
- Data files can have many MB: copy text in chunks (`transform`), never char by char or with `slice` in a loop, and parse the file once.

### Configuration
- Configuration file: `ez-migrate.json` (handled by `ConfigReader`)
- Environment variables support with customizable keys
- Connection data (env vars, `envKeys.url`, `ssl`) is built only in `src/ConnectionOptions.ts` (`connectionOptions`). Never print a connection URL or password, even in errors.
- Default configurations in `src/constants.ts`

### Logging and tracing
- Use the exported `consoleLogger` from `src/Logger.ts` (`error`, `warn`, `info`, `debug`, with optional fields). It has no dependencies; keep it that way, startup time matters.
- Wrap a step that can be slow or fail in `tracer.span(name, attrs, fn)` from `src/Tracer.ts`. Use names like `db.*`, `tracker.*`, `migration.*`.
- Never log or trace SQL text or values (they can contain personal data). Log file names and sizes instead. `tests/observability.test.ts` checks this.
- Command output (like the `status` list) goes to `console.log`, not the logger.
- Database drivers are loaded with `require` inside the factories so commands don't pay for drivers they don't use. Don't import `mysql2`, `pg` or the connection classes at the top of shared modules.

### Locks and trackers
- Commands that change the database run inside `withLockedTracker(config, fn)` from `src/TrackerSession.ts`. It creates the tracker, takes the lock (`Repository.withLock`), and always closes it.
- One command takes one lock. A use case that another one reuses has two methods: `run` (takes the lock) and a static method that receives an already locked tracker (`Migrate.apply`, `Down.revertLast`). Call that method from other use cases, never `run`, or the command waits for its own lock.
- Read-only commands (`status`, `--dry-run`) use `withTracker` (no lock), and `seed --file` takes no lock.
- Commands that apply or revert migrations go through `runPlan` (`src/RunPlan.ts`) with two functions: `makePlan` (the only place that chooses the migrations) and `execute`. `runPlan` uses the same `makePlan` for `--dry-run`, for the confirmation question and for the real run under the lock, so the three always agree. The SQL goes to stdout with `printDryRun` / `printPlan`, never to the logger.
- The confirmation question only appears with a terminal and without `CI` (`mustConfirm`). Tests run without a terminal, so they never see it; `tests/confirm.test.ts` uses `Project.runInTerminal` (the `script` command) to test it.
- `MigrationExecutor.close()` only closes the target connection. Whoever creates the tracker closes it.
- `migrate` and `up` call `SchemasHandler.checkAppliedUnchanged` before applying anything.
- Tests for locks, SSL and changed migrations are in `tests/safety.test.ts`. The SSL users and test certificate are in `tests/fixtures/`.

### Tenants
- `src/Tenants.ts` has no I/O: it validates and fills each tenant (`resolveTenant`), gives its connection data (`tenantConnection`), and has `crossTenantProblem`, the check that a migration only changes its tenant. `src/TenantRunner.ts` loads the list (`list`, `file` or `query`), reads `--tenant` / `--all-tenants` in the CLI `preAction` hook (`prepareTenants`), and runs a plan for several tenants (`runPlanForTenants`).
- One tenant (`--tenant a`): `ConfigReader` sets `config.tenant`, and `ConnectionFactory`, `TrackerFactory` and `SchemasHandler.forConfig` use it. So every command works for one tenant without its own code. Always build a `SchemasHandler` with `forConfig(config)`, never from `config.migrationsPath` alone.
- Several tenants (`--all-tenants`, `--tenant a,b`): only `migrate` and `status` (`MULTI_TENANT_COMMANDS`). They loop with `configForTenant(base, tenant)`.
- The tracker of a tenant is always in the tenant (same schema, database, or `<name>.tracker.db`). With a PostgreSQL schema, `useSchema` sets `search_path` on the target and the tracker, and the advisory lock key uses `hashtext(schema)`. Without a tenant the lock key and every behavior must stay as before.
- Without `--tenant` / `--all-tenants`, a config with `tenants` behaves exactly as before. Keep a test for that.
- Tests are in `tests/tenants.test.ts` (every case on the three DBMS).

### Output for scripts and AI agents
- `--json` output (`status`, `check`, `schema`, `--dry-run`) is the command output: one JSON object on stdout with `console.log`. Logs stay on stdout/stderr through the logger as usual; tests parse from the first `{`.
- `check` (`src/Checker.ts`) never connects to the database and never prints the value of a secret: only file, line and rule. Add new rules there with a test in `tests/agents.test.ts`.
- `schema` reuses `SchemaDumper.dumpSchema` and never reads rows.
- ez-migrate never calls an AI model or sends the schema anywhere. Keep it that way: AI support means output that agents can use, not network calls.

### CLI Patterns
- All CLI commands are in `src/CLI.ts`
- Commands use Commander.js for argument parsing
- Each command maps to a use case class with a static `run` method

### Constants
- Store all magic strings and numbers in `src/constants.ts`
- Use typed constants for database dialects and paths

### File Extensions
- Source files: `.ts`
- Type definition files: `.d.ts`
- Exported binary: `.js` (in `dist/`)

## Development Workflow

1. Make changes to TypeScript files in `src/`
2. Add or update tests in `tests/`
3. Run `pnpm run lint` and `pnpm test` (with `pnpm run db:up` running)
4. Add the change to `CHANGELOG.md`

## Package Manager

This project uses pnpm as evidenced by the build script, but npm commands also work.

## Special Notes

- The project compiles to CommonJS for CLI compatibility
- Main entry point is `dist/ez-migrate.js`
- The CLI tool is designed to be both globally installable and locally runnable
- No test framework is currently configured - this would be a valuable addition for future development