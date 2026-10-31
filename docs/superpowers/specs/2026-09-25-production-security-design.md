# Production Security Design

**Date:** 2026-09-25  
**Status:** Approved for implementation planning  
**Target:** Multi-user paper-trading SaaS with hosted web and macOS desktop clients

## Summary

Harden the existing Python, FastAPI, React, and Electron application in place for a multi-user production release. Preserve the working market-analysis, AI, strategy, and paper-trading domain logic, but replace unsafe process-global state and local trust assumptions with Google authentication, tenant-scoped persistence, a hosted API, and a single paper-order gateway.

The first production release contains no real-money execution and no brokerage OAuth. Broker adapters, live-order routes, and local sidecar startup are excluded from the production application and image.

## Goals

- Let users sign in with Google and access only their own data.
- Serve the web application from a hardened Docker deployment behind HTTPS.
- Make the macOS desktop client a thin signed client for the hosted application.
- Preserve the current analysis, AI, news, market-data, backtesting, and paper-trading features where they can be made tenant-safe.
- Preserve curated, immutable, versioned built-in strategies. User/LLM-generated Python is never parsed, imported, or executed in production; strategy-originated paper orders record the strategy ID/version and still pass through the paper gateway.
- Make paper order submission deterministic, idempotent, bounded, auditable, and restart-safe.
- Remove public or cross-user access to settings, credentials, portfolios, chat sessions, streams, and background jobs.
- Produce reproducible builds with security checks and tested backup recovery.
- Keep real brokerage execution disabled until a separate approved design and compliance phase.

## Non-goals

- Real-money order placement or broker OAuth in this release.
- A local credential-bearing FastAPI sidecar in production.
- Public Telegram commands or portfolio access.
- User-supplied AI provider endpoints, API keys, or webhooks.
- Remote import or execution of user/LLM-generated Python strategies.
- Organization membership, invitations, team roles, or enterprise SSO.
- Automatic desktop updates. The first desktop release uses signed, notarized manual artifacts.
- Microservices, Kubernetes, or per-user compute containers.

## Confirmed Product Decisions

- Deployment: Docker containers on VMs with managed PostgreSQL, Redis, secret storage, and object storage.
- Authentication: Google sign-in only.
- Trading scope: paper trading only for the first release.
- Broker OAuth: deferred.
- Release surfaces: hosted web plus macOS desktop.
- Desktop architecture: Electron connects to the hosted API; it does not run production sidecar services.
- Architecture: tenant-first modular monolith, preserving the existing application rather than rewriting it.

## Planning Decomposition

This design is implemented through five separately reviewed plans:

1. Production composition, Google OIDC, PostgreSQL migrations, sessions, and tenant RLS.
2. Tenant-scoped repositories, API policy, durable jobs, streaming, and feature migrations.
3. Reference market data, paper accounts, and the idempotent paper-order gateway.
4. Hosted web UI and thin Electron desktop client migration.
5. Production packaging, CI security gates, backup/restore, signing, staging, and canary release.

Every plan must preserve the final release gates. A plan may stage compatible work but may not declare production readiness independently.

## Current Security Blockers

The current working tree is not safe for multi-user production because:

- `TRADING_MODE=PAPER` can still call a real broker's `place_order()`.
- Multiple CLI and strategy paths bypass risk and execution controls.
- Authentication is fail-open for fresh self-hosted deployments, uses fast password hashing, and has no ownership model.
- Broker, settings, chat, stream, and credential state is process-global.
- Broker callback pages contain reflected XSS and OAuth flows are not transaction-bound.
- Alert, provider-test, and strategy-import URLs permit SSRF or unsafe code execution.
- Passwords, sessions, provider traffic, package setup, and rate-limited operations lack appropriate abuse controls.
- Broker adapters contain unsafe order mappings, incorrect instrument handling, and ambiguous submission behavior.
- The desktop sidecar uses a predictable unauthenticated port and has incomplete Electron navigation, IPC, sandbox, and release controls.
- Historical repository and local files expose broker credentials and use unsafe filesystem permissions.
- SQLite schemas have no versioned migrations, backup, restore, or recovery process.
- Python dependencies, CI actions, container bases, and macOS releases are not reproducibly locked or signed.

## Target Architecture

### Runtime

Production consists of:

1. **Caddy edge** — TLS termination, security headers, host validation, request limits, and reverse proxying.
2. **API containers** — stateless FastAPI processes serving the web application and authenticated API.
3. **Worker containers** — durable background analysis, report generation, market-data refresh, and paper-order processing.
4. **Managed PostgreSQL** — authoritative identity, tenant, settings, chat, paper account, order, job, and audit data.
5. **Managed Redis** — atomic rate/quota counters, short-lived OIDC transactions, job wake/pubsub signals, and caches of global instrument/calendar/market reference data. Tenant UUIDs and numeric counters may appear only in rate/quota keys; tenant business content is not stored in Redis in v1.
6. **Private object storage** — generated reports with expiring, tenant-bound download URLs.
7. **Managed secret storage** — database credentials, OIDC client secret, platform AI keys, and deployment secrets injected at runtime.

The API and worker use the same application package but different entry points. Domain code remains shared. Broker SDKs and live-order modules are not installed in the production dependency set. Global reference-cache keys use provider/resource/version identifiers and never tenant or user IDs. AI/rate-limit keys may use a tenant UUID only with numeric counters and bounded TTLs. PostgreSQL remains authoritative for durable usage, jobs, orders, and account state.

