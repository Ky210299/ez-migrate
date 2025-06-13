import { ConsoleLoggerImpl } from "./Logger";

/** Represent a database connection where migrations will be made */
export interface Connection {
    /** The Database Managment System name of the connection */
    DBMSName: string;
    /** A method that returns true whether can connect to the DBMS, false otherwise */
    isConnected: () => Promise<boolean>;
    runSQL: (sql: string) => Promise<any>;
    /** Initialize any necessary configuration of the DBMS before run the migrations */
    init: (migrationPath?: string, migrationDirection?: string) => Promise<void>;
    
    close: () => Promise<void>;
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

export interface PostgresConnection extends Connection {
    host: string;
    user: string;
    password: string | (() => string | Promise<string>);
    database: string | undefined;
    port: string | number;
}
/** Generic type for all Specific Connections interfaces */
type DatabaseConnection = MySQLConnection | SqliteConnection | PostgresConnection;

/** Class that use a DatabaseConnection */
class DatabaseConnector {
    readonly connection: DatabaseConnection;
    readonly consoleLogger: ConsoleLoggerImpl
    constructor(connection: DatabaseConnection, { logger: consoleLogger }: { logger: ConsoleLoggerImpl }) {
        this.connection = connection
        this.consoleLogger = consoleLogger
    }
    /** Run the sql into the DBMS */
    async runSQL(sql: string): Promise<void> {
        await this.connection.runSQL(sql);
    }
    
    /** Initialize any necessary configuration of the DBMS before run the migrations.
        You must always call this before running the migration
    */
    async initConnection(migrationPath?: string, migrationDirection?: string) {
        await this.connection.init(migrationPath, migrationDirection);
    }
    
    /** A method that returns true whether can connect to the DBMS, false otherwise */
    async testConnection() {
        try {
            await this.connection.isConnected();
        } catch (err) {
            this.consoleLogger.error(`Error connecting ${this.connection.DBMSName}: 
                ${err}`);
            throw ""
        }
    }
    
    async close() {
        await this.connection.close();
    }
}

export default DatabaseConnector;
