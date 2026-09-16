Create a complete, production-ready Business Requirements Document (BRD) / Feature Specification for the Step iOS project.

**Input:** $ARGUMENTS
Can be any of:
- Jira ticket: `SS-XXXX`
- Inline description: `"Push notification preferences for live classes"`
- Both: `SS-XXXX "Push notification preferences for live classes"`

If no input is provided: ask "Please describe the feature (and optionally provide a Jira ticket number)."

---

## MANDATORY: Read Feature Requirement Template First

**Before doing anything else**, read the project Feature Specification template:

```
documents/Requirenments/Templates/Feature Requirenment Template.md
```

This template governs the **output structure** of every BRD / Feature Specification. It defines:
- **§0 Version History** — track changes across collaborators
- **§1 Feature Overview** — Summary, Scope & Dependencies, Assumptions & Constraints, Risks & Mitigation, Glossary
- **§2 Requirements & UX** — Functional Requirements (user stories), UX & Design, Non-Functional Requirements, Edge Cases, Acceptance Criteria
- **§3 Technical Documentation** — Architecture & Integration, Data Schema, API Interfaces, Testing Strategy
- **§4 Operations & Lifecycle** — Task List, Rollout Strategy, Post Release Monitoring
- **§5 Execution Strategy (AI Instructions)** — Workflow Order, Context & Standards
- **§6 AI Co-Pilot Guidance** — copy-paste prompts for implementation phases

**File naming:** `documents/Requirenments/[Feature]/[Feature]_BRD_v.1.0.md`

**Document pipeline:** **BRD** → TRD → Implementation Plan.
The BRD defines WHAT and WHY. The TRD translates it into technical contracts.

---

## MAX RESOURCES — Quality is the Only Goal

Cost is **not** a constraint. Run every agent at maximum capability:

| Setting | Value |
|---------|-------|
| **Model** | Only `Cursor Grok 4.5` (`grok-4.5-fast-xhigh`) or `Composer 2.5` (`composer-2.5-fast`) — never Claude Opus/Sonnet/Haiku or other models. Default research/review to Grok 4.5; use Composer 2.5 for diversity |
| **Parallelism** | Launch ALL research agents in a **single message** (concurrent tool calls) — never sequential |
| **Thoroughness** | `very thorough` for all Explore agents — read every relevant file completely |
| **Review cycles** | Run ALL cycles up to the maximum; only exit early when genuinely zero issues remain |
| **Synthesis** | Cross-reference ALL agent findings fully before writing output; do not rush |

---

## What is a BRD (and what it is NOT)

A **Business Requirements Document** captures the product intent and behavioral requirements before any technical design begins.

**BRD DEFINES:**
- The problem being solved and business value
- User stories and functional requirements
- UX design references and user flows
- Acceptance criteria (what "done" looks like)
- Non-functional requirements (performance, accessibility, security at a product level)
- Edge cases from a user perspective
- Rollout and monitoring strategy

**BRD DOES NOT DEFINE:**
- Database schema or API contracts — that is the TRD
- Swift/JS code patterns — that is the Implementation Plan
- Architecture decisions — that is the TRD
- Step-by-step build tasks — that is the Implementation Plan

---

## Project Structure Reference

```
step/
  Services/          ← Business logic singletons (120+ Swift files)
  APIServises/       ← Amplify GraphQL API services (28 files)
  Views/             ← SwiftUI views (200+ files across 14 subdirs)
  Models/            ← Data models
  Managers/          ← Navigation, Analytics, DeepLink, VideoPlayer
  Config/            ← Design tokens, themes

documents/Requirenments/   ← All BRDs, TRDs, Implementation Plans
```

**BRD gold-standard references in this repo:**
- `documents/Requirenments/Circle_System_Business_Requirement.md` — comprehensive Circle BRD
- `documents/Requirenments/Live_External_Activity_Tracking_BRD_v1.3.md` — activity tracking BRD
- `documents/Requirenments/Daily Readiness Check.md` — feature BRD example

---

## Phase 1 — Read & Classify

