interface Connection {
    isConnected: () => Promise<boolean>;
}
type MySQLConnection = Connection & {
    SGDBName: string;
    host: string;
    user: string;
    password: string | undefined;
    database: string | undefined;
    port: string | number;
};
type DatabaseConnection = MySQLConnection;

class DatabaseConnector {
    readonly connection: DatabaseConnection;
    constructor(connection: DatabaseConnection) {
        this.connection = {
            ...connection,
        };
    }

    async testConnection() {
        try {
            if (await this.connection.isConnected())
                console.log(this.connection.SGDBName + " is connected successfuly");
        } catch (err) {
            console.error("Error connecting ", this.connection.SGDBName, ":\n", err);
        }
    }
}

export default DatabaseConnector;
