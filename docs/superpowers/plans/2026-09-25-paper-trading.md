# Paper Trading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a data-only Fyers market provider, versioned NSE/BSE reference data, and one fail-closed tenant-scoped paper-order gateway for long-only cash-equity `MARKET`/`LIMIT` `DAY` trading with integer-paise accounting, reservations, idempotency, durable jobs, and reconciliation.

**Architecture:** Production market access lives under `tradebot_hosted.market` and contains no account, OAuth, funds, position, or order methods. Reference instruments and exchange calendars are versioned global data. All paper state is PostgreSQL under forced RLS. `PaperOrderGateway` claims idempotency before side effects, reserves risk under row locks, and delegates fill/expiry work to the Plan 2 fenced job worker.

**Tech Stack:** Plan 1/2 hosted runtime, httpx, pinned `websockets`, PostgreSQL/RLS, Redis rate limits, pydantic, fpdf2 where already required by Plan 2, pytest, Ruff

**Spec:** `docs/superpowers/specs/2026-09-25-production-security-design.md`

## Global Constraints

- v1 supports only NSE/BSE cash equities with `side=BUY|SELL`, `type=MARKET|LIMIT`, `validity=DAY`, lot size one, INR, and positive integral share quantity.
- `BUY` opens/increases a long position; `SELL` only reduces an existing long position. Short, F&O, margin, product variants, stop, bracket, cover, and partial fills are rejected.
- Starting capital is selected once from INR 10,000–10,000,000, defaults to INR 1,000,000, uses integer paise, and is immutable for the tenant lifetime.
- Market quotes expire after 5 seconds; limit quotes after 30 seconds. `yfinance` cannot satisfy the order quote gate.
- Instrument snapshots expire after 24 hours. Exchange calendar coverage must include the current IST date and comes from committed official NSE/BSE-derived data.
- `Idempotency-Key` is 16–128 visible ASCII characters and is claimed before quote, rate-limit, or risk side effects.
- Claim leases are 60 seconds, fenced by owner/epoch; stale workers cannot link, fail, reserve, submit, settle, or fill.
- Money uses integer paise and committed simulation/fee configuration hashes. No float reaches the order/accounting path.
- Paper limits: 10 submissions/second, 200/trading day, 10 open orders, 20 positions, INR 1,000,000/order, 25% starting capital/instrument, 100% gross exposure, 5% start-of-day marked-equity loss.
- State transitions are only `PENDING→ACCEPTED|REJECTED|FAILED|EXPIRED` and `ACCEPTED→FILLED|CANCELLED|FAILED|EXPIRED`.
- Production contains no broker SDK, broker adapter, live mode, raw order route, or `place_order()` path.
- Do not execute commit steps unless the user explicitly authorizes commits in the execution session.

## Review Focus

- Fyers client must provide quotes/instruments only and fail closed on stale/error/missing data rather than return zero/delayed fallback data.
- Instrument/calendar activation must be atomic and exact; guessed symbols or weekday-only sessions are forbidden.
- Concurrent same-key requests create at most one order; different payload under the same key returns `409`.
- BUY/SELL reservations and fill/cancel races must never oversubscribe cash, long quantity, or exposure.
- Worker crash, retry, session expiry, and reconciliation must never duplicate a fill or resurrect a released reservation.

---

### Task 1: Create neutral market contracts and a data-only Fyers provider

**Files:**
- Create: `hosted/src/tradebot_hosted/market/__init__.py`
- Create: `hosted/src/tradebot_hosted/market/contracts.py`
- Create: `hosted/src/tradebot_hosted/market/fyers_data.py`
- Create: `hosted/src/tradebot_hosted/config/market/india_exchange_calendar.json`
- Create: `tests/production/test_market_contracts.py`
- Create: `tests/production/test_fyers_data.py`
- Create: `tests/production/test_market_import_boundary.py`