### Desktop

Electron loads the hosted web application from one fixed HTTPS origin. It does not start Python, expose arbitrary filesystem or environment access to the renderer, store financial data, or hold long-lived API credentials. The React application inside Electron uses the same Google session and API as the browser.

### Existing-to-Production Composition Seam

The current `web.api:app` remains the local-development application so existing CLI and desktop development workflows are not deleted. Production uses a separate application factory and worker entry point that import only approved routers and services.

The migration must:

- Split safe analysis handlers from broker, credential, provider-setup, and live-order handlers currently combined in `web/skills.py` and `web/api.py`.
- Move neutral market/order DTOs out of the production-excluded `brokers` package.
- Replace broker globals with explicitly injected capabilities: a broker-free `MarketDataProvider`, tenant `PortfolioReader`, `AlertEvaluator`, AI provider factory, and `PaperOrderGateway`.
- Make the production portfolio adapter read the tenant's PostgreSQL paper account; no static, mock, or shared broker fallback is permitted.
- Define a production wheel and dependency allowlist that exclude broker SDKs, Telegram, TUI, local bootstrap, and broker modules.
- Test the production route table, imported-module denylist, dependency metadata, and final image contents.

Every current direct paper/live submission path must be migrated or made unreachable in the production entry point: `engine/trade_executor.py`, `engine/paper_execute.py`, `app/commands/trade.py`, `app/commands/strategy.py`, and the quick-order path in `app/repl.py`. No production handler may call a broker or mutate paper state outside the gateway.

## Identity and Sessions

### Google OIDC

The application uses Google OpenID Connect Authorization Code flow with PKCE.

Login start creates a 256-bit `state`, `nonce`, and PKCE verifier/challenge. It sets a `__Host-tradebot_oidc` cookie containing a binding secret with `Secure`, `HttpOnly`, `SameSite=Lax`, host-only, path `/`, and `Max-Age=600`. Redis stores the state hash, nonce, PKCE verifier/challenge, expected relative return path, binding-secret hash, expiry of at most ten minutes, and consumed flag.

The return path must be at most 512 characters, begin with one `/`, contain no scheme, authority, backslash, control character, or `//` prefix, resolve within the SPA route table, and must not target an authentication callback or static asset. Login defaults to `/` when no valid relative path is supplied.

The callback first atomically consumes the transaction and verifies the cookie binding, `state`, and validated return path in constant time before any code exchange. It then exchanges the authorization code with the stored PKCE verifier and validates the returned ID token's signature, issuer, audience, nonce, expiry, and `email_verified=true` claim. It identifies the account uniquely by `(provider='google', google_subject)`, never by email address. A missing, expired, replayed, mismatched, exchange-failed, or token-invalid transaction ends in a consumed failed state and cannot be replayed.

The callback does not render provider-controlled HTML. On success it redirects to the validated relative application path with OAuth parameters removed. On failure it redirects to a fixed application error page; details remain in redacted logs.

No password table, password reset flow, email/password form, or public signup endpoint is included.

### Application Sessions

After OIDC validation, the server creates an opaque 256-bit session token and a separate session-bound CSRF token. Only hashes are stored in PostgreSQL.

`GET /auth/session` returns the authenticated user and a CSRF token. Clients keep the CSRF token in memory only and send it in `X-CSRF-Token` for every unsafe method. The server compares it in constant time and rejects missing, mismatched, or expired tokens. A session retains at most five active CSRF-token hashes so concurrent browser tabs can bootstrap independently; older tokens are revoked when the limit is exceeded or during explicit session/security rotation.

Session policy:

- Idle expiry: 24 hours.
- Absolute expiry: 7 days.
- Rotation: after login or security-sensitive changes; logout and account disablement revoke all active tokens.
- Revocation: explicit logout, account disablement, or administrative invalidation.
- Cookie name: `__Host-tradebot_session`.
- Cookie flags: `Secure`, `HttpOnly`, `SameSite=Lax`, host-only, path `/`.
- Local HTTP development may use separate explicitly named non-secure development cookies.

OIDC start, callback, and session bootstrap are rate-limited by IP and transaction binding.

## Tenancy and Authorization

### v1 Tenant Model

Each verified Google identity owns exactly one internal tenant. The internal tenant has an opaque UUID; Google's `sub` is stored only as the external identity key.

The model is deliberately not extended with organizations, invitations, or group roles unless a later approved requirement demands them.

### Tenant Boundary

- The server derives `tenant_id` from the verified session.
- Clients cannot select or override tenant IDs.
- Every tenant-owned table has a non-null `tenant_id` foreign key.
- Repository methods require a tenant context object; tenantless user-data methods are invalid.
- Production uses a non-owner PostgreSQL runtime role. Every tenant table enables and forces row-level security.
- Each request executes inside a transaction that sets a transaction-local `app.tenant_id` from the verified session. Missing, malformed, or unauthorized values deny access.
- `users`, `tenants`, `sessions`, and `csrf_tokens` are identity tables with explicit least-privilege access and are not tenant-content tables.
- `audit_events` and `identity_deletion_tombstones` are restricted global security tables outside tenant RLS; application queries cannot read them directly.
- Background jobs carry immutable tenant/user IDs for tenant scope and set the same database context before accessing tenant data.
- Administrative or operational cross-tenant access is not exposed through the public API.

