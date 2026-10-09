import { Config } from "./types";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { isEmptySQL, normalizeSQL } from "./sql";

export default class SeedHandler {
    private readonly SEEDS_PATH: string
    private readonly SEEDS_TEMPLATE: string = "-- Type here your seed"
    private readonly DDLRegExp = /(?:^|;)\s*(?:CREATE|ALTER|DROP|TRUNCATE|RENAME)\b/i;
    constructor(config: Config) {
        const { seedsPath } = config
        this.SEEDS_PATH = seedsPath
        mkdirSync(this.SEEDS_PATH, { recursive: true })
    }
    
    hasDDL(sql: string) {
        return this.DDLRegExp.test(normalizeSQL(sql))
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

        const now = new Date().toISOString();
        const endWithSlash = this.SEEDS_PATH.endsWith("/");
        const path = `${this.SEEDS_PATH}${endWithSlash ? "" : "/"}${now}-${name}.sql`;
        if (existsSync(path)) throw new Error("The seed file already exists");
        writeFileSync(path, this.SEEDS_TEMPLATE);
        return path
    }
    
    /** Returns the SQL of every seed file, in file name order. Throws if a seed has DDL */
    getSeeds() {
        const paths = this.addSeedsPathToSchemasName(this.getSeedsFileNames());
        const seeds: Array<string> = [];
        for (const path of paths) {
            const sql = readFileSync(path, "utf8");
            if (isEmptySQL(sql)) continue;
            if (this.hasDDL(sql)) throw new Error(`File ${path} has DDL statements. Seeds can only have DML`);
            seeds.push(sql.trim());
        }
        return seeds
    }
}
