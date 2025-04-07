import MysqlConnection from "./mysql.js";

const mysqlConnection = new MysqlConnection({});
(async () => {
    console.log(await mysqlConnection.isConnected());
    console.log(await mysqlConnection.runSQL("SELECT 1"));
    process.exit()
})();
