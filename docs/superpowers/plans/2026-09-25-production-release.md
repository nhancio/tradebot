# Production Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package and operate the hosted system as a reproducible, broker-free, monitored, recoverable, signed, and fail-closed production release with security CI, restore drills, staging synthetic tenants, and a monitored 24-hour canary.

**Architecture:** The hosted wheel is built from a clean reviewed commit and deployed as a minimal non-root image with separate API and worker commands. Caddy is the only public ingress; PostgreSQL/Redis/object storage remain private. Release evidence is bound to one commit through a canonical manifest covering migrations, scans, SBOM/provenance, unsigned and signed macOS artifacts, restore, staging, canary, and rollback.

**Tech Stack:** Docker/Compose, Caddy, GitHub Actions, CodeQL, gitleaks, pip-audit, npm audit, Trivy, CycloneDX/Syft, BuildKit provenance, Apple codesign/notarytool/stapler, Python/Node/Ruff/pytest

**Spec:** `docs/superpowers/specs/2026-09-25-production-security-design.md`

## Global Constraints

- Plans 1–4 must be complete before production release work begins.
- The current application source and lockfiles must be reviewed, tracked, and buildable from a clean checkout before a release candidate.
- Historical broker/API credentials must be revoked/rotated before release; history rewriting requires separate explicit user authorization.
- Production has no real-money execution, broker OAuth, broker SDK, live route, local sidecar, user provider endpoint, or public Telegram.
- Caddy is the only public ingress; API, worker, PostgreSQL, Redis, object storage, readiness, and metrics remain private.
- Production secrets are injected from managed secret storage; no production `.env`, keychain, interactive prompt, or CLI secret.
- Python dependencies are exact and hash-locked; base images and GitHub actions are pinned by digest/full SHA.
- Migrations are forward-only and run in a one-shot migration job after a successful backup; application startup never migrates.
- Rollback changes image/feature flags only and never runs Alembic downgrade.
- Restore remains isolated until deletion-manifest scrubbing and all database/object/RLS/order checks pass.
- RPO is at most 15 minutes; RTO is at most four hours.
- Canary runs at least 86,400 seconds with zero security/order/data-integrity violations before promotion.
- No unresolved Critical/High scan finding, failed test/migration/restore, unsigned macOS artifact, missing provenance, or unapproved privacy/data/market-data use can be waived.
- Do not execute commit steps unless the user explicitly authorizes commits in the execution session.

## Review Focus

- Production image must contain only the hosted wheel/runtime/assets and no source, compiler, shell administration tooling, `.env`, broker SDK, or sidecar entry point.
- Unknown Host, readiness/metrics, oversized/slow requests, HTTP, and query/header logging must fail closed at Caddy.
- Backup restore must not resurrect a deleted identity, tenant, session, report object, idempotency record, or order.
- Exact release commit, wheel, image digest, unsigned app tree, signed app/DMG, SBOM, provenance, and evidence must all match one manifest.
- Canary rollback must trigger immediately on any tenant leak, duplicate/lost order, integrity mismatch, failed backup/migration, 5xx threshold, or stale job backlog.

---

### Task 1: Add release preflight and freeze the reviewed source

**Files:**
- Create: `release/manifest-v1.schema.json`
- Create: `scripts/release/preflight.py`
- Create: `tests/release/test_preflight.py`

**Interfaces:**
- Consumes: Git state, expected release manifest, Alembic head, and evidence references.
- Produces: `preflight(manifest, require_clean, require_source_tracked)` for every later release task.

- [ ] **Step 1: Write failing preflight tests**

```python
def test_preflight_rejects_untracked_production_source(tmp_repo, manifest):
    (tmp_repo / "hosted/src/tradebot_hosted/new_module.py").write_text("x = 1\n")
    with pytest.raises(ReleaseError, match="untracked production source"):
        preflight(tmp_repo, manifest, require_clean=True, require_source_tracked=True)


def test_preflight_never_prints_secret_values(tmp_repo, manifest, capsys):
    result = preflight(tmp_repo, manifest, require_clean=True, require_source_tracked=True)
    assert SECRET_SENTINEL not in capsys.readouterr().out
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/release/test_preflight.py -v
```

Expected: FAIL because preflight does not exist.

- [ ] **Step 3: Implement strict preflight**

Validate:

- exact Git commit and clean tree
- no untracked non-ignored production source
- committed root/macOS lockfiles
- exact expected Alembic head
- manifest schema/version/commit
- required scan/SBOM/provenance/staging/restore/canary evidence references
- no default/blank release secret names

The script reads metadata, not secret values. Exit nonzero on any mismatch.

- [ ] **Step 4: Run tests**

