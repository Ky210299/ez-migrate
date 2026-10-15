import ConfigReader from "../ConfigReader";
import ConnectionFactory from "../ConnectionFactory";
import SchemaDumper from "../SchemaDumper";
import { tracer } from "../Tracer";

export type SchemaOptions = {
    /** Print the schema as JSON, for scripts and AI agents */
    json?: boolean,
}

/**
 * Print the current schema of the target database as SQL, the same SQL that
 * `baseline` writes. It only reads the schema: no rows, no lock, no files.
 * Useful to give an AI agent or a reviewer the real state of the database.
 */
export default class Schema {
    private constructor() { throw new Error("Schema is a static class") }

    static async run(options: SchemaOptions = {}) {
        const config = new ConfigReader().getConfig();
        const connection = ConnectionFactory.create(config);
        try {
            await connection.testConnection();
            const schema = await tracer.span("schema.dump", {}, () => new SchemaDumper(connection, config.dialect).dumpSchema());
            // The schema is the output of the command, not a log line
            if (options.json) {
                console.log(JSON.stringify({
                    dialect: config.dialect,
                    tables: schema.tables.map(t => t.raw),
                    sql: schema.up,
                    skipped: schema.skipped,
                }, null, 2));
                return;
            }
            if (schema.tables.length === 0 && schema.up.trim() === "") {
                console.log("-- The database has no tables");
                return;
            }
            const skipped = schema.skipped.map(s => `-- Not exported: ${s}`);
            console.log([schema.up.trim(), ...(skipped.length ? ["", ...skipped] : [])].join("\n"));
        } finally {
            await connection.close().catch(() => {});
        }
    }
}
