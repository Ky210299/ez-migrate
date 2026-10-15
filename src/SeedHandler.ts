import { Config } from "./types";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { isEmptySQL, splitStatements } from "./sql";
import { fileTimestamp } from "./utils";

export default class SeedHandler {
    private readonly SEEDS_PATH: string
    private readonly SEEDS_TEMPLATE: string = "-- Type here your seed"
    private readonly DDLRegExp = /^(?:CREATE|ALTER|DROP|TRUNCATE|RENAME)\b/i;
    /**
     * Statements that only turn triggers and foreign keys off and on again while
     * data loads. The baseline data file has them, so the rows are copied as they are.
     */
    private readonly DataLoadToggleRegExp = new RegExp("^(?:" + [
        String.raw`DROP\s+TRIGGER\b`,
        String.raw`CREATE\s+TRIGGER\b`,
        String.raw`ALTER\s+TABLE\s+\S+\s+(?:DISABLE|ENABLE)\s+(?:TRIGGER|RULE)\s+\S+$`,
        String.raw`ALTER\s+TABLE\s+\S+\s+DROP\s+CONSTRAINT\s+\S+$`,
        String.raw`ALTER\s+TABLE\s+\S+\s+ADD\s+CONSTRAINT\s+\S+\s+FOREIGN\s+KEY\b`,
    ].join("|") + ")", "i");
    constructor(config: Config) {
        const { seedsPath } = config
        this.SEEDS_PATH = seedsPath
        mkdirSync(this.SEEDS_PATH, { recursive: true })
    }
    
    hasDDL(sql: string, { allowDataLoadToggles = false } = {}) {
        return this.findDDL(splitStatements(sql), allowDataLoadToggles);
    }

    private findDDL(statements: Array<string>, allowDataLoadToggles: boolean) {
        return statements.some(statement =>
            this.DDLRegExp.test(statement) && !(allowDataLoadToggles && this.DataLoadToggleRegExp.test(statement)));
    }

    getSeedsFileNames() {
        mkdirSync(this.SEEDS_PATH, { recursive: true });
        return readdirSync(this.SEEDS_PATH, "utf8").filter((path) => path.endsWith(".sql")).sort()
    }
    
    private addSeedsPathToSchemasName(seedsFilesNames: Array<string>): Array<string> {
        return seedsFilesNames.map((name) => this.SEEDS_PATH + "/" + name);
    }
    
    readSQL(sqlPath: string) {
        return readFileSync(sqlPath, "utf8");
    }
    
    makeSeedFile(name: string) {
        if (!name) throw new Error("Name is needed for create a new seed file");

        const now = fileTimestamp();
        const endWithSlash = this.SEEDS_PATH.endsWith("/");
        const path = `${this.SEEDS_PATH}${endWithSlash ? "" : "/"}${now}-${name}.sql`;
        if (existsSync(path)) throw new Error("The seed file already exists");
        writeFileSync(path, this.SEEDS_TEMPLATE);
        return path
    }
    
    /**
     * SQL of a data file outside the seeds folder (for example the baseline data
     * file). Throws if it is empty or has DDL other than turning triggers and foreign keys off and on
     */
    readDataFile(path: string) {
        if (!existsSync(path)) throw new Error(`File ${path} doesn't exist`);
        const sql = readFileSync(path, "utf8");
        // Split once: data files can have many MB
        const statements = splitStatements(sql);
        if (statements.length === 0) throw new Error(`File ${path} is empty`);
        if (this.findDDL(statements, true)) throw new Error(`File ${path} has DDL statements. Data files can only have DML`);
        return sql.trim();
    }

    /**
     * Returns the file name and SQL of every seed file, in file name order.
     * Empty files are skipped. Throws if a seed has DDL
     */
    getSeeds() {
        const seeds: Array<{ name: string, sql: string }> = [];
        for (const name of this.getSeedsFileNames()) {
            const [path] = this.addSeedsPathToSchemasName([name]);
            const sql = readFileSync(path, "utf8");
            if (isEmptySQL(sql)) continue;
            if (this.hasDDL(sql)) throw new Error(`File ${path} has DDL statements. Seeds can only have DML`);
            seeds.push({ name, sql: sql.trim() });
        }
        return seeds
    }
}
