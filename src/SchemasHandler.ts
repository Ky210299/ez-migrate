import { writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { ERRORS, isErrnoException } from "./Errors";
import { DEFAULT_MIGRATION_PATH } from "./constants";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import Migration from "./Migration";
import { isEmptySQL, normalizeSQL, splitStatements } from "./sql";
import { fileTimestamp } from "./utils";
import { consoleLogger } from "./Logger";

type SchemaHandlerArguments = { migrationsPath: string };

/** Class for handle the migrations file schemas */
export default class SchemasHandler {
    /** The separator for up and down sql  */
    private readonly upDownSeparatorRegExp = /^-- ez-migration-(up|down)/gm;
    private readonly DMLRegExp = /^(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE)\b/i
    private readonly migrationsPath: string;
    /** Migration file template. It's necessary to use this for successfuly run migrations */
    private readonly migrationSQLTemplate = `-- ez-migration-up
    -- Write the SQL to apply the migration here
-- ez-migration-up
    -- (Optional) Add comments or leave empty between up/down sections
-- ez-migration-down
    -- Write the SQL to revert the migration here
-- ez-migration-down
`.trim();
    constructor({ migrationsPath }: SchemaHandlerArguments) {
        this.migrationsPath = migrationsPath ?? DEFAULT_MIGRATION_PATH;
        mkdirSync(this.migrationsPath, {recursive: true})

    }
    /** True if a statement is DML. The body of a trigger or procedure is part of its CREATE statement */
    hasDML(sql: string){
        return splitStatements(sql).some(statement => this.DMLRegExp.test(statement));
    }

    private ensureMigrationPathExists() {
        try {
            if (this.migrationsPath == null) return;
            mkdirSync(this.migrationsPath);
        } catch (err) {
            if (isErrnoException(err)) {
                const { code } = err;
                if (code === ERRORS.FILE_ALREADY_EXISTS.code) return;
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
        const matches = sql.matchAll(this.upDownSeparatorRegExp);
        const info = [];
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

        // Keep the SQL as written: the database handles comments and line breaks
        const up = sql.slice(...upIndexs).trim();
        const down = sql.slice(...downIndexs).trim();

        if (isEmptySQL(up)) throw new Error("The UP migration section is empty");
        if (isEmptySQL(down)) throw new Error("The DOWN migration section is empty");
        
        return { up, down };
    }

    makeMigrationFile(name: string) {
        if (!name) throw new Error("Name is needed for create a new migration file");

        const now = fileTimestamp();
        const endWithSlash = this.migrationsPath.endsWith("/");
        const path = `${this.migrationsPath}${endWithSlash ? "" : "/"}${now}-${name}.sql`;

        if (existsSync(path)) throw new Error("The migration file already exists");
        writeFileSync(path, this.migrationSQLTemplate);
        return path
    }

    /** Write a migration file with the given up and down SQL. Returns its path */
    writeMigrationFile(name: string, up: string, down: string) {
        const path = this.makeMigrationFile(name);
        writeFileSync(path, `-- ez-migration-up\n${up.trim()}\n-- ez-migration-up\n-- ez-migration-down\n${down.trim()}\n-- ez-migration-down\n`);
        return path
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
    
    /**
     * Migrations whose file is not tracked as done, in file name order.
     * Files are compared by name, so a migration with an older name that was
     * added later (for example from another branch) is also pending.
     */
    getPendingMigrations(done: Array<Migration>, batchId: string = randomUUID()) {
        const doneNames = new Set(done.map(m => basename(m.getDetails().path)));
        return this.getAllMigrations()
            .filter(path => !doneNames.has(basename(path)))
            .map(path => this.makeMigrationFromFile(path, batchId));
    }

    /**
     * Applied migrations whose file changed after they were applied, as file paths.
     * Comments and whitespace are ignored. Old versions stored the SQL normalized
     */
    findChangedMigrations(done: Array<Migration>): Array<string> {
        const doneByName = new Map(done.map(m => [basename(m.getDetails().path), m.getDetails().up]));
        return this.getAllMigrations().filter(path => {
            const appliedUp = doneByName.get(basename(path));
            if (appliedUp == null) return false;
            const { up } = this.makeMigrationFromFile(path).getDetails();
            return normalizeSQL(up) !== normalizeSQL(appliedUp);
        });
    }

    /**
     * Throws if an applied migration file changed, because the database would
     * not match the files anymore. With allowChanged it only warns
     */
    checkAppliedUnchanged(done: Array<Migration>, allowChanged = false) {
        const changed = this.findChangedMigrations(done).map(path => basename(path));
        if (changed.length === 0) return;
        const list = changed.map(name => `  - ${name}`).join("\n");
        if (allowChanged) {
            consoleLogger.warn(`Applied migrations changed after they were applied (allowed by --allow-changed):\n${list}`);
            return;
        }
        throw new Error(
            `Applied migrations changed after they were applied:\n${list}\n` +
            "The database doesn't have these changes. Put the files back as they were and write the change in a new migration. " +
            "Use --allow-changed to run anyway",
        );
    }

    /** The migration file with the same name as the given migration, or null if it doesn't exist */
    findMigrationFile(migration: Migration) {
        const name = basename(migration.getDetails().path);
        return this.getAllMigrations().find(path => basename(path) === name) ?? null;
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
