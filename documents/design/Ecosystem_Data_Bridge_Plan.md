# Symply Ecosystem Cross-App Data Bridge

> **Status:** Phase A platform spine **live** on staging+production (v1.16); Phase C Soft Transfer House↔Budget **live** (consent/prepare/export/import + UI) — Soft Transfer D1 **enabled**; registration / Realtime remain **false**  
> **Owner:** Platform  
> **Last updated:** 2026-07-15  
> **Saved:** 2026-07-14  
> **User-data migration:** None  
> **Schema installation:** `0092_shared_user_entitlements.sql` on empty/unused House, Budget, and Kaizen platform tables  
> **Depends on:** [_ecosystem TRD](../apps/_ecosystem/TRD.md), [PROJECT](../ecosystem/PROJECT.md), [SERVICES](../ecosystem/SERVICES.md), [FLEET](../ecosystem/FLEET.md)

| Field | Decision |
|---|---|
| Version | v1.16 |
| Launch model | Greenfield: no real users, sessions, paid entitlements, transfers, or user-owned async work to preserve |
| Identity authority | Symply House from the first joined-app public release |
| Joined in v1 | House, Budget, Kaizen |
| Soft Transfer joined | Health + Language Soft Transfer packages live; Language auth remains legacy JWT until Shared User spine |
| Product data movement | Explicit, consented, versioned Soft Transfer packages only |

## Revision history

| Version | Date | Change |
|---|---|---|
| v1.13 | 2026-07-14 | Migration-safe design for a potentially populated fleet |
| v1.14 | 2026-07-14 | Greenfield simplification: remove user migration, legacy-token grace, identity remap, aliases, shadow comparison, write fence, queue drain, and auth cutover state machine |
| v1.15 | 2026-07-14 | review-plan Cycle 1: drop false Ready; operational zero-user SQL; D1/KV authority matrix; SecureStore+App Group cutover tasks; Health migrate CI gate; companion membership; retire legacy Realtime; Phase A file tasks; DO hibernation; pass-1 binary rules; eas-build platform rewrite; RFC 9068 claims; rate-limit/monitoring/Pre-Impl/rollback |
| v1.16 | 2026-07-14 | review-plan Cycle 2: fix today JWT House vs Budget; Appendix A statuses; RFC 9068 profile note + `sub`/`exp`; pass-1 build-tag only; Realtime DO 16KiB/`acceptWebSocket`; D1 replication ops note; `brands/resolve.cjs` in Affected files |

---

## 0. Pre-Implementation Checklist (coding blocked until checked)

- [x] Phase A0 docs: `_ecosystem` TRD §5.2 + brand ids aligned to `symply-*`; NAMING/FLEET `APP_BRAND` columns match `brand.cjs`/wrangler (`symply-house`, not `simple-house`); RELATIONSHIPS Budget→House = Soft Transfer packages; SERVICES lists bridge secrets
- [x] Engineering sign-off that TRD no longer claims migration-era “existing users default” / plan version pin ≠ v1.4
- [ ] `backend/` `npm install` done before any Worker test gate
- [ ] Keychain: material for `set-data-bridge.sh` available (staging first)
- [x] Health migrate scripts gated: `db:migrate:health:*` refuses 0092 unless `HEALTH_ALLOW_0092=1` (POC / zero-user may set the flag; production Health join still requires empty-table + route-unmount DoD)
- [x] Disposition of **existing** OpenAI Realtime / ephemeral mint paths (`aihousekeeper-voice`, related routes) documented: hard-deny behind House D1 `realtimeVoiceEnabled` (SERVICES.md + route assert) before Phase B Realtime ships
- [x] Rewrite `scripts/eas-build-brand.sh` to accept platform (`ios|android|all`), refuse overlapping dirty native trees, and restore **only** files the script changed
- [ ] Zero-user staging rehearsal of Appendix A queries against staging D1s
- [ ] Confirm `RATE_LIMITER` DO healthy on target env (use `dev-preview` if staging DOs broken)
- [ ] Generate + install ES256 JWKs via `set-data-bridge.sh` (staging then production)
- [ ] Uncomment wrangler `[[services]]` PlatformBridgeApi bindings (pass-2) after joined Workers export the entrypoint

---

## 1. Greenfield decision

The fleet has **no real users**, so this is a clean launch rather than a live-account migration.

Remove from implementation scope:

- identity/user-id backfill and collision reconciliation;
- child refresh-token/hash migration;
- legacy HS256 grace for joined apps;
- `legacy_user_aliases` and FK/user-id remapping;
- shadow resolve traffic and mismatch thresholds;
- write fences, final deltas, queue/DLQ drains, and external identity remaps;
- RevenueCat legacy App User ID reconciliation;
- migration rollback for user data.

Keep one production safety check: before opening registration, run the **Appendix A** read-only counts proving zero real accounts and related rows on joined production Workers. Synthetic/test rows may be removed only by an explicit, reviewed cleanup script. If real data is found, stop launch and write a targeted migration plan; do not silently restore the retired v1.13 machinery.

