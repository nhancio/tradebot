# Tenant Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the hosted foundation with tenant-scoped repositories, default-deny product APIs, durable jobs, atomic AI quotas, safe platform providers, tenant conversations/analysis/alerts/reports, authenticated progress streaming, and the account-deletion lifecycle.

**Architecture:** All production data access flows through repositories bound to a verified `TenantContext` and PostgreSQL RLS. Long-running work uses fenced PostgreSQL job leases plus Redis wake signals and quotas. Existing analyzers are adapted through explicit production context/provider/tool ports so no process-global broker, credential, memory, or environment state is reachable from the hosted worker.

**Tech Stack:** Plan 1 hosted runtime, SQLAlchemy 2 async, PostgreSQL RLS, Redis/Lua, FastAPI, Pydantic 2, Anthropic/OpenAI/Google SDK adapters, object storage port, NDJSON streaming, pytest

**Spec:** `docs/superpowers/specs/2026-09-25-production-security-design.md`

## Global Constraints

- Consume `TenantContext`, `Database.tenant_transaction()`, `AuthService`, and Plan 1 routes without redefining them.
- Every tenant-owned table has non-null `tenant_id`, composite tenant-aware foreign keys, forced RLS, explicit runtime grants, and bounded payload columns.
- Repository methods do not accept a caller-supplied tenant ID; cross-tenant object IDs return `None`/`404` without existence disclosure.
- Production routes are explicit method+path entries; no `startswith()` exemptions, CORS, OpenAPI, ReDoc, broker, setup, provider-switch, Telegram, public SSE, OpenClaw, or raw-order route.
- JSON bodies are at most 1 MiB; user messages at most 20,000 characters; client lists and request fields are bounded.
- AI uses deployment-selected providers and fixed endpoints; no user API keys, base URLs, provider/model selection, CLI/Ollama, keychain, or environment mutation.
- Expensive work uses fenced jobs and Redis quota reservations; Redis/job-store failure fails closed with `503`.
- Quota defaults are 2 active jobs/tenant, 20 active jobs globally, 60 requests/tenant/rolling hour, and 50,000 tokens/tenant/IST day.
- Progress is authenticated `application/x-ndjson`, not `EventSource`/`text/event-stream`; maximum 600 seconds, 256 events, 16 KiB/event, 1 MiB progress, 3 streams/tenant.
- Logs/errors never contain prompts, provider bodies, tracebacks, tokens, cookies, signed URLs, or raw tenant IDs.
- Existing local `web/skills.py`, SSE, memory, and alert behavior remains local-development-only.
- Do not execute commit steps unless the user explicitly authorizes commits in the execution session.

## Review Focus

- Known UUIDs from another tenant must never disclose or mutate rows.
- Expired job/quota owners must be fenced before progress, settlement, or terminal writes.
- Redis failure/restart must never reset quotas or permit an unreserved model call.
- A process restart or two API/worker instances must read the same durable progress and job state.
- Account deletion must remove every tenant-owned and identity-owned artifact while preserving only bounded pseudonymous audit evidence.

---

### Task 1: Add tenant feature schema, repositories, and RLS

**Files:**
- Create: `hosted/src/tradebot_hosted/migrations/versions/20260925_0003_tenant_features.py`
- Create: `hosted/src/tradebot_hosted/repositories/__init__.py`
- Create: `hosted/src/tradebot_hosted/repositories/tenant.py`
- Create: `hosted/src/tradebot_hosted/repositories/settings.py`
- Create: `hosted/src/tradebot_hosted/repositories/conversations.py`
- Create: `hosted/src/tradebot_hosted/repositories/analysis.py`
- Create: `hosted/src/tradebot_hosted/repositories/alerts.py`
- Create: `hosted/src/tradebot_hosted/repositories/reports.py`
- Create: `tests/production/test_tenant_migrations.py`
- Create: `tests/production/test_tenant_repositories.py`

**Interfaces:**
- Consumes: Plan 1 `TenantContext` and database transaction API.
- Produces: `TenantRepositories`, feature repository protocols, and `TenantRepositoryFactory`.

- [ ] **Step 1: Write failing migration and isolation tests**

