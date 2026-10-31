# Production Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a broker-free hosted application distribution with Google OIDC, PostgreSQL identity tables, opaque sessions, CSRF protection, and enforced tenant RLS while preserving the existing local sidecar for development.

**Architecture:** The existing `web.api:app` remains a local-only application. A new `hosted/` distribution owns the production API and worker entry points, runtime settings, async PostgreSQL/Redis infrastructure, OIDC transaction store, and session service. Production imports an explicit safe router list and physically excludes broker, CLI, Telegram, keyring, and local sidecar modules from its wheel.

**Tech Stack:** Python 3.11+, FastAPI, Pydantic 2, SQLAlchemy 2 async, psycopg 3, Alembic, Redis 5+, PyJWT with cryptography, httpx, pytest, pytest-xdist, Ruff

**Spec:** `docs/superpowers/specs/2026-09-25-production-security-design.md`

## Global Constraints

- Preserve `web/api.py`, `web/auth.py`, `config/credentials.py`, and `config/paths.py` as local-development code; production must not import them.
- Production authentication is Google OIDC Authorization Code + PKCE only; no password table, signup, login, or recovery endpoints.
- `__Host-tradebot_oidc` uses `Secure`, `HttpOnly`, `SameSite=Lax`, host-only, path `/`, and `Max-Age=600`.
- `__Host-tradebot_session` uses `Secure`, `HttpOnly`, `SameSite=Lax`, host-only, path `/`, 24-hour idle expiry, and 7-day absolute expiry.
- `GET /auth/session` issues a CSRF token; retain at most five active token hashes per session.
- Unsafe cookie-authenticated methods require `X-CSRF-Token` and constant-time verification.
- Tenant IDs are derived only from verified sessions; request bodies cannot select tenants.
- Production uses a non-owner PostgreSQL runtime role with `ENABLE` and `FORCE ROW LEVEL SECURITY` on tenant tables.
- Application startup never runs migrations or DDL.
- Production dependencies and imports exclude broker SDKs, `brokers.*`, `app.*`, `bot.*`, `ui.*`, local `web.*`, keyring, dotenv, and interactive setup code.
- Do not execute commit steps unless the user explicitly authorizes commits in the execution session.

## Review Focus

- Concurrent OIDC callbacks with the same state: exactly one code exchange and one user/session creation.
- OIDC return paths and cookies: reject absolute, scheme-relative, encoded-separator, control-character, callback, and static paths.
- Tenant context across pooled connections: commit, rollback, exception, and reuse must never leak another tenant.
- Runtime-role privileges: no owner rights, `BYPASSRLS`, DDL, `TRUNCATE`, or access to future restricted ledgers.
- Production import boundary: importing or starting the hosted app must not load the local sidecar, broker registry, keyring, or broker SDK modules.

---

### Task 1: Create the hosted distribution and strict production settings

**Files:**
- Create: `hosted/pyproject.toml`
- Create: `hosted/src/tradebot_hosted/__init__.py`
- Create: `hosted/src/tradebot_hosted/config.py`
- Create: `hosted/src/tradebot_hosted/app.py`
- Create: `hosted/src/tradebot_hosted/worker.py`
- Create: `tests/production/conftest.py`
- Create: `tests/production/test_packaging.py`
- Create: `tests/production/test_settings.py`

**Interfaces:**
- Consumes: environment variables and secret values supplied by the future Plan 5 secret layer.
- Produces: `ProductionSettings`, `create_app()`, `main()`, and `run_worker()` entry points for Plans 2–5.

- [ ] **Step 1: Write failing packaging and settings tests**