**Interfaces:**
- Consumes: Plan 1 settings/runtime and Plan 2 job system.
- Produces: `InstrumentKey`, `MarketQuote`, `MarketDataProvider`, and `FyersDataProvider`.

- [ ] **Step 1: Write failing provider-boundary tests**

```python
def test_fyers_data_provider_has_no_account_or_order_api():
    public = {name for name in dir(FyersDataProvider) if not name.startswith("_")}
    assert public.isdisjoint({
        "place_order", "cancel_order", "get_orders", "get_positions",
        "get_funds", "get_profile", "get_holdings", "authorize", "login",
    })


async def test_quote_failure_never_becomes_zero(fyers):
    fyers.http.get_quote.side_effect = UpstreamError()
    with pytest.raises(MarketDataUnavailable):
        await fyers.get_quote(INSTRUMENT)
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_market_contracts.py tests/production/test_fyers_data.py tests/production/test_market_import_boundary.py -v
```

Expected: FAIL because hosted market modules do not exist.

- [ ] **Step 3: Define integer market contracts**

```python
class Exchange(StrEnum):
    NSE = "NSE"
    BSE = "BSE"


@dataclass(frozen=True, slots=True)
class InstrumentKey:
    instrument_id: UUID
    provider: Literal["FYERS"]
    provider_symbol: str
    exchange: Exchange
    trading_symbol: str
    instrument_type: Literal["EQ"]
    currency: Literal["INR"]
    lot_size: Literal[1]
    tick_size_paise: int
    snapshot_id: UUID


@dataclass(frozen=True, slots=True)
class MarketQuote:
    instrument: InstrumentKey
    source: Literal["FYERS_REST", "FYERS_WS"]
    last_price_paise: int
    bid_price_paise: int | None
    ask_price_paise: int | None
    exchange_timestamp: datetime
    received_timestamp: datetime
    provider_payload_sha256: bytes

    @property
    def delay_ms(self) -> int:
        return int((self.received_timestamp - self.exchange_timestamp).total_seconds() * 1000)
```

- [ ] **Step 4: Implement fixed-host Fyers REST/WebSocket/instrument parsing**

`FyersDataProvider` may call only:

- Fyers quote REST host fixed in code
- NSE/BSE cash instrument-master sources fixed in code
- Fyers market WebSocket endpoint fixed in code

Use `httpx.AsyncClient(follow_redirects=False)`, maximum 50 symbols per REST request, `Decimal` parsing, exact paise conversion, no token files, no OAuth, no account endpoints, and no `fyers_apiv3` import. Add reconnect/backoff and bounded queue/stale-tick behavior for WebSocket data.

- [ ] **Step 5: Add the committed exchange calendar**

`india_exchange_calendar.json` covers NSE/BSE sessions for 2026 and 2027, records source URLs/notes, explicit trading/non-trading days, IST open/close times, and a schema/version. It contains no inferred weekday-only logic.

- [ ] **Step 6: Run tests**

```bash
pytest tests/production/test_market_contracts.py tests/production/test_fyers_data.py tests/production/test_market_import_boundary.py -v
```

Expected: PASS.

- [ ] **Step 7: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/market hosted/src/tradebot_hosted/config/market tests/production/test_market_contracts.py tests/production/test_fyers_data.py tests/production/test_market_import_boundary.py
git commit -m "feat: add hosted market data provider"
```

---

### Task 2: Add versioned instrument catalog and exchange reference service

**Files:**
- Create: `hosted/src/tradebot_hosted/market/reference_data.py`
- Create: `hosted/src/tradebot_hosted/migrations/versions/20260925_0005_reference_data.py`
- Create: `hosted/src/tradebot_hosted/jobs/reference.py`
- Create: `tests/production/test_exchange_calendar.py`
- Create: `tests/production/test_instrument_catalog.py`
- Create: `tests/production/test_reference_jobs.py`

**Interfaces:**
- Consumes: Task 1 provider/contracts and Plan 2 system jobs.
- Produces: `ReferenceDataService.resolve_order_instrument/get_session` and active catalog snapshots.

- [ ] **Step 1: Write failing reference tests**

```python
async def test_stale_or_ambiguous_instrument_is_rejected(reference):
    with pytest.raises(ReferenceDataUnavailable):
        await reference.resolve_order_instrument(Exchange.NSE, "UNKNOWN", at=NOW)


