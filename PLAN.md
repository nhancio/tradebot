# TradeBot: AI-Powered Indian Options Scalping Bot — Master Plan

## Current State (Phase 3 Complete, Phase 5 In Progress)

We have a **production-grade trading engine** with full strategy pipeline:
- ✅ OAuth authentication flow (login URL → request token → access token)
- ✅ Order placement agents (equity, futures, options) with full validation
- ✅ CLI commands (login, orders, positions, margins, profile, order placement)
- ✅ Web UI dashboard (dark theme, WebSocket live updates, trade history)
- ✅ Market data access (WebSocket ticks, candles, OI tracking, VIX)
- ✅ 3 trading strategies (VWAP straddle, momentum scalp, gamma burst)
- ✅ Full risk management (position limits, daily loss limit, auto square-off)
- ✅ SQLite trade journal with audit trail
- ✅ Paper trading mode with full P&L tracking
- ✅ Execution agent with retry logic and trailing stop-loss
- ✅ Position reconciliation with Zerodha
- ✅ Heartbeat monitoring and emergency square-off
- ❌ No AI/ML layer, no backtesting, no Telegram alerts, no SEBI algo registration

---

## Market Context — Indian Options in 2026

### Key Structural Facts
| Detail | Value |
|--------|-------|
| **Weekly expiry** | Nifty (Tuesday), Sensex (Friday) — all others monthly only |
| **Lot sizes** | Nifty: 65, BankNifty: 30, FinNifty: 65, Sensex: 20 |
| **Market hours** | 9:15 AM – 3:30 PM IST |
| **SEBI algo mandate** | April 1, 2026 — all algo orders need exchange-registered Algo-ID |
| **Order rate limit** | <10 orders/sec avoids formal algo registration |
| **API requirement** | Static IP whitelisting + OAuth 2FA mandatory |
| **Options style** | European, cash-settled (NSE index options) |
| **Strike intervals** | Nifty: 50 pts, BankNifty: 100 pts |

### Volatility Windows We Target
1. **Market open (9:15–10:00)** — Gap fills, institutional order flow, highest premium swings
2. **Event reactions** — RBI policy, Union Budget, US Fed — IV crush = premium collapse
3. **Expiry day (Tuesdays for Nifty)** — Gamma explosion, max pain convergence, rapid premium decay
4. **Afternoon reversal (2:00–3:30)** — Institutional positioning for close

### India VIX Strategy Selector
- **VIX < 14**: Mean-reversion, VWAP-based straddle selling, theta farming
- **VIX 14-18**: Momentum scalping with defined-risk spreads
- **VIX > 18**: Directional plays, long straddles on breakouts, avoid naked selling

---

## The Supreme Strategy: Multi-Agent AI Scalping System

### Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   ORCHESTRATOR                       │
│         (Decision Engine + State Manager)            │
├─────────┬──────────┬──────────┬──────────┬──────────┤
│ SIGNAL  │ MARKET   │ RISK     │ EXECUTION│ MONITOR  │
│ AGENT   │ REGIME   │ AGENT    │ AGENT    │ AGENT    │
│         │ AGENT    │          │          │          │
│ - RSI   │ - VIX    │ - Pos    │ - Smart  │ - P&L    │
│ - VWAP  │ - Trend  │   sizing │   order  │   track  │
│ - OI    │ - PCR    │ - Stop   │   routing│ - Alert  │
│ - Super │ - IV     │   loss   │ - Slice  │ - Log    │
│   trend │   Rank   │ - Max    │   orders │ - Report │
│ - Greeks│ - Regime │   loss   │ - Trail  │          │
│         │   detect │          │   SL     │          │
└─────────┴──────────┴──────────┴──────────┴──────────┘
         │                              │
    ┌────▼────┐                   ┌─────▼─────┐
    │ ZERODHA │                   │ ZERODHA   │
    │ WebSocket│                   │ Order API │
    │ (Tick)   │                   │           │
    └─────────┘                   └───────────┘