1. Read the input (Jira description or inline description).
2. Determine:
   - **Feature Name:** title-cased, 3-6 words
   - **Area:** FE / BE / FE+BE
   - **Priority:** P0 (release blocker) / P1 (core feature) / P2 (enhancement)
   - **Type:** New Feature / Enhancement / Integration

Launch Phase 2 research agents **simultaneously**.

---

## Phase 2 — Parallel Research Agents

> **PARALLELISM RULE:** Launch ALL Phase 2 agents in a **single message** with multiple concurrent Agent tool calls. Do NOT wait for one to finish before starting the next.

---

**Agent A — Codebase & Existing Feature Research** (`subagent_type: Explore`, model: **Cursor Grok 4.5** / `grok-4.5-fast-xhigh`, thoroughness: `very thorough`)

Prompt:
```
You are researching the Step iOS codebase to help write a BRD for a new feature.
Working directory: /Users/andreitekhtelev/Documents/DEVELOPMENT/step-ios-work

FEATURE DESCRIPTION: [paste full feature description from $ARGUMENTS]

Your job: find what already exists that is relevant to this feature.

1. EXISTING FEATURE INVENTORY
   - Grep for all keywords from the feature description (class names, screen names, UI strings, type names)
   - Read EVERY relevant file: views (step/Views/), services (step/Services/), managers (step/Managers/)
   - For each file: note exact path, relevant behavior, and whether it overlaps with the new feature
   - Classify: EXISTS (no change needed) / NEEDS EXTENSION / NOT YET BUILT

2. ANALOGOUS FEATURES
   - Find 2-3 similar features already in the app (similar data patterns, similar UX flows)
   - Note the user stories those features solve — to use as pattern for the new BRD
   - Record EXACT file:line for each

3. ANALYTICS BASELINE
   - Grep for Mixpanel.track, AnalyticsManager near feature area
   - Note existing event names and properties to reuse patterns

4. DESIGN SYSTEM REFERENCE
   - Find relevant existing views that the new feature should visually match
   - Note which DesignTokens, AppColors, and shared components are used

5. EXISTING REQUIREMENTS DOCS
   - Check documents/Requirenments/ for any prior BRD, TRD, or plan documents related to this feature
   - Read them if they exist — do not duplicate

6. INTEGRATION POINTS
   - What systems would this feature touch? (HealthKit, Notifications, DeepLinks, Analytics, Video)
   - Check step/Managers/ for existing integration patterns

Return:
- EXISTING CODE INVENTORY: table (Component | File:Line | Status | Notes)
- ANALOGOUS FEATURES: table (Feature | File:Line | User Story Pattern | Design Pattern)
- ANALYTICS BASELINE: existing events to reuse/extend
- DESIGN REFERENCES: existing views that set the visual bar
- PRIOR DOCS: any existing docs already covering this feature
- INTEGRATION POINTS: systems touched and existing pattern file:line
```

---

**Agent B — Product Research & Best Practices** (`subagent_type: general-purpose`, model: **Composer 2.5** / `composer-2.5-fast`) — max 4 searches

Prompt:
```
Research modern UX and product best practices for a new Step iOS feature.

FEATURE DESCRIPTION: [paste full description]
PRODUCT TYPE: iOS fitness / wellness app
TARGET USERS: health-conscious adults using Step.co for workout tracking and coaching

Run up to 4 targeted searches. Focus on user behavior and UX patterns.

1. Search: "[feature type] UX patterns mobile fitness apps 2025"
2. Search: "[feature type] iOS best practices Apple Human Interface Guidelines"
3. Search: "accessibility requirements [feature type] iOS WCAG 2.2"
4. Search: "[feature type] user engagement metrics benchmarks"

Return:
- UX PATTERNS: recommended approach with rationale
- ACCESSIBILITY REQUIREMENTS: WCAG 2.2 / Apple HIG specifics for this feature type
- ENGAGEMENT METRICS: what KPIs typically measure success for this feature type
- COMMON PITFALLS: UX mistakes to avoid
- SOURCES: URLs consulted
```

---

## Phase 3 — Synthesize & Write BRD

After all agents return, synthesize findings into a complete BRD. **Read the template in full before writing any section.** Follow the template's section structure exactly.