```python
async def test_tenant_tables_force_rls_and_composite_foreign_keys(owner):
    for table in TENANT_TABLES:
        assert await rls_forced(owner, table)
        assert await tenant_id_non_null(owner, table)


async def test_known_cross_tenant_id_returns_none(repositories):
    conversation = await repositories.for_tenant(TENANT_A).conversations.get(TENANT_B_CONVERSATION_ID)
    assert conversation is None
```

Also reject a child row whose parent belongs to another tenant even when UUIDs are known.

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_tenant_migrations.py tests/production/test_tenant_repositories.py -v
```

Expected: FAIL because feature tables/repositories do not exist.

- [ ] **Step 3: Add the migration**

Create forced-RLS tables:

- `conversations`, `messages`
- `analysis_records`
- `alerts`, `alert_events`
- `reports`
- `jobs`, `model_usage`
- `audit_events` as a restricted global insert-only ledger without a tenant foreign key
- `identity_deletion_tombstones` as a restricted global table

Required job scope check:

```sql
CHECK (
  (scope = 'TENANT' AND tenant_id IS NOT NULL AND user_id IS NOT NULL)
  OR
  (scope = 'SYSTEM' AND tenant_id IS NULL AND user_id IS NULL)
)
```

Required uniqueness:

```sql
CREATE UNIQUE INDEX jobs_tenant_idempotency_uq
ON tradebot.jobs (tenant_id, idempotency_key)
WHERE scope = 'TENANT';

CREATE UNIQUE INDEX jobs_system_idempotency_uq
ON tradebot.jobs (idempotency_key)
WHERE scope = 'SYSTEM';
```

Audit grants: runtime may insert through a restricted function/table privilege but cannot select; operations tooling uses a separate role. Deletion tombstones use an HMAC of provider+subject and no raw identity.

- [ ] **Step 4: Implement tenant-bound repository factory**

```python
@dataclass(frozen=True, slots=True)
class TenantRepositories:
    settings: SettingsRepository
    conversations: ConversationRepository
    analysis: AnalysisRepository
    alerts: AlertRepository
    reports: ReportRepository
    jobs: JobRepository


class TenantRepositoryFactory:
    def __init__(self, database: Database) -> None:
        self._database = database

    def for_tenant(self, context: TenantContext) -> TenantRepositories:
        if context.tenant_id == UUID(int=0):
            raise ValueError("invalid tenant context")
        return TenantRepositories(
            settings=SettingsRepository(self._database, context),
            conversations=ConversationRepository(self._database, context),
            analysis=AnalysisRepository(self._database, context),
            alerts=AlertRepository(self._database, context),
            reports=ReportRepository(self._database, context),
            jobs=JobRepository(self._database, context),
        )
```

Repository methods call `database.tenant_transaction(self._context)` and never accept `tenant_id` from a request.

- [ ] **Step 5: Run tests**

```bash
pytest tests/production/test_tenant_migrations.py tests/production/test_tenant_repositories.py -v
```

Expected: PASS with real PostgreSQL and the non-owner runtime role.

- [ ] **Step 6: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/migrations hosted/src/tradebot_hosted/repositories tests/production/test_tenant_migrations.py tests/production/test_tenant_repositories.py
git commit -m "feat: add hosted tenant repositories"
```

---

### Task 2: Add strict schemas, request IDs, redacted errors, and exact route policy

**Files:**
- Create: `hosted/src/tradebot_hosted/schemas.py`
- Create: `hosted/src/tradebot_hosted/errors.py`
- Create: `hosted/src/tradebot_hosted/middleware.py`
- Create: `hosted/src/tradebot_hosted/routing.py`
- Modify: `hosted/src/tradebot_hosted/app.py`
- Create: `tests/production/test_schemas.py`
- Create: `tests/production/test_errors.py`
- Create: `tests/production/test_routes.py`

**Interfaces:**
- Consumes: Plan 1 app/runtime/auth and Task 1 repositories.
- Produces: `ApiError`, request IDs, bounded request models, and route-registration guard used by Plans 3–4.

- [ ] **Step 1: Write failing request/error tests**

