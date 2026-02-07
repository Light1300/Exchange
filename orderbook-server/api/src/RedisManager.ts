import type { RedisClientType } from "redis";
import { createClient } from "redis";
import type { MessageFromOrderbook } from "./types/index.js";
import type { MessageToEngine } from "./types/to.js";
import { json } from "stream/consumers";

export class RedisManager {
    private client: RedisClientType;
    private publisher: RedisClientType;
    static instance: RedisManager;


    private constructor(){
        this.client = createClient();
        this.client.connect();
        this.publisher = createClient()
        this.publisher.connect();
    }   

    public  static  getInstance():RedisManager {
        if(!this.instance){
            this.instance = new RedisManager();
        }
        return this.instance;
    }

    public sendAndAwait(message: MessageToEngine){
        return new Promise<MessageFromOrderbook>((resolve) =>{
            const id = this.getRandomClientId();
            this.client.subscribe(id, (message) =>{
                this.client.unsubscribe(id);
                resolve(JSON.parse(message));
            });
            this.publisher.lPush("message", JSON.stringify({cliendId: id, message}));
        });
    }

    public getRandomClientId(){
        return Math.random().toString(36).substring(2,15) + Math.random().toString(36).substring(2,15);
    }
}

