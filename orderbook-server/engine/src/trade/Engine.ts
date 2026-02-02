import fs from "fs";
import { RedisManager  } from "../RedisManager.js";
import { ORDER_UPDATE, TRADE_ADDED } from "../types/index.js";
import { CANCLE_ORDER, CREATE_ORDER, GET_DEPTH, GET_OPEN_ORDERS, MessageFromApi, ON_RAMP } from "../types/fromApi.js";
import { Fill, Order, Orderbook } from "./Orderbook"; 

interface UserBalance{
    [key:string]:{
        available:number,
        locker:number,
    }
}

export class Engine {
    private orderbooks: Orderbook[] = []
    private balances: Map<string, UserBalance> = new Map();

    constructor(){
        let snapshot = null;
        try{
            if(process.env.WITH_SNAPSHOT){
                snapshot = fs.readFileSync("./snapshot.json");
            }
        } catch(error){
            console.log("No snapshot Found ::: ",error)
        }

        if(snapshot){
            const snapshotSnapshot = JSON.parse(snapshot.toString());
            this.orderbooks = snapshotSnapshot.orderbooks.map((o:any) => new Orderbook(o.baseAsset, o.bids, o.asks, o.lastTradeId, o.currentPrice  ));
            this.balances = new Map(snapshotSnapshot.balances);
        } else{
            this.orderbooks = [new Orderbook(`TATA`, [], [], 0,0)];
            this.setBaseBalances();
        }
        setInterval(()=>{
            this.saveSnapshot();
        }, 1000*3);


        saveSnapshot(){
            const snapshotSnapshot = {
                orderbooks: this.orderbooks.map(o=> o.getSnapshot()),
                balances: Array.from(this.balances.entries())
            }
            fs.writeFileSync("./snapshot.json", JSON.stringify(snapshotSnapshot));
        }
        process({message,clientId}: {message:MessageFromApi, clientId:string}){
            switch(message.type){
                case CANCLE_ORDER:
                    try{
                    const { executedQty, fills, orderId } = this.createOrder(message.data.market, message.data.price, message.data.quantity, message.data.side, message.data.userId);
                    }   
            }
        }
    }
}