```python
from tradebot_hosted.config import ProductionSettings


def test_production_settings_reject_missing_or_unsafe_values(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DATABASE_URL", "sqlite:///local.db")
    monkeypatch.setenv("REDIS_URL", "redis://localhost")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "secret")
    monkeypatch.setenv("GOOGLE_REDIRECT_URI", "http://localhost/auth/google/callback")
    monkeypatch.setenv("GOOGLE_ISSUER", "https://accounts.google.com")
    monkeypatch.setenv("SESSION_HMAC_KEY", "short")
    monkeypatch.setenv("ALLOWED_HOSTS", "app.example.com")

    with pytest.raises(ValueError, match="production settings"):
        ProductionSettings.from_env()


def test_hosted_wheel_contains_only_tradebot_hosted():
    assert hosted_wheel_top_level_files() == {"tradebot_hosted"}
```

The packaging helper must inspect a built wheel and reject `brokers`, `app`, `bot`, `ui`, `web`, `config.credentials`, `kiteconnect`, `growwapi`, `fyers-apiv3`, `keyring`, and `python-dotenv`.

- [ ] **Step 2: Run the tests and confirm failure**

Run:

```bash
pytest tests/production/test_settings.py tests/production/test_packaging.py -v
```

Expected: FAIL because `tradebot_hosted` does not exist.

- [ ] **Step 3: Create the minimal hosted project**

Use this dependency set in `hosted/pyproject.toml`:

```toml
[build-system]
requires = ["setuptools>=75,<76", "wheel>=0.45,<0.46"]
build-backend = "setuptools.build_meta"

[project]
name = "tradebot-hosted"
version = "0.1.0"
requires-python = ">=3.11,<3.14"
dependencies = [
  "alembic>=1.14,<2",
  "fastapi>=0.115,<1",
  "httpx>=0.28,<1",
  "psycopg[binary,pool]>=3.2,<4",
  "pydantic>=2.10,<3",
  "pydantic-settings>=2.7,<3",
  "pyjwt[crypto]>=2.10,<3",
  "redis>=5.2,<6",
  "sqlalchemy[asyncio]>=2.0.36,<3",
  "uvicorn>=0.34,<1",
]

[project.scripts]
tradebot-hosted-api = "tradebot_hosted.app:main"
tradebot-hosted-worker = "tradebot_hosted.worker:main"

[tool.setuptools.packages.find]
where = ["src"]
include = ["tradebot_hosted*"]
```

Implement strict settings without dotenv or keyring access:

```python
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlparse


@dataclass(frozen=True, slots=True)
class ProductionSettings:
    environment: Literal["development", "test", "production"]
    database_url: str
    redis_url: str
    google_client_id: str
    google_client_secret: str
    google_redirect_uri: str
    google_issuer: str
    session_hmac_key: bytes
    allowed_hosts: tuple[str, ...]

    @classmethod
    def from_env(cls, env=None) -> "ProductionSettings":
        raise NotImplementedError
```

`from_env()` must parse mappings, reject absent values, require a 32-byte decoded HMAC key, require PostgreSQL and Redis schemes, require HTTPS redirect URIs in production, reject credentials in the redirect URI, and parse hosts as a comma-separated tuple.

- [ ] **Step 4: Add minimal app and worker entry points**

```python
def create_app(settings: ProductionSettings | None = None) -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings
    return app


def main() -> None:
    settings = ProductionSettings.from_env()
    uvicorn.run(
        "tradebot_hosted.app:create_app",
        factory=True,
        host="0.0.0.0",
        port=8765,
        access_log=False,
    )
```

The worker entry point initially validates settings and waits for termination. It must not create speculative job infrastructure before Plan 2.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pytest tests/production/test_settings.py tests/production/test_packaging.py -v
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Inspect:

```bash
git diff --check
git status --short
```

Commit only if explicitly authorized:

```bash
git add hosted tests/production/test_packaging.py tests/production/test_settings.py tests/production/conftest.py
git commit -m "feat: add hosted production distribution"
```

---

### Task 2: Add async PostgreSQL/Redis runtime and tenant transactions

