import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { scheduler } from "node:timers/promises";

type Options = {
    migrationsPath?: string; // Without "/" at the end
};

export function isErrnoException(err: unknown) {
    return (
        err != null &&
        typeof err === "object" &&
        "errno" in err &&
        "code" in err &&
        "path" in err &&
        "syscall" in err
    );
}

class SchemasHandler {
    private readonly DEFAULT_MIGRATION_PATH = "./migrations";
    private opts: Options;
    constructor(opts: Options = {}) {
        this.opts = {
            ...opts,
            migrationsPath: opts.migrationsPath ?? this.DEFAULT_MIGRATION_PATH,
        };
    }

    private ensureMigrationPathExists() {
        try {
            if (this.opts.migrationsPath == null) return;
            mkdirSync(this.opts.migrationsPath);
        } catch (err) {
            if (isErrnoException(err)) {
                const { errno } = err;
                if (errno === -17) return;
            }
            throw err;
        }
    }
    private getSchemasFilesName(): Array<string> {
        this.ensureMigrationPathExists();
        if (this.opts.migrationsPath == null) throw new Error("No migrations path provided");
        const schemas = readdirSync(this.opts.migrationsPath).filter((path) =>
            path.endsWith(".sql"),
        );
        return schemas;
    }

    private addMigrationPathToSchemasName(schemasFilesNames: Array<string>): Array<string> {
        return schemasFilesNames.map((name) => this.opts.migrationsPath + "/" + name);
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