```bash
pytest tests/release/test_preflight.py -v
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

This task will intentionally fail against the current repository until the user explicitly authorizes tracking/committing the reviewed source. Do not auto-stage, commit, push, or rewrite history.

---

### Task 2: Add production secret loading and harden legacy local secret files

**Files:**
- Create: `hosted/src/tradebot_hosted/secrets.py`
- Create: `config/secure_files.py`
- Create: `scripts/security/harden_local_secrets.py`
- Modify: `brokers/zerodha.py:49-58`
- Modify: `brokers/fyers.py:256-265`
- Modify: `brokers/groww.py:172-176`
- Modify: `brokers/upstox.py:89-98`
- Modify: `brokers/angelone.py:151-166`
- Modify: `.gitignore`
- Modify: `.dockerignore`
- Create: `tests/production/test_secrets.py`
- Create: `tests/test_secure_files.py`

**Interfaces:**
- Consumes: Plan 1 settings and a private `/run/secrets` directory.
- Produces: redacted `ProductionSecrets`, atomic `write_private_text`, and explicit ignore policy.

- [ ] **Step 1: Write failing secret tests**

```python
def test_settings_repr_never_contains_secret_values():
    secrets = ProductionSecrets.from_directory(tmp_path)
    assert "super-secret" not in repr(secrets)


def test_private_writer_creates_0600_file_in_0700_directory(tmp_path):
    path = write_private_text(tmp_path / "token.json", '{"token":"x"}')
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert stat.S_IMODE(path.parent.stat().st_mode) == 0o700
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_secrets.py tests/test_secure_files.py -v
```

Expected: FAIL because secure loading/writing does not exist.

- [ ] **Step 3: Implement managed secret loading**

Required files include database/Redis URLs, OIDC secret, HMAC keys, `fyers_data_app_id`, `fyers_data_access_token`, object-store credentials, and enabled platform AI key. Reject missing/default/blank values, file mode broader than `0600`, directory mode broader than `0700`, `.env`, keychain, interactive prompt, broker execution credentials, and custom AI base URLs.

- [ ] **Step 4: Implement atomic private writer and migrate token writers**

`write_private_text()` creates a private parent, writes a same-directory temporary file with `0600`, `fsync`s, and atomically replaces the target without widening permissions. Migrate every listed broker token writer and local onboarding `.env` write.

- [ ] **Step 5: Update ignore policy**

Exclude managed secret directories, Apple certificates/profiles/private keys, local data/logs, evidence outputs, and test artifacts. Do not ignore committed lockfiles, SBOMs, or release evidence selected for retention.

- [ ] **Step 6: Run tests**

```bash
pytest tests/production/test_secrets.py tests/test_secure_files.py -v
```

Expected: PASS.

- [ ] **Step 7: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/secrets.py config/secure_files.py scripts/security/harden_local_secrets.py brokers .gitignore .dockerignore tests/production/test_secrets.py tests/test_secure_files.py
git commit -m "fix: protect production and local secrets"
```

---

### Task 3: Lock production dependencies and build a minimal image

**Files:**
- Modify: `hosted/pyproject.toml`
- Create: `hosted/requirements/production.in`
- Create: `hosted/requirements/production.lock`
- Create: `hosted/requirements/ci.in`
- Create: `hosted/requirements/ci.lock`
- Create: `scripts/dependencies/lock.sh`
- Create: `docker/Dockerfile.production`
- Create: `docker/Dockerfile.production.dockerignore`
- Create: `tests/packaging/test_production_dependencies.py`
- Create: `tests/packaging/test_production_wheel.py`
- Create: `tests/packaging/test_production_image.py`

**Interfaces:**
- Consumes: Plans 1–3 hosted package and Plan 5 Task 2 secrets.
- Produces: hash-locked hosted wheel, wheelhouse, and production OCI image.

- [ ] **Step 1: Write failing dependency/image tests**

```python
def test_production_lock_has_exact_versions_and_hashes():
    requirements = parse_requirements("hosted/requirements/production.lock")
    assert all("==" in line for line in requirements)
    assert all("--hash=sha256:" in line for line in requirements)


def test_image_contains_no_broker_or_local_modules(production_image):
    files = inspect_image_files(production_image)
    assert not any(path.startswith(("brokers/", "bot/", "ui/", "web/")) for path in files)
    assert not any(name.endswith((".whl", ".env")) for name in files)
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/packaging/test_production_dependencies.py tests/packaging/test_production_wheel.py tests/packaging/test_production_image.py -m "not network" -v
```

Expected: FAIL because lock/image files do not exist.

- [ ] **Step 3: Generate canonical hash locks**

Use a hash-locked `pip-tools` environment. `production.in` is derived from hosted metadata; `ci.in` adds only pytest/Ruff/build/test tools. `lock.sh` regenerates and fails on diff. `requirements.txt` remains local-only and cannot be a production input.