**Files:**
- Create: `hosted/src/tradebot_hosted/database.py`
- Create: `hosted/src/tradebot_hosted/redis.py`
- Create: `hosted/src/tradebot_hosted/runtime.py`
- Modify: `hosted/src/tradebot_hosted/app.py`
- Modify: `hosted/src/tradebot_hosted/worker.py`
- Create: `tests/production/test_database.py`
- Create: `tests/production/test_runtime.py`

**Interfaces:**
- Consumes: `ProductionSettings` from Task 1.
- Produces: `TenantContext`, `Database.tenant_transaction()`, and `Runtime` for all later plans.

- [ ] **Step 1: Write failing transaction-isolation tests**

```python
async def test_tenant_context_does_not_leak_through_pool(postgres):
    async with database.tenant_transaction(TenantContext(user_a, tenant_a)) as connection:
        assert await connection.scalar(text("SELECT current_setting('app.tenant_id', true)")) == str(tenant_a)

    async with database.transaction() as connection:
        assert await connection.scalar(text("SELECT current_setting('app.tenant_id', true)")) in (None, "")


async def test_rollback_clears_tenant_context(postgres):
    with pytest.raises(RuntimeError):
        async with database.tenant_transaction(TenantContext(user_a, tenant_a)) as connection:
            await connection.execute(text("INSERT INTO tradebot.user_settings(tenant_id) VALUES (:id)"), {"id": tenant_a})
            raise RuntimeError("stop")
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_database.py tests/production/test_runtime.py -v
```

Expected: FAIL because `Database` and `Runtime` do not exist.

- [ ] **Step 3: Implement immutable tenant context and database wrapper**

```python
@dataclass(frozen=True, slots=True)
class TenantContext:
    tenant_id: UUID
    user_id: UUID


class Database:
    def __init__(self, url: str, *, pool_size: int = 10, max_overflow: int = 10) -> None:
        self._engine = create_async_engine(
            url,
            pool_pre_ping=True,
            pool_size=pool_size,
            max_overflow=max_overflow,
        )

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[AsyncConnection]:
        async with self._engine.begin() as connection:
            yield connection

    @asynccontextmanager
    async def tenant_transaction(self, context: TenantContext) -> AsyncIterator[AsyncConnection]:
        async with self._engine.begin() as connection:
            await connection.execute(
                text("SELECT set_config('app.tenant_id', :tenant_id, true)"),
                {"tenant_id": str(context.tenant_id)},
            )
            yield connection
```

Use the application runtime role for `Database`; migration ownership belongs to a separate URL available only to the migration process.

- [ ] **Step 4: Implement Redis and runtime lifecycle**

```python
@dataclass(slots=True)
class Runtime:
    settings: ProductionSettings
    database: Database
    redis: Redis

    @classmethod
    def create(cls, settings: ProductionSettings) -> "Runtime":
        return cls(
            settings=settings,
            database=Database(settings.database_url),
            redis=Redis.from_url(settings.redis_url, decode_responses=True),
        )

    async def close(self) -> None:
        await self.database.close()
        await self.redis.aclose()
```

Use FastAPI lifespan to create and close the runtime. Tests may inject a runtime; do not expose a module-global database or Redis client.

- [ ] **Step 5: Run focused tests**

```bash
pytest tests/production/test_database.py tests/production/test_runtime.py -v
```

Expected: PASS with real PostgreSQL/Redis fixtures.

- [ ] **Step 6: Checkpoint**

