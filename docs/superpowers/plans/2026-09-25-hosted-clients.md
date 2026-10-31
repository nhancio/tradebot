# Hosted Clients Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the existing React UI and Electron shell to the hosted Google-authenticated, tenant-scoped web API and remove every production sidecar, broker, provider-setup, live-mode, and local-secret path.

**Architecture:** Browser and Electron load the same hosted React application and use one same-origin API client with an in-memory CSRF token. Server UUIDs replace local chat/stream IDs. The Electron main process loads one configured HTTPS origin, permits Google OIDC navigation only during an active transaction, and exposes no preload, filesystem, environment, shell, or Python bridge.

**Tech Stack:** React 18, Vite, Electron, Zustand, Vitest, React Testing Library, hosted FastAPI contracts from Plans 1–3

**Spec:** `docs/superpowers/specs/2026-09-25-production-security-design.md`

## Global Constraints

- Browser and Electron use the same hosted origin and relative API routes; no `127.0.0.1:8765`, `file://`, injected Electron stub, or production sidecar.
- Authentication is Google-only; no password/email input, client secret, ID token, refresh token, or brokerage credential in JavaScript.
- `GET /auth/session` is the sole session bootstrap; CSRF token is held in memory and sent only in `X-CSRF-Token` on unsafe methods.
- API requests use `credentials: include`, stable `{code,message,correlationId}` errors, and no raw response body/traceback exposure.
- Absolute URLs, scheme-relative `//host` paths, tenant IDs, live/broker fields, and user-selected provider/model/object keys are rejected.
- Every direct `fetch`/`EventSource` caller is removed; all network I/O uses one API client.
- Chat, alerts, analysis, reports, paper data, and financial state are server-owned; only theme preference may remain in local storage.
- Paper UI supports only long-only NSE/BSE `MARKET|LIMIT DAY` orders and sends one stable `Idempotency-Key` per logical submission.
- Production Electron uses `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, no preload, no webviews, and denies permissions.
- Packaged Electron loads one exact HTTPS origin; Google hosts are allowed only during an active OIDC transaction.
- No commit step runs unless the user explicitly authorizes commits.

## Review Focus

- CSRF/session tokens must never enter local/session storage, IndexedDB, URLs, logs, or error text.
- Conversation/analysis/job/paper/report IDs must come from the server; switching tabs or sessions must not reuse another object.
- A hostile main-frame, redirect, window-open, `file:`, `data:`, `javascript:`, credential-bearing, or custom-scheme URL must be denied.
- UI retry must reuse the same idempotency key for one order/job/report and generate a new key only for a new user action.
- Raw HTML reports, local filesystem paths, storage keys, and signed URLs must never enter renderer state or DOM.

---

### Task 1: Freeze the hosted route and response contract

**Files:**
- Create: `macos-app/src/renderer/src/lib/apiRoutes.js`
- Create: `macos-app/src/renderer/src/lib/apiSchemas.js`
- Create: `macos-app/src/__tests__/apiRoutes.test.js`
- Create: `tests/test_production_route_table.py`

**Interfaces:**
- Consumes: Plan 1 auth routes, Plan 2 product routes, Plan 3 paper routes.
- Produces: one route/DTO registry used by the API client and UI components.

- [ ] **Step 1: Write failing route-contract tests**

```javascript
import { routes } from '../src/renderer/src/lib/apiRoutes.js'

test('route registry contains no legacy or broker paths', () => {
  const serialized = JSON.stringify(routes)
  expect(serialized).not.toMatch(/broker|onboarding\/provider|telegram|live|127\.0\.0\.1/)
})
```

```python
def test_production_frontend_only_calls_registered_routes(frontend_route_scan, hosted_client):
    assert unregistered_frontend_routes(frontend_route_scan, hosted_client) == []
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
npm --prefix macos-app test -- apiRoutes.test.js
pytest tests/test_production_route_table.py -v
```

Expected: FAIL because the route registry does not exist and frontend has legacy calls.

- [ ] **Step 3: Implement route constants and bounded DTO readers**

```javascript
export const routes = Object.freeze({
  session: '/auth/session',
  googleStart: '/auth/google/start',
  logout: '/auth/logout',
  conversations: '/api/conversations',
  analysisJobs: '/api/analysis/jobs',
  jobs: '/api/jobs',
  alerts: '/api/alerts',
  reports: '/api/reports',
  paperAccount: '/api/paper/account',
  paperOrders: '/api/paper/orders',
  paperOrderCancel: (orderId) => `/api/paper/orders/${encodeURIComponent(orderId)}/cancel`,
  reportContent: (reportId) => `/api/reports/${encodeURIComponent(reportId)}/content`,
})
```

DTO readers reject unknown/missing critical IDs, non-integer paise fields, unsupported order enums, and raw HTML/path/storage fields.

- [ ] **Step 4: Run tests**

```bash
npm --prefix macos-app test -- apiRoutes.test.js
pytest tests/test_production_route_table.py -v
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Commit only if explicitly authorized:

