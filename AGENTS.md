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
npx eslint src/
```

## Testing

Currently, this project does not have formal test suites configured. The package.json test script is a placeholder. To run tests once implemented:

```bash
# Run all tests (when implemented)
pnpm test

# Run single test (when implemented)
# Pattern will depend on test framework choice
```

## Code Style Guidelines

### TypeScript Configuration
- Strict mode enabled (`"strict": true`)
- Target: ES2016
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

### Configuration
- Configuration file: `ez-migrate.json` (handled by `ConfigReader`)
- Environment variables support with customizable keys
- Default configurations in `src/constants.ts`

### Logging
- Use the logger interface from `src/Logger.ts`
- Exported `consoleLogger` instance should be used consistently
- Logger supports `info`, `warn`, and `error` methods

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
2. Run build command: `pnpm run build`
3. Run linting: `npx eslint src/`
4. Test commands manually using the built CLI

## Package Manager

This project uses pnpm as evidenced by the build script, but npm commands also work.

## Special Notes

- The project compiles to CommonJS for CLI compatibility
- Main entry point is `dist/ez-migrate.js`
- The CLI tool is designed to be both globally installable and locally runnable
- No test framework is currently configured - this would be a valuable addition for future development