`0092_shared_user_entitlements.sql` is still required to create the new tables. It is a **schema installation**, not a user-data migration.

---

## 2. Locked architecture

1. House owns joined-platform identity, credentials, sessions, app entitlements, profile/contact data, AI preference/eligibility, consent, and deletion state.
2. Budget and Kaizen never mint joined-platform sessions. Their `/auth/*` facades proxy House and create only local product-user mirrors.
3. Health joins Soft Transfer + Shared User spine (auth proxy). Language joins Soft Transfer packages (`/smart-engine` + House RPC) while product auth remains Language Worker JWT until Shared User spine lands.
4. Product Workers never query sibling product tables. Cross-app data moves only through Soft Transfer packages.
5. Service authentication identifies the calling Worker; it never supplies end-user identity or independently mints a user session.
6. House alone holds the platform ES256 private key. Joined Workers receive current/previous public keys.
7. **Authority matrix (locked):** correctness for registration, Soft Transfer, AI eligibility/policy, and Realtime enablement is decided only by House D1 via `withSession('first-primary')` (`platform_bridge_control`, `platform_ai_policy`, entitlements). Enable D1 read replication (`read_replication.mode: auto`) on House when using Sessions API for replica-aware reads; without replication, sessions still work but all queries hit primary. Workers KV / `DEFAULT_FLAGS` / mobile `FEATURE_DEFAULTS` are **UI/release cache only** — a stale KV `true` never authorizes traffic if D1 says false. Kill E2E asserts D1 deny even when KV still shows enabled. Sub-60s edge kill is **not** promised via KV; ops kill flips D1 first, then refreshes KV. ([D1 first-primary](https://developers.cloudflare.com/d1/best-practices/read-replication/), [KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/))
8. All new authority/features default off. Public registration is enabled last, after backend and store binaries pass their gates.
9. Product access/refresh tokens live only in brand+environment+authority-version namespaced SecureStore. They never enter Zustand persist, MMKV, AsyncStorage, App Group, or Watch storage. **Companion JWTs** (`typ=companion+jwt`) are the only capability tokens allowed in House App Group / Watch for the two companion GETs — never `at+jwt`. Phase A must remove today’s `authStore` MMKV/AsyncStorage token persist and `WidgetSyncModule.setAuth` product-JWT App Group writes.
10. Health remains **route/schema blocked for platform authority** until Health join: Health Worker must not mount `/shared-user`, `/smart-engine`, `/auth/platform`, or companion routes; Health remote migrate must not apply 0092 until empty-table + unmount DoD (CI gate). Language remains in `backend-language/`.
11. Unknown/missing `APP_BRAND` **fails startup with 503** after Phase A (`getAppBrand` / `brands/resolve.cjs` must stop defaulting to House). Today’s default-to-House is a defect to fix in Phase A, not current truth.
12. Bridge abuse surfaces use `checkRateLimitDO` (never in-memory `rateLimit()` Map): register, IdP challenge, transfer prepare/import, deletion-status, companion GETs, resolve/exchange.
13. One request ≤32 Worker invocations including service-binding hops; Soft Transfer prepare ≤8 hops.

### Canonical fleet registry

One generated/shared `PLATFORM_BRANDS` registry is the security source of truth.

| Runtime brand | JWT audience (target) | Worker | Platform auth | Bridge v1 | Companion v1 |
|---|---|---|---|---|---|
| `symply-house` | `symply-house-app` | `simple-house-api*` | joined | joined | House read-only (`companion+jwt`) |
| `symply-budget` | `symply-budget-app` | `simple-budget-api*` | joined | joined | cache-only (no companion JWT) |
| `symply-kaizen` | `symply-kaizen-app` | `symply-kaizen-api*` | joined | control plane; packages later | cache-only |
| `symply-health` | legacy local | `symply-health-api*` | blocked | blocked | cache-only |
| `symply-language` | legacy local | `backend-language/` | separate legacy | blocked | cache-only |

**Today vs target:** House wrangler JWT vars = `simple-house` / `simple-house-app` (HS256); Budget = `simple-budget` / `simple-budget-app` (HS256); Kaizen = `symply-kaizen` / `symply-kaizen-app` (HS256). Phase A installs ES256 `iss=symply-ecosystem` and target `symply-*-app` audiences — no HS256 grace on joined apps.

The registry also fixes provider client ids by brand/environment, service-binding names, exact caller props, package directions, and default-false capabilities.

Because some current Google client ids are reused, every joined social login/link request uses a five-minute one-use House challenge bound to caller brand, environment, provider, and intent. House validates `aud`/`azp` and atomically consumes the challenge nonce. Request JSON cannot choose its audience or brand.

---

## 3. Greenfield schema installation

Create `backend/migrations/0092_shared_user_entitlements.sql` after the current migration head (`0091_budget_chat.sql`). House, Budget, Kaizen, and Health share `backend/migrations`, so 0092 is a universal **file** in the repo, but remote rollout applies it **only** to House/Budget/Kaizen.

**Health hold (mechanical):** `package.json` `db:migrate:health:*` and CI refuse if applying would install 0092 unless `HEALTH_ALLOW_0092=1`. **POC / zero-user:** the hold is lifted for Health D1 when operators set `HEALTH_ALLOW_0092=1` (no real accounts to preserve). **Production Health join** still requires empty-table + route-unmount DoD before routine migrate. **Skip-0092 path:** while the hold is active, `npm run db:migrate:health:skip-0092:staging|production|all` runs `backend/scripts/migrate-health-skip-0092.sh`, which applies every pending shared migration file in order **except** `0092_*` and `0093_platform_profile_revocation.sql` (0093 FK-references `platform_deletion_requests` from 0092). It does not set `HEALTH_ALLOW_0092`. For 0092/0093 on Health use `db:migrate:health:*` with `HEALTH_ALLOW_0092=1`.

### Table groups

| Group | Tables / purpose |
|---|---|
| Identity and auth | `platform_identity_links`, `platform_identity_tombstones`, `platform_profiles`, `platform_credentials`, `platform_provider_grants`, `platform_refresh_tokens`, `platform_one_time_tokens`, `platform_idp_challenges`, `platform_lifecycle_proofs` |
| App/session control | `user_app_entitlements`, `platform_session_revocation_outbox`, `platform_session_revocations`, `platform_app_access_revocations`, `platform_ws_tickets`, `platform_live_session_attachments` |
| Profile projection | `platform_profile_outbox`, `platform_profile_mirrors` |
| Billing and AI | `user_entitlements`, `platform_billing_identities`, `platform_billing_events`, `platform_subscription_entitlements`, `platform_ai_eligibility`, `platform_ai_policy`, `platform_ai_job_grants`, `platform_ai_schedule_grants`, `platform_ai_speech_grants` |
| Transfer | `transfer_consents`, `transfer_prepare_operations`, `token_exchange_jtis`, `transfer_import_receipts`, `transfer_event_outbox`, `transfer_package_events`, `transfer_onboarding_contexts` |
| Control and deletion | `platform_bridge_control`, `platform_request_idempotency`, `platform_app_footprints`, `platform_deletion_requests`, `platform_deletion_outbox`, `platform_deletion_receipts`, `platform_deletion_work_items`, `platform_processor_deletion_work_items` |

Authority routes are mounted only on House. Children may write only House-derived mirrors, local receipts, local revocation/tombstone state, transfer import receipts, and product deletion work.

0092 seeds these House controls false:

```text
platformRegistrationEnabled = false
softTransferEnabled = false
lifeSnapshotEnabled = false
realtimeVoiceEnabled = false
```

`platform_ai_policy` starts empty; absent policy always denies. Sync false defaults into Worker `DEFAULT_FLAGS` + mobile `FEATURE_DEFAULTS` for UI chrome only (never authorize).

### Retention essentials

- No table stores raw JWTs, passwords, IdP proofs, provider authorization codes, raw idempotency keys, envelope payloads, raw context ids, or Realtime audio.
- One-use proof/ticket hashes purge shortly after consume/expiry; transfer JTIs and speech grants purge after 2× their TTL.
- Generic idempotency and prepare rows live 24 hours and purge by 48 hours.
- Revoked/expired refresh-family hashes remain only through reuse-detection and session-revocation receipt completion, at most 30 days after final expiry/revocation.
- Provider grant ciphertext remains only until provider revoke/no-grant disposition is terminal.
- Billing/legal retention must be detached from `user_id`, contact data, and vendor App User ID and follow `documents/engineering/privacy-retention.md` (create in Phase A0).
- Pepper/key versions remain until their last referencing row is purged.

---

## 4. Joined identity, auth, and lifecycle

### Token classes

| Token | Contract |
|---|---|
| Product access | House ES256, `typ=at+jwt`, issuer `symply-ecosystem`, `sub`, `exp`, `iat`, `jti`, `client_id`, one exact joined-app `aud`, stable `sid`, current `ent_ver`, space-delimited `scope`. **Internal RFC 9068-shaped profile** (ES256-only fleet; not claiming full RFC 9068 RS256 interop) |
| Transfer export | House ES256, `typ=transfer+jwt`, `aud=symply-transfer-export`, exact operation/package/direction/context/JTI, TTL ≤120s |
| WebSocket ticket | Random one-use hash-stored ticket, TTL ≤30s, bound to product/user/room/household/`sid`/`ent_ver` |
| House companion | House ES256, `typ=companion+jwt`, `aud=symply-house-companion`, read-only scopes, one House household, TTL ≤1h |

Joined verifiers accept ES256 only, require recognized `kid`, reject `jku`/`x5u`/unknown `crit`, and use separate access/spine/transfer/companion verifier functions. There is no joined-app HS256 grace or token migration. Negative tests: `transfer+jwt` on product routes → 401 `wrong_token_class`; `at+jwt` on export → 401; `companion+jwt` on product write → 401.

### Auth behavior

- House/Budget/Kaizen shared Login/Register UI uses one `joined-platform` adapter. Child facades proxy credential proof to House; House derives the audience from trusted caller identity.
- Health uses `shared-worker-legacy`; Language uses `language-legacy`. Each has its own SecureStore namespace and API client.
- A separate spine client refuses to initialize for unjoined brands.
- Apple/Google email claims are contact metadata, never identity keys. Identity links are provider subject or verified password email.
- Social/link flows forward the provider authorization code to House. Apple grants are encrypted with row-bound AAD and revoked on provider unlink/platform deletion.
- Every app entitlement has a monotonic `entitlement_version`; access/refresh/transfer/AI/WS authorization requires an active current version.
- Session revoke/logout/password-reset/reuse creates exact-`sid` child revocation commands and closes indexed sockets.
- **SecureStore adapter (Phase A mandatory):** key prefix `{brand}:{env}:{authorityVer}:`; remove Zustand persist of `token`/`refreshToken`; memory-only session pointer OK; `keychainAccessible` device-only where applicable. “SecureStore namespace migration” in tests means **one-time wipe of legacy generic keys** on first joined auth, not cross-user id migration.

### Profile projection

House `platform_profiles` owns display name, avatar reference, verified contact email, locale, and timezone. A versioned outbox updates child `platform_profile_mirrors`; children apply only increasing versions. Local `users.email` is not a login/contact authority. Compatibility aliases use `.invalid` and are centrally blocked from mail, analytics, invitations, search, display, and export.

### Unlink and deletion

App unlink is House-first: set `revocation_pending`, increment `entitlement_version`, revoke sessions/consents/grants, deliver the inactive version to the child, then mark revoked after receipt. Product data remains unless the user separately requests deletion.

Platform deletion:

1. Client creates a 256-bit status secret and ≥128-bit idempotency key; House stores hashes/fingerprints only.
2. One House batch blocks login/mint, revokes sessions/entitlements/AI, creates identity tombstones, and starts deletion work for House/Budget/Kaizen plus configured processors.
3. Apple/provider tokens are rewrapped under deletion-request AAD, revoked, then erased.
4. Each joined Worker returns terminal `deleted` or attested `no_data`; processor/billing exceptions are explicit `retention_bounded` records with an expiry.
5. `POST /auth/platform/deletion-status` uses the status secret and never authenticates or recreates the account.

`platform_deletion_requests` stores a random request id, nullable user id while pending, fingerprint pepper version, unique idempotency fingerprint, unique indexed status-secret hash, state, timestamps, and terminal/status expiry. Status/saga rows purge 30 days after terminal state; detached lawful billing/security records follow their own documented expiry and do not cascade.

Tombstone digests use domain-separated JCS input:

```text
HMAC-SHA-256(key,
  UTF8("symply:identity-tombstone:v1\n") ||
  JCS({ v: 1, linkType, namespace, normalizedValue }))
```

No raw identity value survives. Tombstones remain until all joined/processor receipts are terminal, then expire after 30 days.

---

## 5. Soft Transfer

### v1 packages

| Package | Direction | Notes |
|---|---|---|
| `profile.core.v1` | House ↔ Budget | Minimal user-confirmed profile fields |
| `house.property.v1` | House → Budget | Explicit source household membership; no silent sync |
| `budget.summary.v1` | Budget → House | Confirmed ISO-4217 currency and field allowlist |

### Protocol

1. Destination validates the product access token and requires a ≥128-bit CSPRNG idempotency key.
2. House validates active source/destination entitlements, consent, package direction, independent contexts, and `softTransferEnabled` from first-primary D1.
3. House issues a one-use transfer JWT; source atomically consumes its JTI immediately before export (`UPDATE … WHERE consumed_at IS NULL`).
4. Source returns an ES256-signed RFC 8785/JCS envelope (tested library, not hand-rolled) with exact schema hash, ordered field manifest, purpose, contexts, operation id, consent version, and five-minute expiry.
5. Destination validates every binding before one D1 batch inserts the unique receipt (UNIQUE abort → SELECT → 200 `already_imported`), applies product mutation, and writes an audit outbox event.
6. Same idempotency key/request returns the same operation/result; same key/different request is 409. Concurrent import mutates once.
7. `checkRateLimitDO` on prepare/export/import/consent.

Payloads are transit-only and are not stored in audit tables or on mobile.

**React Query:** invalidate `['smart-engine','consents']`, `['smart-engine','packages', brandId]`, `['home','home-budget', householdId]` on grant/revoke/import.

---

## 6. AI and Realtime

House stores the user preference `ai_master_enabled` separately from derived display status `off|trial|on` (replace mobile `off|entitled|denied` in Phase B with call-site inventory). A mobile PATCH changes only the preference.

Every provider call requires all of:

- active app entitlement/version;
- master preference enabled;
- current verified RevenueCat, BYOK capability, trial, or audited admin eligibility;
- exact House-primary brand/capability/provider/model policy;
- any relevant House-primary surface latch;
- D1 authority allow (KV cache irrelevant).

Timeout/House failure denies the model call while CRUD remains available. Async jobs/schedules use short-lived opaque grants bound to brand, job/schedule id, provider, capability, policy version, and immutable spec hash. Lambda reauthorizes immediately before every vendor call; events/state never contain user JWTs or provider keys. Tool context uses a per-tool allowlist (no unbounded household dump).

**Legacy Realtime retirement (locked):** before enabling `realtimeVoiceEnabled`, unmount or 410/403 the existing OpenAI ephemeral / WebRTC mint paths so only `AuthorizedRealtimeSessionDO` can stream. Dual live voice surfaces are forbidden.

### House Realtime v1

- House only; Budget/Kaizen/Health/Language voice stays disabled.
- Mobile PCM16 24 kHz mono WebSocket → `AuthorizedRealtimeSessionDO` → provider.
- Provider performs STT/TTS transport only; existing Claude/tools chat remains the reasoning path.
- One-use Realtime ticket, authorization before first audio byte, explicit turn boundaries, one-use speech grant bound to exact response-text hash.
- Maximum 15-minute session, 60-second turn, 64 KiB frame, 256 KiB queued audio; explicit pause/resume backpressure.
- No audio/JWT/provider secret persistence.
- Native I/O uses repo-owned `modules/realtime-audio/`: AVAudioEngine/AVAudioConverter/AVAudioPlayerNode on iOS; AudioRecord/AudioTrack on Android.
- **DO runtime:** declare class in wrangler `[[migrations]]` / `new_sqlite_classes` as required; set `limits.cpu_ms` (and subrequest limits as needed for ≤15 min sessions). Use hibernation WebSocket API (`acceptWebSocket`), not only std `addEventListener`. Active audio: keep awake **or** persist ≤16 KiB per-WS via `serializeAttachment` + restore on wake (overflow → keep awake / refuse hibernate). Optional `setWebSocketAutoResponse` for idle ping. Mid-stream kill reads D1 authority and closes sockets; deploy drains sessions. Staging DO: use `dev-preview` if staging DOs unhealthy.
- Kill: flip D1 `realtimeVoiceEnabled=false`; in-flight session closes within one turn boundary; new tickets denied.

`realtimeVoiceEnabled` remains false until native device, provider-spy, revocation, teardown, no-persistence, and legacy-path-absent tests pass.

**Phase B split:** B1 = AI AuthZ/policy/Lambda grants (registration-independent). B2 = Realtime DO + native module (separately gated).

---

## 7. Widget and Watch security

Only House gets direct companion reads in v1:

- `GET /companion/v1/tasks?days=1..7` with `tasks:read`;
- `GET /companion/v1/home-insight` with `home-insight:read`.

Routes use companion verifier + **household membership** (`HouseholdService.verifyAccess` or equivalent) for the household claim in the token. No companion write route exists. Budget/Kaizen/Health/Language Widget/Watch surfaces are phone-fed/cache-only and make no direct backend request.

**App Group cutover:** remove product `auth_token` from App Group; store only companion JWT (or phone-fed cache payloads). Watch mutations use a phone relay, never the companion token. The Watch creates a ≤24h intent bound to random `intent_id`, origin `sid`, House household, action, resource ids, canonical body/audio hash, and expiry. The phone rechecks current auth/membership and calls the normal House route with `Idempotency-Key: <intent_id>`. House stores the authenticated request fingerprint, so crash/lost-response/duplicate delivery mutates once.

Pending voice is ≤120 seconds and ≤10 MiB, protected in the app container, excluded from backup, and deleted after success/cancel/logout/revoke/unlink/deletion or 24h expiry.

Non-secret prefs use `storageHelpers` only (never direct MMKV).

---

## 8. Secrets and inter-Worker transport

| Secret/binding | Placement |
|---|---|
| `PLATFORM_JWT_PRIVATE_JWK` | House only |
| `PLATFORM_JWT_PUBLIC_KEYS` | House/Budget/Kaizen |
| `TRANSFER_ENVELOPE_PRIVATE_JWK` | Each exporting Worker; unique per env/brand |
| `TRANSFER_ENVELOPE_PUBLIC_KEYS` | Importers; key bound to source brand |
| `HOUSE_SERVICE`, `BUDGET_SERVICE`, `KAIZEN_SERVICE` | Named `PlatformBridgeApi` bindings with static caller props |
| Per-edge service tokens | HTTP fallback only; unique per caller→callee/env |
| `PLATFORM_SERVICE_TOKEN_LAMBDA_TO_HOUSE` | Lambda + House; AI-job authorization endpoint only |
| `PLATFORM_DELETION_TOMBSTONE_PEPPERS` | House only, versioned |
| `TRANSFER_METADATA_PEPPERS` | Local per Worker, versioned |
| Apple client keys + provider-grant KEK | House only |
| RevenueCat secret/webhook auth | House only |
| Feature/control/AI-policy admin secrets | Purpose-separated, exact routes only |

Provision with `scripts/secrets/set-data-bridge.sh <staging|production>`: resolve repo root, explicit Wrangler configs, never print material, install both ends of each fallback edge token, verify House-only secrets absent on children. Document each `wrangler secret put … --env staging|production -c <config>` in SERVICES.md. Never commit `.dev.vars` secrets.

---

## 9. Implementation plan

### Phase A0 — Docs + gates

1. Sync TRD / NAMING / FLEET / RELATIONSHIPS / SERVICES to v1.16 registry and greenfield decisions; create `privacy-retention.md`.
2. Clear §0 Pre-Impl checklist (including eas-build rewrite + Health migrate gate + legacy Realtime disposition).

### Phase A — Greenfield platform spine

| Task | Files / deliverables | Verify |
|---|---|---|
| A1 Schema | `0092_*.sql`, `schema.ts`, Health migrate deny | Local migrate House/Budget/Kaizen only |
| A2 Brand fail-closed | `backend/src/config/brand.ts`, `brands/resolve.cjs` | Missing brand → 503 |
| A3 Registries/RPC | `platform-brands.ts`, package registry, `PlatformBridgeApi` in `index.ts`, wrangler service props | Boot asserts |
| A4 JWT classes | `jwt.ts`, product/spine/transfer/companion middleware | Negatives in harness |
| A5 Auth authority | `auth-service.ts`, `shared-user-service.ts`, platform routes, child proxies | Children cannot mint |
| A6 Transport | `inter-worker-client.ts`, per-edge tokens, `set-data-bridge.sh` | Directed-edge smokes |
| A7 SecureStore + App Group | `authStore.ts` (no token persist), SecureStore adapter, `WidgetSyncModule` / `AppGroup` cutover | DoD token locations |
| A8 Profile/session/deletion | outbox, revocation, deletion saga, `credential-encryption.ts` | Receipts |
| A9 Rate limits | Wire `checkRateLimitDO` + `RATE_LIMITS` keys | Not in-memory Map |
| A10 Mobile adapters | `src/api/client.ts`, joined/legacy adapters, spine client, Login/Register | Health/Language isolation |
| A11 Registration false | `platform_bridge_control` seed | Cannot public-register |

Keep `platformRegistrationEnabled=false`; no public account until §10.

### Phase B — AI

- **B1:** House AI policy/eligibility gateway, async grants, Lambda recheck (`handler.py`, `ai_adapters.py`, …), call-site audit, enum migration `off|trial|on`, FEATURE_DEFAULTS sync (UI only).
- **B2:** Realtime DO + `modules/realtime-audio/` + legacy path retirement. Keep Realtime false until gates pass.

### Phase C — Soft Transfer

Implement House↔Budget consent, packages, transfer-only JWT, signed envelopes, idempotent import, audit outbox, UI (`SoftTransferImportScreen`), RQ keys, authority-ordered kill switch.

### Phase D/E — Later

Life Snapshot, Kaizen packages, then Language/Health only after their own auth/privacy join plans.

### Per-phase rollback

| Phase | Rollback |
|---|---|
| A0 | Docs only |
| A (pre-registration) | Restore previous Worker/mobile; leave registration/features false; leave 0092 in place or document forward-only |
| A secrets/bindings | Re-run set-data-bridge with previous material; disable peer bindings |
| B1 | D1 AI policy deny / eligibility off |
| B2 | `realtimeVoiceEnabled=false`; unmount DO route if needed |
| C | `softTransferEnabled=false` on House (+ Budget UI) |
| Registration open | Roll **forward** only; never restore child mint |

---

## 10. Deployment and launch order

### Two-pass Service Binding bootstrap (locked)

1. **Pass-1 binary:** Workers export `PlatformBridgeApi` but **must not** contain outbound peer call sites for auth proxy — build tag `BRIDGE_PEER_RPC=0` only (not a runtime feature-flag dual path). Registration/features disabled. Deploy House then Budget then Kaizen.
2. **Pass-2:** Add `HOUSE_SERVICE` / `BUDGET_SERVICE` / `KAIZEN_SERVICE` + static props; deploy again; smoke every directed edge. Automate in bridge bootstrap script; fail CI if pass-2 smokes skipped.
3. Mid-pass failure: leave registration false; roll back to last green pass-1 or complete pass-2 — never leave half-wired production peers with public registration on.

### Staging

1. `eval "$(./scripts/secrets/export-env.sh)"`; typecheck, lint, unit tests, Lambda tests, AI call-site audit, multi-Worker suite (`npm install` in `backend/` first).
2. `scripts/secrets/set-data-bridge.sh staging`.
3. Validate 0092 locally; archive migration lists; apply **only** House/Budget/Kaizen staging D1s (Health script must refuse).
4. Two-pass binding bootstrap as above.
5. Deploy platform auth; keep public registration false.
6. After eas-build rewrite, build/install staging profiles:

   ```bash
   scripts/eas-build-brand.sh symply-house symply-house-staging all --non-interactive
   scripts/eas-build-brand.sh symply-budget symply-budget-staging all --non-interactive
   scripts/eas-build-brand.sh symply-kaizen symply-kaizen-staging all --non-interactive
   scripts/eas-build-brand.sh symply-health symply-health-staging all --non-interactive
   scripts/eas-build-brand.sh symply-language symply-language-staging all --non-interactive
   ```

7. Pass full staging matrix; enable staging registration only for joined brands. Enable Realtime and Soft Transfer separately after their tests.

### Production

1. Run Appendix A zero-user queries; archive results. Any real row stops launch.
2. Distinct production secrets; apply 0092 only to House/Budget/Kaizen.
3. Two-pass bindings; registration/features false.
4. Audit `eas.json`: production Android AABs (fix House inherited APK); store credentials present.
5. Build House/Budget/Kaizen production binaries; wrapper accepts platform; no broad dirty checkout.
6. Submit recorded build ids (never `--latest` across parallel brands); TestFlight/Play internal.
7. Publish min client versions; incompatible builds get 426 on auth/spine.
8. Admin-only one-use allowlisted synthetic account while registration false; delete + verify saga; **remove bypass before public open**.
9. Commit `platformRegistrationEnabled=true` **last**.
10. Observe 48h (see Monitoring); then Soft Transfer. Realtime separately gated.

---

## 11. Test matrix

| Area | Required tests |
|---|---|
| Identity/auth | Provider subject stability, password/social flows, nonce replay/caller mismatch, concurrent registration, Apple code/revoke, joined child cannot mint, Health/Language isolation |
| JWT/session | Exact issuer/alg/kid/type/audience/`client_id`/`jti`/`sid`/`ent_ver`; wrong-token-class negatives; refresh race/reuse; revoke-one/all; WS ticket one-use; live socket close |
| Entitlement/profile/deletion | House-first unlink, version race, monotonic profile mirrors, `.invalid` guard, lost deletion response/status secret, full joined/processor receipts, tombstone collision fixtures |
| Caller/control | Static RPC props, every per-edge fallback negative, cyclic pass-1/pass-2 deployment, unknown brand 503, D1 authority-first kills with stale KV, `checkRateLimitDO` |
| Transfer | Consent/revoke, exact contexts/direction, JTI replay, JCS/ES256 fixtures, schema/manifest rejection, concurrent/idempotent import, House-down failure, audit outbox retry |
| AI/Realtime | Full eligibility/policy decision, RevenueCat/BYOK trust boundaries, job/schedule/Lambda grants, no provider call when off/down, legacy Realtime path absent, PCM protocol/limits/backpressure, DO hibernate/restore, native device and no-persistence tests |
| Mobile/native | SecureStore namespace + legacy key wipe, no JWT in Zustand/MMKV/App Group, joined vs legacy adapters, client 426, House companion two-GET + membership, non-House no-network, Watch relay idempotency, Widget/Watch brand builds |
| Schema/release | 0092 on isolated House/Budget/Kaizen, Health migrate refuse 0092, secret placement negatives, AAB/store profile validation, registration remains false until store availability |

**Total: 8 test areas.** Unit mocks alone do not satisfy the cross-Worker or native gates. Harness: `backend/__tests__/data-bridge/miniflare-harness.ts` + `vitest.data-bridge.config.ts`.

---

## 12. Definition of Done

- [x] Appendix A production query archived (`documents/engineering/launch-zero-user-audits/`); no backfill/remap/token migration exists — **registration remains false** (non-zero legacy/test users documented in audit README)
- [x] 0092/0093 installed only on House/Budget/Kaizen; Health migrate refuse verified
- [x] House ES256 auth live (`PLATFORM_JWT_*` secrets); children proxy mint (cannot mint when JWKS present)
- [x] Health/Language isolation: Health platform routes 404 / unmounted; Language separate backend
- [x] Registration defaults false; Soft Transfer / Realtime false; synthetic public open blocked
- [x] Two-pass Service Binding bootstrap (`PlatformBridgeApi`) live on joined Workers
- [x] Session revocation + deletion saga routes mounted (House); Apple revoke path still uses existing unlink flows
- [x] No product/refresh JWT in Zustand persist / App Group; companion mint + App Group companion key path shipped
- [ ] AI B1 + (optional) B2 gates — Phase B (legacy Realtime hard-denied)
- [ ] House↔Budget transfer E2E — Phase C (control plane mounted fail-closed)
- [ ] Monitoring alarms live; full 8-area harness + store binary smokes — remaining ops/native

---

## 13. Affected files

| Area | Files |
|---|---|
| Schema/config | `backend/migrations/0092_shared_user_entitlements.sql`, `backend/src/db/schema.ts`, `backend/src/config/brand.ts`, `brands/resolve.cjs`, `platform-brands.ts`, package registries, `backend/src/types/index.ts`, `backend/wrangler*.toml`, `backend/package.json` (Health migrate deny) |
| Auth/lifecycle | `auth-service.ts`, `shared-user-service.ts`, `entitlement-service.ts`, `credential-encryption.ts`, auth/shared-user/client-policy routes, provider grants, session revocation, profile projection, deletion services |
| Security/transport | `jwt.ts`, auth/service/spine/transfer/companion middleware, `rate-limit.ts` (`checkRateLimitDO`), `index.ts` (`PlatformBridgeApi`), bridge bootstrap, per-edge client |
| Transfer | smart-engine services/routes, package registry, adapters, audit outbox, `src/smart-engine/transfer.ts`, `SoftTransferImportScreen.tsx`, consent UI |
| AI | authorized gateway, `enhanced-pdf-processor.ts`, AI routes, call-site audit, `backend/lambda-processor/{handler,ai_adapters,batch_processor,job_state}.py`, `modules/realtime-audio/` (new), retire legacy voice mint routes |
| Mobile auth | `src/api/client.ts`, auth adapters, SecureStore storage, `src/stores/authStore.ts` (remove token persist), Login/Register/social, biometric, `app/_layout.tsx`, `src/config/features.ts`, `src/shared-user/` enum |
| Widget/Watch | `modules/widget-sync/ios/WidgetSyncModule.swift`, `ios/Shared/Utilities/AppGroup.swift`, Watch clients, `src/services/watch-sync.ts`, brand patchers |
| Release/ops | `eas.json`, `scripts/eas-build-brand.sh` (rewrite), `scripts/secrets/set-data-bridge.sh`, feature/AI-policy scripts, Appendix A query script |
| Tests/docs | `backend/__tests__/data-bridge/*`, Lambda/native suites, TRD, NAMING, FLEET, RELATIONSHIPS, SERVICES, `documents/engineering/privacy-retention.md` |

---

## 14. Monitoring / runbook

| Signal | Alarm / action |
|---|---|
| `/auth/platform/*`, exchange, import 5xx | Sentry P1 |
| Refresh 401 / unknown `kid` | P1 vs baseline |
| Deletion saga stuck | P1 age > SLA |
| `caller_brand_mismatch` spike | P1 pause exchange |
| AI authorize deny/timeout | P2; fail closed |
| Realtime session errors / deploy drain | P2 |
| Flag/D1 vs KV skew | Ops: trust D1 |
| Soft Transfer kill | Flip D1 control; verify 503 |

**Top failures:** House down during child login → CRUD local only, new auth fails closed; revoke lag → force refresh 401; deletion stuck → ops replay outbox; transfer House-down → 503 `house_unreachable`; Realtime outage → leave flag false.

---

## 15. Deferred

- Language platform-auth join and packages
- Health privacy/auth join and packages (then lift 0092 hold)
- Kaizen transfer packages
- Dedicated identity Worker/KMS
- OIDC Native SSO and DPoP
- Physical removal of unused House-only tables from child D1s
- Sub-30s global kill via DO write-through (optional Phase F)
- Cloudflare Agents `withVoice()` alternative to custom PCM module

---

## Appendix A — Zero-user safety queries (pre-0092 and post-0092)

Run read-only against **House, Budget, and Kaizen production** D1s. Archive stdout + timestamps under `documents/engineering/launch-zero-user-audits/`.

**Pre-0092 (current schema) — all must be 0 for “real” rows:**

```sql
-- Adjust column names to live schema; exclude known synthetic markers if any.
SELECT COUNT(*) AS users_total FROM users;
SELECT COUNT(*) AS refresh_active FROM refresh_tokens WHERE revoked_at IS NULL AND datetime(expires_at) > datetime('now');
-- Paid / AI credentials if tables exist:
-- SELECT COUNT(*) FROM subscriptions WHERE status IN ('active','trialing','past_due');
-- SELECT COUNT(*) FROM user_ai_credentials;
```

**Post-0092 (before public registration) — also 0:**

```sql
SELECT COUNT(*) FROM platform_identity_links;
SELECT COUNT(*) FROM platform_refresh_tokens WHERE revoked_at IS NULL;
SELECT COUNT(*) FROM user_app_entitlements;
SELECT COUNT(*) FROM transfer_consents;
SELECT COUNT(*) FROM platform_deletion_requests;
```

Pass: every count = 0 (or only explicitly documented synthetic ids that a reviewed cleanup removes). Fail: stop launch; do not invent remaps.
