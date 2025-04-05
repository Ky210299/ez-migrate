import { mkdirSync, readdirSync, readFileSync } from "node:fs";


type Options = {
    migrationsPath: string | undefined;
};

class SchemasHandler {
    private readonly DEFAULT_MIGRATION_PATH = "./migrations";
    private readonly sqlRE = /\.sql$/;
    private opts: Options | undefined;  
    constructor(opts: Options | undefined = undefined) {
        this.opts = opts;
    }

    ensureMigrationPathExists() {
        mkdirSync(this.opts?.migrationsPath ?? this.DEFAULT_MIGRATION_PATH);
    }
}

export default new SchemasHandler();
