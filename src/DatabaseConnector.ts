/** Represent a database connection where migrations will be made */
export interface Connection {
    /** The Database Managment System name of the connection */
    DBMSName: string;
    /** A method that returns true whether can connect to the DBMS, false otherwise */
    isConnected: () => Promise<boolean>;
    runSQL: (sql: string) => Promise<any>;
    /** Initialize any necessary configuration of the DBMS before run the migrations */
    init: () => Promise<void>;
}

/** Specific Mysql Connection interface */
export interface MySQLConnection extends Connection {
    host: string;
    user: string;
    password: string | undefined;
    database: string | undefined;
    port: string | number;
};
/** Specific Sqlite Connection interface */
export interface SqliteConnection extends Connection {
    path: string
}
/** Generic type for all Specific Connections interfaces */
type DatabaseConnection = MySQLConnection | SqliteConnection;

/** Class that use a DatabaseConnection */
class DatabaseConnector {
    readonly connection: DatabaseConnection;
    constructor(connection: DatabaseConnection) {
        this.connection = connection
    }
    /** Run the sql into the DBMS */
    async runSQL(sql: string): Promise<void> {
        await this.connection.runSQL(sql);
        console.log("SQL runned successfuly!\n");
    }
    
    /** Initialize any necessary configuration of the DBMS before run the migrations.
        You must always call this before running the migration
    */
    async initConnection() {
        await this.connection.init();
    }
    
    /** A method that returns true whether can connect to the DBMS, false otherwise */
    async testConnection() {
        try {
            if (await this.connection.isConnected())
                console.log(this.connection.DBMSName + " is connected successfuly");
        } catch (err) {
            console.error("Error connecting ", this.connection.DBMSName, ":\n\n");
            throw err;
        }
    }
}

export default DatabaseConnector;