```bash
git add macos-app/src/renderer/src/lib macos-app/src/__tests__/apiRoutes.test.js tests/test_production_route_table.py
git commit -m "feat: define hosted client api contract"
```

---

### Task 2: Add Google session provider and remove password auth

**Files:**
- Create: `macos-app/src/renderer/src/auth/sessionState.js`
- Create: `macos-app/src/renderer/src/auth/SessionProvider.jsx`
- Create: `macos-app/src/renderer/src/auth/GoogleSignIn.jsx`
- Modify: `macos-app/src/renderer/src/main.jsx`
- Modify: `macos-app/src/renderer/src/App.jsx:28-134`
- Delete or replace: `web/static/auth.html`
- Create: `macos-app/src/__tests__/authGate.test.jsx`

**Interfaces:**
- Consumes: Plan 1 `/auth/session`, OIDC start/callback, and deletion-pending status.
- Produces: in-memory auth state and Google sign-in/logout controls.

- [ ] **Step 1: Write failing auth-gate tests**

```javascript
test('anonymous user sees only Google sign-in', async () => {
  render(<SessionProvider fetchImpl={anonymousFetch}><App /></SessionProvider>)
  expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument()
  expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
})


test('session and csrf values never enter web storage', async () => {
  await bootstrapAuthenticatedSession()
  expect(localStorage.length).toBe(0)
  expect(sessionStorage.length).toBe(0)
})
```

- [ ] **Step 2: Run test and confirm failure**

```bash
npm --prefix macos-app test -- authGate.test.jsx
```

Expected: FAIL because the session provider does not exist.

- [ ] **Step 3: Implement session state**

```javascript
export const sessionStates = Object.freeze({
  LOADING: 'loading',
  ANONYMOUS: 'anonymous',
  AUTHENTICATED: 'authenticated',
  DELETION_PENDING: 'deletion_pending',
  ERROR: 'error',
})
```

`SessionProvider` deduplicates concurrent bootstrap calls, holds `user`, `csrfToken`, and expiry in React memory only, clears state on 401/logout, and does not persist tokens. Deletion-pending state never starts a login loop.

- [ ] **Step 4: Wire auth gate into the application**

Render loading, anonymous, deletion-pending, error, or workspace states. `GoogleSignIn` navigates to `/auth/google/start?return_to=${encodeURIComponent(window.location.pathname)}`; the server still validates the returned relative path. Remove current password page, inline scripts, `onclick`, and `onsubmit` auth code.

- [ ] **Step 5: Run tests**

```bash
npm --prefix macos-app test -- authGate.test.jsx
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Commit only if explicitly authorized:

```bash
git add macos-app/src/renderer/src/auth macos-app/src/renderer/src/App.jsx macos-app/src/renderer/src/main.jsx web/static/auth.html macos-app/src/__tests__/authGate.test.jsx
git commit -m "feat: add hosted google session gate"
```

---

### Task 3: Implement the single same-origin API client and migrate every request

**Files:**
- Create: `macos-app/src/renderer/src/lib/apiClient.js`
- Modify: `macos-app/src/renderer/src/hooks/useAPI.js`
- Modify: `macos-app/src/renderer/src/hooks/useMarketClock.js`
- Modify: `macos-app/src/renderer/src/components/Input/InputBar.jsx:208-339`
- Modify: `macos-app/src/renderer/src/components/Cards/StreamingAnalysisCard.jsx:529-609`
- Modify: `macos-app/src/renderer/src/components/Cards/AlertsCard.jsx:4-21`
- Create: `macos-app/src/__tests__/apiClient.test.js`
- Create: `macos-app/src/__tests__/hostedClientBoundary.test.js`

**Interfaces:**
- Consumes: Tasks 1–2 routes/session and Plan 2 NDJSON stream.
- Produces: `createApiClient()` and a compatibility `useAPI` wrapper.

- [ ] **Step 1: Write failing client tests**

```javascript
test('unsafe request includes in-memory csrf and credentials', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }))
  const client = createApiClient({ fetchImpl })
  await client.bootstrapSession({ csrfToken: 'csrf' })
  await client.post(routes.logout)

  expect(fetchImpl).toHaveBeenLastCalledWith('/auth/logout', expect.objectContaining({
    credentials: 'include',
    headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf' }),
  }))
})


