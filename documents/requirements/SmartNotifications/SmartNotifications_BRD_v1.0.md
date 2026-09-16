# Smart Notifications — Business Requirements Document

| Field | Value |
|-------|-------|
| **Product** | SimpleHouse (iOS / Android — React Native + Expo; Cloudflare Workers backend) |
| **Feature Name** | Smart Notifications — AI-Driven, Fatigue-Aware Household Engagement |
| **Status** | Draft |
| **Owner** | Product / Engineering |
| **Version** | v1.0 |
| **Created** | 2026-06-23 |
| **Last Updated** | 2026-06-23 |
| **Author** | andrei@step.co |
| **Stakeholders** | Mobile Engineering, Backend Engineering, Product, Design, QA, Data |

> **Document pipeline:** **BRD** → TRD → Implementation Plan. This BRD defines WHAT and WHY. The companion [SmartNotifications_TRD_v1.0.md](SmartNotifications_TRD_v1.0.md) defines the technical contracts.

> **Framing.** SimpleHouse already has a *mature* notification platform: Expo push delivery, per-user device tokens, 13 per-category preference toggles, quiet hours, thread grouping, rich content, A/B testing, send-time optimization, engagement logging, and a per-task/space/category override system. **Smart Notifications is an intelligence layer on top of that platform — not a replacement.** It decides *whether* to send, *to whom*, *what to say*, and *via which surface*, and it learns from outcomes. The existing [NotificationService](../../../backend/src/services/notification-service.ts) remains the canonical delivery path; every smart notification still flows through it to Expo.

---

## 0. Version History

| Version | Date | Author | Description of Changes |
|---------|------|--------|------------------------|
| v1.0 | 2026-06-23 | andrei@step.co | Initial BRD. Defines the Smart Notifications intelligence layer over the existing SimpleHouse notification platform: a unified send gateway, cross-type frequency/fatigue control, recipient intelligence, dedup/batching, AI-generated copy with fallback, and outcome learning. Phased P1 (telemetry/parity) → P2 (AI copy beta) → P3 (per-household learning). |

---

## 1. Feature Overview

### 1.1 Summary

- **Feature Name:** Smart Notifications
- **Status:** Draft
- **Objective:** Households on SimpleHouse receive a growing volume of notifications — task reminders, overdue alerts, garbage collection, report-ready, task drafts, critical findings, AI Housekeeper suggestions, garden-plan status. Today each producer sends independently with hardcoded copy and only per-type opt-out, so a busy week can produce a notification storm, the *wrong household member* can be pinged, and copy is generic. Smart Notifications adds a shared decision + learning layer that **reduces noise, routes to the right person, personalizes copy, and improves timing** — increasing the chance a notification leads to a completed task rather than a dismissal or an opt-out.
- **Stakeholders:** Mobile Engineering, Backend Engineering, Product, Design, QA, Data.
- **Success Metrics (KPIs):**
  - **Tap-through rate** on actionable notifications: **≥ 12%** (baseline TBD from `notificationHistory`/`notificationEngagement`).
  - **Task-completion attribution:** notifications that lead to the referenced task being completed within 48h — **+10%** vs. pre-launch baseline.
  - **Opt-out rate** per smart category: **< 5%** cumulative (read from `notificationPreferences` toggle-off events).
  - **Volume reduction:** average daily push count per active user **−20%** with no drop in task completion (dedup/batching/fatigue control working).
  - **Learning lift (P3):** per-household learned send-time/recipient profiles beat defaults on tap-through over time.
  - **Safety:** zero notifications sent during quiet hours without an approved bypass; zero AI-generated copy shipped that fails the safety/fallback check.

### 1.2 Scope & Dependencies