```python
async def test_unknown_field_omits_submitted_input(client):
    response = await client.post("/api/conversations", json={"title": "ok", "tenant_id": str(TENANT_B)})
    assert response.status_code == 422
    body = response.text
    assert str(TENANT_B) not in body
    assert "input" not in response.json()["error"]


async def test_unhandled_error_returns_stable_shape(client, monkeypatch):
    monkeypatch.setattr(router, "fail", lambda: (_ for _ in ()).throw(RuntimeError(SEED_SECRET)))
    response = await client.get("/api/failure")
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"
    assert SEED_SECRET not in response.text
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_schemas.py tests/production/test_errors.py tests/production/test_routes.py -v
```

Expected: FAIL because production product routes and boundary helpers do not exist.

- [ ] **Step 3: Implement strict bounded schemas**

```python
class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class CreateConversationRequest(StrictRequest):
    title: str = Field(min_length=1, max_length=120)
    client_reference: str | None = Field(default=None, min_length=1, max_length=128)


class SendMessageRequest(StrictRequest):
    content: str = Field(min_length=1, max_length=20_000)
```

Add bounded models for analysis, alerts, reports, settings, job streams, and account deletion. Reject tenant/user/provider/model/object-key fields.

- [ ] **Step 4: Implement correlation, body limit, and stable errors**

```python
class ApiError(Exception):
    def __init__(self, *, status_code: int, code: str, message: str) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message


async def correlation_id_middleware(request, call_next):
    request_id = valid_uuid(request.headers.get("X-Request-ID")) or uuid4()
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = str(request_id)
    return response
```

Enforce 1 MiB for `Content-Length` and streamed/chunked bodies. Validation errors include field path/type/message but not submitted input/context. Authenticated/OAuth responses receive `Cache-Control: no-store`.

- [ ] **Step 5: Implement exact route registration**

Use a `RoutePolicy` that stores exact `(method, path)` pairs. A route absent from the approved set is not registered. Do not use middleware prefix exemptions. Product routes added in later tasks must be added to the policy and tests together.

- [ ] **Step 6: Run tests**

```bash
pytest tests/production/test_schemas.py tests/production/test_errors.py tests/production/test_routes.py -v
```

Expected: PASS.

- [ ] **Step 7: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/schemas.py hosted/src/tradebot_hosted/errors.py hosted/src/tradebot_hosted/middleware.py hosted/src/tradebot_hosted/routing.py hosted/src/tradebot_hosted/app.py tests/production
git commit -m "feat: enforce hosted api boundaries"
```

---

### Task 3: Implement durable job records, leases, and worker execution

**Files:**
- Create: `hosted/src/tradebot_hosted/jobs.py`
- Create: `hosted/src/tradebot_hosted/worker.py`
- Create: `hosted/src/tradebot_hosted/routers/jobs.py`
- Modify: `hosted/src/tradebot_hosted/runtime.py`
- Create: `tests/production/test_job_repository.py`
- Create: `tests/production/test_worker.py`

**Interfaces:**
- Consumes: Task 1 job schema and Plan 1 runtime.
- Produces: `JobService`, `JobRepository`, `JobHandler`, `DurableWorker`, and authenticated job routes.

- [ ] **Step 1: Write failing lease tests**

```python
async def test_stale_worker_cannot_complete_job(job_repository, jobs):
    lease = await job_repository.claim(owner="worker-a", job_types={"ANALYSIS"}, limit=1, lease_seconds=30)
    await job_repository.renew(JobLease(**{**lease, "owner": "worker-b", "epoch": lease.epoch + 1}), lease_seconds=30)
    assert await job_repository.complete(lease, result_ref="done") is False
    assert await job_repository.get(lease.job_id).status == JobStatus.RUNNING
```

Also test `FOR UPDATE SKIP LOCKED`, idempotent same-hash reuse/different-hash conflict, retry limit, cancellation, startup recovery, and tenant/system context checks.

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_job_repository.py tests/production/test_worker.py -v
```

Expected: FAIL because durable jobs do not exist.

- [ ] **Step 3: Implement job contracts**

