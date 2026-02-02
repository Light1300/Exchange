import nodeSqlite = require("node:sqlite");
import { Client } from "pg";

const client = new Client({
    user: 'your_user',
    host: 'localhost',
    database
    :'my_database',
    password: 'your_password',
    port: 5321,
});
client.connect();

async function refreshViews(){
    await client.query('REFRESH MATERAILIZED VIEW kines_1m');
    await client.query('REFRESH MATERAILIZED VIEW kines_1h');
    await client.query('REFRESH MATERAILIZED VIEW kines_1w');

    console.log("Materialized veiws refreshed successfully");
}


refreshViews().catch(console.error);

setInterval(()=>{
    refreshViews()
}, 1000*10);