async def test_calendar_requires_explicit_date(reference):
    with pytest.raises(ReferenceDataUnavailable):
        await reference.get_session(Exchange.NSE, at=datetime(2028, 1, 1, tzinfo=UTC))
```

Also test NSE/BSE atomic activation, 24-hour snapshot expiry, non-cash/non-equity/lot-size rejection, IST boundaries, and source metadata.

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_exchange_calendar.py tests/production/test_instrument_catalog.py tests/production/test_reference_jobs.py -v
```

Expected: FAIL because reference tables/service do not exist.

- [ ] **Step 3: Add global reference tables**

Create `instrument_snapshots`, `instruments`, `exchange_calendar_versions`, and `exchange_calendars` without tenant RLS. Grant runtime read access and a dedicated system job write path. Enforce unique provider/content hash, one active snapshot, explicit effective dates, unique source symbols, positive tick, exact 32-byte hashes, and composite calendar primary keys.

- [ ] **Step 4: Implement reference service and refresh job**

```python
class ReferenceDataService:
    async def resolve_order_instrument(self, exchange: Exchange, trading_symbol: str, *, at: datetime) -> InstrumentKey: ...
    async def get_session(self, exchange: Exchange, *, at: datetime) -> ExchangeSession: ...
```

The daily 05:00 IST system job fetches NSE and BSE cash masters, validates both, and activates one atomic snapshot. Any failure leaves the prior active snapshot unchanged and records a stable failure code.

- [ ] **Step 5: Run tests**

```bash
pytest tests/production/test_exchange_calendar.py tests/production/test_instrument_catalog.py tests/production/test_reference_jobs.py -v
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/market/reference_data.py hosted/src/tradebot_hosted/jobs/reference.py hosted/src/tradebot_hosted/migrations tests/production/test_exchange_calendar.py tests/production/test_instrument_catalog.py tests/production/test_reference_jobs.py
git commit -m "feat: add hosted market reference data"
```

---

### Task 3: Add paper account, claim, order, event, position, and fill schema

**Files:**
- Create: `hosted/src/tradebot_hosted/migrations/versions/20260925_0006_paper_accounts_claims.py`
- Create: `hosted/src/tradebot_hosted/migrations/versions/20260925_0007_paper_orders.py`
- Create: `hosted/src/tradebot_hosted/migrations/versions/20260925_0008_positions_fills.py`
- Create: `tests/production/test_paper_migrations.py`

**Interfaces:**
- Consumes: Plans 1–2 database/RLS/job schema.
- Produces: PostgreSQL paper state required by Tasks 4–8.

- [ ] **Step 1: Write failing migration tests**

```python
async def test_database_rejects_invalid_order_transition(owner):
    order = await insert_accepted_order(owner, TENANT_A)
    with pytest.raises(IntegrityError):
        await owner.execute(text("UPDATE tradebot.paper_orders SET state='PENDING' WHERE order_id=:id"), {"id": order})


async def test_paper_event_is_append_only(owner):
    event = await insert_event(owner, TENANT_A)
    with pytest.raises(IntegrityError):
        await owner.execute(text("DELETE FROM tradebot.paper_order_events WHERE event_id=:id"), {"id": event})
```