- [ ] **Step 4: Build multi-stage production image**

Pin Python and any build/runtime base images by digest. Use web builder, wheel builder, wheelhouse, and final non-root distroless/minimal Python stages. Copy only installed locked runtime, hosted wheel metadata, migrations, committed reference/calendar/fee configuration, and hosted web assets. Expose no source, tests, compiler, package installer, shell administration tools, `.env`, broker SDK, or local entry point.

API and worker use the same image with different commands:

```text
uvicorn tradebot_hosted.app:create_app --factory --host 0.0.0.0 --port 8765 --no-access-log
tradebot-hosted-worker
```

- [ ] **Step 5: Run packaging tests/build**

```bash
python -m build hosted
pip install --require-hashes -r hosted/requirements/production.lock
python -m pip check
pytest tests/packaging -m "not network" -v
docker build -f docker/Dockerfile.production -t tradebot-hosted:test .
```

Expected: PASS; production image has no shell/package manager and imports only hosted modules.

- [ ] **Step 6: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/pyproject.toml hosted/requirements scripts/dependencies docker/Dockerfile.production docker/Dockerfile.production.dockerignore tests/packaging
git commit -m "build: lock and package hosted production image"
```

---

### Task 4: Enforce private Compose networking and Caddy policy

**Files:**
- Modify: `docker/docker-compose.yml`
- Modify: `docker/docker-compose.prod.yml`
- Modify: `docker/Caddyfile`
- Create: `docker/production.env.example`
- Create: `scripts/deploy/verify_network_policy.sh`
- Modify: `tests/test_docker_config.py`
- Create: `tests/ops/test_compose_security.py`
- Create: `tests/ops/test_caddy_policy.py`

**Interfaces:**
- Consumes: Task 3 image and Plans 1–3 health/migration routes.
- Produces: `edge`, private `data`, and restricted `egress` networks plus Caddy security policy.

- [ ] **Step 1: Write failing rendered-Compose/Caddy tests**

```python
def test_only_caddy_publishes_public_ports(compose_config):
    published = {service: config.get("ports", []) for service, config in compose_config["services"].items()}
    assert set(published) == {"edge"}
    assert not compose_config["services"]["api"].get("ports")
    assert not compose_config["services"]["worker"].get("ports")


def test_worker_is_not_on_edge_network(compose_config):
    assert "edge" not in compose_config["services"]["worker"]["networks"]
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
docker compose -f docker/docker-compose.yml config --format json > /tmp/compose.json
pytest tests/ops/test_compose_security.py tests/ops/test_caddy_policy.py -v
```

Expected: FAIL against legacy one-service topology.

- [ ] **Step 3: Implement production Compose topology**

Services:

- `edge`: Caddy only, publishes 80/443
- `migrate`: one-shot migration, data network only
- `api`: private app/data/egress, no published port
- `worker`: private app/data/egress, never edge

Use immutable image references, read-only root filesystem, tmpfs `/tmp` with `noexec,nosuid,nodev`, `cap_drop: [ALL]`, `no-new-privileges`, pids/CPU/memory limits, bounded logs, and no production `env_file` or writable app volume.

- [ ] **Step 4: Implement Caddy policy**

Require configured domain; redirect only that HTTP host to HTTPS; reject unknown Host; block `/health/ready` and `/metrics`; enable HSTS after verified HTTPS; set CSP/anti-framing/nosniff/referrer/permissions; cap body/header/timeouts; and omit query strings/auth/session/signed URL data from logs.

- [ ] **Step 5: Implement egress verification**

Verify metadata/private/public targets are denied and approved Google/Fyers/AI/object-store endpoints are reachable. The script records evidence but does not replace VM/provider firewall enforcement.

- [ ] **Step 6: Run tests**

```bash
docker compose -f docker/docker-compose.yml config
docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml config
pytest tests/ops/test_compose_security.py tests/ops/test_caddy_policy.py -v
```

Expected: PASS.

- [ ] **Step 7: Checkpoint**

Commit only if explicitly authorized:

```bash
git add docker scripts/deploy/verify_network_policy.sh tests/test_docker_config.py tests/ops
git commit -m "security: enforce private production network"
```

---

### Task 5: Add readiness, migration gate, and non-committing deployment commands

**Files:**
- Modify: `hosted/src/tradebot_hosted/health.py`
- Modify: `hosted/src/tradebot_hosted/worker.py`
- Create: `scripts/deploy/migrate.sh`
- Replace: `scripts/deploy.sh`
- Remove from hosted path: auto-commit/push behavior in `deploy.sh`
- Create: `tests/production/test_health.py`
- Create: `tests/ops/test_migration_gate.py`
- Create: `tests/ops/test_deploy_script.py`

**Interfaces:**
- Consumes: Plan 1 readiness, Plan 2 worker heartbeat, Plans 1–3 Alembic head.
- Produces: canonical `validate`, `migrate`, `up`, `verify`, `cohort`, and `rollback` deploy commands.

- [ ] **Step 1: Write failing health/deploy tests**

```python
def test_deploy_never_downgrades_schema():
    source = Path("scripts/deploy.sh").read_text()
    assert "alembic downgrade" not in source
    assert "git commit" not in source
    assert "git push" not in source