```python
@dataclass(frozen=True, slots=True)
class SubmitJobCommand:
    scope: Literal["TENANT", "SYSTEM"]
    job_type: str
    idempotency_key: str
    request_hash: str
    payload: Mapping[str, object]
    correlation_id: UUID
    estimated_tokens: int = 0


@dataclass(frozen=True, slots=True)
class JobLease:
    job_id: UUID
    scope: Literal["TENANT", "SYSTEM"]
    tenant: TenantContext | None
    owner: str
    epoch: int
    expires_at: datetime
    attempt: int
```

`claim()` uses `FOR UPDATE SKIP LOCKED`. Every progress/renew/complete/fail update matches job ID, owner, epoch, and unexpired lease. Terminal states are immutable.

- [ ] **Step 4: Implement worker dispatch**

```python
class DurableWorker:
    async def run(self) -> None:
        while not self._stopping:
            leases = await self._jobs.claim(
                owner=self._owner,
                job_types=self._handlers.keys(),
                limit=self._batch_size,
                lease_seconds=self._lease_seconds,
            )
            await asyncio.gather(*(self._execute(lease) for lease in leases))
```

Build `JobExecutionContext` with immutable lease, optional tenant context, tenant-bound repositories, platform provider, market-data port, object store, quota service, cancellation token, and correlation ID. System jobs receive a dedicated global repository and null tenant context.

- [ ] **Step 5: Add job API routes**

```text
GET  /api/jobs
GET  /api/jobs/{job_id}
POST /api/jobs/{job_id}/cancel
```

Cross-tenant IDs return `404`. List pagination is cursor-bounded.

- [ ] **Step 6: Run tests**

```bash
pytest tests/production/test_job_repository.py tests/production/test_worker.py -v
```

Expected: PASS.

- [ ] **Step 7: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/jobs.py hosted/src/tradebot_hosted/worker.py hosted/src/tradebot_hosted/routers/jobs.py hosted/src/tradebot_hosted/runtime.py tests/production/test_job_repository.py tests/production/test_worker.py
git commit -m "feat: add durable hosted jobs"
```

---

### Task 4: Add atomic Redis AI quota reservations

**Files:**
- Create: `hosted/src/tradebot_hosted/quota.py`
- Create: `hosted/src/tradebot_hosted/lua/reserve_quota.lua`
- Create: `hosted/src/tradebot_hosted/lua/renew_quota.lua`
- Create: `hosted/src/tradebot_hosted/lua/settle_quota.lua`
- Create: `hosted/src/tradebot_hosted/lua/release_quota.lua`
- Create: `tests/production/test_quota_unit.py`
- Create: `tests/production/test_quota_redis.py`

**Interfaces:**
- Consumes: Task 3 jobs/model usage.
- Produces: `QuotaService.reserve/bind_worker/renew/settle/release/reconcile/reap/purge_tenant_keys`.

- [ ] **Step 1: Write failing real-Redis concurrency tests**

```python
async def test_concurrent_reservations_never_exceed_tenant_limit(quota):
    results = await asyncio.gather(*(quota.reserve(
        job_id=uuid4(), tenant_id=TENANT_A, reserved_tokens=1000, ttl_seconds=60
    ) for _ in range(20)))
    assert sum(isinstance(item, QuotaReservation) for item in results) == 2
```

Add global limit, 60/hour, IST rollover, stale epoch, renewal failure, enqueue failure, absent/terminal-job reap, and nonterminal-job rehydration cases.

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_quota_unit.py tests/production/test_quota_redis.py -v
```

Expected: FAIL because quota service does not exist.

- [ ] **Step 3: Implement reservation state and Lua atomicity**

Reservation fields: ID, job ID, tenant ID, reserved tokens, worker owner, epoch, created time, expiry. `reserve` atomically removes expired active entries and enforces 2/20/60/50,000. `renew` happens at one-third TTL. `settle`/`release` require matching ID, job, tenant, owner, and epoch and are idempotent for that epoch.

- [ ] **Step 4: Implement crash/restart reconciliation**

If renewal fails, the worker starts no new model call. Reconciliation compares Redis reservations to durable `jobs`/`model_usage`, rehydrates eligible nonterminal reservations with a new epoch, and charges the full reservation when an in-flight token count cannot be proven. Redis loss blocks new work; it never resets counters optimistically.

- [ ] **Step 5: Run tests**

```bash
pytest tests/production/test_quota_unit.py tests/production/test_quota_redis.py -v
```

