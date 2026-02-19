# AI Trading Bot – Plan (Zerodha Kite Connect)

## Overview

Build an AI-based trading bot that uses Zerodha’s [Kite Connect API](https://kite.trade/docs/kiteconnectjs/v3/) to place and manage orders for **equity**, **futures**, and **options**. Start with a basic, extensible app and improve over time.

---

## Architecture

```
TradeBot/
├── src/
│   ├── config/           # Env & app config
│   ├── zerodha/          # Kite Connect client (auth, session)
│   ├── agents/           # Order agents (equity, futures, options)
│   └── app.js            # Entry: CLI / trigger agents
├── PLAN.md
├── README.md
└── package.json
```

---

## Phases

### Phase 1 – Foundation (current)

- **Config**: Load `KITE_API_KEY`, `KITE_API_SECRET`, `KITE_ACCESS_TOKEN` (or request token flow) from env.
- **Zerodha client**: Thin wrapper around `kiteconnect`:
  - `getLoginURL()`, `generateSession(requestToken)`, `setAccessToken(token)`
  - Expose `placeOrder`, `getOrders`, `getPositions`, `getMargins`, `getQuote`, etc.
- **Order agents** (no AI yet; just structured API calls):
  - **Equity agent**: Buy/sell stocks (NSE/BSE), products: `CNC`, `MIS`.
  - **Futures agent**: Buy/sell futures (NFO), product: `NRML` or `MIS`.
  - **Options agent**: Buy/sell options (NFO), product: `NRML` or `MIS`.
- **App entry**: Simple CLI (or small HTTP server) that:
  - Ensures session (login URL or access token).
  - Calls agents to place sample orders (e.g. place, list orders, positions).

### Phase 2 – AI integration (later)

- Add a layer that:
  - Takes market data (e.g. from Kite ticker/quote APIs) and/or external signals.
  - Uses an LLM or a small model to decide: instrument, side (BUY/SELL), quantity, product, order type (MARKET/LIMIT/SL/SL-M).
  - Calls the existing agents with the decided parameters.
- Keep agents as pure “executors”: they only validate and call Zerodha APIs.

### Phase 3 – Improvements (later)

- **Risk**: Max position size, daily loss limit, per-instrument limits.
- **Postbacks**: Order status updates via webhooks.
- **Ticker**: Live quotes for AI or alerts.
- **Logging & persistence**: Order log, P&amp;L, audit trail.
- **UI**: Optional dashboard to monitor positions and orders.

---

## Zerodha API usage

| Need              | API / component        |
|-------------------|------------------------|
| Auth              | `getLoginURL`, `generateSession` |
| Place order       | `placeOrder(variety, params)`    |
| Orders / trades   | `getOrders()`, `getOrderHistory(id)`, `getTrades()` |
| Positions         | `getPositions()`                 |
| Margins           | `getMargins()`, `orderMargins()` |
| Quote / LTP       | `getQuote()`, `getLTP()`         |
| Instruments       | `getInstruments(exchange)`       |

**Order params (common):** `tradingsymbol`, `exchange`, `transaction_type` (BUY/SELL), `quantity`, `product`, `order_type` (MARKET/LIMIT/SL/SL-M), `price` (limit), `trigger_price` (SL).

**Products:**  
- Equity: `CNC` (delivery), `MIS` (intraday).  
- F&amp;O: `NRML`, `MIS`.

**Exchanges:** NSE, BSE (equity); NFO (futures, options).

---

## Agent responsibilities

| Agent      | Exchange | Product | Role |
|-----------|----------|---------|------|
| Equity    | NSE, BSE | CNC, MIS | Place/cancel equity orders; optional: holdings. |
| Futures   | NFO      | NRML, MIS | Place/cancel futures orders; optional: position checks. |
| Options   | NFO      | NRML, MIS | Place/cancel options orders; optional: position checks. |

Agents accept normalized inputs (e.g. symbol, quantity, side, order type, product) and build Kite `placeOrder` params, then call the shared Zerodha client.

---

## Next steps

1. Get API keys from [Kite Connect Developer Portal](https://developers.kite.trade/).
2. Run the app: generate login URL, complete flow, get access token; or set `KITE_ACCESS_TOKEN` for testing.
3. Trigger agents via CLI (or later via API) with paper/small size first.
4. Add AI layer that outputs (symbol, side, quantity, product, order_type) and feeds agents.
