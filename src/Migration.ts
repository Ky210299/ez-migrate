import { randomUUID } from "node:crypto";
export type MigrationData = {
    id: string;
    sql: string;
    date: string;
    path: string;
    direction: 1 | 0;
    orderNumber: number;
};
export default class Migration {
    private readonly id: string;
    private readonly sql: string;
    private readonly date: string;
    private readonly direction: 1 | 0; // 1 up and 0 down
    private readonly path: string;
    private readonly orderNumber: number;

    constructor(data: Omit<MigrationData, "date" | "id">) {
        const { sql, direction, path, orderNumber } = data;
        if (!sql) throw new Error("Empty migration SQL");
        else if (direction == null) throw new Error("Up or down must be specified");
        else if (!path) throw new Error("Migration path must be espeficied");
        else if (orderNumber == null || orderNumber < 0) throw new Error("Invalid order number");

        const now = new Date().toISOString();

        this.id = randomUUID();
        this.sql = sql;
        this.date = now;
        this.direction = direction;
        this.path = path;
        this.orderNumber = orderNumber;
    }

    getData() {
        return { ...this };
    }
}