Expected: PASS using real Redis, not mocks.

- [ ] **Step 6: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/quota.py hosted/src/tradebot_hosted/lua tests/production/test_quota_unit.py tests/production/test_quota_redis.py
git commit -m "feat: enforce hosted ai quotas"
```

---

### Task 5: Build platform-only providers and production tool registry

**Files:**
- Create: `hosted/src/tradebot_hosted/providers.py`
- Create: `hosted/src/tradebot_hosted/tools.py`
- Create: `hosted/src/tradebot_hosted/context.py`
- Create: `tests/production/test_platform_provider.py`
- Create: `tests/production/test_production_tools.py`

**Interfaces:**
- Consumes: deployment settings, Task 3 job context, and later Plan 3 capability ports.
- Produces: `PlatformProviderFactory`, `UsageCollector`, `PromptContext`, and safe tenant-bound tool registry.

- [ ] **Step 1: Write failing provider-boundary tests**

```python
def test_provider_factory_never_reads_keychain_or_environment(monkeypatch, provider_factory):
    monkeypatch.setattr(keyring, "get_password", forbidden)
    monkeypatch.setattr(os, "getenv", forbidden)
    provider = provider_factory.create(config=PLATFORM_CONFIG, ...)
    assert provider is not None
```

Also reject provider/model/base URL in request payloads, disable CLI/Ollama/setup paths, and assert timeout/cancellation/deadline are passed to every SDK call.

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_platform_provider.py tests/production/test_production_tools.py -v
```

Expected: FAIL because the factory/registry do not exist.

- [ ] **Step 3: Implement explicit provider and prompt context**

```python
@dataclass(frozen=True, slots=True)
class PromptContext:
    trading_mode: Literal["PAPER"]
    starting_capital_paise: int
    risk_limit_bps: int
    market_status: str
    tenant_analysis_context: str


@dataclass(frozen=True, slots=True)
class PlatformProviderConfig:
    provider: Literal["anthropic", "openai", "gemini"]
    model: str
    api_key: SecretStr
    endpoint: str
    request_timeout_seconds: float
```

The factory uses one deployment-selected client and records usage against `model_usage`. It must not mutate process environment or use a user keychain.

- [ ] **Step 4: Implement safe tool registry**

Register only approved read/analysis tools backed by injected tenant repositories and provider ports. Remove broker, order, webhook, arbitrary strategy import/execution, package setup, and provider-switch tools. Tool failures return stable code/category, never traceback text.

- [ ] **Step 5: Run tests**

```bash
pytest tests/production/test_platform_provider.py tests/production/test_production_tools.py -v
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/providers.py hosted/src/tradebot_hosted/tools.py hosted/src/tradebot_hosted/context.py tests/production/test_platform_provider.py tests/production/test_production_tools.py
git commit -m "feat: add hosted platform providers"
```

---

### Task 6: Add tenant conversations, durable analysis records, and memory context

**Files:**
- Create: `hosted/src/tradebot_hosted/routers/conversations.py`
- Create: `hosted/src/tradebot_hosted/routers/analysis.py`
- Create: `hosted/src/tradebot_hosted/analysis.py`
- Create: `tests/production/test_conversations.py`
- Create: `tests/production/test_analysis.py`

**Interfaces:**
- Consumes: Tasks 1–5 repositories/jobs/providers/tools.
- Produces: server conversation UUIDs, analysis job/record APIs, and `CompletedAnalysis` persistence.

- [ ] **Step 1: Write failing tenant workflow tests**

```python
async def test_same_client_reference_is_independent_per_tenant(client_a, client_b):
    a = await client_a.post("/api/conversations", json={"title": "A", "client_reference": "main"})
    b = await client_b.post("/api/conversations", json={"title": "B", "client_reference": "main"})
    assert a.json()["id"] != b.json()["id"]


async def test_analysis_memory_uses_only_current_tenant(client_a, client_b, repositories):
    await run_analysis(client_a, symbol="RELIANCE")
    context = await repositories.for_tenant(TENANT_A).analysis.context_for_symbol("RELIANCE")
    assert TENANT_B_MARKER not in context
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_conversations.py tests/production/test_analysis.py -v
```