```bash
git diff --check
```

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/database.py hosted/src/tradebot_hosted/redis.py hosted/src/tradebot_hosted/runtime.py hosted/src/tradebot_hosted/app.py hosted/src/tradebot_hosted/worker.py tests/production/test_database.py tests/production/test_runtime.py
git commit -m "feat: add hosted runtime and tenant transactions"
```

---

### Task 3: Create identity schema, runtime grants, and forced RLS

**Files:**
- Create: `hosted/alembic.ini`
- Create: `hosted/src/tradebot_hosted/migrations/env.py`
- Create: `hosted/src/tradebot_hosted/migrations/script.py.mako`
- Create: `hosted/src/tradebot_hosted/migrations/versions/20260925_0001_identity_and_rls.py`
- Create: `hosted/src/tradebot_hosted/migrations/versions/20260925_0002_runtime_grants.py`
- Create: `docker/postgres/init/001-runtime-role.sh`
- Create: `tests/production/test_identity_migrations.py`
- Create: `tests/production/test_tenant_rls.py`

**Interfaces:**
- Consumes: `Database` and `TenantContext` from Task 2.
- Produces: identity tables, `user_settings` tenant anchor, expected Alembic head, and RLS enforcement for later migrations.

- [ ] **Step 1: Write failing migration tests**

```python
async def test_identity_schema_and_runtime_grants(postgres_owner, postgres_runtime):
    assert await table_names(postgres_owner) >= {
        "users", "tenants", "sessions", "csrf_tokens", "user_settings"
    }
    assert await role_has_bypassrls(postgres_runtime) is False
    assert await can_ddl(postgres_runtime) is False


async def test_runtime_rls_blocks_cross_tenant(postgres_runtime):
    await insert_user_settings(postgres_owner, user_a, tenant_a)
    async with runtime_database.tenant_transaction(TenantContext(user_b, tenant_b)) as connection:
        with pytest.raises(NoDataFound):
            await connection.execute(
                text("UPDATE tradebot.user_settings SET theme='dark' WHERE tenant_id=:id"),
                {"id": tenant_a},
            )
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_identity_migrations.py tests/production/test_tenant_rls.py -v
```

Expected: FAIL because the schema and runtime role do not exist.

- [ ] **Step 3: Add migration configuration and identity migration**

Create schema/table requirements:

- `users`: UUID ID, provider, Google subject, verified email, lifecycle state, timestamps, unique `(provider, google_subject)`.
- `tenants`: UUID ID, unique owner user, lifecycle state, deletion deadline, timestamps.
- `sessions`: UUID ID, user, 32-byte token hash, idle/absolute expiry, revocation, timestamps.
- `csrf_tokens`: UUID ID, session, 32-byte token hash, expiry, last-used, revocation, timestamps.
- `user_settings`: tenant UUID primary key/FK, bounded non-secret JSON, timestamps.

Enable and force RLS on `user_settings`:

```sql
ALTER TABLE tradebot.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tradebot.user_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY user_settings_tenant_isolation ON tradebot.user_settings
FOR ALL TO tradebot_runtime
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
```

- [ ] **Step 4: Add explicit runtime grants**

Revoke `PUBLIC` access, grant only required identity/session/settings operations to `tradebot_runtime`, and deny DDL/truncate/migration metadata. Do not use blanket default privileges; each later tenant-table migration repeats explicit RLS and grants.

- [ ] **Step 5: Add non-owner role bootstrap for local PostgreSQL**

`docker/postgres/init/001-runtime-role.sh` must use `psql` variables, create `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, and never embed a password in Git. Managed PostgreSQL receives equivalent DBA provisioning outside Alembic.

- [ ] **Step 6: Run migration and RLS tests**

```bash
alembic -c hosted/alembic.ini upgrade head
pytest tests/production/test_identity_migrations.py tests/production/test_tenant_rls.py -v
```

Expected: PASS using both owner and runtime roles.

