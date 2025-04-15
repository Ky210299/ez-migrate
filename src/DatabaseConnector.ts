export interface Connection {
    SGDBName: string;
    isConnected: () => Promise<boolean>;
    runSQL: (sql: string) => Promise<any>;
    init: () => Promise<void>;
}

export interface MySQLConnection extends Connection {
    host: string;
    user: string;
    password: string | undefined;
    database: string | undefined;
    port: string | number;
};
export interface SqliteConnection extends Connection {
    path: string
}
type DatabaseConnection = MySQLConnection | SqliteConnection;

class DatabaseConnector {
    readonly connection: DatabaseConnection;
    constructor(connection: DatabaseConnection) {
        this.connection = connection
    }
    async runSQL(sql: string): Promise<void> {
        await this.connection.runSQL(sql);
        console.log("SQL runned successfuly!\n");
    }
    
    async initConnection() {
        await this.connection.init();
    }

    async testConnection() {
        try {
            if (await this.connection.isConnected())
                console.log(this.connection.SGDBName + " is connected successfuly");
        } catch (err) {
            console.error("Error connecting ", this.connection.SGDBName, ":\n\n");
            throw err;
        }
    }
}

export default DatabaseConnector;