Primary and foreign-key constraints include `tenant_id` to prevent globally colliding user-owned identifiers. Every tenant child foreign key is composite with `tenant_id`, preventing a record from referencing a parent owned by another tenant. Uniqueness constraints likewise include `tenant_id`, including singleton settings and paper accounts.

## Core Data Model

Initial migrations create these tables:

- `users` — internal ID, provider, Google subject, verified email, lifecycle state, timestamps.
- `tenants` — internal tenant ID, owning user, lifecycle state, deletion deadline, and timestamps.
- `sessions` — hashed session token, user, expiry, idle timestamp, revocation timestamp.
- `csrf_tokens` — hashed token, session, expiry, last-used timestamp, and revocation timestamp.
- `user_settings` — validated non-secret preferences.
- `conversations` and `messages` — tenant-owned AI chat; client chat session IDs map to these records.
- `analysis_records` — tenant-owned analysis outcomes, trade memory, drift, and lessons used by the existing multi-agent workflow.
- `alerts` and `alert_events` — tenant-owned conditions, lifecycle state, and evaluation history; delivery integrations are disabled in v1.
- `reports` — tenant-owned metadata and private object references.
- `paper_accounts` — starting capital, currency, cash, reserved cash, realized/unrealized P&L, and timestamps.
- `idempotency_claims` — tenant, key, canonical request hash, durable state, linked order/job, expiry, and failure code.
- `paper_orders` — idempotency claim, canonical request hash, instrument, strategy ID/version, side, type, quantity, quote/config snapshots, reservation, prices, state, and timestamps.
- `paper_order_events` — append-only state-transition journal.
- `positions` and `fills` — tenant-owned paper execution state with unique fill identities.
- `jobs` — scope, durable job state, attempts, lease, tenant/user IDs, result reference, and timestamps.
- `model_usage` — tenant/job/reservation/provider/model token counts, reservation/settlement state, and timestamps.
- `audit_events` — restricted global append-only security ledger with pseudonymous actor/tenant references, redacted metadata, and no foreign key to `tenants`; the public runtime role may insert but cannot read it.
- `identity_deletion_tombstones` — keyed HMAC of provider plus external subject, purge time, and restore-expiry metadata; no email or raw subject.
- `instruments` and `exchange_calendars` — versioned global reference data with source, effective dates, refresh status, and fail-closed availability.

All timestamps are stored in UTC. Trading-day calculations use `Asia/Kolkata` and the versioned exchange calendar rather than container locale or weekday-only logic.

Hosted development, integration tests, staging, and production all use PostgreSQL with the same repository contracts. SQLite and local JSON may remain only inside explicitly retained CLI-only offline features; they are not alternate implementations behind tenant-owned web APIs and may not silently fall back when PostgreSQL is unavailable.

### Data Retention

- OIDC transactions expire after ten minutes.
- Expired sessions are purged after 30 days.
- Conversations and analysis records remain until the user deletes them.
- Generated reports expire after 30 days unless the user deletes them sooner.
- Terminal job payloads and progress expire after seven days.
- Idempotency claims and model-usage ledgers are retained for two years with the order/audit trail.
- Security and paper-order audit events are retained for two years.
- Application logs are retained for 30 days by default.

### Existing Local Data

The hosted production service starts with an empty identity and tenant dataset. Existing password users, SQLite databases, broker tokens, local JSON state, and mixed-user CLI history are not imported automatically. Accounts are never linked by matching email addresses. Existing local export remains available only through the local CLI; any future import requires a separate reviewed tool that proves record ownership before upload.

### Tenant Deletion

`DELETE /account` requires a fresh Google OIDC reauthentication completed within ten minutes, a valid CSRF token, and an explicit confirmation phrase. It atomically transitions the user and tenant from `ACTIVE` to `DELETION_PENDING`, revokes every normal session and CSRF token, blocks new login, and issues one seven-day deletion-control session. That control session can access only the fixed cancellation page and `POST /account/deletion/cancel`; it uses its own CSRF token and cannot call product APIs. Calling cancel transitions both records back to `ACTIVE`, revokes the control session, and permits normal Google sign-in again.

At the deadline, a system job transitions `DELETION_PENDING` to `PURGE_PENDING` using a fenced lease. Re-login during either pending state returns only the deletion-status page and never recreates or reactivates the tenant. The purge transaction cancels queued/running work, removes all tenant rows including settings, conversations, analysis, alerts, paper account/orders/fills, idempotency claims, jobs, and model usage; deletes all sessions and CSRF tokens; deletes the tenant and user; clears optional tenant/actor pseudonyms from retained audit events; and writes an identity-deletion tombstone. A finalizer deletes report objects and Redis keys, then transitions the tombstone to `PULGED`. Retried purge/finalizer steps are idempotent.

After purge, signing in again may create a new tenant under the same Google identity, but it never restores or links old data. Restore jobs consult `identity_deletion_tombstones` and discard any pre-purge rows found in point-in-time backups. Encrypted backups age out within 30 days.

## API Security Policy

### Default-Deny Routing

Public routes are an explicit allowlist:

- Static application assets.
- `GET /health/live`, returning only `{"status":"ok"}` without dependency or configuration details.
- Google OIDC start and callback routes.

