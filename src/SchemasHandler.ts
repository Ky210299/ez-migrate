import { writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { ERRORS, isErrnoException } from "./Errors";
import { DEFAULT_MIGRATION_PATH } from "./constants";
import { randomUUID } from "node:crypto";
import Migration from "./Migration";

type SchemaHandlerArguments = { migrationsPath: string };

/** Class for handle the migrations file schemas */
export default class SchemasHandler {
    /** The separator for up and down sql  */
    private readonly upDownSeparatorRE = /^-- ez-migration-(up|down)/gm;
    private readonly migrationsPath: string;
    /** Migration file template. It's necessary to use this for successfuly run migrations */
    private readonly migrationSQLTemplate = `
-- ez-migration-up
    -- Write the SQL to apply the migration here
-- ez-migration-up
    -- (Optional) Add comments or leave empty between up/down sections
-- ez-migration-down
    -- Write the SQL to revert the migration here
-- ez-migration-down
`.trim();
    constructor({ migrationsPath }: SchemaHandlerArguments) {
        this.migrationsPath = migrationsPath ?? DEFAULT_MIGRATION_PATH;
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
    getSchemasFilesName(): Array<string> {
        this.ensureMigrationPathExists();
        if (this.migrationsPath == null) throw new Error("No migrations path provided");
        const schemas = readdirSync(this.migrationsPath).filter((path) => path.endsWith(".sql"));
        return schemas;
    }

    private addMigrationPathToSchemasName(schemasFilesNames: Array<string>): Array<string> {
        return schemasFilesNames.map((name) => this.migrationsPath + "/" + name);
    }

    readSQL(sqlPath: string) {
        return readFileSync(sqlPath, "utf8");
    }

    private splitUpAndDownFromSQL(sql: string) {
        const matches = sql.matchAll(this.upDownSeparatorRE);
        let info = [];
        for (const match of matches) {
            const [text, direction] = match;
            const { index } = match;
            info.push({ text, direction, index });
        }
        const upInfo = info.filter((inf) => inf.direction === "up").slice(0, 2);
        const downInfo = info.filter((inf) => inf.direction === "down").slice(0, 2);
        
        if (upInfo.length + downInfo.length < 3) {
            throw new Error("Bad SQL migration format. Use the correct template");
        }
        const upIndexs = upInfo.map(({ index }) => index);
        const downIndexs = downInfo.map(({ index }) => index);

        const upCommentLen = upInfo[0].text.length;
        const downCommentLen = downInfo[0].text.length;

        upIndexs[0] = upIndexs[0] + upCommentLen;
        downIndexs[0] = downIndexs[0] + downCommentLen;

        const up = sql.slice(...upIndexs);
        const down = sql.slice(...downIndexs);

        if (!up.trim()) throw new Error("The UP migration section is empty");
        if (!down.trim()) throw new Error("The DOWN migration section is empty");

        return { up: up.replace(/\n/g, ""), down: down.replace(/\n/g, "") };
    }

    makeMigrationFile(name: string) {
        if (!name) throw new Error("Name is needed for create a new migration file");

        const now = Migration.getPreciseNow();
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
        if (!schemasFilesName.some((m) => m.startsWith(migrationFileName)))
            throw new Error(
                "The reference migration must be an existing migration file, in the migration folder",
            );
        const nextSchema = schemasFilesName.find(
            (migrationName) => migrationName.endsWith(".sql") && migrationName > migrationFileName,
        );
        if (nextSchema == null) return null;

        const path = `${this.migrationsPath}/${nextSchema}`;
        return new Migration({
            batchId: randomUUID(),
            ...this.splitUpAndDownFromSQL(this.readSQL(path)),
            path,
        });
    }
    before(migrationFileName: string) {
        const schemasFilesName = this.getSchemasFilesName();
        if (!schemasFilesName.some((m) => m.startsWith(migrationFileName)))
            throw new Error(
                "The reference migration must be an existing migration file, in the migration folder",
            );
        const previousSchema = schemasFilesName
            .reverse()
            .find(
                (migrationName) =>
                    migrationName.endsWith(".sql") && migrationName < migrationFileName,
            );
        if (previousSchema == null) return null;

        const path = `${this.migrationsPath}/${previousSchema}`;
        return new Migration({
            batchId: randomUUID(),
            ...this.splitUpAndDownFromSQL(this.readSQL(path)),
            path,
        });
    }

    allNextTo(migrationFileName: string) {
        const schemasFilesName = this.getSchemasFilesName();
        if (!schemasFilesName.some((m) => m.startsWith(migrationFileName)))
            throw new Error(
                "The reference migration must be an existing migration file, in the migration folder",
            );
        const nextSchemas = schemasFilesName.filter(
            (migrationName) => migrationName.endsWith(".sql") && migrationName > migrationFileName,
        );
        const batchId = randomUUID() as unknown as string;
        return nextSchemas.flatMap((schemaName) => {
            if (schemaName == null) return [];

            const path = `${this.migrationsPath}/${schemaName}`;
            return new Migration({
                batchId,
                ...this.splitUpAndDownFromSQL(this.readSQL(path)),
                path,
            });
        });
    }

    allBeforeTo(migrationFileName: string) {
        const schemasFilesName = this.getSchemasFilesName();
        if (!schemasFilesName.some((m) => m.startsWith(migrationFileName)))
            throw new Error(
                "The reference migration must be an existing migration file, in the migration folder",
            );
        const nextSchemas = schemasFilesName
            .reverse()
            .filter(
                (migrationName) =>
                    migrationName.endsWith(".sql") && migrationName < migrationFileName,
            );
        const batchId = randomUUID() as unknown as string;
        return nextSchemas.flatMap((schemaName) => {
            if (schemaName == null) return [];

            const path = `${this.migrationsPath}/${schemaName}`;
            return new Migration({
                batchId,
                ...this.splitUpAndDownFromSQL(this.readSQL(path)),
                path,
            });
        });
    }

    getSQLMigration() {
        const schemasFilesNames = this.getSchemasFilesName();
        const schemasPaths = this.addMigrationPathToSchemasName(schemasFilesNames);
        return this.combineSchemas(schemasPaths);
    }
    
    getAllMigrations() {
        const schemasFilesNames = this.getSchemasFilesName();
        return this.addMigrationPathToSchemasName(schemasFilesNames).sort();
    }
    
    makeMigrationFromFile(filePath: string, batchId?: string) {
        const sql = this.readSQL(filePath)
        if (!sql) throw new Error("Migration file is empty or doesn't exists");
        return new Migration({
            batchId: batchId ?? randomUUID(),
            ...this.splitUpAndDownFromSQL(sql),
            path: filePath,
        });
    }
}