```

### Agent Descriptions

#### 1. Market Regime Agent
Classifies current market state every 30 seconds:
- **Trending Up/Down**: ADX > 25, Supertrend aligned
- **Range-bound**: ADX < 20, price oscillating around VWAP
- **Volatile/Event**: VIX spike > 15%, sudden OI shifts
- **Pre-expiry**: Last 2 hours of expiry day

Output: `{ regime: “trending_up” | “range_bound” | “volatile” | “pre_expiry”, confidence: 0-1 }`

#### 2. Signal Agent
Generates trade signals based on regime:

**Range-bound regime → Straddle/Strangle Selling**
- Entry: Premium at VWAP + 1 std dev, RSI overbought on premium chart
- Target: Premium mean-reverts to VWAP
- Exit: Premium breaks 2 std dev or time limit hit

**Trending regime → Momentum Options Buying**
- Entry: Supertrend crossover + volume spike + RSI confirmation
- Buy slightly ITM options (delta 0.55-0.65) for leverage
- Exit: Supertrend reversal or 50% profit target

**Volatile regime → Long Straddle on Breakout**
- Entry: When IV Rank < 30 but VIX spiking (cheap premiums, expected move)
- Exit: 30-50% premium gain or reversal signal

**Pre-expiry regime → Gamma Scalping**
- Trade ATM options with rapid delta changes
- Quick in-and-out trades (1-5 minutes)
- Strict time-based exits (no holding past 3:15 PM)

#### 3. Risk Agent
Hard rules that CANNOT be overridden:
- **Max loss per trade**: 2% of capital
- **Max daily loss**: 5% of capital → auto-shutdown
- **Max concurrent positions**: 3
- **Max order rate**: 8/sec (under SEBI 10 OPS limit)
- **Position sizing**: Half-Kelly based on strategy win rate
- **Trailing stop-loss**: Adjusts every tick based on premium movement
- **Greeks limits**: Max portfolio delta ±500, max gamma exposure defined
- **Margin check**: Verify margin availability before every order

#### 4. Execution Agent
Smart order routing:
- **Market orders** for urgent entries/exits (high slippage tolerance)
- **Limit orders** for planned entries (place at best bid/ask)
- **Order slicing**: Break large orders into smaller chunks
- **SL-M orders** for stop-losses (guaranteed execution)
- **Trailing SL**: Update SL order every X premium movement
- **Retry logic**: If order rejected, diagnose (margin? frozen stock?) and alert

#### 5. Monitor Agent
Real-time tracking:
- Per-trade P&L with Greeks decomposition
- Daily P&L waterfall (realized + unrealized)
- Strategy performance metrics (win rate, avg win/loss, Sharpe)
- Alert on: daily loss limit approach, unusual spread widening, API errors
- Trade journal: Every entry/exit with reason, regime, signals

---

## Tech Stack

### Current (Keep)
- **Node.js + Express** — Server and API
- **Zerodha Kite Connect** — Broker integration (`kiteconnect` npm)
- **Web UI** — Dashboard (vanilla JS, dark theme)

### Add — Core Trading Engine
| Component | Technology | Why |
|-----------|-----------|-----|
| **WebSocket tick data** | `kiteconnect` KiteTicker | Real-time price feed, 50-100ms latency |
| **Technical indicators** | `technicalindicators` npm | RSI, VWAP, Supertrend, ADX, Bollinger |
| **Options Greeks** | Custom Black-Scholes or `lets-be-rational` | Delta, gamma, theta, vega calculation |
| **State machine** | Custom or `xstate` | Strategy state management |
| **Logging** | `winston` + file rotation | Trade journal, debug logs |
| **Database** | SQLite via `better-sqlite3` | Trade history, performance metrics |

### Add — AI/ML Layer
| Component | Technology | Why |
|-----------|-----------|-----|
| **Price prediction** | Python microservice (LSTM/Transformer) | Short-term directional prediction |
| **Sentiment** | FinBERT via HuggingFace API | News/social sentiment scoring |
| **Reinforcement learning** | PPO agent (Python) | Adaptive position sizing and timing |
| **LLM reasoning** | Claude API | Complex regime analysis, anomaly detection |

### Add — Dashboard Enhancement
| Feature | Implementation |
|---------|---------------|
| Live P&L chart | WebSocket → Chart.js |
| Options chain heatmap | OI + IV visualization |
| Trade log table | Filterable, sortable |
| Strategy controls | Start/stop/configure per strategy |
| Risk dashboard | Limits, utilization, drawdown |

---

## Implementation Phases

### Phase 2: Live Data + Indicators (Week 1-2) — COMPLETE
```
Priority: Get real-time data flowing and compute signals
```
- [x] **WebSocket integration** — Connect KiteTicker for Nifty/BankNifty options chain
- [x] **Tick data processing** — Aggregate ticks into 1-min, 5-min candles
- [x] **Technical indicators** — RSI, VWAP, Supertrend, ADX on underlying index
- [x] **Options data** — Real-time Greeks calculation, IV computation
- [x] **OI tracking** — Track OI changes per strike, compute PCR
- [x] **India VIX feed** — Pull VIX for regime detection
- [x] **Market Regime Agent v1** — Basic regime classification

### Phase 3: Strategy Engine + Risk (Week 3-4) — COMPLETE
```
Priority: Strategy logic with paper trading
```
- [x] **Signal Agent v1** — 3 strategies implemented:
  - Straddle selling (range-bound regime)
  - Momentum options buying (trending regime)
  - Gamma burst (expiry day)
- [x] **Risk Agent** — All hard limits, position sizing, margin checks
- [x] **Execution Agent** — Smart order placement, SL management, retry logic
- [x] **Paper trading mode** — Full simulation with P&L tracking
- [x] **Trade journal** — SQLite storage of all signals and trades
- [ ] **Backtesting module** — Replay historical data against strategies

### Phase 4: AI Enhancement (Week 5-8)
```
Priority: ML models to improve signal quality
```
- [ ] **LSTM price predictor** — 5-min directional prediction for Nifty
- [ ] **Sentiment agent** — News sentiment via FinBERT
- [ ] **LLM regime analyzer** — Claude API for complex market interpretation
- [ ] **Adaptive parameters** — RL-based tuning of indicator thresholds
- [x] **Multi-strategy orchestration** — Run multiple strategies concurrently
- [ ] **Performance analytics** — Sharpe, Sortino, max drawdown, win rate

### Phase 5: Production Hardening (Week 9-10) — IN PROGRESS
```
Priority: Reliability and compliance
```
- [ ] **SEBI compliance** — Algo-ID registration through Zerodha
- [x] **Failsafe mechanisms** — Auto square-off at 3:15 PM, connection loss handling, heartbeat
- [ ] **Alert system** — Telegram/email alerts for trades, errors, limits
- [x] **Dashboard v2** — WebSocket live updates, trade history API, strategy performance
- [ ] **Deployment** — Mumbai cloud server (low latency), static IP, PM2 process manager
- [x] **Audit trail** — SQLite event logging, signal logging, trade journal

---

## Core Trading Strategies — Detailed Logic

### Strategy 1: VWAP Mean-Reversion Straddle (Range-bound)

```
REGIME: range_bound (ADX < 20, VIX < 14)
INSTRUMENT: ATM Nifty straddle (CE + PE at nearest strike)