> **MANDATORY FIRST STEP:** Re-read `documents/Requirenments/Templates/Feature Requirenment Template.md` in full before writing. The template section structure is canonical — do not invent new sections.

---

### BRD Document Header

```markdown
# [Feature Name] — Business Requirements Document

**Feature Name:** [Feature Name]
**Product:** Step.co (iOS)
**Status:** Draft
**Version:** v0.1
**Created:** [today's date]
**Last Updated:** [today's date]
**Author:** andrei@step.co
**Stakeholders:** iOS Engineering, Product, Design
```

If Jira provided: add `**Jira:** [SS-XXXX](https://step-co.atlassian.net/browse/SS-XXXX)`

---

### Required BRD Sections (follow template structure)

---

#### § 0 — Version History

```
| Version | Date | Author | Description of Changes |
|---------|------|--------|------------------------|
| v0.1    | <today> | andrei@step.co | Initial Draft |
```

---

#### § 1 — Feature Overview

**§ 1.1 Summary**
- **Feature Name:** [title-cased, 3-6 words]
- **Status:** Draft
- **Objective:** [1-2 sentences — the problem being solved and the business value]
- **Stakeholders:** iOS Engineering, Product, Design, [others from integration points]
- **Success Metrics (KPIs):** [measurable outcomes — from Agent B findings]

**§ 1.2 Scope & Dependencies**
- **Type:** Standalone / Extension / Integration
- **Prerequisites (Upstream):** [features/services that must exist first — from Agent A findings]
- **Impacts (Downstream):** [existing features that will be modified]

**§ 1.3 Assumptions & Constraints**
- **Assumptions:** [e.g., "Users have completed onboarding", "HealthKit permissions granted"]
- **Constraints:**
  - Platform: iOS 17+ minimum; watchOS companion if applicable
  - Tech Stack: SwiftUI / AWS Amplify AppSync / DynamoDB / Lambda / Cognito
  - [Budget/Timeline if known]

**§ 1.4 Risks & Mitigation**

| Risk Type | Description | Impact | Mitigation Strategy |
|-----------|-------------|--------|---------------------|
| Technical | [e.g., API latency] | [e.g., Slow UI] | [e.g., Add caching] |
| Product | [e.g., Low adoption] | [e.g., KPI miss] | [e.g., Analytics + iteration] |

**§ 1.5 Glossary**
- [Term]: [Definition] — for any non-obvious domain terms

---

#### § 2 — Requirements & UX

**§ 2.1 Functional Requirements (User Stories)**

Write at least 3-5 user stories. Format:
```
- FR-1: "As a [user type], I can [action] so that [benefit]."
  - AC-1.1: [measurable acceptance criterion — concrete Given/When/Then]
  - AC-1.2: [next criterion]
- FR-2: ...
```

Use analogous feature patterns from Agent A to inform user stories.

**§ 2.2 User Experience (UX) & Design**
- **Design Assets:** [Link to Figma — or "TBD — design pending"]
- **User Flow:** [Describe the navigation path: which screen → what action → where they go]
- **Existing visual reference:** [From Agent A — which existing screen/component this should match]
- **Copy/Content:** [Key strings or labels needed]

**§ 2.3 Non-Functional Requirements**
- **Performance:** [e.g., Screen loads within 400ms p50]
- **Security:** [e.g., All data requires Cognito auth; no PII in analytics]
- **Internationalization:** English only / multi-language
- **Accessibility:** WCAG 2.2 AA — Dynamic Type, VoiceOver labels, 44pt tap targets (from Agent B)

**§ 2.4 Edge Cases**
Consider every realistic failure a user will encounter:
- Network Failure: [What the user sees; retry behavior]
- Empty State: [What to show when there is no data]
- Validation Errors: [User-facing error messages]
- Auth Expiry: [Redirect behavior]
- [Feature-specific edge cases from Agent A + B findings]

**§ 2.5 Acceptance Criteria (Overall)**

Feature is DONE only when:
- [ ] All FR-N user stories pass their individual AC criteria
- [ ] Empty, Loading, Error, and Offline states are handled
- [ ] Accessibility: VoiceOver labels, Dynamic Type, 44pt tap targets verified
- [ ] Analytics events fire correctly (see §4.3)
- [ ] Feature can be fully disabled via feature flag
- [ ] No regression in existing features