Also test forced RLS, composite cross-tenant FKs, capital bounds/immutability, one fill/order, nonnegative money/reservations, event numbering, and runtime grants.

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_paper_migrations.py -v
```

Expected: FAIL because paper tables do not exist.

- [ ] **Step 3: Add account/claim migration**

Create `paper_accounts` and `idempotency_claims` with all integer-paise, lease, hash, lifecycle, retention, and uniqueness constraints from the spec. Add a database trigger preventing starting-capital updates.

- [ ] **Step 4: Add order/event migration**

Create `paper_orders` and `paper_order_events` with snapshot/hash/reservation columns, state constraints, immutable origin/instrument fields, partial indexes, append-only event trigger, and exact transition trigger.

- [ ] **Step 5: Add position/fill migration**

Create `positions` and `fills` with nonnegative quantity/basis/fees, exact fee-component sum, unique one full fill per v1 order, composite tenant FKs, and no negative positions.

- [ ] **Step 6: Run migration tests**

```bash
alembic -c hosted/alembic.ini upgrade head
pytest tests/production/test_paper_migrations.py -v
```

Expected: PASS.

- [ ] **Step 7: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/migrations tests/production/test_paper_migrations.py
git commit -m "feat: add hosted paper schema"
```

---

### Task 4: Implement pure paper domain, fee schedule, simulation, and risk

**Files:**
- Create: `hosted/src/tradebot_hosted/paper/__init__.py`
- Create: `hosted/src/tradebot_hosted/paper/domain.py`
- Create: `hosted/src/tradebot_hosted/paper/simulation.py`
- Create: `hosted/src/tradebot_hosted/paper/risk.py`
- Create: `hosted/src/tradebot_hosted/config/paper/simulation_v1.json`
- Create: `hosted/src/tradebot_hosted/config/paper/fees_v1.json`
- Create: `tests/production/test_paper_domain.py`
- Create: `tests/production/test_paper_simulation.py`
- Create: `tests/production/test_paper_risk.py`

**Interfaces:**
- Consumes: Task 1/2 market contracts and Task 3 schema semantics.
- Produces: canonical request hash, state enums, reservation/risk decisions, fills, and fee/account deltas used by Tasks 5–7.

- [ ] **Step 1: Write failing domain/simulation/risk tests**

```python
def test_canonical_hash_excludes_quote_and_idempotency_metadata():
    a = SubmitPaperOrder("NSE", "RELIANCE", Side.BUY, OrderType.LIMIT, 10, 123450)
    b = SubmitPaperOrder("NSE", "RELIANCE", Side.BUY, OrderType.LIMIT, 10, 123450)
    assert canonical_order_hash(a) == canonical_order_hash(b)


def test_market_buy_uses_ceiling_after_five_bps_slippage():
    assert market_fill_price_paise(100_000, Side.BUY, slippage_bps=5, tick_size_paise=5) == 100_050


def test_loss_limit_rejects_buy_but_allows_reducing_sell(risk):
    assert risk.evaluate(candidate=LOSS_LIMIT_BUY).allowed is False
    assert risk.evaluate(candidate=REDUCING_SELL).allowed is True
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_paper_domain.py tests/production/test_paper_simulation.py tests/production/test_paper_risk.py -v
```

Expected: FAIL because paper domain modules do not exist.

- [ ] **Step 3: Implement exact enums and canonicalization**

```python
class Side(StrEnum):
    BUY = "BUY"
    SELL = "SELL"


class OrderType(StrEnum):
    MARKET = "MARKET"
    LIMIT = "LIMIT"


@dataclass(frozen=True, slots=True)
class SubmitPaperOrder:
    exchange: Exchange
    trading_symbol: str
    side: Side
    order_type: OrderType
    quantity: int
    validity: Literal["DAY"]
    limit_price_paise: int | None
```

Also define `OrderState`, `OrderOrigin`, `StrategyRef`, `PendingOrderDraft`, `FillDecision`, and `PaperLimits`. Canonical JSON contains only exchange, symbol, side, type, quantity, validity, and limit paise.

- [ ] **Step 4: Implement versioned paise simulation**

