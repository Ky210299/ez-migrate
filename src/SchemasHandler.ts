import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { ERRORS, isErrnoException } from "./Errors";

type Config = {
    migrationsPath?: string; // Without "/" at the end
};

class SchemasHandler {
    private readonly DEFAULT_MIGRATION_PATH = "./migrations";
    private config: Config;
    constructor(config: Config = {}) {
        this.config = {
            ...config,
            migrationsPath: config.migrationsPath ?? this.DEFAULT_MIGRATION_PATH,
        };
    }

    private ensureMigrationPathExists() {
        try {
            if (this.config.migrationsPath == null) return;
            mkdirSync(this.config.migrationsPath);
        } catch (err) {
            if (isErrnoException(err)) {
                const { errno } = err;
                if (errno === ERRORS) return;
            }
            throw err;
        }
    }
    private getSchemasFilesName(): Array<string> {
        this.ensureMigrationPathExists();
        if (this.config.migrationsPath == null) throw new Error("No migrations path provided");
        const schemas = readdirSync(this.config.migrationsPath).filter((path) =>
            path.endsWith(".sql"),
        );
        return schemas;
    }

    private addMigrationPathToSchemasName(schemasFilesNames: Array<string>): Array<string> {
        return schemasFilesNames.map((name) => this.config.migrationsPath + "/" + name);
    }

    private readSQL(sqlPath: string) {
        return readFileSync(sqlPath);
    }

    private combineSchemas(schemasPaths: Array<string>): string {
        let finalSql = "";
        for (const path of schemasPaths) {
            finalSql += this.readSQL(path) + "\n";
        }
        return finalSql;
    }

    getSQLMigration() {
        const schemasFilesNames = this.getSchemasFilesName();
        const schemasPaths = this.addMigrationPathToSchemasName(schemasFilesNames);
        return this.combineSchemas(schemasPaths);
    }
}

export default new SchemasHandler();