---

#### § 3 — Technical Documentation (High-Level)

> Note: Deep technical contracts belong in the TRD. This section captures the high-level picture for product sign-off.

**§ 3.1 Architecture & Integration**
- Which existing services are extended? (from Agent A)
- Which new services/Lambdas are needed? (high-level)
- Integration touchpoints: [HealthKit / Notifications / DeepLinks / Analytics / Video]

**§ 3.2 Data Requirements**
- What data needs to be stored? (high-level entities and key fields)
- Is data user-scoped or shared?
- Retention requirements?

**§ 3.3 API Requirements**
- Queries needed: [what data the app needs to read]
- Mutations needed: [what actions the app takes that change data]
- Real-time requirements: [subscriptions / polling needed?]

**§ 3.4 Testing Strategy**
- Unit: [what service-level behavior must be tested]
- Integration: [what end-to-end flows must be tested]
- Device testing: [specific device/iOS version requirements]

---

#### § 4 — Operations & Lifecycle

**§ 4.1 Task List (high-level)**
- [ ] Design mockups approved
- [ ] Backend schema & API defined (TRD)
- [ ] Lambda functions implemented
- [ ] iOS service layer
- [ ] iOS views
- [ ] Analytics events implemented and verified
- [ ] Accessibility review
- [ ] QA sign-off

**§ 4.2 Rollout Strategy**
- **Feature Flag:** [Key name — e.g., `circleSessionFeature`; default: `false`]
- **Rollout Sequence:** dev → stg → 10% production → 50% → 100%
- **Rollback Trigger:** [Conditions that would trigger a rollback — e.g., crash rate > 0.5%, error rate > 2%]
- **Rollback Plan:** [Disable feature flag; no data migration needed / migration steps]

**§ 4.3 Analytics & Post Release Monitoring**
- **Events to Track:**
  - [event_name]: [trigger] — Properties: [list]
  - [event_name]: [trigger] — Properties: [list]
- **Metrics to Watch Post-Launch:**
  - [KPI from §1.1] — target: [value]
  - Crash-free rate on new screens — target: > 99.5%
  - API error rate — target: < 1%
- **Alerts:** [What triggers on-call — thresholds]

---

#### § 5 — Execution Strategy (AI Instructions)

Directives for AI agents (Claude Code, Cursor) on how to build this feature.

**§ 5.1 Workflow Order**

Do not build all layers at once. Follow this strict execution order:

1. **Layer 1: TRD.** Create Technical Requirements Document first (`/create-trd`). All technical contracts must be approved before any code.
2. **Layer 2: Implementation Plan.** Create Implementation Plan from the TRD (`/create-implementation-plan`).
3. **Layer 3: Backend.** Lambda functions + GraphQL schema (Phase 1 of Implementation Plan).
4. **Layer 4: iOS Service.** Service layer + API wrappers (Phase 2).
5. **Layer 5: iOS Views.** UI components only after service is verified (Phase 3).
6. **Layer 6: Polish.** Analytics, deep links, notifications (Phase 4).

**§ 5.2 Context & Standards**

| Standard | Canonical Source |
|----------|-----------------|
| Tech Stack | SwiftUI iOS 17+ / AWS Amplify AppSync / DynamoDB / Lambda Node.js / Cognito |
| Debug Logging | `DebugConfig.Services.<flag>` — never `#if DEBUG` |
| Error Handling | `AppError` + `ErrorService.shared` — never custom error UI |
| Design Tokens | `step/Config/DesignTokens.swift` + `step/Utils/AppColors.swift` |
| Service Pattern | `@MainActor` singleton with `private init()` |
| Lambda Pattern | `aws-sdk` v2; shared role `step-lambda-shared-{env}` |

---

#### § 6 — AI Co-Pilot Guidance

Specific prompts to copy-paste when starting each document phase.

**Prompt 1: Create TRD**
```
/create-trd [path to this BRD]
```

**Prompt 2: Create Implementation Plan**
```
/create-implementation-plan [path to TRD created above]
```

