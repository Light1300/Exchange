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

        } catch(error){
            console.log("No snapshot Found ::: ",error)
        }
    }
}