async def test_ready_fails_on_schema_mismatch(health):
    health.expected_revision = "expected"
    health.current_revision = "other"
    assert (await health.ready()).status_code == 503
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/production/test_health.py tests/ops/test_migration_gate.py tests/ops/test_deploy_script.py -v
```

Expected: FAIL until production health/deploy are implemented.

- [ ] **Step 3: Implement liveness/readiness and worker heartbeat**

`/health/live` returns exact `{"status":"ok"}` without dependency checks. Private `/health/ready` verifies runtime initialization/shutdown, PostgreSQL, exact Alembic head, Redis reconciliation state, object store, and no broker/live/raw-gateway registration. Worker readiness requires a fresh job-loop heartbeat. No DSN, host, version, or raw error is public.

- [ ] **Step 4: Implement migration gate**

`scripts/deploy/migrate.sh release/release-manifest.json` validates the manifest commit and exact Alembic head, rejects multiple heads/dirty revision, upgrades to the manifest's single exact head, runs `alembic current` and `alembic check`, and prints revision/status only. API/worker never run DDL.

- [ ] **Step 5: Implement non-committing deploy CLI**

Order: validate manifest/scans -> verify latest backup -> migrate -> start API/worker -> wait private readiness -> set cohort -> verify. `deploy.sh` never stages, commits, pushes, builds a mutable image, or downgrades schema.

- [ ] **Step 6: Run tests**

```bash
pytest tests/production/test_health.py tests/ops/test_migration_gate.py tests/ops/test_deploy_script.py -v
```

Expected: PASS.

- [ ] **Step 7: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/health.py hosted/src/tradebot_hosted/worker.py scripts/deploy.sh scripts/deploy/migrate.sh tests/production/test_health.py tests/ops
git commit -m "build: add gated production deployment"
```

---

### Task 6: Add redacted observability, private metrics, and alert rules

**Files:**
- Create: `hosted/src/tradebot_hosted/observability.py`
- Create: `hosted/src/tradebot_hosted/metrics.py`
- Create: `config/observability/alerts.yml`
- Create: `tests/observability/test_redaction.py`
- Create: `tests/observability/test_correlation_id.py`
- Create: `tests/observability/test_metrics.py`
- Create: `tests/security/test_secret_sentinels.py`

**Interfaces:**
- Consumes: Plan 2 correlation/error/audit hooks and Plans 1–3 metrics.
- Produces: structured logs, private metrics, stable alert evidence, and 30-day external log retention configuration.

- [ ] **Step 1: Write failing redaction/metric tests**

```python
async def test_secrets_never_reach_logs_errors_or_audit(client, caplog):
    response = await failing_request(client, SECRET_SENTINEL)
    output = caplog.text + response.text
    assert SECRET_SENTINEL not in output


def test_metrics_have_no_identity_labels():
    text = render_metrics()
    assert TENANT_ID not in text
    assert USER_EMAIL not in text
    assert "exception_message" not in text
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/observability tests/security/test_secret_sentinels.py -v
```

Expected: FAIL because observability modules do not exist.

- [ ] **Step 3: Implement correlation and redaction**

Accept valid inbound correlation ID or generate UUID4; return it on every response/error. Log route templates and stable result categories, not raw query/path/exception/provider body. Use HMAC tenant pseudonyms. Disable Uvicorn access logging.

- [ ] **Step 4: Implement private metrics and alerts**

Metrics cover HTTP, auth failures, cross-tenant denials, jobs/backlog/retries/dead letters, DB pool, migrations/backups, paper idempotency/fill/cancel/daily-loss reconciliation, and unexpected broker/live/raw-gateway registration. `/metrics` is private and blocked by Caddy. Alerts cover every approved release/canary failure mode.

- [ ] **Step 5: Run tests**

```bash
pytest tests/observability tests/security/test_secret_sentinels.py -v
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/observability.py hosted/src/tradebot_hosted/metrics.py config/observability tests/observability tests/security/test_secret_sentinels.py
git commit -m "feat: add production observability"
```

---

### Task 7: Add backup/restore and external deletion anti-resurrection ledger