**Prompt 3: Backend Implementation (paste into Cursor Agent)**
```
@[FeatureName]_Implementation.md

Act as a Backend Engineer for the Step iOS project.
Implement Phase 1 (Backend) of the Implementation Plan.
Read the Implementation Plan's Phase 1 Agent Prompt section and follow it exactly.
Start with the GraphQL schema additions, then the Lambda function.
Do NOT run amplify push — note it as a manual step.
```

**Prompt 4: iOS Implementation (paste into Cursor Agent)**
```
@[FeatureName]_Implementation.md

Act as an iOS Engineer for the Step iOS project.
Implement Phase 2 (iOS Service Layer) of the Implementation Plan.
Read the Phase 2 Agent Prompt section and follow it exactly.
Do NOT modify amplify/generated/ files.
```

---

## Phase 4 — Multi-Cycle Review Loop (up to 3 cycles)

> **PARALLELISM RULE:** Every cycle, launch all three reviewers in a **single message** with concurrent Agent tool calls. Wait for all three before synthesizing.

Three independent reviewers run simultaneously every cycle. Iterate until zero CRITICAL and zero WARNING remain. At the start of each cycle: `--- BRD REVIEW CYCLE N/3 ---`

---

**Reviewer A — Codebase & Existing Feature Accuracy** (`subagent_type: Explore`, model: **Cursor Grok 4.5** / `grok-4.5-fast-xhigh`, thoroughness: `very thorough`)

**Cycle 1 prompt:**
```
Validate this BRD against the actual Step iOS codebase at /Users/andreitekhtelev/Documents/DEVELOPMENT/step-ios-work.

BRD content: [paste full BRD text]

Verify every codebase claim:
1. EXISTING CODE CLAIMS — for every "currently exists" or "already built" claim in §3.1: glob and read the mentioned file. Flag any claim about existing behavior that doesn't match actual code as CRITICAL.
2. ANALOGOUS FEATURE ACCURACY — for every analogous feature referenced (e.g. "similar to X screen"): read the actual view/service file and confirm the analogy is accurate. Flag inaccurate analogies as WARNING.
3. ANALYTICS PATTERN — for every analytics event in §4.3: grep the codebase for the nearest existing AnalyticsManager.track() call. Confirm property format (camelCase, String types) matches project conventions.
4. INTEGRATION TOUCHPOINTS — for every system in §3.1 (HealthKit, Notifications, DeepLinks, Analytics, Video): find the actual integration file:line and confirm the claimed integration pattern matches.
5. DESIGN SYSTEM — for every referenced design component or token: confirm it exists in step/Config/DesignTokens.swift or step/Utils/AppColors.swift.
6. PRIOR DOCS — confirm no existing BRD/TRD already covers this feature (check documents/Requirenments/).

Return:
- ✅ CONFIRMED: each verified item (file:line)
- ❌ BROKEN: each inaccurate claim with what the code actually shows
- ⚠️ UNVERIFIABLE: items impossible to check and why
```

**Cycles 2–3 prompt (incremental):**
```
Re-check only BROKEN/UNVERIFIABLE items from the previous cycle.

Updated BRD: [paste full updated BRD]
Previously CONFIRMED (skip): [paste ✅ list]
Re-check list: [paste ❌ and ⚠️ lists]

Return: ✅ NOW CONFIRMED / ❌ STILL BROKEN / 🆕 NEW BROKEN / ⚠️ STILL UNVERIFIABLE
```

---

**Reviewer B — Product Completeness & Quality** (`subagent_type: Plan`, model: **Cursor Grok 4.5** / `grok-4.5-fast-xhigh`)

