import { MigrateError } from "./Errors";

export type MigrationData = {
    batchId: string | null // The batch id where the Migration was run it
    migratedAt: string;
    up: string;
    down: string;
    path: string;
};
export default class Migration {
    private readonly batchId: string | null;
    private readonly migratedAt: string;
    private readonly up: string;
    private readonly down: string;
    private readonly path: string;

    /**
     *  Concat ns part that change in an accepted speed to avoid same timestamp when the
     *  Migrations are instanciated in for-loops very fast
     */
    static getPreciseNow() {
        const now = new Date().toISOString().substring(0, 23);
        const ns = process.hrtime.bigint().valueOf() % BigInt(1e9); // Obtain the nanoseconds
        return now.concat(`.${ns.toString().substring(0, 8)}`);
    }

    constructor(data: Omit<MigrationData, "batchId" | "migratedAt"> & { batchId?: MigrationData["batchId"], migratedAt?: MigrationData["migratedAt"] }) {
        if (data == null) throw new MigrateError("Invalid migration data")
        const { batchId, up, down, path, migratedAt } = data;
        if (!up) throw new Error('SQL fragment for "up" the migration, is missing');
        else if (!down) throw new Error("Missing down migration");
        else if (!path) throw new Error("Migration path must be espeficied");

        this.batchId = batchId ?? null;
        this.migratedAt = migratedAt ?? Migration.getPreciseNow();
        this.up = up;
        this.down = down;
        this.path = path;
    }

    /** Returns the data of the migrations */
    getDetails() {
        return {
            batchId: this.batchId,
            migratedAt: this.migratedAt,
            up: this.up,
            down: this.down,
            path: this.path,
        };
    }
}