`simulation_v1.json` records 5 bps slippage, configuration hash inputs, and supported market rules. `fees_v1.json` records brokerage `max(INR 20, 0.03% turnover)` plus committed NSE/BSE statutory rows for stamp, exchange transaction, SEBI, STT, IPFT/clearing, and GST. All rounding is integer half-up or explicit tick rounding.

- [ ] **Step 5: Implement cash/position/P&L math**

BUY reduces cash by turnover+fees and basis by the same amount. SELL increases cash by turnover-fees, releases weighted basis, and computes realized P&L. Full close releases exact remaining basis. Marked equity is cash plus long-position value; daily loss is `max(0, start_marked_equity-current_marked_equity)`.

- [ ] **Step 6: Implement risk and reservations**

```python
@dataclass(frozen=True, slots=True)
class OrderReservation:
    reserved_cash_paise: int
    reserved_sell_quantity: int
    reserved_exposure_paise: int
    max_reserved_fee_paise: int
```

Limit BUY reserves limit price+max fees. Market BUY reserves reference price+5 bps rounded upward to tick+max fees. Available long is current long minus all nonterminal SELL reservations. Evaluate every configured order/position/exposure/loss limit; missing marks fail closed for BUY but allow reducing SELL/cancel/audit.

- [ ] **Step 7: Run tests**

```bash
pytest tests/production/test_paper_domain.py tests/production/test_paper_simulation.py tests/production/test_paper_risk.py -v
```

Expected: PASS.

- [ ] **Step 8: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/paper hosted/src/tradebot_hosted/config/paper tests/production/test_paper_domain.py tests/production/test_paper_simulation.py tests/production/test_paper_risk.py
git commit -m "feat: add hosted paper domain and risk"
```

---

### Task 5: Implement durable claims, row-lock reservations, and paper repository

**Files:**
- Create: `hosted/src/tradebot_hosted/paper/repository.py`
- Create: `tests/production/test_paper_idempotency.py`
- Create: `tests/production/test_paper_reservations.py`

**Interfaces:**
- Consumes: Plans 1–2 database/jobs, Tasks 2–4 schema/domain.
- Produces: `PaperRepository` claim/reserve/cancel/fill/expire/reconcile operations for gateway/jobs.

- [ ] **Step 1: Write failing PostgreSQL concurrency tests**

```python
async def test_same_key_same_hash_creates_one_claim(paper_repository):
    results = await asyncio.gather(*(submit_same_request(paper_repository) for _ in range(20)))
    assert len({result.claim_id for result in results}) == 1


async def test_stale_claim_owner_cannot_commit_order(paper_repository):
    stale = await takeover_claim(paper_repository)
    with pytest.raises(StaleLease):
        await paper_repository.commit_pending_order(CONTEXT, stale, DRAFT, RISK, SESSION, now=NOW)
```

Add different-hash `409`, lease renewal, epoch increment, no partial order on crash, immutable failure, and concurrent BUY/SELL oversubscription cases.

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_paper_idempotency.py tests/production/test_paper_reservations.py -v
```

Expected: FAIL because repository does not exist.

- [ ] **Step 3: Implement fenced claim operations**

Use `CLAIMED|PROCESSING|COMPLETED|FAILED`, owner/epoch/60-second expiry, canonical request hash, linked order/job, response/failure, and two-year retention. All writes require current owner/epoch/unexpired lease and one affected row.

- [ ] **Step 4: Implement atomic pending commit**

In one transaction lock `paper_accounts` and affected `positions`, recalculate risk, reserve cash/quantity/exposure, create `PENDING` order/event/fill job, and link the claim. Unique constraints and row locks prevent cash/quantity oversubscription.

- [ ] **Step 5: Run tests**

```bash
pytest tests/production/test_paper_idempotency.py tests/production/test_paper_reservations.py -v
```

Expected: PASS with real PostgreSQL.

