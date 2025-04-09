export type MigrationData = {
    migrated_at: string;
    up: string;
    down: string;
    path: string;
};
export default class Migration {
    private readonly migrated_at: string;
    private readonly up: string;
    private readonly down: string;
    private readonly path: string;

    constructor(data: Omit<MigrationData, "migrated_at">) {
        const { up, down, path } = data;
        if (!up) throw new Error('SQL fragment for "up" the migration, is missing');
        else if (!down) throw new Error("Missing down migration");
        else if (!path) throw new Error("Migration path must be espeficied");

        const now = new Date().toISOString();

        this.migrated_at = now;
        this.up = up;
        this.down = down;
        this.path = path;
    }

    getDetails() {
        return {
            migrated_at: this.migrated_at,
            up: this.up,
            down: this.down,
            path: this.path,
        };
    }
}