ENTRY CONDITIONS (ALL must be true):
  1. Straddle premium > VWAP + 1.0 std dev (overpriced)
  2. RSI(14) on premium chart > 70 (overbought)
  3. No major event in next 2 hours
  4. Within first 4 hours of market (9:15 AM - 1:15 PM)

ENTRY:
  - SELL 1 lot ATM CE + 1 lot ATM PE (MIS product)
  - Place SL-M at premium + 30% of entry premium

EXIT CONDITIONS (ANY triggers exit):
  1. Premium touches VWAP → TARGET HIT (book profit)
  2. Premium > entry + 30% → STOP LOSS HIT
  3. 45 minutes elapsed → TIME EXIT
  4. VIX spikes > 15% from entry → REGIME CHANGE EXIT
  5. 2:30 PM reached → EOD EXIT

POSITION SIZE:
  - Risk = SL distance × lot size × 2 (both legs)
  - Max risk = 2% of capital
  - Lots = floor(2% capital / risk per lot)
```

### Strategy 2: Supertrend Momentum Scalp (Trending)

```
REGIME: trending_up or trending_down (ADX > 25, Supertrend aligned)
INSTRUMENT: Slightly ITM option (delta 0.55-0.65)

ENTRY CONDITIONS (ALL must be true):
  1. Supertrend(10,3) on 5-min chart just flipped direction
  2. Volume on crossover candle > 1.5× average volume
  3. RSI(14) between 40-60 (room to run, not exhausted)
  4. ADX > 25 (confirmed trend)

ENTRY:
  - Trending UP → BUY 1 lot slightly ITM CE
  - Trending DOWN → BUY 1 lot slightly ITM PE
  - Order type: MARKET (speed matters)

EXIT CONDITIONS (ANY triggers exit):
  1. Premium up 50% from entry → TARGET HIT
  2. Supertrend flips against position → REVERSAL EXIT
  3. Premium down 25% from entry → STOP LOSS
  4. 30 minutes elapsed → TIME EXIT
  5. RSI > 80 (if long) or RSI < 20 (if short) → EXHAUSTION EXIT