- [ ] **Step 7: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/migrations docker/postgres/init tests/production/test_identity_migrations.py tests/production/test_tenant_rls.py
git commit -m "feat: add hosted identity schema and tenant rls"
```

---

### Task 4: Implement OIDC/PKCE token primitives and return-path validation

**Files:**
- Create: `hosted/src/tradebot_hosted/auth/__init__.py`
- Create: `hosted/src/tradebot_hosted/auth/models.py`
- Create: `hosted/src/tradebot_hosted/auth/tokens.py`
- Create: `tests/production/test_auth_tokens.py`

**Interfaces:**
- Consumes: `ProductionSettings` for token HMAC keys and allowed SPA routes.
- Produces: secure token, PKCE, digest, and return-path primitives consumed by Tasks 5–6.

- [ ] **Step 1: Write failing token tests**

```python
@pytest.mark.parametrize("value", [
    "https://evil.example/path", "//evil.example/path", "/\\evil",
    "/auth/google/callback", "/assets/app.js", "/x\nSet-Cookie:y",
])
def test_validate_return_path_rejects_unsafe_values(value):
    with pytest.raises(ValueError):
        validate_return_path(value, allowed_paths=("/app", "/"))


def test_pkce_pair_uses_s256():
    verifier, challenge = new_pkce_pair()
    assert len(verifier) >= 43
    assert challenge == base64url_without_padding(sha256(verifier))
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_auth_tokens.py -v
```

Expected: FAIL because token helpers do not exist.

- [ ] **Step 3: Implement standard-library primitives**

```python
def new_opaque_token() -> str:
    return secrets.token_urlsafe(32)


def new_pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return verifier, base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def token_digest(token: str, secret: bytes) -> bytes:
    return hmac.digest(secret, token.encode("ascii"), "sha256")
```

`validate_return_path()` must require a single `/`, reject scheme/authority/backslash/control/percent-encoded separators, cap length at 512, and match an explicit SPA route prefix.

- [ ] **Step 4: Run tests**

```bash
pytest tests/production/test_auth_tokens.py -v
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/auth tests/production/test_auth_tokens.py
git commit -m "feat: add hosted oidc token primitives"
```

---

### Task 5: Implement atomic Redis OIDC transactions and Google token verification

**Files:**
- Create: `hosted/src/tradebot_hosted/auth/google.py`
- Create: `hosted/src/tradebot_hosted/auth/rate_limit.py`
- Create: `hosted/src/tradebot_hosted/auth/store.py`
- Create: `hosted/src/tradebot_hosted/lua/consume_oidc.lua`
- Create: `tests/production/test_oidc_transactions.py`
- Create: `tests/production/test_google_oidc.py`

**Interfaces:**
- Consumes: token helpers from Task 4, Redis runtime from Task 2.
- Produces: `OidcTransactionStore` and `GoogleOIDCClient` consumed by `AuthService`.

- [ ] **Step 1: Write failing concurrency and verification tests**

```python
async def test_concurrent_callback_consumes_state_once(redis_store, oidc_transaction):
    first, second = await asyncio.gather(
        redis_store.consume(state=oidc_transaction.state, binding_secret=oidc_transaction.binding_secret),
        redis_store.consume(state=oidc_transaction.state, binding_secret=oidc_transaction.binding_secret),
        return_exceptions=True,
    )
    assert sum(not isinstance(item, Exception) for item in (first, second)) == 1


async def test_google_client_rejects_invalid_nonce(google_client):
    with pytest.raises(InvalidIdentityToken):
        await google_client.verify_id_token(id_token=valid_id_token, expected_nonce="wrong")
```

Additional assertions: `email_verified is True`, issuer, audience, RS256 signature, expiry, fixed redirect URI, no redirect following, and stable failure categories.

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_oidc_transactions.py tests/production/test_google_oidc.py -v
```

Expected: FAIL because the store/client do not exist.

- [ ] **Step 3: Implement atomic transaction storage**

Redis hashes must store state digest, nonce, PKCE verifier/challenge, expected return path, binding-secret digest, expiry, and consumed status. `consume()` must be one Lua operation that rejects expired/replayed/mismatched values and marks exactly one caller as owner.

- [ ] **Step 4: Implement Google OIDC calls**