`GET /health/ready` is restricted to the private container network and never exposed through Caddy. Every other API, stream, skill, report, settings, and paper-order route requires a valid session. Production does not expose OpenAPI or ReDoc.

CORS is disabled by default. The browser and Electron clients use the same hosted origin, so no cross-origin credentialed API is required. Exact development origins may be allowed only outside production.

Trusted-host validation accepts only the configured production hostname and explicit local development hosts.

### Input and Output Controls

- Reject unknown request fields and oversized bodies.
- Enforce bounded strings, collections, numeric ranges, and enum values.
- Validate symbols against supported market-data/instrument identifiers.
- Require fixed units and explicit timezone/currency semantics where ambiguity would affect orders.
- Escape or template every HTML value.
- Return stable error codes and a correlation ID, not raw exceptions, tracebacks, SQL, filesystem paths, OAuth codes, or provider response bodies.
- Redact credentials, tokens, cookies, authorization headers, signed URLs, and query strings from logs.
- Set `Cache-Control: no-store` on authenticated and OAuth responses.
- Set `X-Content-Type-Options: nosniff`, anti-framing headers, and a restrictive CSP at the edge and application layers.

### Disabled Production Capabilities

The following existing capabilities are not registered in the production application:

- Arbitrary environment-variable or keychain writes.
- Remote provider setup or package-manager execution.
- User-configurable AI base URLs.
- User webhooks and arbitrary outbound URLs.
- Broker login, broker OAuth, broker status, and broker callbacks.
- Public SSE subscriptions.
- Remote strategy import, parsing, or execution. Production executes only immutable, versioned built-in strategies.
- Raw broker or simulated order APIs outside the paper gateway.

## AI and Cost Controls

The production release uses platform-managed AI provider credentials. User API keys and custom provider endpoints are not accepted.

Initial abuse controls:

- An expensive job is any endpoint invoking a model or generating a report. Concurrency includes queued and running work.
- Maximum two concurrent expensive jobs per tenant.
- Maximum 20 concurrent expensive jobs globally.
- Maximum 60 AI requests per tenant per rolling hour.
- Maximum 50,000 combined input/output model tokens per tenant per `Asia/Kolkata` day. Users cannot override this v1 limit.
- Maximum 1 MiB JSON request body.
- Maximum 20,000 characters per user message.
- Global cancellation and timeout deadlines for every external model call.
- Idempotent job submission using a client request ID.
- Bounded retries with exponential backoff; exhausted jobs enter a durable failed state and do not loop indefinitely.

Redis atomically reserves per-tenant and global quota before queueing an expensive job. The reservation contains a random reservation ID, job ID, tenant ID, reserved tokens, worker owner, integer epoch, creation time, and a short TTL. The worker renews it at one-third of the TTL while the job is nonterminal. Settlement and release require the matching reservation ID, owner, and epoch, so a stale worker cannot change quota after ownership moves. A worker must hold a valid reservation before starting a model call.

Enqueue failure releases the reservation in the same request path; timeout/cancellation settles or releases it. If renewal fails, the worker starts no further model call and marks the job retryable. After Redis recovery, reconciliation compares durable `jobs` and `model_usage` rows, rehydrates one reservation for each eligible nonterminal job with a new epoch, and charges the full reservation when the prior in-flight token count cannot be proven. A reaper releases only reservations whose durable job is absent or terminal, using the reservation ID as the idempotency key.

Durable `model_usage` rows and job records provide the auditable source of truth. Redis restart or data loss blocks new quota-bearing work until its state is restored or expired reservations are reconciled; it never resets limits optimistically. A Redis failure prevents new work rather than allowing an unbounded race.

If Redis or the job store is unavailable, new mutating, streaming, and AI requests fail closed with `503`. Static assets and minimal health probes remain available.

## Paper Trading

### Single Gateway

All paper orders pass through one application service. API handlers, background jobs, CLI development commands, and strategy evaluators may call that service but may not mutate paper account state directly.

The initial production market-data provider is a new data-only `market/fyers_data.py` adapter built from the existing Fyers quote/streaming code using `httpx` and the pinned `websockets` package. It accepts only platform-managed Fyers market-data credentials, exposes quote and instrument-master operations, and contains no OAuth, account, order, position, or funds functionality. The full `fyers-apiv3` and other broker SDKs are not installed in production.

A system job refreshes the versioned instrument snapshot from the Fyers instrument master at 05:00 IST daily. Orders reject instrument snapshots older than 24 hours or whose effective interval does not cover the order time. Exchange sessions come from a repository-maintained, versioned `config/market/india_exchange_calendar.json` sourced from official NSE/BSE holiday notifications and covering the current and next calendar year; missing dates fail closed. `yfinance` may remain a clearly labeled delayed source for non-order analysis, but it cannot satisfy the paper-order quote-freshness gate.

The v1 production paper engine is deliberately long-only NSE/BSE cash-equity trading. It accepts `side=BUY|SELL`, `type=MARKET|LIMIT`, `validity=DAY`, `exchange=NSE|BSE`, and positive integral quantities of one share. `BUY` opens or increases a long position; `SELL` may only reduce an existing long position. Short selling, options/F&O, margin, product variants, stop, bracket, cover, and partial fills are disabled until a separately approved simulation and risk design exists. Analysis of those segments may remain read-only, but strategies that would originate unsupported paper orders are blocked before submission.

