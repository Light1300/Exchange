export const CREATE_ORDER = "CREATE_ORDER";
export const CANCLE_ORDER = "CANCLE_ORDER";
export const ON_RAMP = "ON_RAMP";
export const GET_OPEN_ORDERS = "GET_OPEN_ORDERS";

export const GET_DEPTH = "GET_DEPTH";

export type MessageFromOrderbook = {
    type: "DEPTH",
    payload:{
        market:string,
        bids:[string,string][],
        asks:[string,string][],
    }
} | {
    type: "ORDER_PLACED",
    payload: {
        orderId: string,
        executedQty: number,
        fills: [
            {
                price: string,
                qty:number,
            }
        ]
    }
} | {
    type: "OPEN_ORDERS",
    payload: {
        orderId: string,
        execturedQty: number,
        price:string,
        quantity:string,
        side: "buy"| "sell",
        userId: string,
    }[]
}