```python
class GoogleOIDCClient:
    async def authorization_url(self, *, state: str, nonce: str, code_challenge: str) -> str:
        ...

    async def exchange_code(self, *, code: str, code_verifier: str) -> str:
        ...

    async def verify_id_token(self, *, id_token: str, expected_nonce: str) -> GoogleIdentity:
        claims = jwt.decode(
            id_token,
            self._public_key,
            algorithms=["RS256"],
            audience=self._client_id,
            issuer=self._issuer,
            leeway=30,
        )
        if not hmac.compare_digest(claims["nonce"], expected_nonce):
            raise InvalidIdentityToken("nonce mismatch")
        if claims.get("email_verified") is not True:
            raise InvalidIdentityToken("email not verified")
        return GoogleIdentity(subject=claims["sub"], email=claims["email"])
```

Fetch Google's JWKS with caching, bounded TTL, and no redirect following. Do not log token responses.

- [ ] **Step 5: Run tests**

```bash
pytest tests/production/test_oidc_transactions.py tests/production/test_google_oidc.py -v
```

Expected: PASS with real Redis and deterministic signed test tokens.

- [ ] **Step 6: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/auth hosted/src/tradebot_hosted/lua tests/production/test_oidc_transactions.py tests/production/test_google_oidc.py
git commit -m "feat: add hosted google oidc transactions"
```

---

### Task 6: Implement session, CSRF, and authentication services

**Files:**
- Create: `hosted/src/tradebot_hosted/auth/service.py`
- Create: `hosted/src/tradebot_hosted/auth/router.py`
- Modify: `hosted/src/tradebot_hosted/runtime.py`
- Create: `tests/production/test_sessions_csrf.py`
- Create: `tests/production/test_auth_routes.py`

**Interfaces:**
- Consumes: Tasks 3–5 interfaces.
- Produces: `AuthService`, principal dependencies, `GET /auth/session`, and `POST /auth/logout`.

- [ ] **Step 1: Write failing session and CSRF tests**

```python
async def test_session_bootstrap_caps_active_csrf_hashes(auth_service, session):
    tokens = [await auth_service.bootstrap_session(session_token=session.raw_token) for _ in range(6)]
    assert all(item.csrf_token for item in tokens)
    assert await active_csrf_count(session.id) == 5


async def test_unsafe_request_requires_csrf(client, session):
    response = await client.post("/auth/logout", cookies={"__Host-tradebot_session": session.raw_token})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CSRF_INVALID"
```

Also test 24-hour idle expiry, 7-day absolute expiry, login rotation, logout revocation, inactive tenant rejection, and raw-token absence from PostgreSQL.

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_sessions_csrf.py tests/production/test_auth_routes.py -v
```

Expected: FAIL because `AuthService` and routes do not exist.

- [ ] **Step 3: Implement service contracts**

```python
@dataclass(frozen=True, slots=True)
class AuthenticatedPrincipal:
    user_id: UUID
    tenant_id: UUID
    session_id: UUID
    session_purpose: Literal["NORMAL", "DELETION_CONTROL"]
    reauthenticated_at: datetime


class AuthService:
    async def start_google_login(self, *, return_to: str | None, client_ip: str) -> OidcStart: ...
    async def complete_google_login(self, *, state: str, binding_secret: str, code: str, client_ip: str) -> LoginResult: ...
    async def bootstrap_session(self, *, session_token: str, client_ip: str) -> SessionBootstrap: ...
    async def authenticate(self, session_token: str) -> AuthenticatedPrincipal: ...
    async def validate_csrf(self, principal: AuthenticatedPrincipal, csrf_token: str) -> None: ...
    async def logout(self, principal: AuthenticatedPrincipal) -> None: ...
```

On first Google login, create the user and tenant in one transaction keyed by `(provider, google_subject)`. Never look up or link by email. On subsequent login, return the existing tenant.

- [ ] **Step 4: Implement exact auth routes**

```text
GET  /auth/google/start
GET  /auth/google/callback
GET  /auth/session
POST /auth/logout
```