**Cycle 1 prompt:**
```
Deep completeness and quality review of a BRD for the Step iOS fitness app.

BRD content: [paste full BRD text]
Target users: Health-conscious adults using Step.co for workout tracking and coaching.

Evaluate:

1. USER STORY COMPLETENESS — does every FR-N have at least one concrete AC in Given/When/Then format? "Works correctly" is NOT acceptable. Flag missing or vague ACs as CRITICAL.

2. SCOPE CLARITY — is the Out of Scope list explicit enough to prevent scope creep? List 3 features that a developer might build that are NOT in scope — are they excluded? Flag insufficient scope definition as WARNING.

3. EDGE CASE COVERAGE — does §2.4 cover ALL realistic failure modes: network failure, empty state, validation errors, auth expiry, offline, rate limiting? Flag missing critical edge cases as CRITICAL.

4. ANALYTICS COMPLETENESS — does §4.3 have an event for every major user action defined in the FR-N stories? An FR without a corresponding analytics event means the feature cannot be measured post-launch. Flag each gap as WARNING.

5. NFR SPECIFICITY — does §2.3 have measurable thresholds? "Fast" is not acceptable — require specific ms numbers. Flag vague NFRs as WARNING.

6. ROLLOUT SAFETY — does §4.2 define a feature flag name, rollout sequence, and specific rollback trigger conditions? Flag missing rollback triggers as WARNING.

7. DEPENDENCY COMPLETENESS — does §1.2 list every upstream prerequisite that must exist before this feature can ship? Flag missed dependencies as CRITICAL.

8. STAKEHOLDER COMPLETENESS — are all relevant stakeholders listed who would be impacted by or need to sign off on this feature? Flag missing stakeholders as WARNING.

9. PIPELINE READINESS — is the BRD ready to hand to /create-trd? Flag any open product decisions that must be resolved first as CRITICAL.

Return: CRITICAL / WARNING / SUGGESTION (reference §section and FR number for each).
```

**Cycles 2–3 prompt (delta):**
```
Delta review of updated BRD. Focus only on whether previous issues were resolved.

Updated BRD: [paste full updated BRD]
Previous cycle: CRITICAL: [list] / WARNING: [list]

For each: ✅ RESOLVED / ❌ STILL CRITICAL / ⚠️ STILL WARNING / 🆕 NEW CRITICAL / 🆕 NEW WARNING.
```

---

**Reviewer C — Independent UX & Scope Review** (`subagent_type: Plan`, model: **Composer 2.5** / `composer-2.5-fast`)

**Cycle 1 prompt:**
```
Independent adversarial review of a BRD for Step iOS. You have NOT seen any prior review. Find what the other reviewers missed.

BRD content: [paste full BRD text]

Be contrarian:

1. SCOPE CREEP VECTORS — what features are implied by the FR user stories but not explicitly defined? If a developer reads this and builds "the obvious next thing," what would that be? Each implied feature is a scope risk. Flag as WARNING.

2. USER JOURNEY GAPS — trace the full user journey for each FR. Are there screens, states, or interactions that must exist for the FR to work but are not defined? Flag each gap as CRITICAL.

3. MISSING UNHAPPY PATHS — what will real users hit within 30 days of launch that is NOT covered in §2.4 edge cases?
   - What if the user has an extremely slow connection?
   - What if the data volume is 10x the expected amount?
   - What if the user opens this feature for the first time with no data?
   Flag each missing edge case as WARNING.

4. ANALYTICS BLIND SPOTS — is there any user behavior that would tell you the feature is failing (not just succeeding) that isn't tracked? E.g., rage taps, drop-off mid-flow, repeated error retries. Flag missing failure metrics as WARNING.

5. ACCESSIBILITY GAPS — are there user interactions in the FRs that could be inaccessible? (e.g. gesture-only interactions, color-only state indicators, time-limited actions) Flag as WARNING.

6. MOST LIKELY SCOPE DISPUTE — in one sentence: what requirement in this BRD is most likely to cause a "that's not what we meant" conversation during implementation?

Return: CRITICAL / WARNING / SUGGESTION, plus "MOST LIKELY SCOPE DISPUTE:" (1 sentence).
```

**Cycles 2–3 prompt (delta):**
```
Delta independent review of updated BRD.

Updated BRD: [paste full updated BRD]
Previous cycle: CRITICAL: [list] / WARNING: [list]

For each: ✅ RESOLVED / ❌ STILL CRITICAL / ⚠️ STILL WARNING / 🆕 NEW CRITICAL / 🆕 NEW WARNING.
Updated MOST LIKELY SCOPE DISPUTE (1 sentence).
```

---

### Cycle Decision Logic