Instruments are accepted only when the versioned global catalog has an exact exchange, trading symbol, lot size of one, tick size, currency, effective date, and current exchange-calendar session. Missing or stale reference data rejects the order rather than inventing an instrument or price.

The gateway:

1. Derives the tenant from trusted request or job context.
2. Requires an `Idempotency-Key` header and atomically claims `(tenant_id, idempotency_key)` before quote, risk, or rate-limit side effects.
3. Canonicalizes only client-controlled order fields and compares their SHA-256 hash. A concurrent/repeated request with the same hash returns the existing in-progress or terminal order; a different hash returns `409`.
4. Rejects broker adapters and live-mode configuration in production.
5. Resolves the instrument from the server-controlled catalog.
6. Refetches a quote and stores source, exchange timestamp, receipt timestamp, and delay separately from the canonical client request.
7. Rejects market quotes older than five seconds and limit quotes older than 30 seconds.
8. Validates side, order type, quantity, price/limit, exchange, lot size, tick size, validity, market session, and that a `SELL` quantity is fully covered by the tenant's long position.
9. Applies configured per-order notional, per-instrument exposure, gross exposure, position-count, daily simulated loss, and order-rate limits.
10. Atomically commits a `PENDING` order, first event, quote/config snapshots, and durable fill job while preserving the idempotency claim.
11. Produces one deterministic fill or rejection using the stored quote and versioned simulation configuration.
12. Updates cash, positions, and P&L atomically with the fill and event.
13. Stores the serialized response separately from the canonical client request and returns it for retries.
14. Records every transition and never releases an idempotency key during the session.

Initial paper limits are fixed server configuration, not user secrets:

- Paper starting capital is user-selectable once from INR 10,000 to INR 10,000,000, defaults to INR 1,000,000, uses INR accounting, and is immutable for the life of the tenant in v1. There is no reset or top-up transition.
- 10 order submissions per second per tenant.
- 200 order submissions per trading day per tenant.
- Maximum 10 concurrent open paper orders per tenant.
- Maximum 20 open positions per tenant.
- Default maximum simulated order notional of INR 1,000,000.
- Maximum 25% of starting capital in one instrument.
- Maximum 100% of starting capital in gross paper exposure.
- Default maximum simulated daily loss of 5% of start-of-day marked equity.

Daily loss is `max(0, start_of_day_marked_equity - current_marked_equity)` using the latest accepted instrument quotes. Risk-increasing orders are rejected once the formula reaches 5%; if current marked equity cannot be refreshed, the system fails closed for new risk but continues order cancellation and audit reads.

After quote and schema validation, the gateway opens one transaction, locks the tenant's `paper_accounts` row and affected position, recomputes all limits, reserves cash/quantity and exposure for the new `PENDING` order, and commits the order/job. A limit `BUY` reserves quantity multiplied by its limit price plus the maximum fee schedule; a market `BUY` reserves quantity multiplied by the reference price increased by five basis points, rounded upward to the instrument tick, plus the maximum fee schedule. Available long quantity is `max(0, current_long_quantity - sum(nonterminal SELL reservations))`; a `SELL` reserves at most that amount. `PENDING` orders count toward open-order, position, per-instrument, and gross-exposure limits. Fill or terminal failure releases the reservation atomically; cancellation and end-of-day expiry follow the same rule.

Simulation defaults live in committed, immutable `config/paper/simulation_v1.json` and `config/paper/fees_v1.json` files with source notes, effective dates, and SHA-256 hashes. Every order stores both hashes. The initial fee schedule uses brokerage of `max(INR 20, 0.03% of turnover)` plus the versioned NSE/BSE cash statutory-charge rows for stamp duty, exchange transaction charges, SEBI turnover fees, and GST.

Eligible market orders fill once using the stored reference quote, five basis points of side-dependent slippage, and tick-size rounding. Eligible limit orders become fillable when a later quote satisfies the limit price and are selected deterministically by `(accepted_at, order_id)`. Partial fills are not simulated in v1. Cash decreases on a fill by turnover plus fees for `BUY` and increases by turnover minus fees for `SELL`. Positions use weighted-average cost; realized P&L is `sell_turnover - sell_fees - remaining_cost_basis`, and unrealized P&L uses the latest accepted quote. Marked equity is cash plus the current long-position value, and all money is stored as integer paise.

### Idempotency and Recovery

A unique `(tenant_id, idempotency_key)` constraint on `idempotency_claims` prevents duplicate work. The key is a 16–128 character opaque ASCII value. Before quote, risk, or rate-limit work, one transaction inserts a durable `CLAIMED` row containing the canonical client-request hash, random `lease_owner`, integer `lease_epoch=1`, `lease_expires_at=now()+60 seconds`, and no order reference. Only the current owner may renew the lease, and renewal never changes the epoch.

Only the current lease owner may link an order/job or write a failure. Every such update uses `WHERE lease_owner=? AND lease_epoch=? AND lease_expires_at>now` and requires exactly one affected row. Recovery of an expired lease increments `lease_epoch` and assigns a new owner in one transaction, fencing the stale worker from all later reservation or order commits. The same-hash owner resumes from the claim; an existing linked order is returned; a quote, validation, or risk failure is recorded once and returned for later retries; a completed/failed claim is immutable. Claims and their request hashes are retained for two years with the audit trail, and the key cannot be reused during that period. The order stores the canonical hash separately from the quote snapshot, simulation configuration hashes, resulting state, and serialized response. Concurrent or repeated use returns the in-progress or terminal result; different content with the same key returns `409`.