**Files:**
- Create: `hosted/src/tradebot_hosted/operations/__init__.py`
- Create: `hosted/src/tradebot_hosted/operations/restore.py`
- Create: `schemas/deletion-manifest-v1.schema.json`
- Create: `scripts/ops/export_deletion_manifest.py`
- Create: `scripts/ops/scrub_restored_data.py`
- Create: `scripts/ops/verify_restore.py`
- Create: `scripts/ops/restore_drill.sh`
- Create: `tests/ops/test_restore_drill.py`
- Create: `tests/security/test_deletion_tombstones.py`

**Interfaces:**
- Consumes: Plan 2 account-deletion finalizer and managed PostgreSQL/object-store backups.
- Produces: signed deletion manifest, isolated restore scrub, and measured RPO/RTO evidence.

- [ ] **Step 1: Write failing restore/tombstone tests**

```python
async def test_pitr_before_purge_cannot_resurrect_identity(restore_scrubber):
    await restore_scrubber.apply_manifest(PRE_PURGE_BACKUP, SIGNED_DELETION_MANIFEST)
    assert await user_count(HMAC_DELETED_IDENTITY) == 0
    assert await post_purge_new_user_count(NEW_IDENTITY) == 1


def test_invalid_manifest_mac_fails_closed():
    with pytest.raises(RestoreError):
        verify_manifest(tampered_manifest)
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/ops/test_restore_drill.py tests/security/test_deletion_tombstones.py -v
```

Expected: FAIL because restore tooling does not exist.

- [ ] **Step 3: Implement signed deletion manifest**

Manifest entries contain only keyed identity HMAC, purge time, report prefixes/versions, key ID, and MAC. No email/raw subject. Plan 2 finalizer cannot mark `PULGED` until the manifest is durably written. Missing key/invalid MAC fails closed.

- [ ] **Step 4: Implement restore scrub and verifier**

Restore order: isolated service -> exact PITR -> load all deletion manifests after PITR -> remove matching pre-purge users/tenants/sessions/children/objects -> merge tombstones -> verify schema/RLS/roles/jobs/idempotency/orders/fills/events/audit/reports -> measure RPO/RTO -> allow readiness only after scrub completion.

- [ ] **Step 5: Implement provider-specific restore runbook hook**

`restore_drill.sh` coordinates the selected managed PostgreSQL/object-store restore. Vendor-specific commands remain in a protected operations runbook, not source-controlled secret configuration. Application verifiers remain provider-neutral.

- [ ] **Step 6: Run tests**

```bash
pytest tests/ops/test_restore_drill.py tests/security/test_deletion_tombstones.py -v
```

Expected: PASS with restore integration evidence.

- [ ] **Step 7: Checkpoint**

Commit only if explicitly authorized:

```bash
git add hosted/src/tradebot_hosted/operations schemas scripts/ops tests/ops/test_restore_drill.py tests/security/test_deletion_tombstones.py
git commit -m "feat: verify restore and deletion recovery"
```

---

### Task 8: Add CI security gates and release scanning

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/security.yml`
- Modify: `.github/pull_request_template.md`
- Create: `scripts/security/scan_release.py`
- Create: `tests/security/test_workflow_policy.py`
- Create: `tests/security/test_dependency_policy.py`

**Interfaces:**
- Consumes: Tasks 3–7 artifacts/evidence.
- Produces: redacted secret/SAST/dependency/container scan evidence for release manifest.
- CLI: `scan_release.py` requires named `--wheel`, `--oci-layout`, `--app-resources`, and `--output` flags; Task 12 supplies the concrete release paths.

- [ ] **Step 1: Write failing workflow-policy tests**

```python
def test_all_actions_use_full_commit_sha():
    for workflow in load_workflows():
        assert not re.search(r"uses:\s*[^@\s]+@(v?\d+|main|master)\s*$", workflow)


def test_pull_request_jobs_reference_no_secrets():
    assert secret_references(pull_request_jobs()) == []
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/security/test_workflow_policy.py tests/security/test_dependency_policy.py -v
```

Expected: FAIL against current mutable workflows.

- [ ] **Step 3: Add security workflow jobs**

Run Python/frontend tests, Ruff, full-history redacted gitleaks, CodeQL Python/JS, pip/npm audits, hosted wheel/import/image policy, image vulnerability scan, SBOM, provenance on release refs, migration/restore tests, and macOS unsigned build. Fail on unresolved Critical/High findings. Pin actions to 40-character SHAs; set `permissions: contents: read`; grant job-specific permissions only where required; set timeouts; no `pull_request_target` checkout.

- [ ] **Step 4: Expand secret scan scope**

Scan Git history, current tracked/non-ignored untracked release source, lockfiles/workflows, wheel, container filesystem, `.app` resources, and DMG contents. Expand archives before scanning and redact values.

- [ ] **Step 5: Run tests**

```bash
pytest tests/security/test_workflow_policy.py tests/security/test_dependency_policy.py -v
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Commit only if explicitly authorized:

```bash
git add .github/workflows .github/pull_request_template.md scripts/security/scan_release.py tests/security
git commit -m "ci: enforce production security gates"
```

---

### Task 9: Add reproducible builds, SBOM/provenance, and canonical release manifest

**Files:**
- Create: `scripts/release/source_date_epoch.sh`
- Create: `scripts/release/app_tree_manifest.py`
- Create: `scripts/release/build_manifest.py`
- Create: `scripts/release/verify_manifest.py`
- Modify: `macos-app/scripts/build-web.js`
- Create: `macos-app/.node-version`
- Create: `macos-app/.npmrc`
- Create: `tests/release/test_release_manifest.py`

**Interfaces:**
- Consumes: Tasks 3, 7, and 8 artifacts/evidence.
- Produces: release manifest consumed by preflight, deployment, signing, staging, canary, and rollback.

- [ ] **Step 1: Write failing reproducibility/manifest tests**

```python
def test_two_unsigned_app_manifests_match(clean_builds):
    assert normalized_tree_hash(clean_builds[0]) == normalized_tree_hash(clean_builds[1])


def test_manifest_rejects_modified_artifact(manifest, signed_dmg):
    signed_dmg.write_bytes(signed_dmg.read_bytes() + b"x")
    with pytest.raises(ManifestError):
        verify_manifest(manifest)
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/release/test_release_manifest.py -v
```

Expected: FAIL because tools do not exist.

- [ ] **Step 3: Implement deterministic source/build normalization**

Set `SOURCE_DATE_EPOCH` from commit timestamp, sort copied assets, normalize modes/timestamps, and hash normalized app trees. Two clean builds must match for hosted wheel, web asset tree, OCI digest, and unsigned Electron app tree. Signed DMGs are verified by manifest but not compared byte-for-byte.

- [ ] **Step 4: Generate SBOM/provenance and manifest**

Include commit, epoch, tool/runtime versions, wheel/web/app/image hashes, Alembic head, SBOM/provenance hashes, scan evidence, restore/staging/canary evidence, and signed artifact hashes. No secret value enters the manifest.

- [ ] **Step 5: Run tests**

```bash
pytest tests/release/test_release_manifest.py -v
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Commit only if explicitly authorized:

```bash
git add scripts/release macos-app/scripts/build-web.js macos-app/.node-version macos-app/.npmrc release tests/release/test_release_manifest.py
git commit -m "build: make release artifacts reproducible"
```

---

### Task 10: Sign, notarize, staple, and verify the macOS release

**Files:**
- Modify: `macos-app/package.json`
- Modify: `.github/workflows/build-mac.yml`
- Modify: `tests/test_build_workflow.py:59-69`
- Create: `macos-app/build/entitlements.mac.plist`
- Create: `macos-app/build/entitlements.mac.inherit.plist`
- Create: `scripts/release/verify_macos.sh`
- Create: `tests/release/test_macos_release.py`

**Interfaces:**
- Consumes: Plan 4 unsigned app and Task 9 reproducibility manifest.
- Produces: signed/notarized/stapled app and DMG evidence for the release manifest.
- CLI: `verify_macos.sh APP_PATH DMG_PATH MANIFEST_PATH`; Task 12 passes the exact Vibe Trading artifact paths.

- [ ] **Step 1: Write failing macOS release tests**

```python
def test_workflow_requires_signing_notarization_and_stapling():
    workflow = Path(".github/workflows/build-mac.yml").read_text()
    assert "CSC_IDENTITY_AUTO_DISCOVERY=false" not in workflow
    assert "notarytool" in workflow
    assert "stapler" in workflow
    assert "spctl --assess" in workflow
    assert "codesign --verify" in workflow
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/release/test_macos_release.py tests/test_build_workflow.py -v
```

Expected: FAIL because current workflow explicitly skips signing.

- [ ] **Step 3: Configure unsigned and release builds**

`build:unsigned` creates arm64/x64 unsigned app/DMG. `build:release` enables Developer ID signing, hardened runtime, Gatekeeper assessment, and only reviewed Electron JIT entitlements. No Python wheel/sidecar/source resource is packaged. No auto-updater is added.

- [ ] **Step 4: Implement protected release workflow**

PR/fork jobs build/test unsigned artifacts without secrets. Protected tag job imports certificate into an ephemeral keychain, signs app, notarizes/staples app, builds/signs/notarizes/staples DMG, verifies signature/entitlements/Gatekeeper/staple/architectures/checksums/manifest, destroys keychain, and publishes only on success. Missing artifacts fail closed.

- [ ] **Step 5: Remove unsigned release guidance**

Delete instructions telling users to bypass Gatekeeper. Update tests that currently require signing to be skipped.

- [ ] **Step 6: Run tests**

```bash
pytest tests/release/test_macos_release.py tests/test_build_workflow.py -v
```

Expected: PASS structurally; actual signing requires protected release credentials and macOS runner.

- [ ] **Step 7: Checkpoint**

Commit only if explicitly authorized:

```bash
git add macos-app/package.json .github/workflows/build-mac.yml tests/test_build_workflow.py macos-app/build scripts/release/verify_macos.sh tests/release/test_macos_release.py
git commit -m "release: sign and notarize macos app"
```

---

### Task 11: Add staging synthetic-tenant and canary/rollback gates

**Files:**
- Create: `scripts/staging/run_synthetic_suite.py`
- Create: `hosted/src/tradebot_hosted/rollout.py`
- Create: `scripts/release/canary_gate.py`
- Create: `scripts/deploy/rollback.sh`
- Create: `tests/staging/test_synthetic_tenant_contracts.py`
- Create: `tests/production/test_rollout.py`
- Create: `tests/release/test_canary_gate.py`
- Create: `tests/ops/test_rollback.py`

**Interfaces:**
- Consumes: Plans 1–3 APIs, Task 5 deploy CLI, Task 6 metrics, Task 7 restore evidence.
- Produces: staging/canary/rollback evidence and stable cohort assignment.
- Staging CLI requires named `--base-url`, `--tenant-a-session-file`, `--tenant-b-session-file`, and `--evidence` flags; Task 12 supplies concrete values.
- Canary API: `canary_gate(*, start: datetime, end: datetime, metrics: MetricsEvidence, reconciliation: ReconciliationEvidence, restore: RestoreEvidence) -> CanaryDecision`.
- Rollback CLI requires named `--current-manifest` and `--target-manifest` flags.

- [ ] **Step 1: Write failing synthetic/canary tests**

```python
def test_canary_requires_full_24_hours():
    with pytest.raises(CanaryRejected, match="86400"):
        canary_gate(start=NOW, end=NOW + timedelta(hours=23), metrics=GOOD_METRICS)