After all three reviewers return, consolidate:

```
=== BRD REVIEW CYCLE N/3 ===

CRITICAL (must fix — blocks TRD hand-off):
- [merged from all three reviewers, or "None"]

WARNING (should fix — reduces quality):
- [merged, or "None"]

MOST LIKELY SCOPE DISPUTE: [from Reviewer C]
```

**Decision:**
- **Zero CRITICAL and zero WARNING** → BRD is READY. Go to Phase 5. Stop cycling.
- **Issues found + cycles remaining** → fix all CRITICAL and WARNING. Create a new version file (v0.1 → v0.2 → v0.3). Proceed to next cycle.
- **3 cycles reached** → go to Phase 5, flag all unresolved items.

### Creating a New Version File

Increment version, apply all fixes, update header and revision history. Announce: `Created v0.X — proceeding to Cycle N+1.`

---

## Phase 5 — Save File & Jira

### ⚠️ Large Document — Multi-Part Writing

Before writing, estimate document length (section count × avg lines per section). Documents > 400 lines must be split to avoid the `API Error: Claude's response exceeded the 32000 output token maximum`.

| Estimated lines | Parts |
|----------------|-------|
| < 400 | 1 — single Write call |
| 400–700 | 2 — split at a `##` section boundary |
| > 700 | 3 — split at two `##` section boundaries |

**How to split:**
1. Announce: `📄 Large document (~{N} lines) — writing in {2|3} parts.`
2. **Part 1**: Write tool — content up to a natural `##` boundary, ending with `<!-- PART_2_CONTINUES -->`
3. **Part 2**: Edit tool — `old_string: "<!-- PART_2_CONTINUES -->"` → next sections (+ `<!-- PART_3_CONTINUES -->` if 3 parts)
4. **Part 3**: Edit tool — `old_string: "<!-- PART_3_CONTINUES -->"` → final sections
5. Between parts announce: `✅ Part {N} written. Writing Part {N+1}...`

### Step 1 — Write the file

Determine the output path:
```
documents/Requirenments/[FeatureName]/[FeatureName]_BRD_v.1.0.md
```

Examples:
- `documents/Requirenments/CircleSession/CircleSession_BRD_v.1.0.md`
- `documents/Requirenments/LiveExternalActivity/LiveExternalActivity_BRD_v.1.0.md`
- `documents/Requirenments/PushNotificationPreferences/PushNotificationPreferences_BRD_v.1.0.md`

If there is already a subdirectory for this feature area, use it.

### Step 2 — Run Jira script

Only if no Jira ticket was provided in $ARGUMENTS:
```bash
python3 Scripts/create_jira_ticket.py "documents/Requirenments/[FeatureName]/[FeatureName]_BRD_v.1.0.md"
```

If Jira ticket was already provided: skip (ticket already exists).

If `.env` is missing: warn "Set up `.env` with JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY before running the Jira script."

### Step 3 — Final output

```
=== BRD CREATED ===

File: documents/Requirenments/[FeatureName]/[FeatureName]_BRD_v.1.0.md
Area: FE / BE / FE+BE
Priority: P0 / P1 / P2
Jira: SS-XXXX (created / pre-existing / skipped)

BRD Summary:
- User stories: N (FR-1 through FR-N)
- Acceptance criteria: N total
- Edge cases covered: N
- Analytics events: N
- Integration points: [list]

⚠️ Open items requiring product sign-off before TRD:
  - [list from §1.4 Risks or §2.4 Edge Cases that need decisions]

Next step: Get product approval on §2.1 Functional Requirements, then run /create-trd with this BRD.
```

---

## Style Rules (always enforce)

- User stories in FR-N format with Given/When/Then acceptance criteria
- Tables for: risks, dependencies, analytics events, task list
- No implementation-specific details (no file paths, no Swift code, no GraphQL) — that belongs in TRD
- Reference existing analogous screens/patterns from Agent A findings
- Mark any item requiring product decision clearly with `⚠️ NEEDS PRODUCT DECISION`
- The document must be readable by non-engineers — avoid technical jargon without explanation
- Every edge case must have an explicit user-facing outcome (not just "handle gracefully")
