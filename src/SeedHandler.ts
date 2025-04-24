import { ERRORS, isErrnoException } from "./Errors";
import { Config } from "./types";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"

export default class SeedHandler {
    private readonly SEEDS_PATH: string
    private readonly SEEDS_TEMPLATE: string = "# Type here your seed"
    private readonly DDLRegExp = /(?:^|;)\s*(?:CREATE|ALTER|DROP|TRUNCATE|RENAME)\b/im;
    private readonly SQLCommentsRegExp = /(--|#|\/\/).*$/gm
    constructor(config: Config) {
        const { seedsPath } = config
        
        this.SEEDS_PATH = seedsPath
    }
    
    hasDDL(sql: string) {
        return this.DDLRegExp.test(sql) 
    }
    private normalizeSQL(sql: string) {
        const withoutComments = sql.replace(this.SQLCommentsRegExp, " ");
        const withoutLineBreaks = withoutComments.replace(/\n/g, " ")
        return withoutLineBreaks.replace(/\s+/g, " ");
    }
    private ensureSeedsPathExists() {
        try {
            if (this.SEEDS_PATH == null) return;
            mkdirSync(this.SEEDS_PATH);
        } catch (err) {
            if (isErrnoException(err)) {
                const { errno } = err;
                // if the path exists just return
                if (errno === ERRORS.FILE_ALREADY_EXISTS.errno) return;
            }
            throw err;
        }
    }
    getSeedsFileNames() {
        this.ensureSeedsPathExists();
        const seeds = readdirSync(this.SEEDS_PATH, "utf8").filter((path) => path.endsWith(".sql"))
        return seeds
    }
    
    private addSeedsPathToSchemasName(seedsFilesNames: Array<string>): Array<string> {
        return seedsFilesNames.map((name) => this.SEEDS_PATH + "/" + name);
    }
    
    readSQL(sqlPath: string) {
        return readFileSync(sqlPath, "utf8");
    }
    
    makeSeedFile(name: string) {
        if (!name) throw new Error("Name is needed for create a new migration file");

        const now = new Date().toISOString();
        const endWithSlash = this.SEEDS_PATH.endsWith("/");
        const path = `${this.SEEDS_PATH}${endWithSlash ? "" : "/"}${now}-${name}.sql`;
        if (existsSync(path)) throw new Error("The migration file already exists");
        writeFileSync(path, this.SEEDS_TEMPLATE);
    }
    
    getSeeds() {
        const seedsFileNames = this.getSeedsFileNames(); 
        const withPath = this.addSeedsPathToSchemasName(seedsFileNames);
        const sql = withPath.flatMap(path => {
            const sql = readFileSync(path, "utf8");
            if (!sql.trim()) return []
            return this.normalizeSQL(sql);
        })
        sql.forEach((query, i) => {
            if (this.hasDDL(query)) throw new Error(`File ${withPath[i]} has DDL statements`)
        })
        return sql
    }
}