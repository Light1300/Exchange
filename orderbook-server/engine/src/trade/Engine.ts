import fs from "fs";
import crypto from "crypto";
import { RedisManager } from "../RedisManager.js";
import {
  CREATE_ORDER,
  CANCLE_ORDER,
  GET_DEPTH,
  GET_OPEN_ORDERS,
  ON_RAMP,
  MessageFromApi
} from "../types/fromApi.js";
import { Fill, Order, Orderbook } from "./Orderbook.js";

export const BASE_CURRENCY = "INR";

interface AssetBalance {
  available: number;
  locked: number;
}

type UserBalance = Record<string, AssetBalance>;

export class Engine {
  private orderbooks: Orderbook[] = [];
  private balances: Map<string, UserBalance> = new Map();

  constructor() {
    this.loadSnapshot();
    setInterval(() => this.saveSnapshot(), 3000);
  }

  /* ---------------- SNAPSHOT ---------------- */

  private loadSnapshot() {
    try {
      if (process.env.WITH_SNAPSHOT) {
        const raw = fs.readFileSync("./snapshot.json", "utf-8");
        const parsed = JSON.parse(raw);

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
        return;
      }
    } catch {
      console.log("No snapshot found. Starting fresh.");
    }

    this.orderbooks = [new Orderbook("TATA_INR", [], [], 0, 0)];
    this.setBaseBalances();
  }

  private saveSnapshot() {
    fs.writeFileSync(
      "./snapshot.json",
      JSON.stringify({
        orderbooks: this.orderbooks.map(o => o.getSnapshot()),
        balances: Array.from(this.balances.entries())
      })
    );
  }

  /* ---------------- PROCESS ---------------- */

  process({ message, clientId }: { message: MessageFromApi; clientId: string }) {
    switch (message.type) {
      case CREATE_ORDER:
        return this.handleCreateOrder(message, clientId);

      case CANCLE_ORDER:
        return this.handleCancelOrder(message, clientId);

      case GET_OPEN_ORDERS:
        return this.handleGetOpenOrders(message, clientId);

      case GET_DEPTH:
        return this.handleGetDepth(message, clientId);

      case ON_RAMP:
        return this.onRamp(message.data.userId, Number(message.data.amount));
    }
  }

  /* ---------------- HANDLERS ---------------- */

  private handleCreateOrder(
    message: Extract<MessageFromApi, { type: typeof CREATE_ORDER }>,
    clientId: string
  ) {
    const { market, price, quantity, side, userId } = message.data;

    try {
      const result = this.createOrder(market, price, quantity, side, userId);

      RedisManager.getInstance().sendToApi(clientId, {
        type: "ORDER_PLACED",
        payload: result
      });
    } catch {
      RedisManager.getInstance().sendToApi(clientId, {
        type: "ORDER_REJECTED",
        payload: { reason: "Insufficient funds" }
      });
    }
  }

  private handleCancelOrder(
    message: Extract<MessageFromApi, { type: typeof CANCEL_ORDER }>,
    clientId: string
  ) {
    const { orderId, market } = message.data;
    const ob = this.getOrderbook(market);
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
  }

  private handleGetOpenOrders(
    message: Extract<MessageFromApi, { type: typeof GET_OPEN_ORDERS }>,
    clientId: string
  ) {
    const ob = this.getOrderbook(message.data.market);
    if (!ob) return;

    RedisManager.getInstance().sendToApi(clientId, {
      type: "OPEN_ORDERS",
      payload: ob.getOpenOrders(message.data.userId)
    });
  }

  private handleGetDepth(
    message: Extract<MessageFromApi, { type: typeof GET_DEPTH }>,
    clientId: string
  ) {
    const ob = this.getOrderbook(message.data.market);

    RedisManager.getInstance().sendToApi(clientId, {
      type: "DEPTH",
      payload: ob ? ob.getDepth() : { bids: [], asks: [] }
    });
  }

  /* ---------------- CORE ---------------- */

  private getOrderbook(market: string) {
    return this.orderbooks.find(o => o.ticker() === market);
  }

  private createOrder(
    market: string,
    price: string,
    quantity: string,
    side: "buy" | "sell",
    userId: string
  ) {
    const ob = this.getOrderbook(market);
    if (!ob) throw new Error("No orderbook");

    const [base, quote] = market.split("_");
    this.checkAndLockFunds(base, quote, side, userId, price, quantity);

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

  private updateBalances(
    userId: string,
    base: string,
    quote: string,
    side: "buy" | "sell",
    fills: Fill[]
  ) {
    for (const fill of fills) {
      const buyer = side === "buy" ? userId : fill.otherUserId;
      const seller = side === "sell" ? userId : fill.otherUserId;

      const buyerBal = this.balances.get(buyer);
      const sellerBal = this.balances.get(seller);
      if (!buyerBal || !sellerBal) continue;

      buyerBal[base].available += fill.qty;
      buyerBal[quote].locked -= fill.qty * fill.price;

      sellerBal[base].locked -= fill.qty;
      sellerBal[quote].available += fill.qty * fill.price;
    }
  }

  private publishTrades(fills: Fill[], market: string, userId: string) {
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

  private checkAndLockFunds(
    base: string,
    quote: string,
    side: "buy" | "sell",
    userId: string,
    price: string,
    quantity: string
  ) {
    const bal = this.balances.get(userId);
    if (!bal) throw new Error("User not found");

    const cost = Number(price) * Number(quantity);

    if (side === "buy") {
      if (bal[quote].available < cost)
        throw new Error("Insufficient funds");

      bal[quote].available -= cost;
      bal[quote].locked += cost;
    } else {
      if (bal[base].available < Number(quantity))
        throw new Error("Insufficient funds");

      bal[base].available -= Number(quantity);
      bal[base].locked += Number(quantity);
    }
  }

  private onRamp(userId: string, amount: number) {
    const bal =
      this.balances.get(userId) ??
      ({
        [BASE_CURRENCY]: { available: 0, locked: 0 }
      } as UserBalance);

    bal[BASE_CURRENCY].available += amount;
    this.balances.set(userId, bal);
  }

  private setBaseBalances() {
    ["1", "2", "5"].forEach(id => {
      this.balances.set(id, {
        [BASE_CURRENCY]: { available: 10_000_000, locked: 0 },
        TATA: { available: 10_000_000, locked: 0 }
      });
    });
  }
}