test('absolute and scheme-relative paths are rejected', async () => {
  const client = createApiClient({ fetchImpl: vi.fn() })
  await expect(client.get('https://evil.example')).rejects.toThrow('relative path')
  await expect(client.get('//evil.example')).rejects.toThrow('relative path')
})
```

Add bootstrap deduplication, 401 clear, no CSRF replay, idempotency forwarding, split NDJSON chunks, abort, and stable error tests.

- [ ] **Step 2: Run tests and confirm failure**

```bash
npm --prefix macos-app test -- apiClient.test.js hostedClientBoundary.test.js
```

Expected: FAIL because current callers use direct fetch/base-port logic.

- [ ] **Step 3: Implement API client**

```javascript
export function createApiClient({ fetchImpl = globalThis.fetch, onUnauthorized }) {
  let session = null
  let bootstrapPromise = null

  function headers(method, options = {}) {
    const result = new Headers(options.headers)
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase()) && session?.csrfToken) {
      result.set('X-CSRF-Token', session.csrfToken)
    }
    if (options.idempotencyKey) result.set('Idempotency-Key', options.idempotencyKey)
    return result
  }

  return { bootstrapSession, get, post, delete: remove, stream, download, clearSession }
}
```

Parse stable error JSON only, include correlation ID, and never expose raw response text. Parse `application/x-ndjson` from `ReadableStream`; no `EventSource`.

- [ ] **Step 4: Migrate every direct network caller**

Remove direct `fetch`, local base URL, sidecar port, broker status polling, and report path handling. `useAPI` becomes a thin wrapper or is deleted after all callers use `apiClient`.

- [ ] **Step 5: Run tests and source scan**

```bash
npm --prefix macos-app test -- apiClient.test.js hostedClientBoundary.test.js
```

The source scan must find none of:

```text
new EventSource
127.0.0.1:8765
window.electronAPI
__INDIA_TRADE_WEB__
/api/status
/api/broker
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Commit only if explicitly authorized:

```bash
git add macos-app/src/renderer/src macos-app/src/__tests__ tests/test_frontend_production_boundary.py
git commit -m "feat: use one hosted api client"
```

---

### Task 4: Remove production sidecar, provider, broker, live, and setup UI

**Files:**
- Delete from production build: `macos-app/src/renderer/src/components/SetupScreen.jsx`
- Delete from production build: `macos-app/src/renderer/src/components/Onboarding/ProviderStep.jsx`
- Delete from production build: `macos-app/src/renderer/src/components/Onboarding/MarketDataStep.jsx`
- Delete from production build: `macos-app/src/renderer/src/components/Sidebar/BrokerPanel.jsx`
- Delete from production build: `macos-app/src/renderer/src/components/Sidebar/SettingsPanel.jsx`
- Delete from production build: `macos-app/src/renderer/src/components/Cards/ProviderCard.jsx`
- Delete from production build: `macos-app/src/renderer/src/components/Cards/TelegramCard.jsx`
- Modify: `macos-app/src/renderer/src/components/Onboarding/OnboardingWizard.jsx`
- Create: `macos-app/src/renderer/src/components/Onboarding/PaperOnboarding.jsx`
- Create: `macos-app/src/__tests__/paperOnboarding.test.jsx`

**Interfaces:**
- Consumes: Plan 2 settings API and Plan 3 paper account API.
- Produces: paper-only capital/risk onboarding with no credential/setup controls.

- [ ] **Step 1: Write failing onboarding/source tests**

