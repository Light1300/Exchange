import { createClient } from  "redis";
import { Engine } from "./trade/Engine.js";

async function main(){
    const engine = new Engine();
    const redisClient = createClient();
    await redisClient.connect();
    console.log("redis is connectd");

    while(true){
        const response = await redisClient.rPop("message" as string);
        if(!response{
            
        }else{
            engine.process(JSON.parse(response));
        }
    }
}


main();