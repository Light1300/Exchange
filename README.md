<div align="center">

# ⚡ Exchange

### Production-Grade Real-Time Orderbook Matching Engine

[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue)](https://typescriptlang.org)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-green)](https://nodejs.org)
[![Redis](https://img.shields.io/badge/Redis-7-red)](https://redis.io)
[![Docker](https://img.shields.io/badge/Docker-Compose-blue)](https://docker.com)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

**A high-performance stock exchange simulation featuring a Price-Time Priority matching engine, decoupled microservice architecture, and live order book streaming via WebSockets.**

</div>

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Architecture & System Design](#2-architecture--system-design)
3. [Matching Engine Design](#3-matching-engine-design)
4. [WebSocket Architecture](#4-websocket-architecture)
5. [Redis & Queue Design](#5-redis--queue-design)
6. [Order Flow — End to End](#6-order-flow--end-to-end)
7. [Security & Validation](#7-security--validation)
8. [State Management & Data Integrity](#8-state-management--data-integrity)
9. [Reliability & Fault Tolerance](#9-reliability--fault-tolerance)
10. [Backend Engineering Quality](#10-backend-engineering-quality)
11. [Performance](#11-performance)
12. [Scalability](#12-scalability)
13. [Extensibility](#13-extensibility)
14. [Tradeoffs & Alternatives](#14-tradeoffs--alternatives)
15. [Deep Technical Questions](#15-deep-technical-questions)
16. [Local Development](#16-local-development)
17. [Folder Structure](#17-folder-structure)

---

## 1. Product Overview

### What exact problem does this system solve?

Building a financial exchange requires solving three hard problems simultaneously: **sub-millisecond order matching**, **real-time broadcast of book changes to all clients**, and **horizontal scalability without shared in-memory state**. Most toy implementations use a single-process in-memory approach — which cannot survive a restart, cannot scale beyond one machine, and cannot decouple the matching engine from the public API. Exchange solves all three with a fully decoupled, queue-driven architecture where the matching engine is isolated behind Redis.

### Core User Journeys

1. **Place a limit order** → `POST /api/v1/order` with symbol, side, price, quantity → order queued → matched against book → fill event emitted
2. **Place a market order** → same flow, matched immediately at best available price → partial fills possible
3. **Watch the order book live** → browser subscribes via WebSocket → receives real-time `BOOK_UPDATED` events as orders arrive and match
4. **Order filled** → `ORDER_FILLED` event pushed through WebSocket to the placing user's browser
5. **Cancel order** → cancel request routes through API → orderbook server removes from book → cancellation event broadcast

### Assumptions Made

- Orders are **ephemeral in-memory** within the orderbook server — persistent order storage is a future feature
- One authenticated user per session — anonymous order placement is not supported
- Market symbols are **pre-configured** at startup (`TATA_INR`, `PAYTM_INR`, `ZOMATO_INR`) — dynamic symbol creation is a future feature
- The matching engine is the **single source of truth** for order state — the API server does not inspect book internals
- Price-Time Priority is strictly enforced — no special order routing or dark pool behavior

### Expected Scale

| Dimension | Design Target |
|---|---|
| Concurrent WebSocket clients | 1,000 |
| Active trading symbols | 10–50 |
| Orders per second (peak) | 5,000 |
| Order book depth per symbol | ~10,000 levels |
| Redis queue throughput | ~50,000 msg/s |
| WebSocket broadcast latency | <10ms |

### Conscious Tradeoffs

| Decision | Chosen | Rejected | Reason |
|---|---|---|---|
| Order transport | Redis queue | Direct HTTP to engine | Decouples API from engine; engine can scale independently |
| Matching engine | Single process per symbol | Distributed | Eliminates distributed locking complexity; symbols are independent |
| Real-time push | WebSockets | Polling / SSE | Bidirectional, sub-10ms, same connection for events and heartbeat |
| WS library | `ws` | Socket.IO | No abstraction overhead; full RFC 6455 control |
| Consistency | Eventual (AP) | Strong (CP) | Book updates and UI sync don't require linearizability |
| Order history | In-memory (engine) | MongoDB per-order | Latency — matching must be microsecond-range |

---

## 2. Architecture & System Design

### Architecture Pattern

**Decoupled, queue-driven microservices with an event-driven real-time layer.**

- The **API Server** is the only surface exposed to users — it validates requests, generates order IDs, and enqueues jobs
- The **Orderbook Server** (matching engine) runs in complete isolation — it reads from the queue, matches orders, and publishes results
- The **WebSocket Server** subscribes to the Redis results queue and pushes events to connected browsers
- No direct HTTP calls between services — all coordination flows through Redis

### High-Level Diagram

```mermaid
flowchart TD
    Browser["Browser\nReact Frontend\nOrder Form · Live Order Book · Trade Feed"]

    subgraph Services["Services (Docker Compose)"]
        API["API Server\nExpress — Exposed to Users\nValidation · Auth · Order ID Generation"]
        OB["Orderbook Server\nMatching Engine\nPrice-Time Priority Algorithm"]
        WS["WebSocket Server\nReal-Time Push\nSubscribes to Redis results queue"]
    end

    subgraph RedisLayer["Redis"]
        Q1["order_queue\nList — pending orders"]
        Q2["result_queue\nList — fills · book updates"]
        PS["Pub/Sub channels\nper-symbol events"]
    end

    Browser -->|"POST /api/v1/order"| API
    API -->|"RPUSH order_queue"| Q1
    Q1 -->|"BLPOP"| OB
    OB -->|"RPUSH result_queue\nPUBLISH room:SYMBOL"| Q2
    OB -->|"PUBLISH"| PS
    PS -->|"pSubscribe"| WS
    WS -->|"WSS push"| Browser
    Browser -->|"WSS connection"| WS
```

### Why Decoupled Engine Over In-Process Matching?

| | Monolithic (in-process) | Decoupled (queue-driven) |
|---|---|---|
| Scale engine independently | ❌ Scales with API | ✅ Own container, own CPU |
| API restart affects matching | ❌ Yes — orders lost | ✅ No — queue persists in Redis |
| Engine crash affects API | ❌ Yes — same process | ✅ No — API still accepts orders |
| Backpressure handling | ❌ None | ✅ Queue depth is visible via `LLEN` |
| Testing engine in isolation | ❌ Must mock Express | ✅ Inject test orders directly to queue |

### Horizontal Scaling

The API Server and WebSocket Server are **stateless** — they hold no order state. The Orderbook Server is **intentionally single-instance per symbol** — matching requires strict serialization and Redis's single-threaded BLPOP provides it.

```mermaid
flowchart LR
    LB["Load Balancer"]

    subgraph API_Instances["API Server (N instances)"]
        A1["API Instance 1"]
        A2["API Instance 2"]
    end

    subgraph WS_Instances["WebSocket Server (N instances)"]
        W1["WS Instance 1"]
        W2["WS Instance 2"]
    end

    subgraph Engine["Orderbook Server (1 per symbol)"]
        E1["TATA_INR Engine"]
        E2["PAYTM_INR Engine"]
        E3["ZOMATO_INR Engine"]
    end

    Redis[("Redis\nQueues + Pub/Sub + State")]

    LB --> A1 & A2
    A1 & A2 -->|"RPUSH"| Redis
    Redis -->|"BLPOP"| E1 & E2 & E3
    E1 & E2 & E3 -->|"PUBLISH"| Redis
    Redis -->|"pSubscribe"| W1 & W2
    W1 & W2 --> LB
```

No sticky sessions required for API or WebSocket tiers. Engine instances are not horizontally scaled — they are vertically scaled and isolated per symbol.

---

## 3. Matching Engine Design

### Price-Time Priority (PTP) Algorithm

Every order is matched using **Price-Time Priority** — the standard algorithm used by all major exchanges (NSE, NYSE, NASDAQ):

| Priority | Rule |
|---|---|
| **1st** | Best price — highest bid or lowest ask |
| **2nd** | Earliest arrival — FIFO within the same price level |

This means: if two buyers both want to buy at ₹200, the one who placed the order first gets filled first.

### Order Book Data Structure

Each symbol maintains two sorted structures:

```
Buy Side (Bids)                    Sell Side (Asks)
───────────────────────────────    ───────────────────────────────
Price  │  Orders (FIFO queue)      Price  │  Orders (FIFO queue)
────── │ ────────────────────────  ────── │ ────────────────────────
₹205   │  [order-C, order-F]       ₹208   │  [order-A]
₹200   │  [order-A, order-B]  ←── ₹210   │  [order-D, order-E]
₹198   │  [order-D]           spread      ₹215   │  [order-B]
```

- **Bids sorted descending** — best bid at top (highest price willing to buy)
- **Asks sorted ascending** — best ask at top (lowest price willing to sell)
- Each price level holds a **FIFO queue** of orders — time priority preserved
- A match occurs when `best_bid >= best_ask`

### Matching Flow

```mermaid
flowchart TD
    Incoming["Incoming Order\n{side: buy, price: 200, qty: 2}"]
    Check{"Check opposite side\nbest_ask <= 200?"}
    Fill["Execute fill\nmin(order_qty, ask_qty)"]
    Emit["Emit ORDER_FILLED\nBOOK_UPDATED to Redis"]
    Partial{"order_qty remaining > 0?"}
    Rest["Place remainder\nin book at price level"]
    Done["Done"]

    Incoming --> Check
    Check -->|"Yes — match found"| Fill
    Fill --> Emit
    Emit --> Partial
    Partial -->|"Yes — re-check"| Check
    Partial -->|"No — fully filled"| Done
    Check -->|"No match"| Rest
    Rest --> Done
```

### Order Types

| Type | Behaviour |
|---|---|
| `limit` | Rest in the book at the specified price if not immediately matchable |
| `market` | Match against the best available price immediately; never rest in book |

### Fill Events Emitted

```typescript
// ORDER_FILLED — sent to placing user's WebSocket
{
  type: "ORDER_FILLED",
  payload: {
    orderId: "a1b2c3d4",
    symbol: "TATA_INR",
    side: "buy",
    filledQty: 1,
    filledPrice: 200,
    remainingQty: 1,
    timestamp: 1710000000000
  }
}

// BOOK_UPDATED — broadcast to all subscribers of this symbol
{
  type: "BOOK_UPDATED",
  payload: {
    symbol: "TATA_INR",
    bids: [{ price: 200, qty: 1 }, { price: 198, qty: 5 }],
    asks: [{ price: 205, qty: 3 }, { price: 210, qty: 2 }]
  }
}
```

---

## 4. WebSocket Architecture

### Why WebSockets Instead of Polling or SSE?

| | Polling | SSE | WebSockets |
|---|---|---|---|
| Direction | Client → Server only | Server → Client only | Bidirectional |
| Latency | 100ms–500ms | ~50ms | <10ms |
| Order submission | ❌ Needs separate POST | ❌ Needs separate POST | ✅ Same connection |
| Order book streaming | ❌ Unusable | ❌ Unidirectional only | ✅ Native |
| Protocol | HTTP/1.1 | HTTP/1.1 | RFC 6455 |

For a trading interface, even 50ms latency means the order book is stale before it renders. WebSockets give sub-10ms push on a single persistent connection per client.

### WebSocket Server Initialization

```typescript
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  // 1. Extract JWT from query param (?token=...)
  // 2. jwt.verify() — reject with 401 if invalid
  // 3. Check decoded.isVerified — reject with 403 if email unverified
  // 4. Attach decoded user to request (userId, username)
  // 5. Hand off to WebSocket server
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});
```

`noServer: true` shares port 8080 with Express. The JWT is verified **before** the WebSocket handshake completes — no unauthenticated socket ever enters the system.

### Client Authentication Flow

```mermaid
sequenceDiagram
    participant Client
    participant Server
    participant JWT

    Client->>Server: GET /?token=JWT (Upgrade: websocket)
    Server->>JWT: verify(token, ACCESS_TOKEN_SECRET)

    alt invalid or expired
        JWT-->>Server: throws error
        Server-->>Client: 401 — socket.destroy()
    else unverified user
        JWT-->>Server: decoded (isVerified: false)
        Server-->>Client: 403 — socket.destroy()
    else valid
        JWT-->>Server: decoded payload
        Server-->>Client: 101 Switching Protocols
        Note over Server: socket.userId = decoded.userId
        Note over Server: socket.username = decoded.name
    end
```

`userId` and `username` are always set **server-side** from the verified JWT — clients cannot spoof identity via crafted payloads.

### Heartbeat & Dead Connection Detection

```mermaid
sequenceDiagram
    participant Server
    participant Client

    loop Every 30 seconds
        Server->>Server: socket.isAlive = false
        Server->>Client: ping()

        alt pong received
            Client-->>Server: pong
            Server->>Server: socket.isAlive = true ✅
        else no pong (crash / network drop)
            Server->>Server: socket.terminate()
            Server->>Server: close event fires
            Note over Server: remove from connections Map<br/>broadcast USER_DISCONNECTED
        end
    end
```

### Reconnect Handling

```typescript
ws.onclose = () => {
  setConnectionStatus("disconnected");
  setTimeout(() => connectWebSocket(), 2000); // 2s reconnect
};
```

On reconnect, client sends `SUBSCRIBE_SYMBOL` → server sends `INITIAL_BOOK_STATE` from the engine's current snapshot → UI replaces stale state. No manual refresh required.

### WebSocket Message Validation

```typescript
const handlers: Record<string, Handler> = {
  SUBSCRIBE_SYMBOL: handleSubscribe,
  UNSUBSCRIBE_SYMBOL: handleUnsubscribe,
  CANCEL_ORDER: handleCancelOrder,
};

const handler = handlers[message.type];
if (!handler) return; // unknown types silently dropped — no error leakage
```

---

## 5. Redis & Queue Design

### Why Redis?

Redis serves **four distinct roles** simultaneously: **job queue**, **message broker**, **result store**, and **rate limit counter store**. No other single tool does all four with sub-millisecond latency and zero additional operational overhead.

### Data Structures Used

**Lists — Order Queue (API → Engine)**
```
order_queue:{symbol} → List [ "{order1}", "{order2}", ... ]

RPUSH  order_queue:{symbol}  {JSON}    // API enqueues            O(1)
BLPOP  order_queue:{symbol}  0         // Engine dequeues (blocks) O(1)
```

**Lists — Result Queue (Engine → WebSocket)**
```
result_queue → List [ "{fill1}", "{book_update1}", ... ]

RPUSH  result_queue  {JSON}    // Engine publishes results   O(1)
BLPOP  result_queue  0         // WS server dequeues         O(1)
```

**Strings with TTL — Rate Limiting**
```
rl:order:{ip}    → count   (TTL: 60s,   max: 100)
rl:auth:{ip}     → count   (TTL: 900s,  max: 10)
```

**Strings with TTL — Refresh Tokens**
```
refresh:{sha256(token)} → userId   (TTL: 30 days)

SETEX  refresh:{hash}  2592000  {userId}   // store
GET    refresh:{hash}                       // validate
DEL    refresh:{hash}                       // revoke / rotate
```

**Pub/Sub — Real-Time Book Events**
```
channel: symbol:{SYMBOL}    // per-symbol order book updates
channel: user:{userId}      // per-user fill notifications

PUBLISH    symbol:{symbol}    {BOOK_UPDATED JSON}
SUBSCRIBE  user:{userId}      // WS server subscribes on client connect
```

### Queue vs Pub/Sub — Why Both?

| Use Case | Mechanism | Reason |
|---|---|---|
| API → Engine (orders) | **List + BLPOP** | Guaranteed delivery; engine processes at its own pace; backpressure visible via `LLEN` |
| Engine → WS (book updates) | **Pub/Sub** | Fan-out to N WS instances simultaneously; at-most-once is fine for UI events |
| Engine → WS (fills) | **Pub/Sub per-user** | User-targeted; WS instance subscribed only for its connected users |

`BLPOP` blocks the consumer until a message arrives — zero polling overhead, instantaneous delivery.

### Backpressure Handling

```bash
# Monitor queue depth — alert if growing unboundedly
LLEN order_queue:TATA_INR   # should be near 0 in steady state
```

If queue depth grows, the engine is the bottleneck. Mitigations: vertical scaling of the engine process, or symbol-level sharding (each symbol gets its own queue + engine instance — already the architectural pattern here).

### Redis Key Space Overview

```mermaid
flowchart LR
    subgraph Keys["Redis Key Space"]
        Q["order_queue:{symbol}\nList — RPUSH/BLPOP\nAPI → Engine"]
        R["result_queue\nList — RPUSH/BLPOP\nEngine → WS Server"]
        P["symbol:{symbol}\nPub/Sub channel\nBOOK_UPDATED events"]
        U["user:{userId}\nPub/Sub channel\nORDER_FILLED events"]
        T["refresh:{hash}\nString + 30d TTL\nToken rotation"]
        L["rl:{type}:{ip}\nString + TTL\nRate limiting"]
    end
```

---

## 6. Order Flow — End to End

### Place a Limit Order

```mermaid
sequenceDiagram
    participant Browser
    participant API
    participant Redis
    participant Engine as Orderbook Engine
    participant WS as WebSocket Server

    Browser->>API: POST /api/v1/order\n{kind:buy, type:limit, price:200, qty:2, market:TATA_INR}
    API->>API: Validate payload\nGenerate orderId = uuid()
    API->>Redis: RPUSH order_queue:TATA_INR\n{userId, orderId, kind, type, price, qty}
    API-->>Browser: 200 { orderId: "a1b2c3d4", status: "queued" }

    Redis-->>Engine: BLPOP unblocks
    Engine->>Engine: Price-Time Priority match\nagainst existing asks
    Engine->>Redis: PUBLISH user:userId ORDER_FILLED (if match)
    Engine->>Redis: PUBLISH symbol:TATA_INR BOOK_UPDATED

    Redis-->>WS: pSubscribe fires (BOOK_UPDATED)
    Redis-->>WS: pSubscribe fires (ORDER_FILLED)
    WS-->>Browser: BOOK_UPDATED { bids:[], asks:[] }
    WS-->>Browser: ORDER_FILLED { orderId, filledQty, filledPrice }
```

### Late-Connect Book State

When a user first opens the order book for a symbol:

```mermaid
sequenceDiagram
    participant Browser
    participant WS

    Browser->>WS: SUBSCRIBE_SYMBOL { symbol: "TATA_INR" }
    WS->>WS: Request current book snapshot from engine
    WS-->>Browser: INITIAL_BOOK_STATE { bids: [...], asks: [...] }
    Note over Browser: Renders full current order book instantly
    Note over Browser: Subsequent BOOK_UPDATED events apply diffs
```

### Order Payload Formats

```typescript
// Request (Browser → API)
{
  "kind": "buy",          // "buy" | "sell"
  "type": "limit",        // "limit" | "market"
  "price": 200,           // omit for market orders
  "quantity": 2,
  "market": "TATA_INR"
}

// Enqueued to Redis (API → Engine)
{
  "orderId": "a1b2c3d4",  // generated server-side
  "userId": "user-xyz",   // from verified JWT — never from client body
  "kind": "buy",
  "type": "limit",
  "price": 200,
  "quantity": 2,
  "symbol": "TATA_INR",
  "timestamp": 1710000000000
}
```

---

## 7. Security & Validation

### Auth & Token Flow

```mermaid
flowchart TD
    A["POST /signup\nbcrypt hash password"] --> B["OTP emailed\nverificationToken JWT 10min"]
    B --> C["POST /verify-otp\ncheck OTP"]
    C -->|valid| D["Issue accessToken 15min\nrefreshToken stored in Redis 30d"]
    D --> E["WS upgrade\njwt.verify at handshake"]
    E -->|invalid| F["401 socket.destroy()"]
    E -->|valid| G["Connection established\nidentity locked server-side ✅"]
    G --> H["POST /api/v1/order\nuserId from socket — never from body ✅"]
```

### Refresh Token Rotation

```mermaid
sequenceDiagram
    participant Client
    participant Server
    participant Redis

    Client->>Server: POST /refresh-token { refreshToken }
    Server->>Redis: GET refresh:sha256(token)

    alt token missing / already rotated
        Redis-->>Server: null
        Server-->>Client: 401 — possible replay attack
    else valid
        Redis-->>Server: userId
        Server->>Redis: DEL refresh:sha256(oldToken)
        Server->>Redis: SETEX refresh:sha256(newToken) userId 2592000
        Server-->>Client: new accessToken + refreshToken ✅
    end
```

### Rate Limiting

`express-rate-limit` with Redis store — survives restarts, shared across all API instances:

| Endpoint | Window | Limit | Purpose |
|---|---|---|---|
| `POST /api/v1/order` | 60 sec | 100 req | Prevent order flooding / DoS |
| `/signup`, `/signin` | 15 min | 10 req | Prevent brute force |
| `/refresh-token` | 15 min | 30 req | Prevent token abuse |

`app.set("trust proxy", 1)` ensures real client IP is used behind the load balancer.

### Identity Enforcement

`userId` is **always** read from `socket.userId` (set at JWT verification time) — never from the incoming message body. A client cannot forge a different user's orders or fills.

---

## 8. State Management & Data Integrity

### What Lives Where

| State | Location | Why |
|---|---|---|
| Order book (bids/asks) | In-memory (engine process) | Nanosecond-range matching; Redis RTT would be fatal |
| Live socket references | In-memory (`connections` Map, local only) | Cannot serialize; per-instance |
| Order queue | Redis List | Survives API restart; engine reads at its own pace |
| Result/event queue | Redis Pub/Sub | Fan-out to N WS instances |
| Refresh tokens | Redis String + TTL | Built-in expiry; no cleanup cron |
| Rate limit counters | Redis String + TTL | Shared across instances; built-in windowing |
| Users (identity) | MongoDB | Permanent; query by email |
| Trade history | MongoDB | Persistent audit log |

### Why Order Book State Lives In-Memory (Not Redis)

The matching engine compares best bid vs best ask on every incoming order. On a busy symbol this happens thousands of times per second. A Redis `ZADD` + `ZRANGE` round-trip adds ~0.5ms per operation. At 5,000 orders/sec, that's **2.5 seconds of latency** introduced purely by persistence overhead.

**The tradeoff:** if the engine process crashes, the in-memory book is lost. Mitigations:
- All matched trades are persisted to MongoDB (audit log)
- Unmatched resting orders can be re-enqueued from a persistent order store (future feature)
- The Redis order queue is durable — unprocessed orders survive an engine restart

### Eventual vs Strict Consistency

**Eventual consistency (AP)** — chosen deliberately. The sequence `match → PUBLISH` involves Redis Pub/Sub which is at-most-once. A browser between operations could briefly see a stale book — but receives the correct state within milliseconds via the next BOOK_UPDATED event. For a trading UI this window is imperceptible. Strict consistency would require distributed transactions at significantly higher latency cost.

---

## 9. Reliability & Fault Tolerance

### Failure Scenarios

```mermaid
flowchart TD
    subgraph RD["Redis Down"]
        R1["POST /order returns 503 — queue unavailable"]
        R2["Engine: BLPOP blocks — no new orders processed"]
        R3["Rate limiting fails open — requests pass through"]
        R4["Health → 503 → container restarts"]
    end

    subgraph MD["MongoDB Down"]
        M1["Signin / Signup fails"]
        M2["Trade history writes fail"]
        M3["Active matching engine unaffected ✅"]
        M4["In-flight orders still match ✅"]
    end

    subgraph EC["Engine Crash"]
        C1["In-memory book lost ⚠️"]
        C2["Unprocessed queue items preserved in Redis ✅"]
        C3["Engine restarts — book rebuilt from resting orders (future)"]
        C4["Queue drains normally on recovery ✅"]
        C1 --> C3
    end

    subgraph AC["API Crash"]
        D1["New order submissions fail"]
        D2["Engine continues matching queued orders ✅"]
        D3["WS server continues broadcasting ✅"]
        D4["API restarts — zero state to recover ✅"]
    end
```

### Queue Durability on API Restart

Orders enqueued to Redis before an API process crash are **not lost**:

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant Redis
    participant Engine

    Client->>API: POST /order
    API->>Redis: RPUSH order_queue ✅ (persisted in Redis)
    API->>API: crashes 💥

    Note over Redis: order still in queue
    Note over Engine: BLPOP dequeues normally
    Engine->>Engine: matches order ✅
```

The client receives a 503 if the crash happens before the API responds — but the order may still be in the queue and get matched. Idempotent order submission (retry with same `orderId`) prevents duplicates.

### Graceful Shutdown

```typescript
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000); // force exit after 10s
});
```

On shutdown, the engine stops consuming new orders. The Redis queue holds unprocessed orders until the engine restarts.

---

## 10. Backend Engineering Quality

### Separation of Concerns

```
orderbook-server/src/
├── engine/                  # Pure matching logic — zero I/O, zero Express, zero Redis
│   ├── OrderBook.ts         # Bid/ask data structures + PTP algorithm
│   ├── Matcher.ts           # Match incoming order against opposite side
│   └── engine.types.ts      # Order, Fill, BookSnapshot TypeScript interfaces
│
├── queue/                   # Redis I/O only — no business logic
│   ├── consumer.ts          # BLPOP loop → dispatch to engine
│   └── producer.ts          # RPUSH results to Redis
│
├── pubsub/                  # Redis Pub/Sub — broadcast book + fill events
│   └── publisher.ts
│
├── ws/                      # WebSocket server — auth, subscriptions, push
│   ├── socket.server.ts
│   └── socket.types.ts
│
├── api/                     # Express HTTP layer — order ingestion only
│   └── order.routes.ts
│
└── index.ts                 # Composition root
```

### Dependency Direction

```mermaid
flowchart LR
    API["api/\nHTTP transport\nno engine imports"] --> Queue
    Queue["queue/consumer.ts\nRedis I/O only"] --> Engine
    Engine["engine/\nPure business logic\nno Redis · no Express · no I/O"]
    Queue --> PubSub["pubsub/publisher.ts\nRedis PUBLISH only"]
    WS["ws/\nWebSocket transport\nno engine imports"] --> PubSub
```

- `engine/` has zero network imports — pure TypeScript logic, fully unit-testable with no mocking
- `api/` has zero engine imports — it validates and enqueues; never inspects book state
- `ws/` has zero engine imports — it receives events from Redis, not directly from the engine

### Testing the Engine in Isolation

Because the engine is pure logic with no I/O dependencies:

```typescript
const book = new OrderBook("TATA_INR");

book.addOrder({ orderId: "1", kind: "sell", type: "limit", price: 200, qty: 5, userId: "u1" });
book.addOrder({ orderId: "2", kind: "sell", type: "limit", price: 205, qty: 3, userId: "u2" });

const fills = book.addOrder({ orderId: "3", kind: "buy", type: "limit", price: 202, qty: 3, userId: "u3" });

// fills[0] === { matchedOrderId: "1", price: 200, qty: 3 }
// book.getBestAsk() === { price: 200, qty: 2 }
// No mocks. No Redis. No HTTP. Pure assertion.
```

### Redis Client Abstraction

Two dedicated Redis clients exported from `src/utils/redis/redisClient.ts`:
- `redisPublisher` — for all WRITE operations (RPUSH, PUBLISH, SETEX, etc.)
- `redisSubscriber` — dedicated to `pSubscribe` (cannot run other commands while subscribed)

No direct `ioredis` imports outside of this file.

---

## 11. Performance

### Throughput Estimates

| Event | Frequency | Redis Ops |
|---|---|---|
| New order placed | 5,000 req/s | 1× RPUSH |
| Order consumed by engine | 5,000/s | 1× BLPOP |
| Book update broadcast | ~3,000/s | 1× PUBLISH |
| Fill event | ~2,000/s | 1× PUBLISH |
| WS broadcast per client | ~5,000 events/s total | 0 Redis ops (local) |

**Peak Redis throughput:** ~15,000 ops/s — well within Redis 7's ~1,000,000 ops/s single-instance ceiling.

### Memory Footprint Per Symbol

| Item | Size |
|---|---|
| Order book (10,000 levels, both sides) | ~5MB |
| Redis order queue (steady-state ~0 depth) | ~0KB |
| Redis pub/sub subscription overhead | ~1KB |
| WS connection refs per 1,000 clients | ~1MB |
| **Total per active symbol** | **~6MB** |

50 active symbols = ~300MB Node.js heap. Comfortable on a 2GB container.

### Broadcasting Cost

`broadcastToSymbol` currently iterates all local connections filtered by subscribed symbol. Complexity: O(total_connections). At 10,000 connected clients across 50 symbols, average 200 clients/symbol — O(200) per broadcast. Acceptable at current scale.

**Optimization at scale:** maintain a `symbolConnections: Map<symbol, Set<connectionId>>` index → O(room_size) per broadcast instead of O(total_connections).

---

## 12. Scalability

### Scaling to 500,000 Concurrent Users

| Bottleneck | Current Limit | Fix |
|---|---|---|
| WebSocket connections | ~65k per OS (file descriptors) | Multiple WS instances behind load balancer |
| Redis pub/sub throughput | ~1M msg/s (single instance) | Redis Cluster with channel-key affinity |
| Engine throughput | ~50k orders/s per process | Vertical scale; Node.js cluster mode |
| MongoDB write throughput | ~10k writes/s | Write-concern tuning; sharding by symbol |
| Broadcasting cost | O(total_connections) | O(room_size) with symbol-connection index |

### What Breaks First at Scale

```mermaid
flowchart TD
    Load["500k DAU → ~50k concurrent"]
    Load --> Calc["50 symbols × 1,000 clients/symbol\n× 20 book updates/s = 1M events/s"]
    Calc --> B1["WS broadcasting O(total_conns)\n→ CPU bottleneck ❌"]
    Calc --> B2["Single Redis pub/sub\n→ ~1M msg/s ceiling ⚠️"]
    B1 --> Fix1["symbolConnections Map index\nO(room_size) broadcast"]
    B2 --> Fix2["Redis Cluster\nhash-tag per symbol"]
```

### Infrastructure at Scale

| Component | Current | At Scale |
|---|---|---|
| Redis | Railway Redis | AWS ElastiCache (Redis Cluster) |
| MongoDB | Atlas Free | Atlas Dedicated M30+ with read replicas |
| API Servers | Railway (N instances) | AWS ECS Fargate auto-scaling |
| Engine Processes | Railway (1 per symbol) | AWS ECS Fargate (1 task per symbol) |
| WebSocket Servers | Railway (N instances) | AWS ECS + ALB with WebSocket support |
| Frontend | Railway static | CloudFront + S3 |

**Total infrastructure cost at 500k DAU:** ~$1,500–2,500/month on AWS.

### Metrics to Monitor

| Metric | Alert Threshold |
|---|---|
| Redis order queue depth | >100 per symbol |
| Redis pub/sub lag | >10ms |
| WebSocket connection count | >50k per instance |
| Engine order processing time (P99) | >5ms |
| HTTP p99 latency | >200ms |
| Reconnect rate | >5% per minute |

---

## 13. Extensibility

### Adding New Trading Symbols

```typescript
// config/symbols.ts
export const SYMBOLS = ["TATA_INR", "PAYTM_INR", "ZOMATO_INR", "NIFTY_INR"];

// Engine creates an OrderBook instance per symbol at startup
const books = new Map(SYMBOLS.map(s => [s, new OrderBook(s)]));
```

Adding a symbol requires only a config change — no changes to matching logic, queue infrastructure, or WebSocket layer.

### Adding Stop-Loss Orders

Stop orders rest in a **pending book** rather than the active book:

```typescript
class StopOrderBook {
  onPriceUpdate(marketPrice: number): Order[] {
    return this.stops
      .filter(o => o.side === "buy"
        ? marketPrice >= o.stopPrice
        : marketPrice <= o.stopPrice)
      .map(o => ({ ...o, type: "market" })); // convert → re-enqueue as market order
  }
}
```

Triggered orders are re-enqueued to the Redis order queue as market orders — zero changes to the matching engine.

### Adding Order Persistence (Crash Recovery)

1. Add `Order` Mongoose model: `{ orderId, userId, symbol, side, type, price, qty, status, createdAt }`
2. API Server writes to MongoDB **before** enqueueing to Redis
3. Engine updates status on fill via MongoDB update
4. On engine restart: `db.orders.find({ status: "open" })` → re-enqueue to Redis queue
5. Full crash recovery of all resting orders — zero lost state

### Adding Options / Futures

Each instrument type gets its own engine class implementing a shared interface:

```typescript
interface BaseOrderBook {
  addOrder(order: Order): Fill[];
  cancelOrder(orderId: string): boolean;
  getSnapshot(): BookSnapshot;
}

class SpotOrderBook extends BaseOrderBook { ... }
class FuturesOrderBook extends BaseOrderBook { ... }  // adds expiry, margin checks
class OptionsOrderBook extends BaseOrderBook { ... }  // adds strike, Greeks
```

The queue infrastructure, WebSocket layer, and Redis pub/sub are instrument-agnostic.

### Versioning the WebSocket Protocol

```typescript
// wss://api.exchange.io/ws?token=...&v=2
const router = version === "2" ? routerV2 : routerV1;
```

Maintain N-1 versions. Deprecate with 90-day notice.

---

## 14. Tradeoffs & Alternatives

### Why `ws` Instead of Socket.IO?

| | Socket.IO | `ws` |
|---|---|---|
| Client bundle | +45KB | 0 (native WebSocket API) |
| Protocol | Custom framing | RFC 6455 standard |
| Rooms | Built-in (in-memory — breaks horizontal scale) | Redis Pub/Sub (distributed) |
| Reconnection | Built-in | Implemented explicitly |
| Polling fallback | ✅ (legacy browser support) | ❌ |
| Wire visibility | ❌ Opaque | ✅ Full control |

Socket.IO's built-in rooms are in-memory per instance — they break the moment you run two API instances. Redis-backed pub/sub works across any number of instances by design.

### Why Not Kafka for the Order Queue?

| | Redis Lists + BLPOP | Kafka |
|---|---|---|
| Already in stack | ✅ | ❌ |
| Latency | <1ms | 5–15ms |
| Guaranteed delivery | ✅ (BLPOP is atomic) | ✅ |
| Message replay | ❌ | ✅ |
| Operational overhead | None (already using Redis) | ZooKeeper + broker cluster |
| At-scale limit | ~1M ops/s | Millions/s |

Redis Lists provide all the delivery guarantees needed at this scale. Kafka would be appropriate if we needed to replay the full order history for backtesting — a future premium feature.

### Why Not a Serverless Matching Engine?

The matching engine requires:
1. **Persistent in-memory state** (the order book) between invocations
2. **Strict serial execution** per symbol — no concurrent invocations
3. **Sub-millisecond response time** — cold starts are unacceptable

None of these properties are compatible with serverless functions, which are stateless, may run concurrently, and have cold start latency of 100–500ms.

### Why Not CRDTs?

CRDTs are designed for **commutative, concurrent edits** where two users editing the same data need conflict resolution. An order book is different: each order is an **independent command** processed strictly serially by one engine instance. Two simultaneous orders either both match, one matches the other, or both rest in the book. There is no conflict — just strict serialization enforced by BLPOP. CRDTs would add significant complexity for zero benefit.

---

## 15. Deep Technical Questions

### Is the System CP or AP Under CAP Theorem?

**AP (Available + Partition Tolerant)** for the real-time layer. During a Redis network partition:
- API Server continues accepting orders but cannot enqueue — returns 503
- WebSocket Server continues serving connected clients but misses new events
- Engine continues processing from any buffered queue items but cannot publish results

On partition recovery, pub/sub resumes. No events are replayed — clients receive only new events.

**CP for the matching engine** — strict serial processing per symbol is guaranteed by the single BLPOP consumer. No two orders on the same symbol are ever processed simultaneously.

### Race Condition Analysis: Two Simultaneous Orders

```
T=0: Order A (buy 200, qty 2) arrives at API Instance 1
T=0: Order B (buy 200, qty 2) arrives at API Instance 2

T=1ms: Both enqueued to Redis:
  order_queue:TATA_INR → [A, B]

T=2ms: Engine BLPOP dequeues A (atomic)
T=3ms: Engine matches A against ask book
T=4ms: Engine BLPOP dequeues B (atomic)
T=5ms: Engine matches B against updated book

Result: No race condition. Redis BLPOP is atomic — only one consumer
dequeues each message. The engine processes strictly serially.
Redis's single-threaded execution model is the synchronization primitive.
No distributed locks required.
```

### Ghost Order Prevention

Resting orders in the book reference a `userId`. If a user disconnects mid-session, their resting limit orders remain valid — this is correct exchange behavior. Explicit cancel is required to remove them.

For the WebSocket layer, disconnected users are detected via:
1. **Proactive heartbeat** — 30s ping/pong; terminate on no pong
2. **Reactive cleanup** — `close` event removes socket from `connections` Map
3. **Reconnect + re-subscribe** — client re-subscribes to symbol channels on reconnect

### Debugging a Production Issue

```bash
# 1. Health check
curl https://api.exchange.io/health
# {"status":"ok","redis":"connected","mongodb":"connected","queueDepth":{"TATA_INR":0}}

# 2. Inspect queue depth (should be ~0 in steady state)
redis-cli LLEN order_queue:TATA_INR

# 3. Check pub/sub subscriber count (should equal WS instance count)
redis-cli PUBSUB NUMSUB symbol:TATA_INR

# 4. Manually inject test order
redis-cli RPUSH order_queue:TATA_INR \
  '{"orderId":"test-1","userId":"debug","kind":"buy","type":"limit","price":100,"quantity":1}'

# 5. Verify engine consumed it
redis-cli LLEN order_queue:TATA_INR  # should be 0

# 6. Watch live book events in real time
redis-cli SUBSCRIBE symbol:TATA_INR
```

### Success Metrics

| Metric | Target |
|---|---|
| Order-to-match latency (P95) | <5ms |
| Book update broadcast latency | <10ms |
| Queue depth (steady state) | <10 per symbol |
| Engine throughput | >5,000 orders/sec |
| WebSocket reconnect success rate | >99% |
| Redis pub/sub lag | <1ms |

---

## 16. Local Development

### Prerequisites

- Node.js 20+ (`nvm install 20 && nvm use 20`)
- Docker + Docker Compose

### Full Stack via Docker (Recommended)

```bash
git clone https://github.com/Light1300/Exchange.git
cd Exchange
docker-compose up --build
```

Services available at:
- **Frontend:** `http://localhost:3000`
- **API Server:** `http://localhost:8080`
- **WebSocket:** `ws://localhost:8080`
- **Redis:** `localhost:6379`

### Manual Setup

```bash
# Terminal 1 — Redis
docker run -p 6379:6379 redis:7

# Terminal 2 — Orderbook Server (Engine + WS)
cd orderbook-server
cp .env.example .env
npm install
npm run dev

# Terminal 3 — Frontend
cd exchange-frontend
cp .env.example .env
npm install
npm run dev
```

### Environment Variables

```env
# orderbook-server/.env
PORT=8080
CLIENT_URL=http://localhost:3000
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/exchange
ACCESS_TOKEN_SECRET=<64-char random hex>
REFRESH_TOKEN_SECRET=<64-char random hex>
REDIS_URL=redis://localhost:6379
SYMBOLS=TATA_INR,PAYTM_INR,ZOMATO_INR

# exchange-frontend/.env
REACT_APP_API_URL=http://localhost:8080/api
REACT_APP_WS_URL=ws://localhost:8080
```

### Verify

```bash
# Health check
curl http://localhost:8080/health
# {"status":"ok","redis":"connected","mongodb":"connected","queueDepth":{}}

# Place a test order (requires valid JWT)
curl -X POST http://localhost:8080/api/v1/order \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"kind":"buy","type":"limit","price":200,"quantity":2,"market":"TATA_INR"}'
# {"orderId":"a1b2c3d4","status":"queued"}
```

---

## 17. Folder Structure

```
Exchange/
├── exchange-frontend/                   # React + TypeScript trading UI
│   ├── src/
│   │   ├── components/
│   │   │   ├── OrderBook.tsx            # Live bid/ask depth table — WebSocket driven
│   │   │   ├── OrderForm.tsx            # Place limit / market orders
│   │   │   └── TradeHistory.tsx         # Recent fills feed
│   │   ├── hooks/
│   │   │   ├── useRoomSocket.ts         # WS lifecycle, reconnect, event dispatch
│   │   │   └── useOrderBook.ts          # Order book state — bids / asks / spread
│   │   ├── pages/
│   │   │   ├── TradingPage.tsx          # Main view: book + form + feed
│   │   │   └── Dashboard.tsx            # Symbol selector
│   │   └── lib/api.ts                   # Axios instance + auth interceptor
│   └── package.json
│
├── orderbook-server/                    # Node.js — Engine + API + WebSocket
│   ├── src/
│   │   ├── engine/
│   │   │   ├── OrderBook.ts             # Bid/ask sorted structures + PTP algorithm
│   │   │   ├── Matcher.ts               # Match incoming order, emit fills
│   │   │   └── engine.types.ts          # Order, Fill, BookSnapshot interfaces
│   │   ├── queue/
│   │   │   ├── consumer.ts              # BLPOP loop → engine dispatch
│   │   │   └── producer.ts              # RPUSH orders to Redis queue
│   │   ├── pubsub/
│   │   │   └── publisher.ts             # PUBLISH book updates + fills to Redis
│   │   ├── ws/
│   │   │   ├── socket.server.ts         # JWT auth on upgrade, heartbeat, push
│   │   │   ├── ws.router.ts             # SUBSCRIBE_SYMBOL, CANCEL_ORDER handlers
│   │   │   └── socket.types.ts          # SocketEvent enum, payload interfaces
│   │   ├── api/
│   │   │   ├── order.routes.ts          # POST /api/v1/order
│   │   │   └── auth.routes.ts           # /signup /signin /refresh-token
│   │   ├── middleware/
│   │   │   └── rate-limiter.ts          # express-rate-limit + Redis store
│   │   ├── utils/
│   │   │   ├── redis/redisClient.ts     # Publisher + subscriber Redis clients
│   │   │   ├── auth/jwt.ts              # sign / verify tokens
│   │   │   └── mongodb/client.ts        # MongoDB singleton
│   │   └── index.ts                     # Composition root: wire + graceful shutdown
│   ├── Dockerfile                       # Multi-stage: build (tsc) → prod (dist only)
│   ├── docker-compose.yml               # Local dev: server + Redis
│   └── .env.example
│
└── README.md
```

---

## Technology Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend framework | React | 18 |
| Frontend language | TypeScript | Strict |
| Styling | Tailwind CSS | 3.x |
| HTTP client | Axios | 1.x |
| Backend runtime | Node.js | 20 LTS |
| Backend framework | Express | 4.x |
| Backend language | TypeScript | 5.x Strict |
| WebSocket library | `ws` | 8.x |
| Database | MongoDB (Atlas) | 7.x |
| ODM | Mongoose | 8.x |
| Cache / Queue / Broker | Redis | 7.x |
| Redis client | ioredis | 5.x |
| Auth | JWT (jsonwebtoken) | — |
| Password hashing | bcrypt | — |
| Rate limiting | express-rate-limit + rate-limit-redis | — |
| Containerization | Docker (multi-stage) | — |
| Deployment | Railway | — |

---

<div align="center">

Built with TypeScript, Redis, and WebSockets.
Price-Time Priority matching. Designed to scale.

</div>