```javascript
test('paper onboarding exposes no live or credential controls', () => {
  render(<PaperOnboarding api={fakePaperApi} />)
  expect(screen.getByText(/paper trading/i)).toBeInTheDocument()
  expect(screen.queryByText(/live/i)).not.toBeInTheDocument()
  expect(screen.queryByLabelText(/api key|password|broker|webhook|telegram/i)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run test and confirm failure**

```bash
npm --prefix macos-app test -- paperOnboarding.test.jsx
```

Expected: FAIL because old wizard remains.

- [ ] **Step 3: Implement paper-only onboarding**

Starting capital is selected once in INR 10,000–10,000,000, defaults to INR 1,000,000, and cannot be changed later. Risk selection is bounded server-side. Submit through shared client with CSRF. Remove provider, package manager, broker, OAuth, webhook, Telegram, custom endpoint, and live controls from the production entry graph.

- [ ] **Step 4: Run tests**

```bash
npm --prefix macos-app test -- paperOnboarding.test.jsx hostedClientBoundary.test.js
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Commit only if explicitly authorized:

```bash
git add macos-app/src/renderer/src/components macos-app/src/__tests__/paperOnboarding.test.jsx
git commit -m "feat: remove hosted broker onboarding"
```

---

### Task 5: Make chat and analysis server-owned

**Files:**
- Modify: `macos-app/src/renderer/src/store/chatStore.js:3-226`
- Modify: `macos-app/src/renderer/src/components/Sidebar/index.jsx:29-130`
- Modify: `macos-app/src/renderer/src/components/Input/InputBar.jsx`
- Modify: `macos-app/src/renderer/src/components/Cards/StreamingAnalysisCard.jsx`
- Modify: `macos-app/src/__tests__/chatStore.test.js:188-243`
- Modify: `macos-app/src/__tests__/parseCommand.test.js:3-5,403-435`
- Create: `macos-app/src/__tests__/conversationStore.test.js`

**Interfaces:**
- Consumes: Plan 2 conversation/analysis/job/progress APIs.
- Produces: asynchronous server-backed Zustand store using server UUIDs.

- [ ] **Step 1: Write failing conversation tests**

```javascript
test('chat store hydrates server conversation ids and no local sess ids', async () => {
  const store = createChatStore(api)
  await store.getState().hydrateConversations()
  expect(store.getState().sessions[0].id).toBe('11111111-1111-4111-8111-111111111111')
  expect(JSON.stringify(store.getState())).not.toContain('sess-')
})
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
npm --prefix macos-app test -- conversationStore.test.js chatStore.test.js
```

Expected: FAIL because store creates local IDs.

- [ ] **Step 3: Convert store actions to server calls**

Store actions:

```text
hydrateConversations()
createConversation()
selectConversation(conversationId)
deleteConversation(conversationId)
appendMessage(conversationId, content)
startAnalysisJob(payload)
cancelJob(jobId)
hydrateAnalysis(analysisId)
```

Remove `port`, `sidecarError`, broker status, local `sess-*`, stream callbacks, and persisted message/financial state. Cancel active streams when switching/logging out.

- [ ] **Step 4: Update input/follow-up components**

Send `conversation_id`; render pending user messages; attach returned job/assistant message. Follow-ups send `analysis_id` plus question, not full report context or symbol-derived session IDs. Import the real command parser in its test.

- [ ] **Step 5: Run tests**

```bash
npm --prefix macos-app test -- conversationStore.test.js chatStore.test.js parseCommand.test.js
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Commit only if explicitly authorized:

```bash
git add macos-app/src/renderer/src/store macos-app/src/renderer/src/components/Input macos-app/src/renderer/src/components/Cards/StreamingAnalysisCard.jsx macos-app/src/renderer/src/components/Sidebar macos-app/src/__tests__
git commit -m "feat: move chat and analysis to hosted api"
```

---

### Task 6: Add tenant workspace panels for paper, alerts, analysis, and reports

**Files:**
- Create: `macos-app/src/renderer/src/components/Workspace/WorkspaceView.jsx`
- Create: `macos-app/src/renderer/src/components/Workspace/PaperAccountPanel.jsx`
- Create: `macos-app/src/renderer/src/components/Workspace/AlertsPanel.jsx`
- Create: `macos-app/src/renderer/src/components/Workspace/AnalysisHistoryPanel.jsx`
- Create: `macos-app/src/renderer/src/components/Workspace/ReportsPanel.jsx`
- Create: `macos-app/src/__tests__/paperOrder.test.jsx`
- Create: `macos-app/src/__tests__/alertsPanel.test.jsx`
- Create: `macos-app/src/__tests__/reportsPanel.test.jsx`

**Interfaces:**
- Consumes: Plan 2 alerts/analysis/reports APIs and Plan 3 paper APIs.
- Produces: tenant-owned browser/Electron workspace UI.

- [ ] **Step 1: Write failing panel tests**

```javascript
test('paper submit uses one idempotency key while pending', async () => {
  const api = fakeApi()
  render(<PaperAccountPanel api={api} />)
  await submitOrder({ side: 'BUY', type: 'LIMIT', quantity: 1 })
  await submitOrder({ side: 'BUY', type: 'LIMIT', quantity: 1 })
  expect(api.paperKeys).toHaveLength(1)
})