- **Type:** Extension / Integration (intelligence layer over the existing notification platform; touches every producer).
- **In Scope:**
  - A **Smart Notification gateway** that all producers route through before `NotificationService.sendNotification()`, applying cross-type frequency capping, fatigue dampening, dedup/batching, and recipient resolution.
  - **Recipient intelligence:** decide which household member(s) receive a given notification (assignee, household role, per-user engagement) instead of blasting everyone.
  - **Cross-type dedup & batching:** collapse redundant/related notifications (e.g., same task's reminder + overdue same day; multiple AI suggestions) into one push while preserving individual history rows.
  - **Urgency lanes** for *all* types (not just AI suggestions): immediate (action-required) vs. optimizable (timing-flexible).
  - **AI-generated copy** (via the existing [AI provider abstraction](../../../backend/src/ai/provider.ts)) for selected categories, with mandatory safe fallback to today's templates.
  - **Outcome learning:** extend the existing engagement/send-time tables to learn frequency tolerance, best recipient, and tone per household/user; opt-out as a learning signal.
  - **Per-category user preferences** for the new smart categories (reuse `notificationPreferences`).
- **Out of Scope (v1.0):**
  - Replacing the Expo push transport, `NotificationService`, device-token registry, or the notification-center/history surfaces. These remain canonical.
  - New delivery channels (SMS, web push). Email exists in preferences but multi-channel orchestration is **not** in scope; push remains primary.
  - A self-serve admin console for flipping producers (a future surface; see §1.2 Future Surfaces).
  - Transactional/security/billing notifications — these are not "smart" and bypass the intelligence layer entirely.
  - Localized AI copy — English only in v1.0.
- **Prerequisites (Upstream):**
  - Existing notification platform: [notification-service.ts](../../../backend/src/services/notification-service.ts), [reminder-service.ts](../../../backend/src/services/reminder-service.ts), [schema-notifications.ts](../../../backend/src/db/schema-notifications.ts), [routes/notifications.ts](../../../backend/src/routes/notifications.ts), mobile [useNotificationHandler](../../../src/hooks/useNotificationHandler.ts) + [services/notifications.ts](../../../src/services/notifications.ts).
  - AI provider abstraction with Claude + Gemini ([backend/src/ai/provider.ts](../../../backend/src/ai/provider.ts)).
  - The `scheduled()` cron handler ([backend/src/index.ts](../../../backend/src/index.ts)) that already dispatches `processScheduledNotifications`, reminders, and the AI Housekeeper worker.
  - **Global feature flags** ([feature-flag system](../FeatureFlags/FeatureFlags_BRD_v1.0.md)) to gate the rollout app-wide.
- **Impacts (Downstream):** Every notification producer (task reminders, garbage, reports, task drafts, AI Housekeeper, garden plans), the engagement/optimization tables, and the mobile preferences UI.

**Future Surfaces (Conditional, Not Committed):**

| Surface | Triggering demand | Expected scope |
|---|---|---|
| Notification admin console | Ops needs to pause/force-fallback a producer without a deploy | Thin internal page over a producer-state store + the existing feature flags |
| Multi-channel (email/SMS) | Product validates a need for non-push reach | Channel-selection policy per category; email body already has a generator |
| Per-household tone presets | Households ask to set a voice (concise / encouraging) | A preset that biases AI copy generation |

### 1.3 Assumptions & Constraints

- **Assumptions:**
  - The existing tables (`pushTokens`, `notificationPreferences`, `scheduledNotifications`, `notificationHistory`, `notificationEngagement`, `userOptimalSendTimes`, `notificationAbTests`) are the substrate; Smart Notifications extends them additively.
  - Households are small (a handful of members); recipient resolution is cheap.
  - Near-real-time learning is unnecessary; the cron cadence (per-minute dispatch, 6-hourly AI worker) is sufficient.
  - AI copy generation is acceptable for *scheduled/optimizable* notifications, **not** on the critical path of immediate sends.
- **Constraints:**
  - **Platform:** React Native 0.81 / Expo 54; backend on Cloudflare Workers (Hono) + D1 + KV + Durable Objects + Queues. Cron is production-only (5-cron account limit).
  - **Delivery:** All push goes through Expo Push API via `NotificationService.sendExpoPushNotification()`.
  - **Per-environment:** staging and production have separate D1 / KV; rollout flags and migrations apply per environment.
  - **Safety-by-default:** quiet hours, per-category opt-out, and permission checks always win over engagement optimization. AI copy must never bypass a guardrail.
  - **Backward compatibility:** introducing the gateway must be behavior-preserving in P1 (same copy, same timing) until parity is proven per producer.

### 1.4 Risks & Mitigation

| Risk Type | Description | Impact | Mitigation Strategy |
|-----------|-------------|--------|---------------------|
| Product | Over-aggressive dedup/batching hides a time-critical alert | User misses garbage day / critical finding | Immediate (Lane A) types are never held/batched; dedup only within optimizable types |
| Technical | AI copy is wrong, off-tone, or unsafe | User confusion, trust loss | Mandatory schema + safety validation; fallback to existing template copy; AI off by default, beta-gated |
| Technical | AI generation latency/cost on send path | Delayed or expensive sends | AI only for scheduled/optimizable notifications; degrade to fallback under load; cost-capped per run |
| Product | Wrong recipient chosen (notify member who can't act) | Task not done, noise for others | Default to task assignee + household owner; recipient rules are explicit and conservative; opt-out is a signal |
| Technical | Gateway regresses existing producers | Missing/late/dup notifications | P1 parity gate per producer (≥7 days behavior-identical) before any smart behavior turns on |
| Product | Fatigue dampening suppresses too much | Engagement drops | Dampening has floors; safety/critical types exempt; monitored via volume + completion KPIs |
| Privacy | AI prompt/log leaks household data | Compliance/trust | Redacted logging (no copy/PII/tokens in logs); AI prompts use minimal household context; retention limits |

### 1.5 Glossary

- **Producer:** Any code path that creates a notification (task reminder, garbage, report-ready, AI Housekeeper suggestion, garden-plan status, …).
- **Smart Notification gateway:** The shared decision layer all producers call before the canonical `NotificationService` send. Resolves recipient, lane, dedup/batch, fatigue, and copy.
- **Lane A (immediate):** Time-critical / action-required notifications (garbage tonight, critical finding, task overdue). Sent promptly; never batched or held.
- **Lane B (optimizable):** Useful but timing-flexible (task reminder days ahead, AI suggestions, weekly summary). Eligible for timing optimization, batching, and fatigue control.
- **Fatigue dampening:** Reducing send frequency for a user/household when engagement (taps) drops or volume exceeds a learned tolerance.
- **Recipient intelligence:** Choosing which household member(s) receive a notification, vs. broadcasting to all.
- **AI copy:** Notification title/body generated by the AI provider from household context, replacing the hardcoded template, with a guaranteed fallback.
- **Outcome / engagement:** Delivery, tap, action (snooze/complete/dismiss), and downstream task completion — already partly captured in `notificationEngagement`.

---

## 2. Requirements & UX

### 2.1 Functional Requirements (User Stories)

- **FR-1 — One front door for all producers.** *As an engineer, every notification producer routes through one smart gateway before delivery, so that frequency, recipient, dedup, and copy policy are applied consistently instead of per-producer.*
  - AC-1.1: **Given** any producer (task/garbage/report/AI/garden), **when** it emits a notification, **then** it calls the gateway, which (in P1) forwards to the existing `NotificationService` with identical copy/timing.
  - AC-1.2: **Given** the gateway is disabled by feature flag, **when** a producer emits, **then** behavior is exactly as today (full bypass / safe fallback).

- **FR-2 — Reduce notification storms.** *As a household member, I receive fewer, consolidated notifications, so that a busy maintenance week doesn't bury me in pushes.*
  - AC-2.1: **Given** a task has both a "due soon" reminder and becomes overdue on the same day, **when** the gateway processes them, **then** the user receives a single consolidated push (history still records both events).
  - AC-2.2: **Given** multiple Lane B notifications queued for one user in a short window, **when** they exceed the batch threshold, **then** they collapse into one summary push linking to a list, while each remains an individual notification-history row.
  - AC-2.3: **Given** the daily Lane B cap is reached for a user, **when** another optimizable notification qualifies, **then** it is deferred or dropped per policy and the decision is logged — Lane A is unaffected.

- **FR-3 — Notify the right person.** *As a household member, I am only notified about things I can act on, so that I'm not pinged for another member's assigned task.*
  - AC-3.1: **Given** a task with an assignee, **when** a reminder fires, **then** the assignee is notified (and the household owner per policy), not every member.
  - AC-3.2: **Given** a household-wide event (report ready), **when** it fires, **then** the recipient set follows an explicit rule (e.g., uploader + owner), not an unconditional broadcast.
  - AC-3.3: **Given** a chosen recipient has the relevant category disabled or is in quiet hours, **then** they are suppressed individually without affecting other recipients.

- **FR-4 — Personalized copy with safe fallback.** *As a household member, notification copy is relevant and clear (and, for smart categories, AI-personalized to my home), so that I understand why it matters — without ever receiving broken or unsafe text.*
  - AC-4.1: **Given** a smart category with AI copy enabled, **when** a notification is generated, **then** the AI output is schema- and safety-validated before send.
  - AC-4.2: **Given** AI generation fails, times out, or fails validation, **then** the gateway sends today's hardcoded template copy instead (never no notification, never broken copy).
  - AC-4.3: **Given** AI copy is disabled (default / non-beta), **then** existing template copy is used unchanged.

- **FR-5 — Respect timing, quiet hours, and opt-out.** *As a household member, smart notifications honor my quiet hours and category opt-outs immediately, so that the system never feels intrusive.*
  - AC-5.1: **Given** quiet hours are set, **when** a Lane B notification would send during them, **then** it is deferred to the next allowed window (Lane A may bypass only if the type is approved).
  - AC-5.2: **Given** a user toggles a smart category off, **when** the change is saved, **then** future sends for that category stop and any queued entries for it are cancelled.
  - AC-5.3: **Given** send-time optimization data exists for a user, **when** a Lane B notification is scheduled, **then** it targets the user's learned best hour within allowed windows.

- **FR-6 — Learn from outcomes.** *As the product, the system learns which notifications work per household, so that timing, recipient, and frequency improve over time.*
  - AC-6.1: **Given** a notification is delivered/tapped/actioned/dismissed, **when** the outcome is recorded, **then** it updates per-user/household engagement used by the next decision.
  - AC-6.2: **Given** sustained low engagement or an opt-out, **when** the next eligibility check runs, **then** frequency for that user/category is dampened (with a floor for safety types).

- **FR-7 — Phased, parity-safe rollout.** *As the team, we migrate producers behind the gateway with proven parity before enabling any smart behavior, so that no existing notification regresses.*
  - AC-7.1: **Given** a producer migrated to the gateway in pass-through mode, **when** it runs for ≥7 days, **then** its delivery behavior matches the pre-gateway baseline before smart features are enabled for it.
  - AC-7.2: **Given** a smart behavior misbehaves, **when** ops flips the feature flag (or per-producer mode to passthrough), **then** behavior reverts without a deploy.

### 2.2 User Experience (UX) & Design

- **Design Assets:** TBD — design pending. Most behavior is invisible (fewer/better notifications). New UI is limited to preference toggles.
- **User Flow:** Producer event → gateway decision (recipient, lane, dedup, copy) → `NotificationService` → Expo push → tap routes via the existing [useNotificationHandler](../../../src/hooks/useNotificationHandler.ts) `data.type` switch to the correct screen.
- **Existing visual reference:** New smart-category toggles match the current notification preferences UI driven by [src/api/notifications.ts](../../../src/api/notifications.ts) (`GET/PATCH /notifications/preferences`). Batched/summary pushes reuse the existing thread-grouping and rich-content patterns in `NotificationService`.
- **Copy/Content:** Smart-category labels (e.g., "Smart Coaching", "Weekly Summary") in preferences. Batched-summary copy template ("3 home tasks need attention"). AI copy follows a per-category prompt with a fallback template string.

### 2.3 Non-Functional Requirements

- **Performance:** Gateway decision adds **≤ 50ms p95** for pass-through sends. AI copy generation is off the immediate path; for scheduled sends, generation must complete within the cron tick budget or fall back.
- **Security:** All write/preference operations are auth-gated (existing JWT middleware). No notification copy, route params, device tokens, or raw AI prompts in logs. Recipient resolution respects household membership.
- **Internationalization:** English only in v1.0; AI copy generation is English-only.
- **Accessibility:** No new always-on UI beyond toggles; preference toggles must meet the app's existing accessibility bar (labels, Dynamic Type, 44pt targets). A suppressed/hidden notification must not leave a dead UI affordance.
- **Reliability:** Gateway/AI failure degrades to existing template send; the system must never drop a Lane A notification due to a smart-layer error.

### 2.4 Edge Cases

- **AI generation fails / times out:** Send existing template copy (FR-4.2). Logged as `ai_fallback`.
- **No device token / push permission off:** No push; notification still recorded in history per existing behavior.
- **Quiet hours boundary (e.g., 10:00 PM):** Lane B deferred to next window; Lane A sends only if the type is approved to bypass.
- **All chosen recipients suppressed (opt-out / quiet / no token):** No push sent; decision logged; no error surfaced to user.
- **Dedup race (reminder + overdue arrive seconds apart):** Gateway consolidates within a short window keyed by task; both events still logged to history.
- **Fatigue floor:** Even under heavy dampening, safety/critical types (overdue, critical findings, garbage-missed) are never suppressed below their floor.
- **Cron skipped/delayed (production-only cron):** Scheduled smart notifications dispatch on the next tick; no duplicates (idempotent on `scheduledNotifications`).
- **Household with one member:** Recipient resolution trivially selects that member; no broadcast logic needed.
- **Feature flag off mid-flight:** New emits bypass the gateway; already-queued smart entries fall back to template send.
- **A/B test + AI copy interaction:** AI copy and A/B variant selection must not both rewrite the same notification — policy picks one source of copy per send (logged).

### 2.5 Acceptance Criteria (Overall)

Feature is DONE only when:
- [ ] All FR-1…FR-7 pass their individual ACs.
- [ ] Every existing producer routes through the gateway and passes a ≥7-day parity gate before smart behavior is enabled for it.
- [ ] Lane A (immediate/critical) is never held, batched, or dropped by the smart layer.
- [ ] AI copy always has a verified fallback; no broken/unsafe copy can ship.
- [ ] Quiet hours and category opt-outs are honored 100% (no smart bypass).
- [ ] Volume and completion KPIs are instrumented from `notificationEngagement` / `notificationHistory`.
- [ ] The whole feature and each smart behavior can be disabled by feature flag without a deploy.
- [ ] No regression in existing notification delivery (parity telemetry clean).

---

## 3. Technical Documentation (High-Level)

> Deep contracts (gateway interface, decision schema, AI prompt/output contract, table extensions, state machine) live in the [TRD](SmartNotifications_TRD_v1.0.md).

### 3.1 Architecture & Integration

- **Extended services:** [NotificationService](../../../backend/src/services/notification-service.ts) (remains canonical delivery), [ReminderService](../../../backend/src/services/reminder-service.ts), [AINotificationOrchestrator](../../../backend/src/services/ai-notification-orchestrator.ts) (already does frequency capping + batching for AI suggestions — generalize it), [NotificationOptimizationService](../../../backend/src/services/notification-optimization-service.ts) (send-time), [NotificationOverrideService](../../../backend/src/services/notification-override-service.ts).
- **New component:** a Smart Notification gateway that producers call; it composes recipient resolution, lane classification, dedup/batch, fatigue/frequency check, optional AI copy, then delegates to `NotificationService`.
- **AI integration:** new notification-copy prompt(s) under [backend/src/ai/prompts/](../../../backend/src/ai/prompts/), invoked through the [provider abstraction](../../../backend/src/ai/provider.ts) (never the SDK directly).
- **Scheduling:** continues via the `scheduled()` cron in [backend/src/index.ts](../../../backend/src/index.ts).
- **Touchpoints:** mobile tap routing ([useNotificationHandler](../../../src/hooks/useNotificationHandler.ts)) and preferences ([api/notifications.ts](../../../src/api/notifications.ts)) — additive only.

### 3.2 Data Requirements

- **Reuse:** `pushTokens`, `notificationPreferences` (13 toggles + quiet hours + timezone), `scheduledNotifications`, `notificationHistory`, `notificationEngagement`, `userOptimalSendTimes`, A/B tables, calendar `notificationOverrides`.
- **New (additive):** a smart-decision record per notification (lane, recipient rule applied, dedup/batch role, copy source = template|ai|abtest, suppression/defer reason) and per-household/user learned fatigue tolerance + best recipient. Likely additive columns/JSON on existing tables or one new `smartNotificationDecision` table — finalized in the TRD.
- **Scope:** household- and user-scoped; no new PII; AI copy is per-send, not used to train shared models.
- **Retention:** detailed decision/engagement rows retained for a limited window; aggregates longer (TRD to define exact periods).

### 3.3 API Requirements

- **Reads:** existing `GET /notifications/preferences`, `/history`, `/unread-count`.
- **Writes:** existing `PATCH /notifications/preferences` extended with the new smart-category toggles; existing token + override endpoints unchanged.
- **Internal:** the gateway is an internal service call, not a public endpoint. No new client-facing notification-send API.
- **Real-time:** none beyond existing push; decisions run server-side on cron/producer events.

### 3.4 Testing Strategy

- **Unit:** recipient resolution rules; lane classification; dedup/batch logic; fatigue/frequency capping with floors; AI output validation + fallback; quiet-hours/opt-out suppression.
- **Integration:** producer → gateway → `NotificationService` → (mocked) Expo; parity test that pass-through mode matches pre-gateway output; opt-out cancels queued entries.
- **E2E:** assignee-only reminder; consolidated reminder+overdue; batched Lane B summary; AI-fallback path; quiet-hours deferral.
- **Edge/failure:** AI timeout, all-recipients-suppressed, dedup race, cron delay idempotency.

---

## 4. Operations & Lifecycle

### 4.1 Task List (high-level)

- [ ] TRD approved (gateway interface, decision schema, AI contract, table changes)
- [ ] D1 migrations (additive) for smart-decision + learned-fatigue data
- [ ] Smart Notification gateway (recipient, lane, dedup/batch, fatigue, copy-source selection)
- [ ] Migrate all producers to call the gateway in pass-through mode
- [ ] Parity telemetry + per-producer parity gate
- [ ] AI copy prompt(s) + provider wiring + validation/fallback
- [ ] Extend `notificationPreferences` with smart-category toggles + mobile UI
- [ ] Learning loop (fatigue tolerance, best recipient) over engagement data
- [ ] Analytics dashboards + alerts
- [ ] QA sign-off; feature-flag rollout

### 4.2 Rollout Strategy

- **Feature Flags:** a master `smartNotifications` flag (default `false`) plus per-producer pass-through/smart mode; AI copy behind a separate `smartNotificationsAiCopy` flag (default `false`). Use the [global feature-flag system](../FeatureFlags/FeatureFlags_BRD_v1.0.md).
- **Sequence:** P1 gateway in pass-through (all producers) → prove ≥7-day parity → enable dedup/batch/fatigue (P1.5) → P2 AI copy for a beta cohort on one category (AI Housekeeper suggestions or task reminders) → P3 per-household learning + experiments → broaden.
- **Rollback Trigger:** delivery-rate drop, opt-out spike (>2× baseline), completion-rate regression, AI error/fallback rate spike, or any Lane A miss.
- **Rollback Plan:** flip `smartNotifications` (or a producer's mode) to passthrough/off — no data migration; producers resume direct `NotificationService` sends.

### 4.3 Analytics & Post-Release Monitoring

- **Events to track** (extend existing engagement logging): `smart_notification_decided` (lane, recipientRule, copySource, dedup/batch role, suppress/defer reason), `smart_notification_sent`, `…_delivered`, `…_tapped`, `…_actioned`, `…_opt_out`, `ai_copy_generated` / `ai_copy_fallback`, `smart_batch_emitted`.
- **Metrics to watch:** tap-through rate; daily push volume per user; task-completion-after-notification; opt-out rate per smart category; AI fallback rate; Lane B hold/batch counts; quiet-hours deferrals.
- **Alerts:** delivery rate < 90% sustained; opt-out spike > 2× baseline; AI fallback rate high; any Lane A suppression; zero smart sends during active hours (pipeline down).
- ⚠️ NEEDS PRODUCT DECISION: which category is the **first** to get AI copy in P2 (AI Housekeeper suggestions vs. task reminders), and the exact recipient rules per producer (§FR-3).

---

## 5. Execution Strategy (AI Instructions)

### 5.1 Workflow Order

1. **Layer 1 — TRD.** Author the [TRD](SmartNotifications_TRD_v1.0.md): gateway interface, decision/state model, AI copy contract, additive D1 schema, parity-gate definition, analytics schema.
2. **Layer 2 — Backend foundation (P1).** Gateway + producer migration in pass-through; parity telemetry. No AI, no smart behavior yet.
3. **Layer 3 — Smart behavior (P1.5).** Recipient rules, dedup/batch, fatigue/frequency capping — flag-gated, per-producer after parity.
4. **Layer 4 — AI copy (P2).** Prompt(s) + provider + validation/fallback; beta cohort, one category.
5. **Layer 5 — Mobile.** Smart-category preference toggles; verify tap routing for any new/batched payloads.
6. **Layer 6 — Learning (P3).** Fatigue tolerance + best-recipient learning; experiments; dashboards.

### 5.2 Context & Standards

| Standard | Canonical Source |
|----------|-----------------|
| Mobile stack | React Native 0.81 / Expo 54 / expo-notifications / Zustand / React Query |
| Backend stack | Cloudflare Workers (Hono) / D1 (Drizzle) / KV / DO / Queues — see [CLAUDE.md](../../../CLAUDE.md) |
| Delivery (canonical) | `NotificationService.sendExpoPushNotification()` → Expo Push API |
| Scheduling | `scheduled()` cron in [backend/src/index.ts](../../../backend/src/index.ts) (production-only) |
| AI access | Always via [backend/src/ai/provider.ts](../../../backend/src/ai/provider.ts); prompts in [ai/prompts/](../../../backend/src/ai/prompts/) |
| Errors | Named service errors → `app.onError` (masked in prod) |
| Backend deploy | staging **and** production together (project rule) |
| Rollout control | [Global feature flags](../FeatureFlags/FeatureFlags_BRD_v1.0.md) |
| Entitlements (NOT this) | [SubscriptionContext](../../../src/contexts/SubscriptionContext.tsx) |

---

## 6. AI Co-Pilot Guidance

**Prompt 1 — Create the TRD**
```
/create-trd documents/Requirenments/SmartNotifications/SmartNotifications_BRD_v1.0.md
Ground every contract in the EXISTING platform: notification-service.ts, schema-notifications.ts,
reminder-service.ts, ai-notification-orchestrator.ts, useNotificationHandler.ts. Define the gateway
interface, the decision/state model, the AI copy output+fallback contract, additive D1 changes, the
per-producer parity-gate, and the analytics schema. Keep NotificationService as canonical delivery.
```

**Prompt 2 — Backend P1 (gateway + parity)**
```
Act as a SimpleHouse backend engineer. Implement the Smart Notification gateway in pass-through mode and
route every producer through it without changing copy or timing. Add parity telemetry. Gate behind the
`smartNotifications` feature flag (default false). Do not add AI or dedup yet.
```

**Prompt 3 — AI copy (P2, beta)**
```
Add a per-category notification-copy prompt under backend/src/ai/prompts/ and generate copy through the
provider abstraction for ONE beta category. Schema- and safety-validate output; on any failure, fall back
to the existing template copy. Gate behind `smartNotificationsAiCopy` (default false).
```