- [ ] **Step 6: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/paper/repository.py tests/production/test_paper_idempotency.py tests/production/test_paper_reservations.py
git commit -m "feat: add hosted paper reservations"
```

---

### Task 6: Implement the single paper gateway and authenticated API

**Files:**
- Create: `hosted/src/tradebot_hosted/paper/gateway.py`
- Create: `hosted/src/tradebot_hosted/paper/portfolio.py`
- Create: `hosted/src/tradebot_hosted/routers/paper.py`
- Create: `tests/production/test_paper_gateway.py`
- Create: `tests/production/test_paper_api.py`

**Interfaces:**
- Consumes: Tasks 2–5 and Plan 2 auth/jobs/quota/repositories.
- Produces: `PaperOrderGateway`, `PaperAccountService`, and Plan 4 paper APIs.

- [ ] **Step 1: Write failing gateway/API tests**

```python
async def test_claim_precedes_quote_and_rate_limit(gateway, spy_dependencies):
    result = await gateway.submit(CONTEXT, VALID_ORDER, "idem-key-123456", OrderOrigin.manual())
    assert spy_dependencies.event_order == ["claim", "rate_limit", "quote", "risk", "pending_commit"]


async def test_paper_order_rejects_live_and_broker_fields(client):
    response = await client.post("/api/paper/orders", json={**VALID_ORDER, "broker": "zerodha"})
    assert response.status_code == 422
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_paper_gateway.py tests/production/test_paper_api.py -v
```

Expected: FAIL because gateway/routes do not exist.

- [ ] **Step 3: Implement gateway sequence**

1. Validate `Idempotency-Key` and canonical request.
2. Atomically claim before Redis/rate/quote/risk work.
3. Apply Plan 2 Redis submission limits using the unique claim.
4. Resolve active instrument/session and fetch fresh quote.
5. Run pure schema/risk validation.
6. Commit `PENDING` order, event, snapshots, reservation, and fill job under the current claim epoch.
7. Return `202` stable in-progress/terminal receipt; repeated same-hash requests return stored response with `Idempotent-Replayed`.

- [ ] **Step 4: Implement account and order APIs**

```text
POST /api/paper/account
GET  /api/paper/account
GET  /api/paper/positions
GET  /api/paper/orders
GET  /api/paper/risk
POST /api/paper/orders
POST /api/paper/orders/{order_id}/cancel
```

`POST /api/paper/account` accepts only `{starting_capital_paise}` in the approved range and creates the one account. A second different value returns `409`; no update/reset/top-up method exists. Cancellation is allowed without market data.

- [ ] **Step 5: Run tests**

```bash
pytest tests/production/test_paper_gateway.py tests/production/test_paper_api.py -v
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/paper hosted/src/tradebot_hosted/routers/paper.py tests/production/test_paper_gateway.py tests/production/test_paper_api.py
git commit -m "feat: add hosted paper gateway"
```

---

### Task 7: Implement fill, cancel, expiry, and reconciliation jobs

**Files:**
- Create: `hosted/src/tradebot_hosted/paper/jobs.py`
- Modify: `hosted/src/tradebot_hosted/worker.py`
- Create: `tests/production/test_paper_orders.py`
- Create: `tests/production/test_paper_jobs.py`
- Create: `tests/production/test_paper_reconciliation.py`

**Interfaces:**
- Consumes: Plan 2 fenced worker, Tasks 2–6 market/repository/gateway.
- Produces: `handle_paper_fill_job`, `handle_paper_expiry_job`, and `reconcile_paper_tenant_job`.

- [ ] **Step 1: Write failing race/recovery tests**

```python
async def test_fill_and_cancel_race_has_one_winner(paper_repository, job_lease):
    fill, cancel = await asyncio.gather(
        apply_fill(job_lease, FILL),
        cancel_order(CONTEXT, ORDER_ID, reason="USER"),
    )
    assert sum(item.terminal_state in {"FILLED", "CANCELLED"} for item in (fill, cancel)) == 1