Expected: FAIL because routes/analysis adapter do not exist.

- [ ] **Step 3: Implement conversation APIs**

```text
POST   /api/conversations
GET    /api/conversations
GET    /api/conversations/{conversation_id}
DELETE /api/conversations/{conversation_id}
GET    /api/conversations/{conversation_id}/messages
POST   /api/conversations/{conversation_id}/messages
```

A message submission inserts the user message and `CHAT_TURN` job in one transaction. Worker loads bounded tenant history, uses the platform provider, and appends the assistant message.

- [ ] **Step 4: Implement analysis adapter and APIs**

```python
@dataclass(frozen=True, slots=True)
class CompletedAnalysis:
    symbol: str
    exchange: str
    analyst_reports: tuple[AnalystReport, ...]
    debate: DebateResult
    synthesis: str
    report_text: str
    trade_plans: Mapping[str, object]
```

```text
POST /api/analysis/jobs
GET  /api/analysis/records
GET  /api/analysis/records/{analysis_id}
DELETE /api/analysis/records/{analysis_id}
GET  /api/analysis/drift
GET  /api/analysis/records/{analysis_id}/audit
```

The adapter reuses existing analyzer algorithms but receives explicit provider, registry, market-data, paper-account, and `PromptContext` ports. It must not read global memory, capital/risk environment, alert manager, broker session, keychain, or provider configuration.

- [ ] **Step 5: Run tests**

```bash
pytest tests/production/test_conversations.py tests/production/test_analysis.py -v
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/routers/conversations.py hosted/src/tradebot_hosted/routers/analysis.py hosted/src/tradebot_hosted/analysis.py tests/production/test_conversations.py tests/production/test_analysis.py
git commit -m "feat: add tenant conversations and analysis"
```

---

### Task 7: Add tenant alerts, safe reports, and settings

**Files:**
- Create: `hosted/src/tradebot_hosted/routers/alerts.py`
- Create: `hosted/src/tradebot_hosted/routers/reports.py`
- Create: `hosted/src/tradebot_hosted/routers/settings.py`
- Create: `hosted/src/tradebot_hosted/alerts.py`
- Create: `hosted/src/tradebot_hosted/reports.py`
- Create: `hosted/src/tradebot_hosted/object_store.py`
- Create: `tests/production/test_alerts.py`
- Create: `tests/production/test_reports.py`
- Create: `tests/production/test_settings.py`

**Interfaces:**
- Consumes: Task 1 repositories, Task 3 jobs, Plan 2 object-store port.
- Produces: tenant alert/report/settings APIs consumed by Plans 3–4.

- [ ] **Step 1: Write failing feature tests**

```python
async def test_alert_has_no_delivery_url_field(client):
    response = await client.post("/api/alerts", json={
        "kind": "PRICE", "symbol": "RELIANCE", "operator": "ABOVE", "threshold": 100,
        "webhook_url": "https://attacker.example"
    })
    assert response.status_code == 422
    assert "webhook_url" not in response.text


async def test_report_download_authorizes_owner_before_signing(object_store, client_a, client_b):
    report = await create_report(client_a)
    assert (await client_b.get(f"/api/reports/{report.id}/download-url")).status_code == 404
    assert await object_store.signed_url_calls == 0
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_alerts.py tests/production/test_reports.py tests/production/test_settings.py -v
```

Expected: FAIL because routers/services do not exist.

- [ ] **Step 3: Implement alerts**

Reuse pure alert condition/evaluation logic through injected market/technical ports. Remove broker fallback, JSON singleton, webhook, Telegram, desktop, and terminal delivery from hosted imports. Concurrent evaluators create one trigger event; active alerts schedule tenant jobs.

- [ ] **Step 4: Implement reports and object storage**

```python
class ObjectStore(Protocol):
    async def put(self, *, tenant_id: UUID, report_id: UUID, content: bytes, content_type: str) -> ObjectRef: ...
    async def delete_many(self, refs: Sequence[ObjectRef]) -> None: ...
    async def create_download_url(self, ref: ObjectRef, *, ttl_seconds: int = 60) -> str: ...
```

Reports are PDF/JSON only. The server selects object keys, stores metadata in PostgreSQL, authorizes tenant ownership, and exposes only the same-origin routes:

