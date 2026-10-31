# Context — TradeBot

## Purpose (observed from README.md / PLAN.md)

**TradeBot** — an AI-oriented options scalping bot for the Indian market
(NIFTY / BANKNIFTY), trading equity, futures, and options through
[Zerodha Kite Connect](https://kite.trade/docs/kiteconnectjs/v3/). It ships
with a CLI, a set of "agent" modules that place/validate orders, and a
small web dashboard. See **PLAN.md** for the full architecture, phased
roadmap, and the three scalping strategies it's built around (VWAP
mean-reversion straddle, Supertrend momentum scalp, expiry-day gamma
burst).

## Stack

- Node.js 18+, ESM (`"type": "module"`)
- `kiteconnect` — Zerodha Kite Connect API client
- `express` + `ws` — web dashboard (HTTP + live WebSocket updates)
- `better-sqlite3` — local trade/event journal (`data/tradebot.db`)
- `winston` — logging (`logs/combined.log`, `logs/error.log`)
- `eventemitter3` — internal event bus for the agent pipeline
- Plain HTML/CSS/JS dashboard front end (`src/public/`), no framework

## Structure

```
src/
├── config/           Env config
├── zerodha/          Kite Connect client wrapper
├── agents/           equityAgent, futuresAgent, optionsAgent (order
│                     execution) + executionAgent, monitorAgent,
│                     regimeAgent, riskAgent (strategy pipeline)
├── strategies/        vwapStraddle, momentumScalp, gammaBurst
├── indicators/        rsi, vwap, supertrend, adx, greeks
├── data/              instrumentManager, oiTracker, ticker, candleBuilder
├── db/                database.js (SQLite journal)
├── scripts/login.js   Kite OAuth login flow (prints URL, exchanges token)
├── orchestrator.js    Ties regime/strategy/risk/execution agents together
├── bot.js             Long-running bot process (npm run bot[:live])
├── server.js          Express + WebSocket dashboard (npm run ui, :3000)
└── app.js             CLI entry (orders/positions/margins/profile, npm start)
```

## Current status / blockers

- Per **PLAN.md**: Phase 3 (strategy engine + risk) is complete, Phase 5
  (production hardening) is in progress. Failsafe auto-square-off,
  WebSocket dashboard v2, and SQLite audit trail are done; SEBI algo-ID
  registration, a Telegram/email alert system, and real deployment (PM2 on
  a Mumbai server) are still open per the plan's own checklist.
- Paper trading is the default (`PAPER_TRADING=true` in `.env`); no live
  orders unless that's flipped and `KITE_ACCESS_TOKEN` is refreshed via
  `src/scripts/login.js` (access tokens expire and must be re-issued).
- `logs/error.log` records a past startup failure ("Cannot read properties
  of undefined (reading 'startsWith')") from an earlier run — worth
  re-checking if the orchestrator fails to start again.
- **`run.sh` / `deploy.sh` are generic boilerplate, not wired to this
  project's real scripts.** `run.sh` runs `npm install && npm run dev` and
  `deploy.sh` runs `npm install && npm run build`, but `package.json` has
  no `dev` or `build` script — both would fail with "Missing script" as
  currently written. The real entry points are `npm run ui` (dashboard,
  `src/server.js`, port 3000) and `npm run bot` / `bot:live` (`src/bot.js`).
  `stop.sh` targets those real processes/ports rather than the placeholder
  commands. Left `run.sh`/`deploy.sh` untouched per instructions — worth
  fixing them to call real scripts in a future pass.
- `git.sh` is also just a placeholder (`echo 'Placeholder for git.sh'`);
  there's a separate `gitpush.sh` in the repo that may be the real one in
  use.

## Key integrations

- **Zerodha Kite Connect** — API key/secret in `.env` (see
  `.env.example`); redirect URL `http://127.0.0.1:3000/callback`, matching
  the dashboard's default port.

## Next steps

See `next steps.md` in this folder for the tracked task list.