TRAILING SL:
  - After 20% profit: move SL to entry (breakeven)
  - After 35% profit: move SL to +20%
  - Update SL every 30 seconds
```

### Strategy 3: Expiry Day Gamma Burst (Pre-expiry)

```
REGIME: pre_expiry (Tuesday, last 3 hours)
INSTRUMENT: ATM options with highest gamma

ENTRY CONDITIONS:
  1. Large OI buildup at specific strike (>1M OI)
  2. Price approaching that strike (within 50 points)
  3. Sudden volume spike (>2× average)

ENTRY:
  - If approaching from below: BUY ATM CE
  - If approaching from above: BUY ATM PE
  - Ultra-fast execution: MARKET order

EXIT:
  1. 20% profit → TAKE IT (don’t be greedy on expiry)
  2. 15% loss → CUT IT
  3. 10 minutes max hold time
  4. 3:15 PM hard exit (no overnight risk)
```

---

## Real-Time Data Pipeline

```
Zerodha KiteTicker WebSocket
    │
    ▼
┌─────────────────┐
│ Tick Processor   │ ← Raw ticks: LTP, volume, OI, bid/ask
│                  │
│ • Aggregate to   │
│   1-min candles  │
│ • Compute OHLCV  │
│ • Track OI Δ     │
└────────┬────────┘
         │
    ┌────▼────┐
    │ Indicator│ ← Runs on each new candle
    │ Engine   │
    │          │
    │ • RSI    │
    │ • VWAP   │
    │ • Super  │
    │   trend  │
    │ • ADX    │
    │ • Greeks │
    │ • IV     │
    └────┬─────┘
         │
    ┌────▼────┐
    │ Signal  │ ← Evaluates strategy conditions
    │ Agent   │
    └────┬────┘
         │
    ┌────▼────┐
    │ Risk    │ ← Validates against all limits
    │ Agent   │
    └────┬────┘
         │
    ┌────▼────┐
    │ Execute │ ← Places order via Kite API
    │ Agent   │
    └─────────┘