The paper order state machine is explicit:

- `PENDING` → `ACCEPTED`, `REJECTED`, `FAILED`, or `EXPIRED`
- `ACCEPTED` → `FILLED`, `CANCELLED`, `FAILED`, or `EXPIRED`

`REJECTED`, `FILLED`, `CANCELLED`, `EXPIRED`, and `FAILED` are immutable terminal states. V1 orders are `DAY` only. A cancellation request locks the order and moves an eligible `ACCEPTED` order directly to `CANCELLED`; a concurrent fill wins only if it committed first. At each exchange-session deadline, a fenced system job locks every nonterminal order, moves `PENDING` or `ACCEPTED` to `EXPIRED`, releases its reservation, records the reason, and completes any unstarted fill job without side effects. A delayed fill worker must condition its update on the order still being `ACCEPTED`, so it cannot fill in a later session. The initial transaction commits only the order, first event, snapshots, and job. A worker locks the order and paper account, performs a conditional state transition, and atomically commits the fill, event, cash, and position changes. Unique fill identities and job leases make retries safe. Startup reconciliation finds expired leases and unfinished jobs and resumes them idempotently.

## Background Jobs and Streaming

Long analysis, report generation, paper fills, and reference-data refresh operations run outside request handlers. Jobs are durable and explicitly scoped.

Every job declares `scope=TENANT|SYSTEM` in a database check constraint:

- `TENANT` jobs require immutable tenant and user IDs and execute under tenant RLS.
- `SYSTEM` jobs have null tenant/user IDs, use a dedicated service identity, access only global instrument/calendar/market data, and are never exposed through tenant APIs.

The job contract includes:

- Stable job ID and scope.
- Idempotency key.
- Required tenant/user IDs for tenant jobs.
- Bounded input payload.
- Attempt count and lease expiry.
- Redacted progress state.
- Result or artifact reference.
- Terminal success or failure state.

Job handlers receive tenant context, repositories, an already-constructed provider client, and bounded inputs explicitly. Production provider construction never prompts, reads a user keychain, mutates process environment variables, auto-detects local CLIs, or falls back to interactive setup.

Authenticated streaming uses fetch-based HTTP streaming with the normal session and CSRF model and reads progress from shared durable job state rather than the current process-global event bus. The server caps stream duration, event size, queued events, symbols per tenant, and concurrent streams. No global unauthenticated event bus is exposed.

## Web Application

The existing React application is retained and adapted to the hosted API.

Required changes:

- Use same-origin relative API URLs for both web and Electron.
- Replace password login with a Google sign-in control and session bootstrap.
- Fetch the CSRF token from `GET /auth/session`, keep it in memory, and route every unsafe request through one shared API client that adds `X-CSRF-Token`.
- Convert every direct `fetch`/SSE caller in the current renderer to that shared client.
- Remove local-sidecar bootstrap, Python readiness, broker-status polling, and broker profile cards from the production build.
- Reduce onboarding to paper capital and risk preferences; remove provider, package, broker, webhook, and live-mode controls in the same release.
- Map existing chat-store sessions to server conversations and preserve multi-session history.
- Display tenant-safe settings, alerts, analysis records, jobs, paper positions, orders, and reports.
- Require explicit confirmation for destructive paper-account actions.
- Avoid raw HTML rendering of model, broker, symbol, strategy, or report content.
- Serve reports as private PDF/JSON artifacts or a self-contained sandboxed document; the production application does not emit raw HTML with a remote CDN dependency.
- Remove production controls for broker connection, package installation, custom provider URLs, and arbitrary webhooks.

## Electron Client

The production Electron main process must:

- Start at the configured HTTPS application origin.
- Use `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`.
- During an active OIDC transaction, allow main-frame navigation and redirects only to the exact configured Google HTTPS host allowlist required by that flow, followed by a return to the configured application origin. All other top-level navigation is denied.
- Block new windows except validated `https:` destinations from the configured application origin.
- Reject `file:`, `data:`, `javascript:`, credential-bearing, and custom-scheme external URLs.
- Deny permission requests by default.
- Remove generic IPC, renderer filesystem, environment, Python bootstrap, sidecar, and shell bridges. The main process may read only packaged application resources required to launch the client.
- Use the same authentication flow as the browser but do not assume a pre-existing Google SSO session. The application session cookie is owned by the HTTPS application origin.
- Store no refresh token, brokerage credential, provider key, chat history, or financial data in renderer storage.
- Show generic connection failures without exposing stack traces or secrets.

The macOS release must use a Developer ID Application certificate, hardened runtime, minimal reviewed entitlements, notarization, stapling, and release checksums. Release CI verifies signatures, Gatekeeper assessment, notarization, architectures, and checksums.

### Feature Compatibility