```text
GET    /api/reports
POST   /api/reports
GET    /api/reports/{report_id}
DELETE /api/reports/{report_id}
GET    /api/reports/{report_id}/content
```

`GET .../content` authorizes ownership, obtains a 60-second object-store URL internally, and streams bytes with attachment disposition and `nosniff`. No object-store URL/key, raw HTML, local path, or CDN URL is returned to the renderer.

- [ ] **Step 5: Implement settings**

Only typed non-secret preferences are writable. No provider, credential, base URL, webhook, Telegram, trading-mode, or broker field exists.

- [ ] **Step 6: Run tests**

```bash
pytest tests/production/test_alerts.py tests/production/test_reports.py tests/production/test_settings.py -v
```

Expected: PASS.

- [ ] **Step 7: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/alerts.py hosted/src/tradebot_hosted/reports.py hosted/src/tradebot_hosted/object_store.py hosted/src/tradebot_hosted/routers tests/production/test_alerts.py tests/production/test_reports.py tests/production/test_settings.py
git commit -m "feat: add hosted tenant data services"
```

---

### Task 8: Add authenticated durable NDJSON progress streaming

**Files:**
- Create: `hosted/src/tradebot_hosted/progress.py`
- Create: `hosted/src/tradebot_hosted/routers/stream.py`
- Create: `tests/production/test_job_progress.py`

**Interfaces:**
- Consumes: Task 3 durable job/progress state.
- Produces: `GET /api/jobs/{job_id}/stream` for Plan 4 fetch-based clients.

- [ ] **Step 1: Write failing stream tests**

```python
async def test_stream_resumes_after_sequence_without_duplicates(client, job_with_events):
    first = await collect_stream(client, job_with_events.id, after_sequence=0)
    second = await collect_stream(client, job_with_events.id, after_sequence=2)
    assert [event["sequence"] for event in first] == [1, 2, 3]
    assert [event["sequence"] for event in second] == [3]
```

Add auth/tenant, terminal flush, 600-second cap, 3 streams/tenant, 256-event cap, 16 KiB/event, 1 MiB progress, restart, two-instance, cancellation, and redaction cases.

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_job_progress.py -v
```

Expected: FAIL because the stream does not exist.

- [ ] **Step 3: Implement bounded NDJSON streaming**

```python
class JobProgressStream:
    async def stream(self, context: TenantContext, job_id: UUID, *, after_sequence: int):
        yield b'{"sequence":1,"event":{"type":"phase","data":{"phase":"debate"}}}\n'
```

Read durable progress from PostgreSQL, emit heartbeat comments every 15 seconds, flush terminal state, then close. Never use the process-global local SSE bus.

- [ ] **Step 4: Run tests**

```bash
pytest tests/production/test_job_progress.py -v
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/progress.py hosted/src/tradebot_hosted/routers/stream.py tests/production/test_job_progress.py
git commit -m "feat: stream durable hosted job progress"
```

---

### Task 9: Implement the account-deletion lifecycle and tombstone finalizer

**Files:**
- Create: `hosted/src/tradebot_hosted/deletion.py`
- Create: `hosted/src/tradebot_hosted/routers/account.py`
- Create: `hosted/src/tradebot_hosted/migrations/versions/20260925_0004_deletion_finalization.py`
- Create: `tests/production/test_account_deletion.py`

**Interfaces:**
- Consumes: Plan 1 reauthentication/session state, Task 1 tenant tables/audit/tombstones, Task 3 jobs, Task 7 object store.
- Produces: Plan 5 restore-scrub manifest hook and exact deletion APIs.

- [ ] **Step 1: Write failing lifecycle tests**

```python
async def test_deletion_pending_revokes_product_sessions_and_issues_control_session(client):
    result = await client.delete("/account", json={"confirmation": "DELETE MY ACCOUNT"})
    assert result.status_code == 202
    assert await normal_session_count(TENANT_A) == 0
    assert await control_session_count(TENANT_A) == 1


async def test_purge_removes_every_tenant_row_and_retains_bounded_audit(owner, deletion_service):
    await deletion_service.purge_database(TENANT_A, worker_owner="worker-a")
    assert await tenant_owned_row_count(owner, TENANT_A) == 0
    assert await audit_row_count(owner) == 1
```

