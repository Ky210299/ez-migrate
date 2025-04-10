import { writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { ERRORS, isErrnoException } from "./Errors";
import ConfigReader from "./ConfigReader";

class SchemasHandler {
    private readonly upDownSeparatorRE = /^-- ez-migration-(up|down)\n/gm;
    private readonly DEFAULT_MIGRATION_PATH = "./migrations";
    private readonly migrationsPath: string;
    private readonly migrationSQLTemplate = `
-- ez-migration-up
-- 👆 Write the SQL to apply the migration here
-- ez-migration-up

-- (Optional) Add comments or leave empty between up/down sections

-- ez-migration-down
-- 👇 Write the SQL to revert the migration here
-- ez-migration-down
    `;
    constructor() {
        const { migrationsPath } = ConfigReader.getConfig();
        this.migrationsPath = migrationsPath ?? this.DEFAULT_MIGRATION_PATH;
    }

    private ensureMigrationPathExists() {
        try {
            if (this.migrationsPath == null) return;
            mkdirSync(this.migrationsPath);
        } catch (err) {
            if (isErrnoException(err)) {
                const { errno } = err;
                if (errno === ERRORS.FILE_ALREADY_EXISTS.errno) return;
            }
            throw err;
        }
    }
    private getSchemasFilesName(): Array<string> {
        this.ensureMigrationPathExists();
        if (this.migrationsPath == null) throw new Error("No migrations path provided");
        const schemas = readdirSync(this.migrationsPath).filter((path) => path.endsWith(".sql"));
        return schemas;
    }

    private addMigrationPathToSchemasName(schemasFilesNames: Array<string>): Array<string> {
        return schemasFilesNames.map((name) => this.migrationsPath + "/" + name);
    }

    private readSQL(sqlPath: string) {
        return readFileSync(sqlPath);
    }

    private splitUpAndDownFromSQL(sql: string) {
        const matches = sql.matchAll(this.upDownSeparatorRE);
        let info = [];
        for (const match of matches) {
            const [text, direction] = match;
            const { index } = match;
            info.push({ text, direction, index });
        }
        const upInfo = info.flatMap((inf) => {
            if (inf.direction !== "up") return [];
            else return inf;
        });
        const downInfo = info.flatMap((inf) => {
            if (inf.direction !== "down") return [];
            else return inf;
        });
        const upIndexs = upInfo.map(({ index }) => index);
        const downIndexs = downInfo.map(({ index }) => index);

        const upCommentLen = upInfo[0].text.length;
        const downCommentLen = downInfo[0].text.length;

        upIndexs[0] = upIndexs[0] + upCommentLen;
        downIndexs[0] = downIndexs[0] + downCommentLen;

        const up = sql.slice(...upIndexs);
        const down = sql.slice(...downIndexs);

        return { up, down };
    }

    makeMigrationFile(name: string) {
        if (!name) throw new Error("Name is needed for create a new migration file");

        const now = new Date().toISOString().substring(0, 19);
        const endWithSlash = this.migrationsPath.endsWith("/");
        const path = `${this.migrationsPath}${endWithSlash ? "" : "/"}${now}-${name}.sql`;

        if (existsSync(path)) throw new Error("The migration file already exists");
        writeFileSync(path, this.migrationSQLTemplate);
    }

    private combineSchemas(schemasPaths: Array<string>): string {
        let finalSql = "";
        for (const path of schemasPaths) {
            finalSql += this.readSQL(path) + "\n";
        }
        return finalSql;
    }

    next(migrationFileName: string) {
        const schemasFilesName = this.getSchemasFilesName();
        if (!schemasFilesName.includes(migrationFileName))
            throw new Error(
                "The reference migration must be an existing migration file, in the migration folder",
            );
        const nextSchema = schemasFilesName.find(
            (migrationName) => migrationName.endsWith(".sql") && migrationName > migrationFileName,
        );
        return nextSchema != null ? `${this.DEFAULT_MIGRATION_PATH}/${nextSchema}` : null;
    }
    before(migrationFileName: string) {
        const schemasFilesName = this.getSchemasFilesName();
        if (!schemasFilesName.includes(migrationFileName))
            throw new Error(
                "The reference migration must be an existing migration file, in the migration folder",
            );
        const nextSchema = schemasFilesName
            .reverse()
            .find(
                (migrationName) =>
                    migrationName.endsWith(".sql") && migrationName < migrationFileName,
            );
        return nextSchema != null ? `${this.DEFAULT_MIGRATION_PATH}/${nextSchema}` : null;
    }

    allNextTo(migrationFileName: string) {
        const schemasFilesName = this.getSchemasFilesName();
        if (!schemasFilesName.includes(migrationFileName))
            throw new Error(
                "The reference migration must be an existing migration file, in the migration folder",
            );
        const nextSchemas = schemasFilesName.filter(
            (migrationName) => migrationName.endsWith(".sql") && migrationName > migrationFileName,
        );
        return nextSchemas.map((schemaName) => `${this.DEFAULT_MIGRATION_PATH}/${schemaName}`);
    }

    allBeforeTo(migrationFileName: string) {
        const schemasFilesName = this.getSchemasFilesName();
        if (!schemasFilesName.includes(migrationFileName))
            throw new Error(
                "The reference migration must be an existing migration file, in the migration folder",
            );
        const nextSchemas = schemasFilesName
            .reverse()
            .filter(
                (migrationName) =>
                    migrationName.endsWith(".sql") && migrationName < migrationFileName,
            );
        return nextSchemas.map((schemaName) => `${this.DEFAULT_MIGRATION_PATH}/${schemaName}`);
    }

    getSQLMigration() {
        const schemasFilesNames = this.getSchemasFilesName();
        const schemasPaths = this.addMigrationPathToSchemasName(schemasFilesNames);
        return this.combineSchemas(schemasPaths);
    }
}

export default new SchemasHandler();