| Existing capability | v1 production behavior |
| --- | --- |
| Market data, news, analysis, multi-agent memory | Preserve through injected providers and tenant-scoped `analysis_records` |
| Curated strategies and backtests | Preserve immutable, versioned built-ins only |
| Generated/imported Python strategies | Disabled in production; may remain an explicitly local CLI-only trust boundary |
| AI chat and multiple sessions | Preserve with server conversations, shared API client, quotas, and durable jobs |
| Alerts and trade-memory review | Preserve as tenant-owned records; disable outbound delivery integrations in v1 |
| PDF/JSON reports | Preserve as private expiring artifacts; remove unsafe raw HTML/CDN reports |
| Paper account, positions, orders, P&L | Preserve for long-only NSE/BSE cash-equity `MARKET`/`LIMIT` `DAY` trading through the tenant-scoped gateway; unsupported F&O/short order strategies are blocked |
| Broker portfolio, broker OAuth, live orders | Not deployed in v1 |
| Telegram | Disabled in the production runtime; a future push-only design requires a separate allowlist and rate-limit review |
| User provider keys, webhooks, setup commands | Disabled in v1 |

## Infrastructure and Secrets

### Network Trust Boundaries

Caddy is the only public ingress. API, worker, PostgreSQL, Redis, and object-storage services are private and use authenticated TLS connections from the application tier.

Public backend egress is deny-by-default to the exact configured Google, Fyers market-data, AI, and package-free runtime endpoints required by the release. Public-egress DNS resolution rejects loopback, private, link-local, multicast, and metadata targets; redirects are disabled unless the redirected host is independently revalidated. Tenant input cannot add egress destinations.

Private data-service connections are a separate allowlist: PostgreSQL, Redis, and object-storage endpoints supplied by managed-service configuration, restricted to their authenticated TLS hostnames and private service network. They are not reachable through the public-egress rule or tenant input.

Report downloads first authorize tenant ownership, then issue a short-lived signed URL for a server-selected object key. Clients cannot supply object keys. Downloads use attachment disposition and `nosniff`, and signed URLs are redacted from logs.

### Containers

Production images:

- Use a minimal non-root Python runtime.
- Pin base images by digest.
- Install a hash-locked Python dependency set with no broker SDKs.
- Run API and worker as separate commands from the same image.
- Expose no source tree, package compiler, shell administration interface, or local `.env` file.
- Write only bounded, non-sensitive runtime logs to stdout/stderr.

Development-only broker dependencies and sidecar entry points are excluded from the production wheel and image.

### Edge

Caddy must:

- Require a configured production domain.
- Redirect HTTP to HTTPS.
- Enable HSTS only after HTTPS is verified.
- Reject unknown Host values.
- Apply request body, connection, and timeout limits.
- Set CSP, anti-framing, `nosniff`, referrer, and permissions policies.
- Avoid logging OAuth query strings and signed URLs.

### Secrets

- Historical broker credentials are revoked and rotated before any release.
- Git history is rewritten only after rotation and with explicit user authorization.
- Production secrets come from managed secret storage at runtime.
- `.env` files are never packaged or used as the production secret source.
- Secret files and local development credentials use mode `0600`; containing directories use `0700`.
- CI performs full-history secret scanning with redacted output.

## Migrations, Backup, and Recovery

Alembic owns production schema migrations.

Requirements:

- Forward-only, versioned migrations run as a gated deployment job.
- Application startup does not mutate schemas.
- Destructive changes use expand/migrate/contract releases.
- Migrations are tested against a production-like PostgreSQL version.
- Backups use managed encryption and point-in-time recovery.
- Initial recovery targets are RPO no more than 15 minutes and RTO no more than 4 hours.
- A restore drill recreates the full PostgreSQL service to a recorded point in time, restores representative report objects, verifies schema version, tenant/RLS access, row-count and content hashes, order/idempotency journals, deletion tombstones, measured RPO, and measured RTO.
- Object storage reports expire after 30 days and support deletion before expiry.

## Observability and Audit

Every request receives a correlation ID. Structured logs include route, status, duration, result category, tenant pseudonym, job ID, and paper-order ID where relevant.

Logs must not include:

- Google authorization codes or tokens.
- Session or CSRF tokens.
- API keys or cookies.
- Signed object-storage URLs.
- Full prompts, reports, or model messages by default.
- Raw broker/provider error bodies.

Security and paper-order audit events are append-only and include actor, tenant, action, target, result, timestamp, and correlation ID. Audit records exclude secrets and unnecessary financial detail.

Operational alerts cover:

- Authentication abuse and repeated authorization failures.
- Cross-tenant policy denials.
- Elevated 4xx/5xx rates.
- Job backlog, retry rate, and dead-letter growth.
- Database pool saturation, migration failure, and backup failures.
- Unexpected broker, live-mode, or raw order-gateway registration.
- Desktop update/signing verification failures.

## Security Testing

### Required Regression Tests

- A production build cannot import or register broker adapters, broker OAuth, live mode, or a raw order route.
- Paper mode can never call a broker `place_order()`.
- Every user-owned query and mutation is isolated across tenants.
- Client-supplied tenant IDs are ignored or rejected.
- Missing, invalid, expired, and replayed Google OIDC transactions fail.
- Sessions enforce idle and absolute expiry, rotation, logout, and CSRF checks.
- Public route allowlisting denies broker, setup, stream, and skill routes without a session.
- Untrusted symbols, oversized bodies, invalid enums, and unknown fields are rejected.
- Paper orders are idempotent across retries and worker restarts.
- Partial simulation failure cannot commit cash or position changes.
- Stale or unavailable market data rejects a paper order.
- Production image and route tests confirm no local sidecar or broker dependency.
- Electron blocks navigation, hostile URLs, permissions, and unnecessary IPC.
- Logs and audit records do not contain seeded secret sentinels.

### Verification Commands

