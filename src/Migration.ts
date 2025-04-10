export type MigrationData = {
    migratedAt: string;
    up: string;
    down: string;
    path: string;
};
export default class Migration {
    private readonly migratedAt: string;
    private readonly up: string;
    private readonly down: string;
    private readonly path: string;

    constructor(data: Omit<MigrationData, "migratedAt">) {
        const { up, down, path } = data;
        if (!up) throw new Error('SQL fragment for "up" the migration, is missing');
        else if (!down) throw new Error("Missing down migration");
        else if (!path) throw new Error("Migration path must be espeficied");

        const now = new Date().toISOString().substring(0, 23);
        const ns = process.hrtime.bigint().valueOf() % BigInt(1e9); // Obtain the nanoseconds
        /**
            Concat now with a ns part that change in an acepted speed to avoid same timestamp when the Migrations are instanciated in for-loops very fast
        */
        this.migratedAt = now.concat(`.${ns.toString().substring(3, 7)}`);
        this.up = up;
        this.down = down;
        this.path = path;
    }

    getDetails() {
        return {
            migratedAt: this.migratedAt,
            up: this.up,
            down: this.down,
            path: this.path,
        };
    }
}
