# TradeBot – AI Trading Bot (Zerodha Kite Connect)

A basic AI-ready trading bot that uses [Zerodha Kite Connect](https://kite.trade/docs/kiteconnectjs/v3/) to place and manage orders for **equity**, **futures**, and **options**. Start with the CLI and agents; add AI signals and risk controls later.

## Plan

See **[PLAN.md](./PLAN.md)** for architecture, phases (foundation → AI → improvements), and agent responsibilities.

## Requirements

- Node.js 18+
- Zerodha account with [2FA TOTP](https://support.zerodha.com/category/trading-and-markets/general-kite/login-credentials-of-trading-platforms/articles/time-based-otp-setup)
- [Kite Connect](https://developers.kite.trade/) app with API key and secret

## Setup

1. **Clone and install**

   ```bash
   cd TradeBot
   npm install
   ```

2. **Environment**

   ```bash
   cp .env.example .env
   ```

   Edit `.env`:

   - `KITE_API_KEY` – from Kite Connect developer portal  
   - `KITE_API_SECRET` – keep secret  
   - `KITE_REDIRECT_URL` – must match the redirect URL configured for your app (e.g. `http://127.0.0.1:3000/callback`)

3. **Login and access token**

   ```bash
   node src/scripts/login.js
   ```

   Open the printed URL in a browser, log in, and copy the `request_token` from the redirect URL. Then:

   ```bash
   KITE_REQUEST_TOKEN=<paste_request_token> node src/scripts/login.js
   ```

   Copy the printed **access token** into `.env` as:

   ```env
   KITE_ACCESS_TOKEN=your_access_token
   ```

   Access tokens expire; repeat the login flow when needed.

## Web UI

Run the UI server and open the dashboard in your browser:

```bash
npm run ui
```

Then open **http://localhost:3000**. You get:

- **Auth status** – Connected / Not authenticated and a link to get the login URL.
- **Data buttons** – Orders, Positions, Margins, Profile (fetch and show JSON in the result area).
- **Place order forms** – Equity, Futures, Options with symbol, side, quantity, product and a “Place order” button each. Response (order ID or error) appears in the result area.

The UI uses the same Zerodha client and agents as the CLI; ensure `KITE_ACCESS_TOKEN` is set in `.env` for data and order actions to work.

## Usage (CLI)

**Info (no order placement):**

```bash
npm start -- help      # list commands
npm start -- orders    # today's orders
npm start -- positions # positions
npm start -- margins   # margin info
npm start -- profile   # user profile
```

**Place orders (real money – use with caution):**

```bash
# Equity: symbol, side, quantity, [CNC|MIS]
node src/app.js order-equity RELIANCE BUY 1 MIS

# Futures: NFO symbol, side, lots, [NRML|MIS]
node src/app.js order-futures NIFTY24FEBFUT BUY 1 NRML

# Options: NFO option symbol, side, lots, [NRML|MIS]
node src/app.js order-options NIFTY24FEB24500CE BUY 1 NRML
```

Use proper NFO tradingsymbols from [instruments](https://kite.trade/docs/connect/v3/market-quotes/#retrieving-the-full-instrument-list) (e.g. `getInstruments("NFO")`).

## Project layout

```
src/
├── config/         # Env config
├── zerodha/        # Kite Connect client wrapper
├── agents/         # Order agents
│   ├── equityAgent.js   # Stocks (NSE/BSE), CNC/MIS
│   ├── futuresAgent.js # NFO futures, NRML/MIS
│   └── optionsAgent.js # NFO options, NRML/MIS
├── scripts/
│   └── login.js   # Login URL + token exchange
└── app.js         # CLI entry
```

## Agents (for AI layer)

Agents are pure executors: they validate inputs and call Zerodha APIs. An AI layer can later decide (symbol, side, quantity, product, order type) and call:

- `placeEquityOrder(client, { symbol, exchange, side, quantity, product, orderType, price?, triggerPrice?, tag? })`
- `placeFuturesOrder(client, { symbol, side, quantity, product, orderType, ... })`
- `placeOptionsOrder(client, { symbol, side, quantity, product, orderType, ... })`

Import from `src/agents/index.js`.

## References

- [Kite Connect API (HTTP)](https://kite.trade/docs/connect/v3)
- [Kite Connect JS client](https://kite.trade/docs/kiteconnectjs/v3/)
- [Kite Connect Developer Portal](https://developers.kite.trade/)

## License

MIT.