async def test_delayed_job_cannot_fill_after_expiry(paper_repository, expired_job):
    result = await handle_paper_fill_job(expired_job, DEPS)
    assert result.order.state is OrderState.EXPIRED
    assert await fill_count(ORDER_ID) == 0
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_paper_orders.py tests/production/test_paper_jobs.py tests/production/test_paper_reconciliation.py -v
```

Expected: FAIL because job handlers do not exist.

- [ ] **Step 3: Implement fill job**

Acquire Plan 2 job lease, re-read order, stop on terminal state, reject another session date, use acceptance quote for MARKET and later qualifying quote for LIMIT, process limits by `(accepted_at, order_id)`, and atomically transition/release reservation/apply fill/event/account/position/update response.

- [ ] **Step 4: Implement cancel/expiry/reconciliation**

Cancellation locks and directly transitions `ACCEPTED→CANCELLED`. End-of-session job moves every `PENDING|ACCEPTED` order to `EXPIRED`, releases reservations, and completes jobs without financial side effects. Reconciliation verifies account, reservations, positions, fills, P&L, events, claims, and jobs; mismatch blocks new risk and never auto-corrects financial values.

- [ ] **Step 5: Run tests**

```bash
pytest tests/production/test_paper_orders.py tests/production/test_paper_jobs.py tests/production/test_paper_reconciliation.py -v
```

Expected: PASS with crash/restart simulations.

- [ ] **Step 6: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/paper/jobs.py hosted/src/tradebot_hosted/worker.py tests/production/test_paper_orders.py tests/production/test_paper_jobs.py tests/production/test_paper_reconciliation.py
git commit -m "feat: reconcile hosted paper orders"
```

---

### Task 8: Close legacy paper/broker execution paths and expose paper portfolio

**Files:**
- Modify: `engine/trade_executor.py:199-392`
- Modify: `engine/paper_execute.py:31-104`
- Modify: `tests/test_trade_executor.py:252-259`
- Create: `hosted/src/tradebot_hosted/analysis_compat.py`
- Create: `tests/production/test_legacy_paper_fail_closed.py`
- Create: `tests/production/test_paper_portfolio.py`

**Interfaces:**
- Consumes: hosted paper gateway/portfolio.
- Produces: no real broker call from any path labeled paper; Plan 4 portfolio DTOs.

- [ ] **Step 1: Write failing fail-closed tests**

```python
async def test_real_broker_is_never_called_in_paper_mode(trade_executor, real_broker):
    real_broker.place_order = AsyncMock(side_effect=AssertionError("must not call"))
    with pytest.raises(UnsafeExecutionMode):
        await trade_executor.execute_trade_plan(PLAN, broker=real_broker, confirm=False)
    real_broker.place_order.assert_not_called()
```

Also cover `engine.paper_execute`, `app.commands.trade`, `app.commands.strategy`, and `app.repl` path denylist/migration tests.

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/test_trade_executor.py tests/production/test_legacy_paper_fail_closed.py -v
```

Expected: current unsafe test fails because it expects a real-broker call.

- [ ] **Step 3: Make local paper paths fail closed**

When selected mode is not exactly `LIVE`, reject any broker adapter that is not an explicitly recognized local paper implementation. Never infer paper from a failed profile call. Parse mode as a strict enum. Remove or make gateway-only `engine.paper_execute`; production still does not import this local code.

- [ ] **Step 4: Implement paper portfolio reader**

```python
class PaperPortfolioReader:
    async def get_summary(self, context: TenantContext, *, at: datetime) -> PaperPortfolioSummary: ...
    async def get_positions(self, context: TenantContext, *, at: datetime) -> list[PaperPositionView]: ...
    async def get_orders(self, context: TenantContext, *, limit: int, cursor: UUID | None) -> Page[PaperOrderSummary]: ...
```

Use PostgreSQL and Plan 3 marks only. Do not instantiate `MockBrokerAPI`, query `brokers.session`, or expose broker funds/profile/holdings terminology.

- [ ] **Step 5: Run tests**

```bash
pytest tests/test_trade_executor.py tests/production/test_legacy_paper_fail_closed.py tests/production/test_paper_portfolio.py -v
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Commit only if explicitly authorized:

