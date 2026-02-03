import fs from "fs";
import { RedisManager } from "../RedisManager.js";
import { ORDER_UPDATE, TRADE_ADDED } from "../types/index.js";
import {
  CANCEL_ORDER,
  CREATE_ORDER,
  GET_DEPTH,
  GET_OPEN_ORDERS,
  ON_RAMP,
  MessageFromApi
} from "../types/fromApi.js";
import { Fill, Order, Orderbook } from "./Orderbook.js";

export const BASE_CURRENCY = "INR";

interface UserBalance {
  [asset: string]: {
    available: number;
    locked: number;
  };
}

export class Engine {
  private orderbooks: Orderbook[] = [];
  private balances: Map<string, UserBalance> = new Map();

  constructor() {
    let snapshot: any = null;

    try {
      if (process.env.WITH_SNAPSHOT) {
        snapshot = fs.readFileSync("./snapshot.json", "utf-8");
      }
    } catch {
      console.log("No snapshot found");
    }

    if (snapshot) {
      const parsed = JSON.parse(snapshot);
      this.orderbooks = parsed.orderbooks.map(
        (o: any) =>
          new Orderbook(
            o.baseAsset,
            o.bids,
            o.asks,
            o.lastTradeId,
            o.currentPrice
          )
      );
      this.balances = new Map(parsed.balances);
    } else {
      this.orderbooks = [new Orderbook("TATA_INR", [], [], 0, 0)];
      this.setBaseBalances();
    }

    setInterval(() => this.saveSnapshot(), 3000);
  }

  saveSnapshot() {
    fs.writeFileSync(
      "./snapshot.json",
      JSON.stringify({
        orderbooks: this.orderbooks.map(o => o.getSnapshot()),
        balances: Array.from(this.balances.entries())
      })
    );
  }

  process({ message, clientId }: { message: MessageFromApi; clientId: string }) {
    switch (message.type) {
      case CREATE_ORDER: {
        const { market, price, quantity, side, userId } = message.data;
        try {
          const result = this.createOrder(
            market,
            price,
            quantity,
            side,
            userId
          );
          RedisManager.getInstance().sendToApi(clientId, {
            type: "ORDER_PLACED",
            payload: result
          });
        } catch (e) {
          RedisManager.getInstance().sendToApi(clientId, {
            type: "ORDER_CANCELLED",
            payload: { executedQty: 0 }
          });
        }
        break;
      }

      case CANCEL_ORDER: {
        const { orderId, market } = message.data;
        const ob = this.orderbooks.find(o => o.ticker() === market);
        if (!ob) return;

        const order =
          ob.bids.find(o => o.orderId === orderId) ||
          ob.asks.find(o => o.orderId === orderId);
        if (!order) return;

        ob.cancelOrder(order);

        RedisManager.getInstance().sendToApi(clientId, {
          type: "ORDER_CANCELLED",
          payload: { orderId }
        });
        break;
      }

      case GET_OPEN_ORDERS: {
        const ob = this.orderbooks.find(o => o.ticker() === message.data.market);
        if (!ob) return;

        RedisManager.getInstance().sendToApi(clientId, {
          type: "OPEN_ORDERS",
          payload: ob.getOpenOrders(message.data.userId)
        });
        break;
      }

      case GET_DEPTH: {
        const ob = this.orderbooks.find(o => o.ticker() === message.data.market);
        RedisManager.getInstance().sendToApi(clientId, {
          type: "DEPTH",
          payload: ob ? ob.getDepth() : { bids: [], asks: [] }
        });
        break;
      }

      case ON_RAMP:
        this.onRamp(message.data.userId, Number(message.data.amount));
        break;
    }
  }

  createOrder(
    market: string,
    price: string,
    quantity: string,
    side: "buy" | "sell",
    userId: string
  ) {
    const ob = this.orderbooks.find(o => o.ticker() === market);
    if (!ob) throw new Error("No orderbook");

    const [base, quote] = market.split("_");

    this.checkAndLockFunds(
      base,
      quote,
      side,
      userId,
      price,
      quantity
    );

    const order: Order = {
      orderId: crypto.randomUUID(),
      price: Number(price),
      quantity: Number(quantity),
      filled: 0,
      side,
      userId
    };

    const { fills, executedQty } = ob.addOrder(order);
    this.updateBalances(userId, base, quote, side, fills);

    this.publishTrades(fills, market, userId);

    return { executedQty, fills, orderId: order.orderId };
  }

  updateBalances(
    userId: string,
    base: string,
    quote: string,
    side: "buy" | "sell",
    fills: Fill[]
  ) {
    for (const fill of fills) {
      const buyer = side === "buy" ? userId : fill.otherUserId;
      const seller = side === "sell" ? userId : fill.otherUserId;

      this.balances.get(buyer)![base].available += fill.qty;
      this.balances.get(buyer)![quote].locked -= fill.qty * fill.price;

      this.balances.get(seller)![base].locked -= fill.qty;
      this.balances.get(seller)![quote].available += fill.qty * fill.price;
    }
  }

  publishTrades(fills: Fill[], market: string, userId: string) {
    for (const fill of fills) {
      RedisManager.getInstance().publishMessage(`trade@${market}`, {
        stream: `trade@${market}`,
        data: {
          e: "trade",
          t: fill.tradeId,
          m: fill.otherUserId === userId,
          p: fill.price,
          q: fill.qty.toString(),
          s: market
        }
      });
    }
  }

  checkAndLockFunds(
    base: string,
    quote: string,
    side: "buy" | "sell",
    userId: string,
    price: string,
    quantity: string
  ) {
    const bal = this.balances.get(userId)!;
    const cost = Number(price) * Number(quantity);

    if (side === "buy") {
      if (bal[quote].available < cost) throw new Error("Insufficient funds");
      bal[quote].available -= cost;
      bal[quote].locked += cost;
    } else {
      if (bal[base].available < Number(quantity))
        throw new Error("Insufficient funds");
      bal[base].available -= Number(quantity);
      bal[base].locked += Number(quantity);
    }
  }

  onRamp(userId: string, amount: number) {
    const bal = this.balances.get(userId) ?? {
      [BASE_CURRENCY]: { available: 0, locked: 0 }
    };
    bal[BASE_CURRENCY].available += amount;
    this.balances.set(userId, bal);
  }

  setBaseBalances() {
    ["1", "2", "5"].forEach(id => {
      this.balances.set(id, {
        [BASE_CURRENCY]: { available: 10_000_000, locked: 0 },
        TATA: { available: 10_000_000, locked: 0 }
      });
    });
  }

}