Also test stale reauthentication, exact confirmation, control-session route restriction, cancellation before deadline, concurrent purge/finalizer, login while pending, idempotent finalization, and tombstone without raw identity.

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_account_deletion.py -v
```

Expected: FAIL because deletion does not exist.

- [ ] **Step 3: Add state transitions and APIs**

```text
ACTIVE -> DELETION_PENDING -> PURGE_PENDING -> tombstone OBJECT_PENDING -> PULGED
                   \-> ACTIVE (cancel before deadline)
```

Implement:

```text
DELETE /account
POST   /account/deletion/cancel
```

The control session can access only cancellation. Purge cancels jobs and removes tenant rows, sessions, CSRF, tenant/user, idempotency/model usage, and bounded audit pseudonyms. Finalizer deletes report objects and Redis keys, writes the Plan 5 signed anti-resurrection manifest before marking `PULGED`.

- [ ] **Step 4: Run tests**

```bash
pytest tests/production/test_account_deletion.py -v
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/deletion.py hosted/src/tradebot_hosted/routers/account.py hosted/src/tradebot_hosted/migrations tests/production/test_account_deletion.py
git commit -m "feat: add hosted account deletion"
```

---

### Task 10: Quarantine legacy callers and enforce the final Plan 2 route/import surface

**Files:**
- Modify: `hosted/src/tradebot_hosted/app.py`
- Create: `tests/production/test_route_allowlist.py`
- Create: `tests/production/test_legacy_callers_unreachable.py`
- Modify: `tests/production/test_production_imports.py`

**Interfaces:**
- Consumes: all Plan 2 routers/services.
- Produces: final hosted route/import boundary for Plans 3–5.

- [ ] **Step 1: Write failing quarantine tests**

```python
def test_production_import_has_no_legacy_trust_modules():
    loaded = import_hosted_app_in_subprocess()
    assert loaded.isdisjoint({
        "web.api", "web.skills", "web.sse", "brokers",
        "brokers.session", "bot.telegram_bot", "config.credentials",
        "engine.trade_executor", "engine.paper_execute", "app.repl",
    })


def test_no_production_route_mentions_broker_or_live_execution(hosted_client):
    paths = route_templates(hosted_client.app)
    assert not any(token in path for path in paths for token in ("broker", "live", "telegram", "onboarding/provider"))
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_route_allowlist.py tests/production/test_legacy_callers_unreachable.py tests/production/test_production_imports.py -v
```

Expected: FAIL until every Plan 2 router is registered explicitly and legacy imports are removed.

- [ ] **Step 3: Register only approved hosted routers**

Include auth, settings, conversations, analysis, alerts, reports, jobs/progress, account deletion, health, and static assets. Keep broker/provider setup/raw orders/public SSE/OpenClaw absent.

- [ ] **Step 4: Run tests**

```bash
pytest tests/production/test_route_allowlist.py tests/production/test_legacy_callers_unreachable.py tests/production/test_production_imports.py -v
```

Expected: PASS.

- [ ] **Step 5: Run the Plan 2 suite**

```bash
pytest tests/production -m "not network and not slow" -v
pytest tests/production -m "slow and not network" -v
ruff check hosted tests/production
ruff format --check hosted tests/production
python -m build hosted
python -m pip check
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted tests/production
git commit -m "feat: quarantine hosted legacy trust boundaries"
```

## Plan 2 Completion Evidence

- [ ] All tenant tables and composite foreign keys enforce RLS under the runtime role.
- [ ] Cross-tenant known IDs return no data or mutation.
- [ ] Product route/schema/error tests pass.
- [ ] Durable job lease and real Redis quota tests pass.
- [ ] Platform provider factory never reads keychain/environment or accepts user provider overrides.
- [ ] Conversations, analysis, alerts, reports, settings, and progress are tenant-owned.
- [ ] Account deletion/cancel/purge/finalize tests pass.
- [ ] Hosted import and route quarantine tests pass.
- [ ] Plan 2 suite, Ruff, hosted build, and `pip check` pass.
- [ ] No commit is made without explicit user authorization.
