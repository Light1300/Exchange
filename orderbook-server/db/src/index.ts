import { Client } from 'pg';
import { createClient } from 'redis';
import { DbMessage } from './types.js';

const pgClient = new Client({
    user: 'your_user',
    host: 'localhost',
    database: 'my_database',
    password: 'your_password',
    port:5432,
});
pgClient.connect();

async function main(){
    const redisClinet = createClient();
    await redisClinet.connect();
    console.log("connect to redis");

    while(true){
        const response = await redisClinet.rPop("db_processor" as string)
        if(!response){

        }else{
            const data: DbMessage = JSON.parse(response);
            if(data.type === "TRADE_ADDED"){
                console.log("adding data");
                console.log(data);
                const price = data.data.price;
                const timestamp = new Data(data.data.timestamp);
                const query = ' INSET INTO tata_prices (time,price) VALUES ($1, $2)';

                const values = [timestamp, price];
                await pgClient.query(query,values);
            }
        }
    }
}


main();