```bash
git add engine/trade_executor.py engine/paper_execute.py tests/test_trade_executor.py hosted/src/tradebot_hosted/analysis_compat.py tests/production/test_legacy_paper_fail_closed.py tests/production/test_paper_portfolio.py
git commit -m "fix: prevent paper mode from calling brokers"
```

---

### Task 9: Enforce the broker-free production paper boundary

**Files:**
- Modify: `hosted/pyproject.toml`
- Modify: `hosted/src/tradebot_hosted/app.py`
- Create: `tests/production/test_production_paper_only.py`
- Modify: `tests/production/test_production_imports.py`

**Interfaces:**
- Consumes: all Plan 3 code.
- Produces: broker-free hosted package contract consumed by Plans 4–5.

- [ ] **Step 1: Write failing paper-only artifact tests**

```python
def test_hosted_wheel_has_no_broker_or_live_submission_symbols(wheel):
    files, modules = inspect_wheel(wheel)
    assert "brokers" not in files
    assert "fyers_apiv3" not in modules
    assert "kiteconnect" not in modules
    assert "engine.trade_executor" not in modules
    assert not any("place_order" in text for text in wheel_text_files(wheel))


def test_production_mode_cannot_change_execution():
    with pytest.raises(UnsafeExecutionMode):
        production_execution_mode(environ={"TRADING_MODE": "LIVE"})
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_production_paper_only.py tests/production/test_production_imports.py -v
```

Expected: FAIL until hosted dependencies/route graph are fully broker-free.

- [ ] **Step 3: Remove broker/legacy dependencies from hosted project**

Keep only data-only Fyers dependencies (`httpx`, pinned `websockets`) and Plan 1–3 runtime dependencies. Do not add a broker extra to hosted `pyproject.toml`. Register only paper routes and reference jobs. Declare the committed `config/market/*.json` and `config/paper/*.json` files as package data and add a wheel-content test proving they are present.

- [ ] **Step 4: Run Plan 3 verification**

```bash
pytest tests/production/test_market_contracts.py tests/production/test_fyers_data.py tests/production/test_exchange_calendar.py tests/production/test_instrument_catalog.py
pytest tests/production/test_paper_domain.py tests/production/test_paper_simulation.py tests/production/test_paper_risk.py
pytest tests/production/test_paper_idempotency.py tests/production/test_paper_reservations.py tests/production/test_paper_gateway.py
pytest tests/production/test_paper_orders.py tests/production/test_paper_jobs.py tests/production/test_paper_reconciliation.py
pytest tests/production/test_paper_api.py tests/production/test_production_paper_only.py
ruff check hosted engine tests/production tests/test_trade_executor.py
ruff format --check hosted engine tests/production tests/test_trade_executor.py
python -m build hosted
python -m pip check
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/pyproject.toml hosted/src/tradebot_hosted/app.py tests/production/test_production_paper_only.py tests/production/test_production_imports.py
git commit -m "feat: close hosted broker access"
```

## Plan 3 Completion Evidence

- [ ] Fyers provider is data-only and has fixed public hosts/no redirects.
- [ ] Instrument/calendar snapshots are versioned, atomic, fresh, and fail closed.
- [ ] Paper schema enforces RLS, transitions, append-only events, one fill/order, and paise constraints.
- [ ] Canonical idempotency, fencing, reservations, fill/cancel races, expiry, and reconciliation pass real PostgreSQL tests.
- [ ] All risk/accounting/fee fixtures pass with exact integer math.
- [ ] Real broker `place_order()` is never called by a paper-labeled path.
- [ ] Hosted wheel/import graph contains no broker/live submission dependency.
- [ ] Plan 3 targeted tests, Ruff, hosted build, and `pip check` pass.
- [ ] No commit is made without explicit user authorization.