- Success callback: fixed `303` redirect to the validated relative path.
- Failure callback: fixed `303` redirect to `/auth/error`; no provider HTML or raw error.
- `/auth/session`: returns user, CSRF token, and expiry; no tenant input.
- `/auth/logout`: normal session + CSRF, revokes session and CSRF tokens, clears cookie.

- [ ] **Step 5: Run focused tests**

```bash
pytest tests/production/test_sessions_csrf.py tests/production/test_auth_routes.py -v
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/auth hosted/src/tradebot_hosted/runtime.py tests/production/test_sessions_csrf.py tests/production/test_auth_routes.py
git commit -m "feat: add hosted sessions and csrf protection"
```

---

### Task 7: Enforce the production route/import boundary and readiness behavior

**Files:**
- Modify: `hosted/src/tradebot_hosted/app.py`
- Modify: `hosted/src/tradebot_hosted/worker.py`
- Create: `hosted/src/tradebot_hosted/health.py`
- Create: `tests/production/test_composition.py`
- Create: `tests/production/test_production_imports.py`
- Create: `tests/production/test_health.py`

**Interfaces:**
- Consumes: Tasks 1–6 application/runtime/auth routes.
- Produces: exact production route table and Plan 2 router-registration seam.

- [ ] **Step 1: Write failing route and import tests**

```python
def test_plan_one_route_allowlist(hosted_client):
    assert route_methods(hosted_client.app) == {
        ("GET", "/health/live"),
        ("GET", "/health/ready"),
        ("GET", "/auth/google/start"),
        ("GET", "/auth/google/callback"),
        ("GET", "/auth/session"),
        ("POST", "/auth/logout"),
    }


def test_production_import_does_not_load_local_trust_modules():
    modules = import_hosted_app_in_subprocess()
    assert forbidden_modules().isdisjoint(modules)
```

Forbidden modules include `web.api`, `web.skills`, `web.sse`, `brokers`, `bot`, `config.credentials`, `keyring`, `fyers_apiv3`, `kiteconnect`, and `growwapi`.

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_composition.py tests/production/test_production_imports.py tests/production/test_health.py -v
```

Expected: FAIL until the app registers only the approved routes.

- [ ] **Step 3: Implement exact route registration and health checks**

`create_app()` must install trusted-host validation, correlation middleware stub, exception boundary, and explicit routers. Do not use prefix-based public exemptions or CORS.

```python
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=list(settings.allowed_hosts),
)
app.include_router(auth_router)
app.add_api_route("/health/live", live, methods=["GET"])
app.add_api_route("/health/ready", ready, methods=["GET"])
```

`/health/live` returns only `{"status":"ok"}`. `/health/ready` is private and may check database/Redis but must not reveal DSNs, versions, or raw errors.

- [ ] **Step 4: Run tests**

```bash
pytest tests/production/test_composition.py tests/production/test_production_imports.py tests/production/test_health.py -v
```

Expected: PASS.

- [ ] **Step 5: Run the Plan 1 suite and static checks**

```bash
pytest tests/production -m "not network and not slow" -v
ruff check hosted tests/production
ruff format --check hosted tests/production
python -m build hosted
python -m pip check
```

Expected: all commands pass.

- [ ] **Step 6: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted tests/production
git commit -m "feat: enforce hosted production boundary"
```

## Plan 1 Completion Evidence

- [ ] `hosted` builds a wheel whose only top-level package is `tradebot_hosted`.
- [ ] Clean hosted import/startup loads no local sidecar, broker, keyring, or broker SDK module.
- [ ] Concurrent OIDC callbacks produce one exchange/session.
- [ ] Session and CSRF expiry/rotation/logout tests pass.
- [ ] PostgreSQL migration and runtime-role tests pass.
- [ ] Cross-tenant RLS and pooled transaction-context tests pass.
- [ ] Plan 1 focused tests, Ruff, build, and `pip check` pass.
- [ ] No commit is made without explicit user authorization.