```

---

## Key Metrics to Track

| Metric | Target | Measurement |
|--------|--------|-------------|
| Win Rate | >55% | Profitable trades / total trades |
| Avg Win / Avg Loss | >1.5 | Mean profit on wins / mean loss on losses |
| Max Drawdown | <10% | Peak-to-trough capital decline |
| Sharpe Ratio | >1.5 | Risk-adjusted returns |
| Trades per Day | 5-15 | Not over-trading |
| Avg Hold Time | 5-30 min | Quick scalps, not swing trades |
| Daily P&L | >0.5% of capital | Consistent daily returns |

---

## Risk Safeguards — Non-Negotiable

1. **Kill switch**: One-click button to cancel all orders + square off all positions
2. **Auto square-off at 3:15 PM**: No overnight MIS positions
3. **Daily loss circuit breaker**: Bot stops trading if 5% daily loss hit
4. **Connection watchdog**: If WebSocket disconnects > 5 sec, square off everything
5. **Margin monitor**: Never use > 80% of available margin
6. **No naked option selling without hedge**: Always defined-risk (spreads) or capped exposure
7. **Heartbeat**: Bot must confirm alive every 30 sec or auto-shutdown triggers

---

## Target File Structure

```
TradeBot/
├── src/
│   ├── agents/                  # Trading agents (existing + new)
│   │   ├── equityAgent.js       # ✅ existing
│   │   ├── futuresAgent.js      # ✅ existing
│   │   ├── optionsAgent.js      # ✅ existing
│   │   ├── signalAgent.js       # NEW: Signal generation
│   │   ├── riskAgent.js         # NEW: Risk management
│   │   ├── executionAgent.js    # NEW: Smart order execution
│   │   ├── monitorAgent.js      # NEW: P&L and trade monitoring
│   │   ├── regimeAgent.js       # NEW: Market regime detection
│   │   └── index.js             # ✅ existing
│   ├── strategies/              # NEW: Strategy implementations
│   │   ├── vwapStraddle.js      # Mean-reversion straddle
│   │   ├── momentumScalp.js     # Supertrend momentum
│   │   ├── gammaBurst.js        # Expiry day gamma
│   │   └── index.js
│   ├── indicators/              # NEW: Technical indicators
│   │   ├── rsi.js
│   │   ├── vwap.js
│   │   ├── supertrend.js
│   │   ├── adx.js
│   │   └── greeks.js
│   ├── data/                    # NEW: Data pipeline
│   │   ├── ticker.js            # WebSocket tick handler
│   │   ├── candleBuilder.js     # Tick → Candle aggregation
│   │   ├── oiTracker.js         # Open interest tracking
│   │   └── vixFeed.js           # India VIX monitoring
│   ├── risk/                    # NEW: Risk management
│   │   ├── positionSizer.js     # Kelly criterion sizing
│   │   ├── stopLoss.js          # SL strategies
│   │   ├── limits.js            # Hard limits enforcement
│   │   └── marginCheck.js       # Pre-trade margin validation
│   ├── db/                      # NEW: Data persistence
│   │   ├── trades.js            # Trade journal
│   │   ├── performance.js       # Strategy metrics
│   │   └── schema.sql           # SQLite schema
│   ├── config/
│   │   └── index.js             # ✅ existing
│   ├── zerodha/
│   │   └── client.js            # ✅ existing (enhance with ticker)
│   ├── orchestrator.js          # NEW: Main trading loop
│   ├── public/                  # ✅ existing (enhance with live charts)
│   ├── scripts/
│   │   └── login.js             # ✅ existing
│   ├── app.js                   # ✅ existing
│   └── server.js                # ✅ existing (add WebSocket endpoints)
├── ai/                          # NEW: Python ML microservice
│   ├── models/
│   │   ├── lstm_predictor.py    # Price direction prediction
│   │   └── sentiment.py         # FinBERT sentiment
│   ├── server.py                # FastAPI microservice
│   └── requirements.txt
├── .env
├── package.json
├── PLAN.md                      # This file
└── README.md
```

---

## Zerodha API Reference (Existing Integration)

| Need | API / Method |
|------|-------------|
| Auth | `getLoginURL()`, `generateSession(requestToken)` |
| Place order | `placeOrder(params)` |
| Orders / trades | `getOrders()`, `getOrderHistory(id)`, `getTrades()` |
| Modify / cancel | `modifyOrder(id, params)`, `cancelOrder(id)` |
| Positions | `getPositions()` |
| Holdings | `getHoldings()` |
| Margins | `getMargins()`, `getOrderMargins(params)` |
| Quote / LTP | `getQuote(instruments)`, `getLTP(instruments)` |
| Instruments | `getInstruments(exchange)` |

**Order params:** `tradingsymbol`, `exchange`, `transaction_type` (BUY/SELL), `quantity`, `product` (CNC/MIS/NRML), `order_type` (MARKET/LIMIT/SL/SL-M), `price`, `trigger_price`.

---

## Broker API Alternatives

| Broker | API | Brokerage | Key Advantage |
|--------|-----|-----------|---------------|
| **Zerodha** (current) | Kite Connect | ₹20/order F&O | Largest community, most mature |
| **Shoonya (Finvasia)** | Shoonya API | **Zero** | Zero brokerage on all segments |
| **Angel One** | SmartAPI | ₹20/order | Free WebSocket, beginner-friendly |
| **Dhan** | DhanHQ | ₹20/order | Modern API, built-in paper trading |

---

## SEBI Compliance Checklist

- [ ] Register algo with Zerodha for exchange Algo-ID (before April 1, 2026)
- [ ] Configure static IP on deployment server
- [ ] Ensure order rate stays under 10 OPS
- [ ] Implement complete audit trail logging
- [ ] OAuth 2FA authentication (already done ✅)
- [ ] Document strategy as “white box” for exchange registration

---

## Immediate Next Steps

1. **Set up KiteTicker WebSocket** — Get live Nifty/BankNifty ticks flowing
2. **Build candle aggregation** — Convert ticks to 1-min and 5-min candles
3. **Implement indicators** — RSI, VWAP, Supertrend on live data
4. **Build Market Regime Agent** — Classify market state in real-time
5. **Implement Strategy 1 (VWAP Straddle)** — Simplest strategy first
6. **Build Risk Agent** — Hard limits before any live trading
7. **Paper trading mode** — Test everything with simulated execution
8. **Go live with 1 lot** — Minimum size, maximum learning

---

## Research References

- SEBI Algo Trading Framework (Feb 2025 circular, effective Apr 1, 2026)
- NSE weekly expiry restructuring to Tuesday (Sep 2025)
- TradingAgents multi-agent framework (arXiv:2412.20138)
- PPO for options trading — 85% success rate (2025 studies)
- Kelly Criterion position sizing (Zerodha Varsity)
- India VIX inverse correlation patterns
- AlgoTest India backtesting platform

---

*Last updated: March 27, 2026*
*Status: Phase 3 complete, Phase 5 in progress → Ready for paper trading validation*