test('report panel never renders html or object key', async () => {
  render(<ReportsPanel api={fakeReportApi} />)
  expect(screen.queryByText(/<script|object_key|report_path/i)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
npm --prefix macos-app test -- paperOrder.test.jsx alertsPanel.test.jsx reportsPanel.test.jsx
```

Expected: FAIL because panels do not exist.

- [ ] **Step 3: Implement paper panel**

Display starting capital, cash/reserved cash, P&L, marked equity, positions, order states, and daily-loss/risk status using integer paise from DTOs. Paper form permits only allowed enums, positive whole quantity, and server symbol. Disable duplicate submit while pending; reuse the key for network retries and create a new key only after a new user submission.

- [ ] **Step 4: Implement alerts/analysis panels**

Alerts list/create/delete/events without webhook controls. Analysis history lists job/analysis state and links tenant-owned reports. Keep React text rendering; add a source guard against `dangerouslySetInnerHTML` and raw report HTML.

- [ ] **Step 5: Implement reports panel**

Start PDF/JSON report jobs, list metadata/expiry, download through same-origin API, and delete after confirmation. Never render HTML, iframe it, use `window.open`, expose a storage key, or accept a filesystem path.

- [ ] **Step 6: Run tests**

```bash
npm --prefix macos-app test -- paperOrder.test.jsx alertsPanel.test.jsx reportsPanel.test.jsx
```

Expected: PASS.

- [ ] **Step 7: Checkpoint**

Commit only if explicitly authorized:

```bash
git add macos-app/src/renderer/src/components/Workspace macos-app/src/__tests__
git commit -m "feat: add hosted tenant workspace"
```

---

### Task 7: Implement Electron origin, OIDC navigation, CSP, and permission policies

**Files:**
- Create: `macos-app/src/main/appConfig.js`
- Create: `macos-app/src/main/originPolicy.js`
- Create: `macos-app/src/main/securityPolicy.js`
- Create: `macos-app/src/__tests__/originPolicy.test.js`
- Create: `macos-app/src/__tests__/securityPolicy.test.js`

**Interfaces:**
- Consumes: packaged/development origin and Plan 1 OIDC paths.
- Produces: pure policy functions consumed by Electron main in Task 8.

- [ ] **Step 1: Write failing policy tests**

```javascript
test('google host is allowed only during oidc', () => {
  expect(classifyNavigation('https://accounts.google.com/o/oauth2/v2/auth', {
    appOrigin: APP_ORIGIN,
    oidcInProgress: true,
  })).toBe('google')
  expect(classifyNavigation('https://accounts.google.com/evil', {
    appOrigin: APP_ORIGIN,
    oidcInProgress: false,
  })).toBe('deny')
})
```

Reject `accounts.google.com.evil.example`, HTTP Google in production, credential-bearing URLs, unexpected ports, `file:`, `data:`, `javascript:`, and custom schemes.

- [ ] **Step 2: Run tests and confirm failure**

```bash
npm --prefix macos-app test -- originPolicy.test.js securityPolicy.test.js
```

Expected: FAIL because policy modules do not exist.

- [ ] **Step 3: Implement pure origin policy**

```javascript
export function resolveAppOrigin({ isPackaged, packagedOrigin, developmentOrigin }) {
  const value = new URL(isPackaged ? packagedOrigin : developmentOrigin)
  if (isPackaged && value.protocol !== 'https:') throw new Error('packaged origin must be HTTPS')
  if (value.username || value.password || value.search || value.hash) throw new Error('invalid origin')
  return value.origin
}

export function classifyNavigation(url, { appOrigin, oidcInProgress }) {
  const parsed = new URL(url)
  if (parsed.origin === appOrigin) return 'app'
  if (oidcInProgress && GOOGLE_OIDC_HOSTS.has(parsed.origin)) return 'google'
  return 'deny'
}
```

- [ ] **Step 4: Implement permission/webContents policies**

Deny all permission requests/checks, webviews, unexpected attachments, and unapproved new windows. New HTTPS windows are denied in v1; the main app stays on its configured origin.

- [ ] **Step 5: Add CSP/security headers**

Use:

```text
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:;
font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none';
frame-ancestors 'none'; form-action 'self' https://accounts.google.com
```

Also require HSTS after HTTPS verification, `nosniff`, anti-framing, strict referrer, and permissions policies from Plan 5 edge/app layers. Convert current production inline `style` attributes in reusable cards to CSS classes before enabling this CSP; the production build must not require `style-src 'unsafe-inline'`.

- [ ] **Step 6: Run tests**

```bash
npm --prefix macos-app test -- originPolicy.test.js securityPolicy.test.js
```

Expected: PASS.

- [ ] **Step 7: Checkpoint**

Commit only if explicitly authorized:

```bash
git add macos-app/src/main macos-app/src/__tests__/originPolicy.test.js macos-app/src/__tests__/securityPolicy.test.js
git commit -m "feat: enforce electron origin policy"
```

---

### Task 8: Remove sidecar/preload/Python resources and rewrite Electron main

**Files:**
- Modify: `macos-app/src/main/index.js:1-199`
- Delete: `macos-app/src/main/pythonBootstrap.js`
- Delete: `macos-app/src/preload/index.js`
- Modify: `macos-app/electron.vite.config.mjs:4-16`
- Modify: `macos-app/package.json:8-64`
- Delete: `web/static/electron-stubs.js`
- Modify: `macos-app/scripts/build-web.js:46-68`
- Create: `macos-app/src/__tests__/mainProcessSecurity.test.js`
- Create: `macos-app/src/__tests__/buildWeb.test.js`

**Interfaces:**
- Consumes: Task 7 policies.
- Produces: hosted thin Electron shell and unsigned app content for Plan 5 signing.

- [ ] **Step 1: Write failing source/package tests**

```javascript
test('packaged main has no sidecar, preload, ipc, shell, or python imports', () => {
  const source = readFileSync('src/main/index.js', 'utf8')
  for (const forbidden of ['spawn', 'ipcMain', 'pythonBootstrap', 'ensurePythonEnv', 'preload']) {
    expect(source).not.toContain(forbidden)
  }
})


test('hosted build injects no electron stubs', () => {
  const output = runBuildWeb()
  expect(output).not.toContain('electron-stubs.js')
  expect(output).not.toContain('127.0.0.1:8765')
})
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
npm --prefix macos-app test -- mainProcessSecurity.test.js buildWeb.test.js
```

Expected: FAIL because current main starts Python and preload exists.

- [ ] **Step 3: Rewrite BrowserWindow setup**

```javascript
const window = new BrowserWindow({
  webPreferences: {
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
  },
})
window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
```

In production call `loadURL(configuredHttpsOrigin)`, not `loadFile`. Track OIDC state from app-origin `/auth/google/start` navigation and clear on callback/error/timeout. Apply Task 7 navigation/redirect policy.

- [ ] **Step 4: Remove sidecar/build seams**

Remove Python prebuild/wheel, `python-pkg` extra resource, preload build entry, sidecar events/tray bridge, injected web stub, and all renderer `electronAPI` references. `build:unsigned` builds the hosted shell only.

- [ ] **Step 5: Run tests/build**

```bash
npm --prefix macos-app test -- mainProcessSecurity.test.js buildWeb.test.js
npm --prefix macos-app run build:unsigned
npm --prefix macos-app run build:web
```

Expected: PASS; unsigned package contains no wheel/source bootstrap/local API process.

- [ ] **Step 6: Checkpoint**

Commit only if explicitly authorized:

```bash
git add macos-app web/static/electron-stubs.js
git commit -m "feat: make electron a hosted thin client"
```

---

### Task 9: Add integration, import, report, and clean-build gates

**Files:**
- Create: `hosted/src/tradebot_hosted/static.py`
- Modify: `hosted/src/tradebot_hosted/app.py`
- Create: `macos-app/src/__tests__/hostedIntegration.test.jsx`
- Create: `tests/test_frontend_production_boundary.py`
- Create: `tests/test_production_import_denylist.py`
- Create: `tests/test_report_artifacts.py`
- Modify: `.github/workflows/ci.yml:68-87`
- Modify: `README.md:145-152,266-274,323-336,419-423`

**Interfaces:**
- Consumes: Plans 1–3 hosted contracts and Tasks 1–8 client behavior.
- Produces: Plan 5 clean frontend/desktop artifact evidence.

- [ ] **Step 1: Write failing end-to-end client tests**

```javascript
test('google user signs in, creates conversation, and submits one paper order', async () => {
  const harness = await createHostedHarness({ tenantId: TENANT_A })
  await harness.signInGoogle()
  const conversation = await harness.createConversation()
  await harness.sendMessage(conversation.id, 'Analyze RELIANCE')
  await harness.submitPaperOrder({ symbol: 'RELIANCE', side: 'BUY', quantity: 1 })
  expect(harness.requests.filter((request) => request.path === '/api/paper/orders')).toHaveLength(1)
})
```

Use Plan 1/2/3 test servers, not mocks, for route/session/tenant contracts.

- [ ] **Step 2: Run tests and confirm failure**

```bash
npm --prefix macos-app test -- hostedIntegration.test.jsx
pytest tests/test_frontend_production_boundary.py tests/test_production_import_denylist.py tests/test_report_artifacts.py -v
```

Expected: FAIL until all client/hosted routes align.

- [ ] **Step 3: Serve the built React app from the hosted origin**

Update `build-web.js` to copy sorted, normalized production assets into `hosted/src/tradebot_hosted/static/` for the hosted wheel. Add a production static/SPA router that serves hashed assets from that packaged directory, returns `index.html` only for approved SPA routes, and never maps a request path directly to the filesystem. Mount the router after all API/auth routes. Static responses receive the same CSP/security headers; authenticated/API responses remain `no-store`. Do not mount legacy `web/static/auth.html` or inject Electron stubs.

- [ ] **Step 4: Add source/artifact boundary assertions**

Fail if production renderer/main contains:

```text
fetch(
new EventSource
electronAPI
127.0.0.1:8765
file://
__INDIA_TRADE_WEB__
/api/status
/api/onboarding/provider
/api/broker
dangerouslySetInnerHTML
```

except the single `apiClient` fetch implementation and approved test fixtures.

- [ ] **Step 5: Add report/tenant integration tests**

User A cannot read/download/delete User B's report. PDF has attachment disposition and `nosniff`; JSON contains no HTML/path/key. Logs/errors contain no signed material.

- [ ] **Step 6: Update CI and user-facing docs**

Run frontend tests/build in CI. Remove hosted docs for sidecar startup, broker panels, unauthenticated `/skills/*`, live trading, and Gatekeeper bypass. Local CLI/sidecar docs, if retained, must be labeled local-development-only and separate from hosted production.

- [ ] **Step 7: Run Plan 4 verification**

```bash
npm --prefix macos-app ci
npm --prefix macos-app test
npm --prefix macos-app run build:unsigned
npm --prefix macos-app run build:web
pytest tests/test_frontend_production_boundary.py tests/test_production_import_denylist.py tests/test_report_artifacts.py -v
pytest -m "not network and not slow"
ruff check .
ruff format --check .
python -m build hosted
```

Expected: PASS.

- [ ] **Step 8: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/static.py hosted/src/tradebot_hosted/app.py macos-app .github/workflows/ci.yml README.md tests
git commit -m "feat: verify hosted web and desktop clients"
```

## Plan 4 Completion Evidence

- [ ] Browser and Electron use one relative same-origin API client.
- [ ] Google auth, in-memory session/CSRF, logout, and deletion-pending UI pass.
- [ ] No production source contains direct fetch/EventSource outside `apiClient`.
- [ ] Sidecar, provider setup, broker, live, Telegram, Python bootstrap, and preload paths are absent from production artifacts.
- [ ] Chat/analysis/alerts/reports/paper UI use server IDs and tenant APIs.
- [ ] Paper/report retries preserve idempotency and do not duplicate actions.
- [ ] Electron origin/OIDC/sandbox/permission policies pass adversarial tests.
- [ ] Unsigned app and hosted web builds are clean and sidecar-free.
- [ ] Plan 4 tests, frontend build, hosted build, Ruff, and full fast tests pass.
- [ ] No commit is made without explicit user authorization.