The implementation must discover and use the repository's canonical commands, including:

```bash
pytest -m "not network and not slow"
pytest -m "slow and not network"
ruff check .
ruff format --check .
python -m build
npm --prefix macos-app test
npm --prefix macos-app run build
docker compose -f docker/docker-compose.yml config
docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml config
```

Network and broker-sandbox tests remain opt-in and never submit real orders.

## CI and Supply Chain

The committed release source must build from a clean checkout. The current untracked production source and lockfiles must be reviewed and committed before a release candidate is created.

CI must include:

- Python and frontend tests.
- Ruff lint and format checks.
- Full-history secret scanning.
- CodeQL or equivalent SAST.
- Python and npm dependency audits.
- Container build and image vulnerability scan.
- Database migration and restore tests.
- macOS build, signature, Gatekeeper, notarization, staple, and checksum verification.
- Secretless fork and pull-request tests.
- Minimal workflow permissions and actions pinned to full commit SHAs.

The release records a software bill of materials and build provenance. Mutable action tags and base-image tags are not permitted in release workflows.

### Reproducibility and Scan Scope

Reproducibility is tested from two clean checkouts of the same commit with `SOURCE_DATE_EPOCH` derived from the commit timestamp:

- The Python wheel and built React assets must have identical SHA-256 hashes.
- `pip install` and `npm ci` must resolve the committed hash-locked dependency sets without network version drift.
- Two clean production container builds must produce identical OCI image digests after BuildKit removes nondeterministic timestamps and provenance layers.
- Two clean unsigned Electron `.app` builds must have identical normalized content-tree manifests. Signing is performed after that comparison because certificate timestamps make signed DMGs non-byte-identical.
- Release verification compares the exact built Python wheel, container image, unsigned app tree, final signed app, notarized DMG, SBOM, and provenance attestations against the release manifest.

Secret scanning covers full Git history, the current tracked and untracked release source, dependency lockfiles, CI configuration, the built Python wheel, production container filesystem, and packaged Electron resources. Findings are redacted, and generated archives are expanded before scanning.

## Deployment and Rollout

1. Revoke and rotate exposed credentials; restrict local secret permissions.
2. Commit and review the actual current source and lockfiles.
3. Introduce Google OIDC, sessions, PostgreSQL schema, migrations, and tenant RLS.
4. Move user data and services behind tenant-scoped repositories.
5. Replace public/global routes with the default-deny production router.
6. Consolidate paper execution behind the idempotent tenant-scoped gateway.
7. Adapt the web client to hosted same-origin APIs.
8. Replace the Electron sidecar model with the hardened hosted client.
9. Remove broker/live capabilities from production packaging and route registration.
10. Add CI security gates, backup/restore verification, and signed desktop release automation.
11. Deploy to staging with synthetic tenants and run security, migration, and failure-mode tests.
12. Run a monitored paper-trading canary before general availability.

Rollback uses backward-compatible application versions and feature flags. It never reverses a destructive database migration. Expanded schemas remain compatible until the prior application version is no longer deployed.

### Canary Acceptance

The paper-trading canary runs for at least 24 hours with synthetic tenants plus 10% of invited production users. General availability requires:

- Zero cross-tenant reads/writes, authentication bypasses, unauthorized disclosures, live/broker route registrations, duplicate paper orders, or lost acknowledged orders.
- API 5xx rate below 0.5% and authenticated read p95 below 500 ms, excluding model and report jobs.
- Expensive-job queue start p95 below five seconds and no backlog older than ten minutes.
- Paper-order idempotency, fill, cancellation, and daily-loss invariant checks passing on every scheduled reconciliation.
- Backup and restore evidence meeting RPO no more than 15 minutes and RTO no more than four hours.

Rollback is triggered immediately by any security-boundary violation, duplicate/lost order, data-integrity mismatch, 5xx rate above 2% for five minutes, job backlog older than 15 minutes, failed backup, or failed migration.

## Release Gates

A production release is blocked unless all of the following are true:

- Historical credentials are rotated and secret scanning is clean.
- A clean checkout reproducibly builds the reviewed source.
- All tests and CI security checks pass.
- No unresolved Critical or High security finding remains.
- Cross-tenant and authorization tests pass.
- Paper orders are the only registered execution path.
- Production images do not contain broker SDKs, live routes, or a production sidecar entry point.
- PostgreSQL migration, backup, and restore drills pass.
- Edge TLS and security headers pass external verification.
- The macOS application is signed, notarized, stapled, and reproducible.
- Staging synthetic-user tests and monitored paper-trading canary pass.
- Privacy, data deletion, Google OAuth consent, and market-data licensing requirements are approved for operation.

## Acceptance Criteria

- A user signs in with Google and receives access only to their tenant.
- Two synthetic users cannot read or mutate each other's settings, chat, jobs, reports, paper account, positions, or orders.
- Public broker, setup, stream, credential, and live-order routes do not exist in the production application.
- Analysis and supported paper-trading workflows complete through authenticated, tenant-scoped APIs.
- Duplicate or retried paper requests create at most one order.
- Worker restart does not lose or duplicate paper orders.
- The hosted web UI and Electron client use the same production API and authorization model.
- Logs, errors, reports, and audit events contain no secrets or raw tracebacks.
- The production release passes all listed CI, restore, security, and signing gates.
- No real-money order can be submitted by the released application.
