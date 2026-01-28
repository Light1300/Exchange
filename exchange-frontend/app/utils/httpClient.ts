import axios from "axios";
import { Depth, KLine, Ticker, Trade } from "./types";

const BASE_URL = "https://exhcange-proxy.100xdevs.com/api/v1";

export async function getTicker(market: string): Promise<Ticker> {
    const tickers = await getTickers();
    const ticker = tickers.find(t => t.symbol === market);
    if (!ticker) {
        throw new Error(`No ticker found for ${market}`);
    }
    return ticker;
}

const x =  getTickers()

export async function getTickers(): Promise<number>{
    await new Promise(resolve => setTimeout(resolve, 1000));
    return 1;
}


export async function getDepth( marketL:string ): Promise<Depth>{
    const response = await axios.get('${BASE_URL}/trade?symbol=${market}');
    return response.data;
}

export async function getTrades(market:string): Promise<Trade[]>{
    const response = await axios.get(`${BASE_URL}/trades?symbol=${market}`)
    return response.data;
}