def test_duplicate_order_always_rejects_canary():
    with pytest.raises(CanaryRejected, match="duplicate"):
        canary_gate(start=NOW, end=NOW + timedelta(days=1), metrics=metrics(duplicate_orders=1))
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
pytest tests/staging/test_synthetic_tenant_contracts.py tests/production/test_rollout.py tests/release/test_canary_gate.py tests/ops/test_rollback.py -v
```

Expected: FAIL because release automation does not exist.

- [ ] **Step 3: Implement staging synthetic suite**

Use two real staging Google identities and normal OIDC; no bypass/header/admin route. Verify all tenant resources, public/private route matrix, analysis, paper idempotency/restart, account deletion/cancel, edge security, and seeded-secret absence. Session files are `0600` and never logged.

- [ ] **Step 4: Implement stable cohort and canary gate**

Use keyed HMAC/BLAKE-style stable hash over tenant ID and rollout key. Canary requires 86,400 seconds and zero security/order/integrity violations; 5xx <0.5%; authenticated read p95 <500 ms excluding model/report jobs; expensive-job start p95 <5 seconds; backlog ≤10 minutes; every reconciliation pass; restore RPO/RTO within target.

- [ ] **Step 5: Implement rollback**

Set cohort to zero, use previous immutable image, verify schema compatibility, start API/worker, wait private readiness, never downgrade schema, and record redacted evidence. Immediate triggers match the spec.

- [ ] **Step 6: Run tests**

```bash
pytest tests/staging/test_synthetic_tenant_contracts.py tests/production/test_rollout.py tests/release/test_canary_gate.py tests/ops/test_rollback.py -v
```

Expected: PASS.

- [ ] **Step 7: Checkpoint**

Commit only if explicitly authorized:

```bash
git add scripts/staging hosted/src/tradebot_hosted/rollout.py scripts/release/canary_gate.py scripts/deploy/rollback.sh tests/staging tests/production/test_rollout.py tests/release/test_canary_gate.py tests/ops/test_rollback.py
git commit -m "release: add staging and canary gates"
```

---

### Task 12: Add operations/security runbooks and execute the final release sequence

**Files:**
- Create: `docs/operations/README.md`
- Create: `docs/operations/production-deployment.md`
- Create: `docs/operations/backup-restore.md`
- Create: `docs/operations/staging-canary.md`
- Create: `docs/operations/macos-release.md`
- Create: `docs/operations/security-gates.md`
- Create: `docs/operations/credential-rotation.md`
- Create: `docs/operations/incident-rollback.md`
- Modify: `SECURITY.md`
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: every prior Plan 5 task.
- Produces: one operator-facing production process and final evidence manifest.

- [ ] **Step 1: Write failing documentation contract test**

Create `tests/release/test_operations_docs.py` that requires each runbook to name the canonical commands, evidence paths, failure triggers, and owner. It must reject instructions to bypass Gatekeeper, use production `.env`, expose sidecar port, enable live mode, auto-commit/push, or declare unsigned release acceptable.

- [ ] **Step 2: Run test and confirm failure**

```bash
pytest tests/release/test_operations_docs.py -v
```

Expected: FAIL because runbooks do not exist.

- [ ] **Step 3: Write the runbooks**

Document credential rotation, secret injection, clean-source preflight, migrations, backup, restore/deletion scrub, staging synthetic tenants, 24-hour canary, rollback, incident handling, signed macOS verification, and security-gate evidence. Existing local CLI/sidecar use is labeled development-only and separate from hosted production.

- [ ] **Step 4: Run the final release sequence**

```bash
python scripts/release/preflight.py --manifest release/release-manifest.json --require-clean --require-source-tracked
pytest -m "not network and not slow"
pytest -m "slow and not network"
ruff check .
ruff format --check .
python -m build hosted --outdir dist/hosted
npm --prefix macos-app ci
npm --prefix macos-app test
npm --prefix macos-app run build:unsigned
docker compose -f docker/docker-compose.yml config
docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml config
python scripts/security/scan_release.py --wheel dist/hosted/tradebot_hosted-0.1.0-py3-none-any.whl --oci-layout release/evidence/oci-layout --app-resources release/evidence/vibe-trading-app-resources-0.2.0.tar.gz --output release/evidence/release-scans.json
python scripts/release/verify_manifest.py --manifest release/release-manifest.json
bash scripts/release/verify_macos.sh "macos-app/dist/mac/Vibe Trading.app" "macos-app/dist/mac/Vibe Trading-0.2.0.dmg" release/release-manifest.json
scripts/deploy.sh validate --manifest release/release-manifest.json --environment staging
scripts/deploy.sh migrate --manifest release/release-manifest.json --environment staging
scripts/deploy.sh up --manifest release/release-manifest.json --environment staging
scripts/deploy.sh verify --manifest release/release-manifest.json --environment staging
python scripts/staging/run_synthetic_suite.py --base-url "$STAGING_BASE_URL" --tenant-a-session-file /run/secrets/staging-tenant-a.json --tenant-b-session-file /run/secrets/staging-tenant-b.json --evidence release/evidence/staging-evidence.json
python scripts/ops/verify_restore.py --evidence release/evidence/restore-evidence.json
scripts/deploy.sh validate --manifest release/release-manifest.json --environment production
scripts/deploy.sh migrate --manifest release/release-manifest.json --environment production
scripts/deploy.sh up --manifest release/release-manifest.json --environment production
scripts/deploy.sh cohort --manifest release/release-manifest.json --percent 10
scripts/deploy.sh verify --manifest release/release-manifest.json --environment production
python scripts/release/canary_gate.py --start "$(cat release/evidence/canary-start.txt)" --end "$(cat release/evidence/canary-end.txt)" --metrics release/evidence/canary-metrics.json --reconciliation release/evidence/canary-reconciliation.json --restore release/evidence/restore-evidence.json --output release/evidence/canary-gate.json
scripts/deploy.sh cohort --manifest release/release-manifest.json --percent 100
scripts/deploy.sh verify --manifest release/release-manifest.json --environment production
```

Run no step with missing credentials/evidence. Never substitute a placeholder domain, secret, signing result, or scan result.

- [ ] **Step 5: Run docs and final tests**

```bash
pytest tests/release/test_operations_docs.py tests/release -m "not network and not slow" -v
git diff --check
git status --short
```

Expected: PASS; dirty state contains only explicitly authorized intended changes/evidence.

- [ ] **Step 6: Final checkpoint**

Do not commit, tag, publish, deploy, or promote without explicit user authorization. When authorized, use focused conventional commits only; never auto-stage unrelated dirty files.

## Plan 5 Completion Evidence

- [ ] Clean tracked source and lockfiles build the exact hosted artifacts.
- [ ] Production secrets, network, image, dependency, SAST, and secret gates pass.
- [ ] API/worker readiness, forward-only migration, redaction, metrics, and alerts pass.
- [ ] Full restore verifies RPO ≤15 minutes, RTO ≤4 hours, and deletion anti-resurrection.
- [ ] Wheel/web/image/unsigned app builds are reproducible; SBOM/provenance/scan evidence is bound to one commit.
- [ ] macOS app/DMG are signed, notarized, stapled, architecture-verified, and checksummed.
- [ ] Staging synthetic tenants prove isolation and paper workflow correctness.
- [ ] 24-hour 10% canary passes exact thresholds with zero security/order/integrity violations.
- [ ] Rollback is tested and never downgrades schema.
- [ ] Final release manifest contains every required artifact/evidence hash.
- [ ] No commit, tag, release, deployment, or promotion occurs without explicit user authorization.
