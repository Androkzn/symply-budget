Create a complete, production-ready Technical Requirements Document (TRD) for the Step iOS project.

**Input:** $ARGUMENTS
Can be any of:
- Path to a BRD: `documents/Requirenments/Feature/BRD.md`
- Jira ticket: `SS-XXXX`
- Both: `SS-XXXX documents/Requirenments/Feature/BRD.md`
- Inline description: `"Push notification preferences for live classes"`

If no input is provided: ask "Please provide the BRD file path or a feature description (and optionally a Jira ticket number)."

---

## ⚡ REVIEW MODE — Detect Before Starting

**Check `$ARGUMENTS` before doing anything else:**

If `$ARGUMENTS` is a path to an **existing TRD file** (matches `*_TRD*.md` or `*TRD_v*.md`), activate **Review & Patch mode**:

1. Read the existing TRD file in full.
2. Extract all factual claims: `file:line` references, config values, file existence assertions, line numbers, bundle IDs, env var values, Lambda event shapes.
3. Launch a **single targeted verifier agent** (not 3 full research agents) to spot-check those specific claims against the codebase and AWS.
4. Collect all confirmed errors. Apply all fixes to produce a new version file (`_v1.X.md`).
5. **Skip Agent B entirely** (web research already done in the original TRD).
6. **Skip Phase 4 multi-cycle review loop** — run one verification pass only.
7. Output the corrected file and a change summary.

> This cuts the typical review from 3 Grok/Composer agents × full codebase scan → 1 targeted verifier. Much faster for corrections to existing documents.

**Only proceed to the full research pipeline below if `$ARGUMENTS` is a BRD path, Jira ticket, or inline description (not an existing TRD).**

---

## MANDATORY: Read TRD Template First

**Before doing anything else**, read the project TRD template:

```
documents/Requirenments/Templates/TRD_Template.md
```

This template governs the **output structure** of every TRD. It defines:
- Mandatory sections §0–§21 (BRD extraction ledger, coverage checksum, shared standards, domain model, state machine, API contract, auth, client behavior, NFRs, observability, testing, rollout, traceability, blockers, decisions log)
- Staged pass protocol: **Pass 0 → Pass 1 → Pass 2A → Pass 2B → Pass 3A → Pass 3B** with human review gates between each pass
- "Do Not Approve Yet" gate checklist
- AI authoring rules (no single-pass generation, no guessing, source anchor rule, decision clarification rule)

**File naming (from template):** `documents/Requirenments/[Feature]/[Feature]_TRD_v.1.0.md`

**The research methodology below (Phases 1–4) feeds INTO the template's staged passes — do not skip either.**

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

## What is a TRD (and what it is NOT)

A **Technical Requirements Document** translates business requirements into precise technical specifications. It answers **WHAT the system must do technically** — not HOW to implement it in code.

**TRD DEFINES:**
- System architecture and data flow (with ASCII diagrams)
- Database schema (full GraphQL — new/changed types, fields, indexes)
- API contracts (all queries, mutations, subscriptions, Lambda signatures)
- iOS service layer design and state management
- Error states, edge cases, and boundary conditions
- Non-functional requirements with measurable thresholds
- Security rules, forbidden patterns, migration plan
- Testing requirements and acceptance criteria

**TRD DOES NOT DEFINE:**
- Specific Swift/JS code (variable names, function bodies) — that is the Implementation Plan
- Step-by-step tasks with before/after code diffs — that is the Implementation Plan
- Deployment commands, rollback scripts, test scripts — that is the Implementation Plan

**Document pipeline:** BRD → **TRD** → Implementation Plan.
The TRD is the engineering contract. The Implementation Plan is the execution blueprint.

---

## Project Structure Reference

```
amplify/
  backend/
    api/step/schema.graphql          ← DynamoDB schema — source of truth for ALL data models
    function/{name}/src/index.js     ← Lambda handler (140 functions)
    function/{name}/src/             ← May contain promptBuilder.js, validators.js
  generated/models/                  ← 578 auto-generated Swift files — DO NOT EDIT
  generated/queries.graphql          ← Generated operations

amplifyconfiguration-{dev,stg,production}.json  ← Env config (region: us-east-2 all envs)
Amplify App ID: dy526yw1rln67
Environments: dev, stg, production (exact — never "prod", "staging")

step/
  Services/          ← Business logic singletons (120+ Swift files)
  APIServises/       ← Amplify GraphQL API services (28 files)
  Views/             ← SwiftUI views (200+ files across 14 subdirs)
  Models/            ← Data models
  Managers/          ← Navigation, Analytics, DeepLink, VideoPlayer
  Config/            ← Design tokens, themes
  Configuration/     ← DebugConfig.swift (debug flags for every service)
```

**TRD gold-standard references in this repo:**
- `documents/Requirenments/Circle/Circle_System_Technical_Document.md` — comprehensive FE+BE TRD
- `documents/Requirenments/Circle/Circle_Remove_ActiveCircle_Flag_TRD.md` — targeted architectural TRD
- `documents/Requirenments/TimeZone_TRD.md` — principles and constraints TRD

---

## Phase 1 — Read & Classify

1. Read the BRD file (or parse inline description). Use the Jira ticket number for document metadata.
2. Determine:
   - **Feature Name:** title-cased, 3-6 words
   - **Area:** FE / BE / FE+BE
   - **Priority:** P0 (release blocker) / P1 (core feature) / P2 (enhancement)
   - **Complexity:** Simple / Medium / Complex

3. **Set research depth based on Complexity:**

| Complexity | Criteria | Agent A thoroughness | Agent B |
|---|---|---|---|
| Simple | FE-only, ≤3 files change, no new API | `medium` | **Skip** |
| Medium | FE+BE, ≤10 files, 1-2 new Lambdas/mutations | `medium` | Run (max 3 searches) |
| Complex | FE+BE, many files, new schema types, auth changes | `very thorough` | Run (max 5 searches) |

State the chosen Complexity tier before launching agents. This selection is locked — do not upgrade to `very thorough` mid-run.

Launch Phase 2 research agents **simultaneously**.

---

## Phase 2 — Parallel Research Agents

> **PARALLELISM RULE:** Launch ALL Phase 2 agents in a **single message** with multiple concurrent Agent tool calls. Do NOT wait for one to finish before starting the next. For BE/FE+BE: launch Agents A, B, and C simultaneously. For FE-only: launch Agents A and B simultaneously (skip C).

All agents run concurrently. Use only Cursor Grok 4.5 or Composer 2.5 — quality over speed.

---

**Agent A — Deep Codebase Research** (`subagent_type: Explore`, model: **Cursor Grok 4.5** / `grok-4.5-fast-xhigh`, thoroughness: `very thorough`)

Prompt:
```
You are doing deep codebase research to write a TRD for the Step iOS project.
Working directory: /Users/andreitekhtelev/Documents/DEVELOPMENT/step-ios-work

FEATURE DESCRIPTION: [paste full BRD content or description from $ARGUMENTS]

Do NOT summarize or truncate. Find EVERYTHING relevant.

1. EXISTING CODE INVENTORY
   - Grep for all keywords from the feature (class names, method names, screen names, type names, error messages)
   - Read EVERY relevant file: views (step/Views/), services (step/Services/), API services (step/APIServises/), managers (step/Managers/)
   - For each file: note exact path, relevant line numbers, current behavior
   - Classify each component: EXISTS (no change) / NEEDS CHANGE / MISSING (needs to be built)

2. GRAPHQL SCHEMA ANALYSIS — read amplify/backend/api/step/schema.graphql:
   - Find all relevant types, enums, fields, and relationships
   - For each relevant type: note @primaryKey, @index fields, sort keys, and auth rules
   - Note field nullability (required vs optional)
   - Identify schema changes needed (new types, fields, indexes)
   - Check if proposed list queries can use a key condition (has @index) or require a filter expression (no index = full scan = expensive)

3. GENERATED MODELS — for each relevant GraphQL type, read amplify/generated/models/{TypeName}.swift:
   - Note the exact Swift field names and optional/non-optional status
   - Note any generated query/mutation names available

4. LAMBDA ANALYSIS (skip if FE-only):
   - Read the FULL source of each relevant amplify/backend/function/{name}/src/index.js
   - Note: event shape, response shape, auth pattern (event.identity?.claims?.sub), table name env vars, aws-sdk version
   - Note: each operation routed (if multi-op router), any shared utilities (promptBuilder.js, validators.js)
   - Identify exactly what needs to change

5. EXISTING PATTERNS — find 3-5 analogous implementations to mirror:
   - Similar data-fetching service patterns (pagination with nextToken, Task caching, error handling)
   - Similar UI patterns (loading/error/empty states, list views, detail views)
   - Similar Lambda patterns (multi-op routers via event.info.fieldName, appSyncNotify, error response shape)
   - Record EXACT file:line for each — these become mandatory mirror references in the TRD

6. INTEGRATION POINTS
   - Analytics: grep for Mixpanel.track, AnalyticsManager, CustomerIO calls near the feature area
   - Deep links: check NavigationManager for Branch.io patterns
   - Push: check PushNotificationService for related handlers
   - Auth: check what Cognito permissions the feature requires

7. CONSTRAINT AUDIT
   - iOS 17+ minimum — note any API version guards needed
   - AppSync auth rules needed (owner, private, apiKey, public)
   - DynamoDB limits that affect this feature (item size, GSI limits, query patterns)
   - Lambda shared role: step-lambda-shared-{env} — no function-specific IAM
   - Any existing business rules that constrain the new feature

8. PROD BASELINE
   - Run: git log --oneline -5 origin/work
   - Run: git log --oneline work..HEAD (list unreleased commits)
   - Note any unreleased commits touching the feature area

9. SECURITY-CRITICAL CONFIG VERIFICATION (mandatory — do not skip, do not assume)
   These values appear in JWT validation, auth rules, or env vars. A wrong value causes silent production failures.
   Read the EXACT source file for each applicable item — never infer from naming conventions:

   a. iOS Bundle ID → read `step.xcodeproj/project.pbxproj`, grep `PRODUCT_BUNDLE_IDENTIFIER` for the main app target. Paste the exact value. (Common mistake: assuming `co.step.step` when it is `com.step.co`.)
   b. Cognito User Pool IDs → read `amplify/backend/auth/step/cli-inputs.json` and `amplifyconfiguration-dev.json`. Paste exact values.
   c. Cognito App Client IDs → same files. Paste exact values.
   d. Auth flow type → read `amplifyconfiguration-dev.json`, confirm `authenticationFlowType` value.
   e. `transform.conf.json` structure → read `amplify/backend/api/step/transform.conf.json` verbatim. Note whether `StackMapping` key EXISTS or not — never assume it does. **If the TRD proposes new StackMapping entries:** also read `.cursor/rules/be-deployment-rules.mdc` and confirm the proposed key format matches the project convention — `{TypeName}{fieldName}Resolver` with NO dot and NO space (e.g. `"MutationresolveAppleCognitoUserLambdaResolver"`) with stack name `Function<Feature>DirectiveStack`. A StackMapping key using dot-separator format (e.g. `"Mutation.resolveAppleCognitoUserLambda"`) is silently ignored by Amplify — all resolvers stay in the default FunctionDirectiveStack and the 500-resource limit is not relieved. Flag any dot-format key as CRITICAL.
   f. Lambda package.json → for each Lambda being changed: check if `package.json` exists in `amplify/backend/function/{name}/src/`. If the Lambda runtime is nodejs20.x (or being upgraded to it), verify `aws-sdk` is listed as a dependency. nodejs20.x does NOT bundle aws-sdk v2.
   g. Any config key, env var name, or feature flag raw string that appears in the BRD → grep the exact current value from source. Never use the BRD's name as ground truth.
   h. **team-provider-info.json wiring** → for every new Lambda function the TRD introduces: read `amplify/team-provider-info.json` and verify `dev.categories.function.{functionName}` entry exists. Read the function's CFN template and identify all Parameters with no `Default` (excluding auto-supplied: `env`, `s3Key`, `deploymentBucketName`, `CloudWatchRule`). Confirm each is present in the TPI entry. `sharedLambdaRoleArn` has no default in project CFN templates — a missing TPI entry causes `amplify push` to fail with `Parameters: [sharedLambdaRoleArn] must have values`. Flag as CRITICAL if the entry is absent or any required param is missing.

   Return each as: `✅ VERIFIED: {item} = "{exact value}" (from {file}:{line})` or `❌ UNVERIFIABLE: {item} — {reason}`.
   Any ❌ UNVERIFIABLE security-critical value MUST become a HIGH blocker in §19. The TRD author must NOT assume a value and write it into validation logic.

10. AMPLIFY / AWS BEHAVIORAL DETAILS (mandatory for BE/FE+BE — these are NOT in the codebase)
    Research the following behavioral facts that cannot be found by reading project files:

    a. **Cognito Custom Auth trigger invocation sequence:** How many times is each trigger (DefineAuthChallenge, CreateAuthChallenge, VerifyAuthChallengeResponse) invoked per sign-in? Is `clientMetadata` available on ALL invocations of DefineAuthChallenge, or only on the first (InitiateAuth)? Check: on RespondToAuthChallenge, does Cognito pass clientMetadata to DefineAuthChallenge?
    b. **adminCreateUser user status:** What status does a Cognito user have immediately after `adminCreateUser`? Can the user complete CUSTOM_AUTH while in FORCE_CHANGE_PASSWORD status? What call is required to move them to CONFIRMED?
    c. **Lambda runtime module bundling:** For any runtime upgrade (e.g. nodejs16.x → nodejs20.x): which modules are pre-bundled in the OLD runtime but NOT in the new one? (Known: nodejs20.x does NOT include `aws-sdk` v2; nodejs16.x did.) Confirm for the specific runtimes involved.
    d. **Amplify Swift SDK auth flow behavior** (if applicable): For the pinned SDK version, confirm whether `clientMetadata` passed in `confirmSignIn` actually reaches the VerifyAuthChallengeResponse trigger. Check release notes for the pinned version for any auth metadata bugs.

    Return each behavioral fact with: the fact stated precisely, the source (AWS docs URL or release notes), and the implication for this TRD's design.

Return a structured report with:
- EXISTING CODE INVENTORY: table (Component | File:Line | Status | Notes)
- SCHEMA STATE: paste the full relevant GraphQL type blocks as they are NOW
- SCHEMA CHANGES NEEDED: specific fields/types/indexes to add/modify/remove
- LAMBDA INVENTORY: each Lambda with event shape, response shape, changes needed (skip if FE-only)
- MIRROR REFERENCES: 3-5 entries (Pattern | File:Line | What to mirror)
- INTEGRATION POINTS: each system with current hook file:line
- CONSTRAINTS: hard limits discovered
- PROD BASELINE: commit hash + unreleased audit table
```

---

**Agent B — Modern Standards & Security Research** (`subagent_type: general-purpose`, model: **Cursor Grok 4.5** / `grok-4.5-fast-xhigh`) — max 5 searches

> **Skip if any of:** (a) Review mode (existing TRD input), (b) Simple complexity tier, (c) Pure data-display with zero new API surface. If skipped, return: "Skipped — review mode / simple feature / display-only."
> Limit to **3 searches** for Medium complexity, **5 searches** for Complex.

Prompt:
```
Research modern best practices for a Step iOS TRD.

FEATURE DESCRIPTION: [paste full BRD content]
TECH STACK: SwiftUI iOS 17+ / AWS Amplify AppSync / DynamoDB / Lambda Node.js / Cognito
AREA: [FE / BE / FE+BE]

Run up to 5 targeted searches. Prioritize official Apple/AWS/Amplify documentation over blogs.

**Always include these AWS behavioral searches if the feature touches Cognito, Lambda runtimes, or admin user ops:**

A. **If feature extends Cognito Custom Auth triggers:**
   - Search: "Cognito DefineAuthChallenge clientMetadata RespondToAuthChallenge" — confirm whether clientMetadata is passed on the SECOND trigger invocation (after RespondToAuthChallenge) or only on the first (InitiateAuth). This determines whether the trigger needs a session-based fallback.
   - Search: "Cognito adminCreateUser FORCE_CHANGE_PASSWORD CONFIRMED status adminSetUserPassword" — confirm the exact calls needed to create and auto-confirm an admin-created user who will never set their own password.

B. **If feature upgrades Lambda runtime (e.g. nodejs16.x → nodejs20.x):**
   - Search: "nodejs20.x Lambda aws-sdk bundled" — confirm which SDKs are no longer pre-bundled and must be declared in package.json. (Known: nodejs20.x does NOT include aws-sdk v2.)

C. **If feature pins an SDK version (Amplify Swift, amplify-js):**
   - Search: "[SDK name] [version] release notes CUSTOM_AUTH clientMetadata" — check for bugs or breaking changes around auth metadata routing at the pinned version.

**Then add feature-specific searches:**
1. Performance budgets for this feature type (list rendering ms, API response ms, fps)
2. Security requirements and attack vectors specific to this feature type
3. DynamoDB/AppSync hard limits and recommended patterns for this data access pattern
4. Swift concurrency pitfalls for this data type (actor isolation, async/await, @MainActor)
5. Any deprecated APIs or patterns to avoid (Apple/AWS deprecation notices 2024-2026)

Return (with sources):
- AWS BEHAVIORAL FACTS: exact behavior of Cognito/Lambda/SDK features used (with doc URL)
- PERFORMANCE BUDGETS: specific ms/fps numbers
- SECURITY REQUIREMENTS: specific to this feature type  
- SCALABILITY LIMITS: DynamoDB/Lambda/AppSync hard limits
- SWIFT CONCURRENCY: relevant patterns or pitfalls
- ACCESSIBILITY: WCAG 2.2 / Apple HIG requirements for this UI type
- DEPRECATED PATTERNS: what to avoid + modern alternatives
- SOURCES: URLs consulted
```

---

**Agent C — Lambda & Production Baseline** (`subagent_type: general-purpose`, model: **Composer 2.5** / `composer-2.5-fast`) — **BE and FE+BE only; skip for FE-only**

Prompt:
```
Gather production baseline data for the Step iOS TRD.
Working directory: /Users/andreitekhtelev/Documents/DEVELOPMENT/step-ios-work
AWS region: us-east-2. Environments: dev, stg, production (exact names — never "prod").

Lambda functions: [list from BRD or Agent A findings]
Lambda naming: {functionName}-dev, {functionName}-stg, {functionName}-production

For each Lambda:

1. FUNCTION CONFIG (stg):
aws lambda get-function-configuration \
  --function-name {functionName}-stg \
  --region us-east-2 2>&1 | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('Runtime:', d.get('Runtime'))
print('Timeout:', d.get('Timeout'), 's')
print('Memory:', d.get('MemorySize'), 'MB')
print('Handler:', d.get('Handler'))
print('Last modified:', d.get('LastModified'))"

2. ERROR RATE (stg + production, last 24h):
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda --metric-name Errors \
  --dimensions Name=FunctionName,Value={functionName}-stg \
  --start-time $(python3 -c "import datetime; print((datetime.datetime.utcnow()-datetime.timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%SZ'))") \
  --end-time $(python3 -c "import datetime; print(datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'))") \
  --period 86400 --statistics Sum --region us-east-2 2>&1

3. RECENT ERROR LOGS (stg, last 24h):
aws logs filter-log-events \
  --log-group-name /aws/lambda/{functionName}-stg \
  --start-time $(python3 -c "import time; print(int((time.time()-86400)*1000))") \
  --filter-pattern "ERROR" --limit 5 --region us-east-2 2>&1

4. SAMPLE INVOCATION (dev only — NEVER invoke production without explicit permission):
If amplify/backend/function/{functionName}/src/event.json exists:
aws lambda invoke \
  --function-name {functionName}-dev \
  --payload file://amplify/backend/function/{functionName}/src/event.json \
  --log-type Tail --cli-binary-format raw-in-base64-out \
  --region us-east-2 /tmp/lambda_response.json > /tmp/lambda_meta.json 2>&1
python3 -m json.tool /tmp/lambda_response.json 2>&1
python3 -c "
import json,base64; m=json.load(open('/tmp/lambda_meta.json'))
t=m.get('LogResult','')
if t: print('=== LOG TAIL ==='); print(base64.b64decode(t).decode('utf-8',errors='replace'))" 2>&1

Return:
- FUNCTION CONFIG: runtime, timeout, memory per function (dev + stg)
- BASELINE ERROR RATE: errors and invocations in last 24h on stg + production
- RECENT ERRORS: actual CloudWatch log lines (redact user IDs/emails)
- CURRENT RESPONSE SHAPE: actual JSON from dev invocation (paste verbatim)
- BASELINE VERDICT: is there currently an error or gap in stg/production?
```

---

## Phase 3 — Synthesize & Write TRD

> **WRITE IMMEDIATELY AFTER AGENT A — don't wait for B and C.**
> As soon as Agent A returns, begin writing §0 through §9 to the file (Write tool, Part 1). Agents B and C run in parallel while you write. When B and C return, incorporate their findings into §10–end (Part 2 and Part 3). This overlaps writing time with remaining agent time and cuts total wall-clock time significantly.

**Model quality and depth on `Circle_System_Technical_Document.md`.** Use ASCII diagrams, full GraphQL blocks, and exhaustive inventories.

> **MANDATORY FIRST STEP:** Read `documents/Requirenments/Templates/TRD_Template.md` in full before writing any section. Follow its staged-pass authoring protocol, mandatory sections, "Do Not Approve Yet Gate", and shared-standards compliance table. The template is the canonical structure authority — the section guide below is the Step iOS technical depth layer on top of it.

---

### TRD Document Header

```markdown
# TRD - <Feature Name> (v 1.0)

**Version:** 1.0
**Date:** <today's date, e.g. April 10, 2026>
**Status:** Draft
**App areas:** <FE | BE | FE+BE>
**Priority:** <P0 | P1 | P2> — <one-line business impact>
**Source BRD:** [<BRD filename>](<relative path>)
**Author:** andrei@step.co
```

If Jira provided: add `**Jira:** [SS-XXXX](https://step-co.atlassian.net/browse/SS-XXXX)`

---

### Required TRD Sections

---

#### § 0.1 — Version History

```
| Version | Date | Author | Changes |
|---------|------|--------|---------|
| v0.1    | <today> | andrei@step.co | Initial draft |
```

---

#### § 0.2 — BRD Requirement Inventory (MANDATORY — populate before any technical section)

Extract every in-scope BRD requirement here first (Pass 0). One row per requirement.

```
| BRD Req ID | BRD Section | Requirement Summary (normalized) | In Scope (Y/N) | Proposed Phase | Source Anchor | Notes / Ambiguities |
|------------|-------------|----------------------------------|----------------|----------------|---------------|----------------------|
| BR-01      | §X.Y        | <single clear requirement>       | Y              | P1             | §X.Y heading  | <unresolved items>  |
```

Any unresolved ambiguity → add HIGH blocker in § 19. Do not guess.

---

#### § 0.3 — Coverage Checksum (MANDATORY — verify before marking TRD ready)

```
| Check                          | Formula                                      | Expected | Actual | Pass |
|-------------------------------|----------------------------------------------|----------|--------|------|
| In-scope count                | A = unique IDs in §0.2 where In Scope = Y   | [N]      | [N]    | [ ]  |
| Traceability count            | B = unique IDs in §18                        | B = A    | [N]    | [ ]  |
| No orphan IDs in §18          | Every §18 ID exists in §0.2                  | true     | [T/F]  | [ ]  |
| No duplicate IDs              | IDs unique in §0.2 and §18                   | true     | [T/F]  | [ ]  |
| No unmapped in-scope reqs     | Every in-scope ID has a §18 row              | true     | [T/F]  | [ ]  |
```

---

#### § 0 — Codebase Verification Note

Always include. Example:

> This document was written against commit `{hash}` — `{message}` (Agent A prod baseline).
> All `file:line` references are a snapshot — re-grep before implementation begins.
> Inferred (not code-verified) claims are marked `⚠️ Unverified:`.

List any claims that could not be verified from the codebase with the `⚠️ Unverified:` prefix.

---

#### § 1 — Overview

- Feature name and one-paragraph technical summary
- Business objective (from BRD — max 2 sentences; paraphrase, don't copy verbatim)
- Technical objective: what the system must do differently after this ships
- What explicitly does NOT change (set scope boundaries immediately)
- Priority (P0/P1/P2) with justification
- Area (FE/BE/FE+BE) with rationale
- Key constraints inherited from BRD

---

#### § 2 — Technical Context

Show the current state of the system. Everything here comes from Agent A's findings — no guessing.

**§ 2.1 Existing Code Inventory**
```
| Component | File | Line(s) | Status | Notes |
|-----------|------|---------|--------|-------|
| LiveClassService | step/Services/LiveClassService.swift | 1–340 | Needs Change | Add sorting |
| CoachPageView | step/Views/Coach/CoachPageView.swift | 220 | Exists | No change |
| getLiveClassesPublic | amplify/backend/function/getLiveClassesPublic/src/index.js | — | New | Create |
```

**§ 2.2 Mirror References (patterns the implementation must follow)**
```
| Pattern | File:Line | What to mirror |
|---------|-----------|----------------|
| Pagination nextToken | step/Services/VideoService.swift:87–140 | nextToken cursor loop pattern |
| @MainActor service | step/Services/CircleService.swift:45–60 | Task caching to prevent duplicate fetches |
| Error state view | step/Views/Coach/CoachPageView.swift:220 | isError @Published flag + retry |
```

**§ 2.3 Schema Baseline**
Paste the current relevant GraphQL types verbatim from `schema.graphql` (with line number noted):
```graphql
# schema.graphql line ~XXXX (as of commit {hash})
type LiveClass @model @auth(rules: [...]) {
  id: ID! @primaryKey
  coachId: ID! @index(name: "byCoach")
  title: String!
  startTime: AWSDateTime!
  # ... paste full type as it currently exists
}
```

**§ 2.4 Lambda Baseline** (BE/FE+BE only — skip for FE-only)
From Agent C findings:
```
| Metric | dev | stg | production |
|--------|-----|-----|------------|
| Timeout | Xs | — | — |
| Memory | NMB | — | — |
| Error rate (24h) | N% | N% | N% |
```
Current response shape (paste actual JSON from dev invocation).
Baseline verdict: is there currently a gap or error in stg/production?

**§ 2.5 Prod Baseline**
```
| Item | Status |
|------|--------|
| Last prod baseline | `{commit}` — {message} |
| Unreleased commits touching affected files | {list or "None"} |
| Breaking changes in-flight | {list or "None"} |
```

---

#### § 3 — High-Level Architecture

ASCII diagram showing the data flow. Required for all FE+BE features; include for FE-only features with complex state.

```
┌─────────────────────────────────────────────────────────────────────┐
│                           iOS Client                                  │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐    ┌─────────────────────────────────────────┐ │
│  │  {Service}       │◄───│  {View}                                 │ │
│  │  @Published      │    │  - .onAppear: fetch                    │ │
│  │  - items: [T]    │    │  - @StateObject service                 │ │
│  │  - isLoading     │    │  - Loading / Loaded / Error states      │ │
│  │  - error         │    └─────────────────────────────────────────┘ │
│  └────────┬─────────┘                                                │
└───────────┼─────────────────────────────────────────────────────────┘
            │ GraphQL (AppSync / Cognito auth)
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         AWS Backend                                   │
│  ┌──────────────┐   ┌─────────────────────┐   ┌──────────────────┐  │
│  │   AppSync    │   │     Lambda(s)        │   │    DynamoDB      │  │
│  │  GraphQL API │──►│  event.info.fieldName│──►│  Table via GSI   │  │
│  │              │   │  event.arguments     │   │  @index byCoach  │  │
│  └──────────────┘   └─────────────────────┘   └──────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

Include data flow narrative:
1. View calls service method on appear
2. Service checks Task cache — cancels existing if refresh
3. Service calls GraphQL query/mutation via AppSync
4. AppSync authenticates via Cognito, routes to Lambda
5. Lambda queries DynamoDB using GSI key condition (not scan)
6. Lambda returns typed response
7. Service publishes result to @Published vars
8. View re-renders from @Published observation

---

#### § 3.4 — Shared Platform Standards Compliance (MANDATORY)

Use centralized standards first. Do not create feature-local variants unless a documented exception is in § 20.

```
| Standard            | Canonical Source(s)                                                                                                   | Mandatory Contract for This Feature                                                                                       | Allowed Deviation                                                          | Decision ID |
|---------------------|-----------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------|-------------|
| Timezone handling   | `documents/Technical Standards/TimeZone_TRD.md`; `step/Utils/DateUtils.swift` (`StepDateUtils`); `amplify/backend/function/stepappbackendDateUtilsLayer/lib/nodejs/dateUtils.js` | Use `localDate`/`weekStartDate` contract; week/day logic via canonical local-date flow; no ad hoc date formatters | Only if legacy schema forces a temporary adapter — must include migration plan + sunset date | [D-XX]      |
| Error handling      | `step/Services/ErrorHandling/AppError.swift`; `ErrorService.swift`; `CrashlyticsService.swift`; `ErrorOverlayModifier.swift`; `ErrorAlertModifier.swift`; `ErrorBannerView.swift`; `ErrorToastView.swift` | Use `AppError` taxonomy + `ErrorService` flow; UI via shared overlay/alert/banner/toast; crash reporting via `CrashlyticsService` | Temporary local handling only behind a documented migration plan          | [D-XX]      |
| Design tokenization | `step/Config/DesignTokens.swift`; `documents/Design and UX/DesignSystem.md`; `step/Utils/AppColors.swift`; `step/Extensions/Font+SystemScaling.swift` | All UI consumes semantic tokens (typography/spacing/radius/color); no hardcoded visual constants                          | Temporary hardcoded values only for blocked migrations — must include replacement plan + date | [D-XX]      |
```

Required evidence:
- [ ] Applicable contracts are adopted in TRD section references.
- [ ] Any deviation is logged in § 20 with rationale, risk, and removal plan.

---

#### § 4 — Data Models & Schema Changes

**§ 4.1 New or Changed GraphQL Types**

For each change, provide the FULL updated GraphQL block. Mark each change inline:

```graphql
# CHANGE: LiveClass — add createdAt sort key to byCoach GSI
# Reason: Enables server-side sort by creation date without a full scan
type LiveClass
  @model
  @auth(rules: [{ allow: private }, { allow: owner, ownerField: "coachId" }]) {
  id: ID! @primaryKey
  coachId: ID! @index(name: "byCoach", sortKeyFields: ["createdAt"])  # CHANGE: add sortKeyFields
  title: String!
  startTime: AWSDateTime!
  endTime: AWSDateTime           # nullable — open-ended classes
  status: LiveClassStatus!
  createdAt: AWSDateTime!        # ADD: sort key for byCoach GSI
  updatedAt: AWSDateTime!
}
```

Inline markers: `# ADD:`, `# CHANGE:`, `# REMOVE:`, `# RENAME:`.

**§ 4.2 New Enums**
```graphql
enum LiveClassStatus {
  SCHEDULED
  LIVE
  ENDED
  CANCELLED
}
```

**§ 4.3 Schema Change Impact Analysis**
```
| Change | Type | Breaking? | Older app impact | Migration |
|--------|------|-----------|-----------------|-----------|
| Add nullable field `endTime` | Additive | No | Safe — new field ignored | None |
| Add `createdAt` sort key to GSI | Non-breaking | No | Safe — GSI uses existing field | Rebuild GSI (~5 min) |
| Add `LiveClassStatus` enum | Additive | No | Old apps skip unknown enum values | None |
```

**§ 4.4 No-Change Contract**
Fields/types that MUST NOT change:
```
| Type | Field | Reason |
|------|-------|--------|
| WeeklyTarget | weekStartDate | DynamoDB sort key — changing breaks all queries |
| LiveClass | id | Primary key — immutable |
```

If no schema changes: state `**No schema changes required for this feature.**`

---

#### § 5 — API Contracts

For each new or changed GraphQL operation, document the full contract:

```graphql
# QUERY: getLiveClassesForCoach
# Auth: Cognito authenticated (private)
# Trigger: Coach page load / pull-to-refresh
# DB access: GSI "byCoach" key condition — O(log N), NOT a scan
# Pagination: cursor-based via nextToken
query getLiveClassesForCoach(
  $coachId: ID!              # required — partition key of byCoach GSI
  $limit: Int                # optional — default 50, max 100
  $nextToken: String         # optional — pagination cursor (null = first page)
  $sortDirection: ModelSortDirection  # optional — ASC (default) or DESC
) {
  getLiveClassesForCoach(coachId: $coachId, limit: $limit, nextToken: $nextToken, sortDirection: $sortDirection) {
    items {
      id                     # ID! — required
      title                  # String! — required
      startTime              # AWSDateTime! — ISO 8601 with timezone
      endTime                # AWSDateTime? — nullable
      status                 # LiveClassStatus! — SCHEDULED | LIVE | ENDED | CANCELLED
      createdAt              # AWSDateTime! — used as sort key
    }
    nextToken                # String? — null if no more pages
  }
}
# Success: { items: [...], nextToken: String|null }
# Error shape: { success: false, error: { message: String, code: String? } }
```

For Lambda functions (BE/FE+BE), also document the Node.js contract:
```javascript
// Lambda operation: getLiveClassesForCoach
// Routed via: event.info.fieldName === "getLiveClassesForCoach"
// Event input:
{
  "info": { "fieldName": "getLiveClassesForCoach" },
  "arguments": {
    "coachId": "string (required)",   // GSI partition key
    "limit": "number (optional, default 50, max 100)",
    "nextToken": "string|null (optional)",
    "sortDirection": "ASC|DESC (optional, default ASC)"
  },
  "identity": { "claims": { "sub": "cognito-user-id" } }
}
// Response:
{ "items": [...], "nextToken": "string|null" }
// Error:
{ "success": false, "error": { "message": "string", "code": "string" } }
```

---

#### § 6 — iOS Service Layer Design

Describe the service interface and state management. This section guides the Implementation Plan without prescribing code.

**§ 6.1 State Properties**

State owned by the service (observable from views):
```
@Published var liveClasses: [LiveClass]    — list data
@Published var isLoadingClasses: Bool      — loading indicator
@Published var classesError: Error?        — error state (nil = no error)
var classesNextToken: String?              — pagination cursor (NOT @Published — internal)
var classesFetchTask: Task<Void, Never>?   — concurrency guard (NOT @Published — internal)
```

**§ 6.2 Public Methods**

Methods views will call:
```
fetchLiveClasses(coachId: String, refresh: Bool) async
  — Initial load (refresh=false) or pull-to-refresh (refresh=true)
  — Cancels in-flight fetch on refresh=true
  — Publishes to liveClasses, isLoadingClasses, classesError

fetchMoreLiveClasses(coachId: String) async
  — Load next page using classesNextToken
  — No-op if classesNextToken is nil (no more pages)
  — Appends to liveClasses
```

**§ 6.3 Concurrency Contract**
- Calls must be on @MainActor (all @Published mutations)
- Task caching: cancel any in-flight task before starting a new one on refresh
- Duplicate call guard: if classesNextToken is nil and liveClasses is non-empty, do not re-fetch unless refresh=true

**§ 6.4 Error Preservation Rule**
- On refresh failure: preserve existing `liveClasses` data (show stale data + error banner)
- On initial load failure: `liveClasses` stays empty, show error state (not crash)
- `classesError` must be cleared before each new fetch attempt

---

#### § 7 — State Machine & Data Flow

All reachable UI states and transitions. This must be complete — missing states cause crashes.

**State Table:**
```
| State | Trigger | UI Shown | Data Available |
|-------|---------|----------|---------------|
| IDLE | — | Nothing | No |
| LOADING | onAppear / refresh (empty data) | Skeleton / spinner | No |
| LOADED (N items) | API success, N > 0 | List of N items | Yes |
| LOADED (empty) | API returns [] | Empty state view | No |
| ERROR | API failure (no data) | Error state + retry | No |
| REFRESHING | pull-to-refresh (has data) | Stale items + spinner | Yes (stale) |
| LOADING_MORE | scroll to bottom | Items + footer spinner | Yes |
| REFRESH_ERROR | pull-to-refresh fails (has data) | Stale items + error banner | Yes (stale) |
```

**State Transitions:**
```
IDLE ──onAppear────────────────────► LOADING
LOADING ──success, N > 0──────────► LOADED(N)
LOADING ──success, N = 0──────────► LOADED(empty)
LOADING ──error───────────────────► ERROR
ERROR ──retry button──────────────► LOADING
LOADED(N) ──pull-to-refresh───────► REFRESHING
REFRESHING ──success, N > 0───────► LOADED(N)
REFRESHING ──error────────────────► REFRESH_ERROR (keep stale data)
REFRESH_ERROR ──retry─────────────► REFRESHING
LOADED(N) ──scroll to bottom──────► LOADING_MORE
LOADING_MORE ──success────────────► LOADED(N + more)
LOADING_MORE ──no more pages──────► LOADED(N) (nextToken = nil, stop)
LOADING_MORE ──error──────────────► LOADED(N) + footer error (non-fatal)
```

---

#### § 8 — Error Handling & Edge Cases

Complete error matrix. Every realistic failure a user will encounter in production:

```
| Scenario | Source | System Behavior | User Message | Recoverable? |
|----------|--------|-----------------|--------------|--------------|
| Network timeout (>30s) | iOS network | Set classesError, preserve stale data | "Unable to load. Try again." | Yes (retry button) |
| Network offline | iOS/URLSession | Use cached data if available, else ERROR state | "You're offline" | Yes (auto-retry on reconnect) |
| Lambda 500 error | Lambda / AppSync | Parse error body → classesError | "Something went wrong. Try again." | Yes (retry) |
| Lambda 403 / auth error | Cognito/AppSync | Clear auth state, redirect to login | (transparent redirect) | Auto |
| Cognito token expired | Amplify | Amplify auto-refreshes; if fail → throw | (transparent) | Auto (Amplify handles) |
| Empty result set | Lambda/DynamoDB | items = [], nextToken = null → LOADED(empty) | Empty state view | N/A |
| Pagination token stale | DynamoDB | Return empty page + null nextToken | Stop loading more silently | N/A (soft fail) |
| Concurrent refresh | iOS Task system | Cancel previous task, start new | Loading indicator resets | N/A (handled in §6.3) |
| Missing required field in response | Lambda | Guard in Swift Codable → skip item | Item absent from list | N/A (silent) |
| Coach has 0 classes | Lambda | { items: [], nextToken: null } | Defined empty state per design | N/A |
| GSI not yet built after schema deploy | DynamoDB | Lambda returns empty set + logs error | Show empty (temporary) | Auto (GSI builds in ~5 min) |
| Lambda cold start > 3s | AWS Lambda | First request slow; Amplify default timeout applies | No UX impact if < timeout | N/A |
```

---

#### § 9 — Non-Functional Requirements

Each requirement must have a **measurable threshold**. Vague statements are not acceptable.

**§ 9.1 Performance**
```
| Metric | Threshold | Device | Measurement Method |
|--------|-----------|--------|-------------------|
| List initial load | ≤ 400ms p50, ≤ 900ms p95 | iPhone 12 | Time.now from .onAppear to first item visible |
| Pull-to-refresh | ≤ 600ms p50 | iPhone 12 | Spinner dismiss to list update |
| Scroll frame rate | 60fps minimum, no drops | iPhone 12 | Instruments Core Animation profiler |
| API response (Lambda) | ≤ 200ms p50, ≤ 600ms p95 | — | CloudWatch Duration metric |
| Lambda cold start | ≤ 1000ms p95 | — | CloudWatch Init Duration metric |
| Memory overhead | No new retain cycles | — | Instruments Leaks tool |
| Pagination page load | ≤ 500ms p50 | iPhone 12 | Time from scroll-to-bottom to items appended |
```

**§ 9.2 Security**
```
| Requirement | Detail |
|-------------|--------|
| Authentication | ALL API calls require Cognito authentication (@auth private) |
| Data scoping | Users may only fetch classes they are authorized to see |
| No PII in logs | Lambda CloudWatch: user ID only via event.identity?.claims?.sub — no name, email, phone |
| Input length limits | All String inputs validated: max 500 chars (or per-field max, specified below) |
| Table names | Always via process.env.TABLE_NAME (Fn::ImportValue) — never hardcoded |
| IAM | Shared role step-lambda-shared-{env} — no function-specific IAM roles |
| Rate limits | AppSync default: 10,000 req/s per region — document if feature could approach this |
```

**§ 9.3 Scalability**
```
| Limit | Value | Design Response |
|-------|-------|-----------------|
| DynamoDB read capacity | 3,000 RCU/s per partition | Use GSI with coachId as partition key — no hot partition |
| DynamoDB item size | 400KB max | Class item ~2KB — safe |
| Lambda concurrent executions | 1,000 (default account limit) | Stateless design — safe |
| AppSync query max depth | 5 levels | This query: 2 levels — safe |
| List page size | 100 items max (DynamoDB Scan/Query hard limit per call) | Use nextToken pagination |
| Lambda response payload | 6MB max | Paginated response ~50KB — safe |
```

**§ 9.4 Reliability**
- Retry: automatic retry on 5xx with exponential backoff — max 3 attempts (Amplify default)
- Graceful degradation: if classes fail to load, rest of the screen still renders
- Idempotent reads: GET operations are safe to retry without side effects

**§ 9.5 Accessibility** (FE only)
```
| Requirement | Standard | Detail |
|-------------|----------|--------|
| VoiceOver | Apple HIG | All interactive elements: .accessibilityLabel + .accessibilityHint |
| Dynamic Type | Apple HIG | All font sizes use .body, .headline etc — no hardcoded pt values |
| Color contrast | WCAG 2.2 AA | Body text: 4.5:1 minimum. Large text (18pt+ or 14pt bold): 3:1 |
| Tap targets | Apple HIG | Minimum 44×44 pt for all tappable elements |
| Motion | Apple HIG | Animations respect @Environment(\.accessibilityReduceMotion) |
```

---

#### § 10 — Integration Points

Every external system this feature touches:

```
| System | Integration Type | Change Required | Full Contract |
|--------|-----------------|-----------------|---------------|
| Mixpanel | Analytics events | Yes — 2 new events (see below) | See §10.1 |
| Customer.io | Push notifications | No change | — |
| Branch.io | Deep links | No change | — |
| Vimeo | Video playback | No change | — |
| Stream Chat | Messaging | No change | — |
```

**§ 10.1 Analytics Event Contracts**

For each new event, full contract (no partial specs):
```
Event: live_class_viewed
Trigger: User taps a live class card in CoachPageView
Fired via: AnalyticsManager.track()
Properties:
  - classId: String! (required — the LiveClass.id)
  - coachId: String! (required — the coach's user ID)
  - status: "SCHEDULED" | "LIVE" | "ENDED" | "CANCELLED" (required)
  - source: "coach_page" (required, always "coach_page" from this entry point)
  - position: Int (required — 0-based index in list at time of tap)

Event: live_class_list_loaded
Trigger: First successful load of live classes list (not on refresh)
Fired via: AnalyticsManager.track()
Properties:
  - coachId: String! (required)
  - classCount: Int! (required — total items returned)
  - hasMore: Bool! (required — whether nextToken was non-null)
```

---

#### § 11 — Forbidden Patterns

Explicit rules the implementation MUST NOT violate. AI must refuse any code suggestion that violates these.

```
| ❌ Forbidden | ✅ Required Instead | Why |
|-------------|-------------------|-----|
| #if DEBUG for logging | if DebugConfig.Services.{flag} { debugLog("...", emoji: "🔧") } | Project logging standard |
| force unwrap (!) in SwiftUI views | guard let / if let / optional chaining | Prevents production crashes |
| aws-sdk v3 in Lambda | const AWS = require('aws-sdk') — v2 only | Project standard |
| function-specific IAM roles | step-lambda-shared-{env} shared role | Security policy |
| Hardcoded table names | process.env.TABLE_NAME (via Fn::ImportValue) | Environment isolation |
| Editing amplify/generated/ or API.swift | Never edit auto-generated files | Overwritten by codegen |
| DB-level sort/filter on un-indexed field | Add @index first, or sort client-side | DynamoDB constraint |
| Full table scan (FilterExpression without key condition) | Key-condition query with partition key | Performance / cost |
| Boolean "isLoaded" flags | Check collection emptiness or nil state | Race condition source |
| Duplicate concurrent async fetches | Task caching — cancel previous on refresh | Thread safety |
| print() in production code | DebugConfig-gated debugLog() | Log hygiene |
| env names "prod" or "staging" | "dev", "stg", "production" (exact) | Project naming convention |
| fileb:// for Lambda JSON payloads | file:// + --cli-binary-format raw-in-base64-out | CLI correctness |
| self. in Swift unless required | No explicit self unless captured in closure | Project style |
| Lines > 150 chars | Break into multiple lines (warning: 120, error: 150) | SwiftLint rule |
```

---

#### § 11.5 — Cross-Platform Behavior Contract (Android Readiness, MANDATORY)

Define behavior once so iOS and a future Android client can implement different UIs with identical product semantics.

**§ 11.5.1 Behavior vs Presentation Split**

```
| Concern            | Platform-Neutral Contract (must match on iOS/Android) | iOS Presentation Notes               |
|--------------------|-------------------------------------------------------|--------------------------------------|
| State transitions  | Reference § 7 state IDs                               | SwiftUI-specific rendering only      |
| API + error handling | Reference § 5 contract + § 8 error matrix           | iOS error surface pattern            |
| Permissions flow   | Reference § 9.2 Security rules                        | iOS permission UX specifics          |
| Caching/staleness  | Reference § 6 concurrency contract                    | iOS Task caching / AppStorage notes  |
| Analytics events   | Reference § 10.1 event contracts                      | iOS AnalyticsManager.track() calls   |
```

**§ 11.5.2 Client Contract Matrix**

```
| Contract Item                         | Source Section | Required for iOS | Required for Android |
|---------------------------------------|----------------|------------------|----------------------|
| Domain entities and writable fields   | § 4            | [ ]              | [ ]                  |
| State machine and invariants          | § 7            | [ ]              | [ ]                  |
| API request/response/error contract   | § 5            | [ ]              | [ ]                  |
| Auth/privacy/security constraints     | § 9.2          | [ ]              | [ ]                  |
| Caching/offline/failure behavior      | § 8            | [ ]              | [ ]                  |
| Analytics schema                      | § 10.1         | [ ]              | [ ]                  |
```

**§ 11.5.3 Intentional Platform Differences (if any)**

```
| Difference | Why Needed | Approved By | Temporary/Permanent | Revisit Date |
|------------|------------|-------------|----------------------|--------------|
| [none]     | —          | —           | —                    | —            |
```

---

#### § 15.0 — Phase Plan Matrix (MANDATORY when BRD is phased)

```
| Phase | Goal | Included BR IDs | Technical Scope | Dependencies | Exit Criteria | Rollback Scope | Status |
|-------|------|-----------------|-----------------|--------------|---------------|----------------|--------|
| P1    | [goal] | [BR-01, BR-02] | [what ships] | [deps] | [objective checks] | [what can roll back] | Planned |
```

Rules:
- Every BRD requirement appears in exactly one phase as "initial delivery".
- Each phase has objective exit criteria verifiable in staging.
- Each phase specifies rollback scope so partial rollback cannot corrupt data or contracts.
- Deferred requirements: mark explicitly here and in § 19.

---

#### § 19 — Open Questions and Blockers

```
| ID   | Question / Gap             | Impacted Section | Severity (Low/Med/High) | Owner | Resolution Needed By | Status      |
|------|---------------------------|------------------|--------------------------|-------|----------------------|-------------|
| Q-01 | [question or ambiguity]   | [§X.Y]           | High                     | [who] | [date]               | Open        |
```

---

#### § 20 — Decisions Log

```
| Decision ID | Date | Decision | Rationale | Alternatives Considered |
|-------------|------|----------|-----------|------------------------|
| D-01        | <date> | [decision made] | [why] | [what was rejected] |
```

---

#### § 21 — Handoff to Implementation Document

Complete this checklist before creating or approving the implementation plan:
- [ ] Scope and non-goals are explicit and conflict-free.
- [ ] BRD Requirement Inventory (§ 0.2) is complete and reviewed.
- [ ] Coverage Checksum (§ 0.3) passes.
- [ ] Shared platform standards compliance (§ 3.4) is complete (or approved exceptions in § 20).
- [ ] Architecture, ownership, and state model are complete.
- [ ] API/data/auth contracts are complete and version-safe.
- [ ] Cross-platform behavior contract (§ 11.5) is complete.
- [ ] Phase Plan Matrix (§ 15.0) is complete (if BRD is phased) with clear phase gates.
- [ ] Failure behavior and retry/idempotency rules are explicit.
- [ ] Observability and analytics contracts are defined (§ 10.1).
- [ ] Testing strategy covers critical paths and edge cases (§ 13).
- [ ] Rollout/migration/rollback plan is actionable (§ 12).
- [ ] Open blockers in § 19 are resolved or formally accepted.

---

#### Do Not Approve Yet Gate (MANDATORY)

All conditions must be satisfied before status changes from DRAFT → APPROVED:

```
| Gate                                 | Section         | Required Evidence                                                            | Status |
|--------------------------------------|-----------------|------------------------------------------------------------------------------|--------|
| BRD extraction ledger complete       | § 0.2           | All in-scope BRD requirements extracted with source anchors                  | [ ]    |
| Coverage checksum passes             | § 0.3 + § 18/16 | No missing, duplicate, or orphan BRD requirement IDs                        | [ ]    |
| Shared standards compliance complete | § 3.4 + § 20    | Timezone, error handling, design tokens adopted or exceptions approved/logged | [ ]    |
| Decision forks resolved              | § 19 + § 20     | Multi-option choices decided and logged with rationale                       | [ ]    |
| No unresolved HIGH blockers          | § 19            | All HIGH blockers resolved or explicitly accepted by owner                   | [ ]    |
| Core contracts complete              | § 5–§ 8         | Data, state, API, auth contracts explicit and consistent                     | [ ]    |
| Cross-platform readiness complete    | § 11.5          | Platform-neutral behavior contract complete                                  | [ ]    |
| Phase plan executable                | § 15.0          | Each phase has scope, dependencies, exit criteria, rollback scope            | [ ]    |
| Test strategy complete               | § 13            | Unit/integration/e2e and edge-failure coverage defined                       | [ ]    |
| Rollout safety complete              | § 12            | Migration, rollback triggers and steps are explicit                          | [ ]    |
```

---

#### § 12 — Migration & Backward Compatibility

**§ 12.1 Schema Migration Strategy**
```
| Change | Safety | Deploy Order | Timing |
|--------|--------|--------------|--------|
| Add nullable field | Safe | Deploy schema → deploy Lambda | Anytime |
| Add non-nullable field | Requires backfill | Backfill all records → deploy schema → deploy Lambda | Schedule maintenance |
| Remove field | Breaking for old apps | Ship iOS update (remove usage) → wait 2 app versions → remove from schema | Coordinated |
| Add new GSI | Safe but slow | Deploy schema → wait 5-10 min for GSI to build → deploy Lambda | Allow for GSI build time |
| Rename field | Breaking | Add new field → migrate data → deprecate old field → remove in v+2 | Multi-phase |
```

**§ 12.2 Older App Version Impact**
```
| Scenario | Impact | Mitigation |
|----------|--------|------------|
| Old app + new nullable field | Field reads as nil — safe | None needed |
| Old app + new enum value | Unknown enum case — safe if handled | Guard against unknownCase in Swift |
| Old app + removed field | Codable decode failure (if non-optional) | Make optional first, wait 2 versions, then remove |
```

**§ 12.3 Data Migration Required?**
State explicitly: `Yes — describe the migration` / `No — purely additive changes`.

If yes: describe the migration approach (DynamoDB scan + update, Lambda migration script, or backfill strategy) and the required deployment order.

---

#### § 13 — Testing Requirements

Define what must be tested. The Implementation Plan writes the actual test code.

**§ 13.1 iOS Unit Tests (Swift)**
```
| Component | Test Scenarios |
|-----------|---------------|
| LiveClassService.fetchLiveClasses | Success: non-empty response → liveClasses populated, nextToken stored |
| | Success: empty response → liveClasses = [], no error |
| | Error: API failure → classesError set, liveClasses unchanged |
| | Concurrency: two concurrent calls → only one fires (Task deduplication) |
| | Pagination: two calls with nextToken → appends correctly |
| | Refresh: call with refresh=true → cancels previous task |
```

**§ 13.2 Lambda Tests (Node.js)**
```
| Function | Scenario | Expected |
|----------|----------|----------|
| getLiveClassesForCoach | Valid coachId, has classes | { items: [...], nextToken: "..." } |
| | Valid coachId, no classes | { items: [], nextToken: null } |
| | Missing coachId | { success: false, error: { message: "coachId required" } } |
| | Invalid pagination token | { items: [], nextToken: null } (DynamoDB returns empty page) |
| | Pagination: first page | items.length === limit, nextToken !== null |
| | Pagination: last page | items.length < limit, nextToken === null |
```

**§ 13.3 Integration Tests**
- iOS → AppSync → Lambda → DynamoDB round-trip for each operation
- Auth: unauthenticated requests rejected (401)
- Pagination: verify nextToken chains correctly across pages
- Sort order: verify createdAt DESC sorts correctly end-to-end

**§ 13.4 Performance Validation**
- Lambda: measure Duration metric in CloudWatch after deploy — must meet §9.1 thresholds
- iOS: Instruments Core Animation pass — 60fps scroll on iPhone 12
- Memory: Instruments Leaks pass — no new retain cycles

---

#### § 14 — Out of Scope

Explicit list. Every item prevents AI from doing extra work.
```
- Push notifications for class start — tracked separately, future phase
- Admin dashboard for class management — separate BE initiative  
- Class capacity/booking system — V2 feature (BRD §V2)
- [Any other feature mentioned in BRD but not in this TRD]
```

---

#### § 15 — Open Technical Decisions

Every unresolved decision that blocks implementation. Must be resolved before Implementation Plan begins.

```
| # | Decision | Options | Owner | Deadline | Blocks |
|---|----------|---------|-------|----------|--------|
| 1 | Sort direction for ended classes | ASC (oldest-first) vs DESC (newest-first) | Product | Before Phase 1 | §5, §6 |
| 2 | Max items per page | 20 vs 50 | Engineering | Before Phase 1 | §5, §9.3 |
| 3 | Cache invalidation strategy | Time-based (5 min) vs event-driven (AppSync subscription) | Engineering | Before Phase 2 | §6 |
```

Mark `⚠️ BLOCKS IMPLEMENTATION` for any decision that must be resolved before any code is written.

---

#### § 16 — Traceability Matrix

Every BRD requirement must map to at least one TRD section:

```
| BRD §Ref | BRD Requirement (summary) | TRD Section(s) | Gap? |
|----------|--------------------------|----------------|------|
| §2.1 | Coach sees all classes | §5, §6 | — |
| §2.3 | Classes sorted by createdAt | §4.1, §5 | — |
| §3.1 | Error state shown | §7, §8 | — |
| §3.2 | Analytics for class view | §10.1 | — |
| §4.1 | Push notification for start | §14 (out of scope) | — |
```

Any BRD requirement without a TRD mapping is a CRITICAL gap — add the missing section before proceeding.

---

## Phase 3.5 — Cross-Section Consistency Check (mandatory, before Phase 4)

After all three parts are written, before launching any reviewers, perform this self-check inline (no agent needed — do it yourself):

For each concept that appears in MORE than one section, confirm every mention agrees:

| Concept to check | Sections to compare |
|---|---|
| Any config value (bundle ID, pool ID, env var name, raw key string) | §0.0, §3.3, §4.1, §9, §10, §16, Appendix B |
| Auth flow steps (which call passes which metadata, what each trigger receives) | §3.3, §6, §9.4, §10.3 |
| Error codes (same name and same behavior everywhere) | §9.5, §13, §16, Appendix A |
| Phase boundaries (which work belongs in P0/P1/P2) | §2.1, §15.0, §18, §21 |
| File paths and line numbers (consistent across all references) | §5.3, §6.1, §14.5, Appendix B |
| Feature flag name and raw key string | §3.3, §6.1, §13.4, §14.1 |
| Domain model input/output field contracts vs GraphQL schema | For each field in any input/output contract table (§7.x, §5.x): confirm the field name appears in the corresponding GraphQL type definition in §4. A field present in the contract table but absent from the schema is an undocumented scope gap. Flag as CRITICAL. |
| Q-XX label accuracy | For each Q-XX reference in AC tables, deliverables, or task labels: confirm the label matches the actual Q item description in §19. A wrong Q-XX label (e.g. labeling an aws-sdk task as "Q-09 nodejs20.x fix" when Q-09 is about DefineAuth invocation detection) misdirects implementation. Flag mismatches as WARNING. |
| Dangling internal section references | Scan all prerequisites, gates, AC tables, and cross-references for §N.N-format section references. For each one, verify the cited section heading exists in the document. A reference to a non-existent section (e.g. §1.10, §21.3) silently mis-routes implementers. Flag any dangling reference as WARNING. |

**For each inconsistency found:** fix it in the file immediately before proceeding to Phase 4. Log each fix as a `⚠️ CONSISTENCY FIX:` comment in §0.0.

**The single most common cross-section bug:** a section is corrected in one place but the old text is left in another section. Search for the OLD value as a string across the entire document before finalising.

**Cross-document check (when an Implementation Plan already exists):** If a matching Implementation Plan exists in `documents/Requirenments/`, grep for references to the previous TRD version and check whether TRD changes in this new version are reflected in the IP. Specifically check: error code tables, StackMapping keys, bundle IDs, Cognito pool/client IDs, and Q-XX labels. Do NOT automatically edit the IP — instead flag each inconsistency as `⚠️ CROSS-DOCUMENT GAP:` in §0.0 so the IP author can apply the corresponding updates.

---

## Phase 4 — Multi-Cycle Review Loop (up to 5 cycles)

> **PARALLELISM RULE:** Every cycle, launch Reviewers A, B, and C in a **single message** with three concurrent Agent tool calls. They run simultaneously — never sequentially. Wait for all three to complete before synthesizing findings.

Three independent reviewers run every cycle. All use only **Cursor Grok 4.5** (`grok-4.5-fast-xhigh`) or **Composer 2.5** (`composer-2.5-fast`) per the model pins below — never Opus, Sonnet, Haiku, GPT, or other slugs. Iterate until zero CRITICAL and zero WARNING remain. At the start of each cycle: `--- TRD REVIEW CYCLE N/5 ---`

**Cycle 1:** Launch Reviewers A, B, and C simultaneously in one message.
**Cycles 2–5:** Launch Reviewers A, B, and C simultaneously in one message (delta/incremental).

---

**Reviewer A — Schema & Code Accuracy** (`subagent_type: Explore`, model: **Cursor Grok 4.5** / `grok-4.5-fast-xhigh`, thoroughness: `very thorough`)

**Cycle 1 prompt:**
```
Validate this TRD against the actual Step iOS codebase at /Users/andreitekhtelev/Documents/DEVELOPMENT/step-ios-work.

TRD content:
[paste full TRD text]

Verify EVERY factual claim. Be exhaustive — this document guides AI implementation:

1. FILE PATHS — does every mentioned file exist? Glob every single one. Flag any missing path.
2. LINE NUMBERS — read the actual file at each referenced line range. Confirm the code shown in the TRD matches what is really there. Flag any stale reference.
3. SYMBOLS — grep every class name, method name, Swift type, enum value, and generated model name. Flag any that do not exist in the codebase.
4. GRAPHQL SCHEMA — for every field, type, enum, index, and auth rule in §4 and §5:
   - Read amplify/backend/api/step/schema.graphql
   - Confirm the exact field name, type, nullability, @index name, sortKeyFields, auth rules
   - Flag ANY mismatch — even a capitalization difference
5. GENERATED MODELS — for any generated model cited in the TRD: read amplify/generated/models/{TypeName}.swift and confirm field names and types.
6. LAMBDA INVENTORY — for every Lambda mentioned: confirm amplify/backend/function/{name}/src/index.js exists. Read it and confirm the event shape, response shape, and routing (fieldName switch) match what the TRD documents.
7. INDEX CLAIMS — if the TRD claims a query uses a DB-level sort or key condition on field X: confirm @index exists for that field in schema.graphql. A "key condition" on a non-indexed field is a filter expression, not a key condition — this matters for performance.
8. MIRROR REFERENCES — read each mirror reference in §2.2 at the exact file:line. Confirm the pattern described matches what is actually there.
9. ANALYTICS — for each new event in §10.1, grep for the nearest existing analogous AnalyticsManager.track() call. Confirm the property format (camelCase, String type, etc) matches project conventions.
10. LAMBDA BASELINE — for BE/FE+BE: confirm §2.4 has real data (timeout, memory, error rate from CloudWatch, actual response shape from dev invocation). Flag ❌ MISSING LAMBDA BASELINE if any item is a placeholder (N%, "N", or empty).
11. PROD BASELINE — confirm §2.5 has a real commit hash (not a placeholder). Confirm the unreleased commits list is accurate.

12. TEMPLATE MANDATORY SECTIONS — verify the following exist and are populated (not placeholder text):
    - § 0.2 BRD Requirement Inventory: at least one row per in-scope BRD requirement with source anchor.
    - § 0.3 Coverage Checksum: all formula rows filled with actual counts, not "[N]" placeholders.
    - § 3.4 Shared Platform Standards Compliance: all three rows (Timezone, Error handling, Design tokenization) filled.
    - § 11.5 Cross-Platform Behavior Contract: §11.5.1 and §11.5.2 tables populated.
    - § 15.0 Phase Plan Matrix: present if BRD is phased; rows populated with real scope and exit criteria.
    - § 19 Open Questions: present (may be empty if no blockers, but section must exist).
    - § 20 Decisions Log: present (at minimum one row for any non-trivial architectural choice).
    - § 21 Handoff Checklist: present.
    - Do Not Approve Yet Gate: present with gate rows.
    Flag any missing or placeholder-only section as ❌ MISSING MANDATORY SECTION.

Return:
- ✅ CONFIRMED: each verified item (be specific — include file:line)
- ❌ BROKEN: each mismatch with exact current state (what the TRD says vs what the code actually has)
- ❌ MISSING LAMBDA BASELINE: list each missing baseline item
- ⚠️ UNVERIFIABLE: items impossible to check and specific reason why
```

**Cycles 2–5 prompt (incremental):**
```
Incremental TRD codebase validation — re-check only items that were BROKEN or UNVERIFIABLE.

Updated TRD:
[paste full updated TRD text]

Previously CONFIRMED (skip these):
[paste ✅ CONFIRMED list from previous cycle]

Items to re-check ONLY (from previous cycle):
[paste ❌ BROKEN and ⚠️ UNVERIFIABLE lists]

For each: read the relevant file/line in the updated TRD. Confirm whether the fix is correct.

Return:
- ✅ NOW CONFIRMED: items fixed
- ❌ STILL BROKEN: items still wrong (with exact current state)
- 🆕 NEW BROKEN: new issues introduced by the edits
- ⚠️ STILL UNVERIFIABLE: still impossible to verify and why
```

---

**Reviewer B — Completeness, Risk & AI-Readiness** (`subagent_type: Plan`, model: **Cursor Grok 4.5** / `grok-4.5-fast-xhigh`)

**Cycle 1 prompt:**
```
Deep completeness, risk, and AI-implementation-readiness review of a TRD for the Step iOS app.

Stack: SwiftUI iOS 17+ / AWS Amplify AppSync / DynamoDB / Lambda Node.js (v2 SDK only) / Cognito.

TRD content:
[paste full TRD text]

Hard project rules (violations = CRITICAL):
- FE: no force unwrap in views, DebugConfig.Services logging (never #if DEBUG), lines 120/150 chars, @MainActor for UI-touching methods, Task caching for async deduplication
- BE: aws-sdk v2 only, shared IAM step-lambda-shared-{env}, table names via Fn::ImportValue, always log EVENT JSON, user ID from event.identity?.claims?.sub
- Never edit amplify/generated/ or API.swift
- TRD specifies WHAT — never prescribes code patterns, variable names, or function bodies

Evaluate every item:

1. ACCEPTANCE CRITERIA — are ALL FR acceptance criteria machine-verifiable (concrete Given/When/Then with specific inputs and expected outputs)? "Works correctly", "displays properly", "behaves as expected" are NOT acceptable — flag as CRITICAL.

2. ERROR COVERAGE — for each FR, does §8 have a corresponding error scenario? A happy-path FR with no error row in §8 is a WARNING. An error that could cause a crash (nil force unwrap, missing state) is CRITICAL.

3. NFR THRESHOLDS — does §9 have SPECIFIC NUMBERS for: API response p50/p95 in ms, scroll fps target, memory leak policy, Lambda timeout, Lambda cold start max? Vague NFRs ("should be fast", "must be secure") are WARNING. Missing NFRs for a feature with user-visible performance are CRITICAL.

4. API CONTRACT COMPLETENESS — for each operation in §5:
   - Are all input fields typed with required/optional markers?
   - Are all response fields typed with nullability markers?
   - Is the auth requirement stated (private/public/owner)?
   - Is the DB access pattern stated (key condition vs filter expression)?
   Flag any missing type, nullability, or auth requirement.

5. STATE MACHINE COMPLETENESS — does §7 cover ALL reachable states including: LOADING, LOADED(non-empty), LOADED(empty), ERROR(initial), REFRESHING, REFRESH_ERROR(stale data), LOADING_MORE, LOADING_MORE_ERROR? Flag any missing state as WARNING. Flag absent §7 as CRITICAL.

6. OPEN DECISIONS — are all implementation-blocking decisions in §15 with owner and deadline? Flag implicit decisions buried in the text (e.g. sort direction mentioned without confirming with product) as WARNING. Flag blocking decisions not in §15 as CRITICAL.

7. TRACEABILITY — does §16 map EVERY BRD requirement to at least one TRD section? Flag unmapped BRD requirements as CRITICAL.

8. DATA MODEL INTEGRITY — for each list query in §5: is it stated whether the sort is DB-level (key condition) or client-side? Is there proof (via @index in §4) that the DB-level sort is supported? Flag any list query claiming DB-level sort without @index evidence as CRITICAL.

9. SCHEMA MIGRATION SAFETY — are migration strategies in §12 safe for production? Could any schema change break older app versions? Flag risky migrations (removing non-optional fields, breaking existing queries) as CRITICAL.

10. INTEGRATION COMPLETENESS — does §10.1 have the full event contract (trigger, all properties with types, required/optional) for EVERY new analytics event? Flag incomplete contracts as WARNING.

11. FORBIDDEN PATTERNS — does §11 list ALL project-specific forbidden patterns? Flag missing critical patterns (force unwrap, #if DEBUG logging, hardcoded table names, aws-sdk v3) as WARNING.

12. AI-READINESS — if an AI coding assistant reads this TRD and starts implementing without any other context, what will it get wrong or have to guess? For each ambiguity, flag as CRITICAL if it could cause a production bug, WARNING otherwise. This is the most important check.

13. OVERALL RISK — Low / Medium / High with justification. Note irreversible decisions.

14. TEMPLATE GATE — Verify the "Do Not Approve Yet Gate" table (§ Do Not Approve Yet Gate): are all rows checked? Flag any unchecked row as CRITICAL. Verify § 0.2 (BRD Requirement Inventory) is populated, § 0.3 Coverage Checksum passes, § 3.4 Shared Platform Standards Compliance is filled, § 11.5 Cross-Platform Contract is present, § 15.0 Phase Plan Matrix is present (if BRD is phased), § 19/§ 20/§ 21 exist. Any missing mandatory section is CRITICAL.

15. SERVER-SIDE KILL SWITCH — does the TRD document a server-side mechanism (Lambda env var, CloudFormation parameter, or remote config) that can disable new behavior without releasing a new binary? A client-only `FeatureFlagService` flag backed by UserDefaults requires a new binary to change — it is insufficient as an emergency kill switch for P0/P1 features. If the feature introduces Lambda auth logic, Cognito trigger changes, or any BE-side gating behavior: flag absence of a server-side kill switch as WARNING. If one is documented: confirm it specifies (a) what to set and where (exact Lambda Console path or CLI command), (b) how to verify it is active, and (c) how to disable/revert it. A kill switch description that only states "set env var X" without these three operational details is insufficient for 3am use — flag missing steps as WARNING.
16. COGNITO ATTRIBUTE OWNERSHIP TABLE — for any new Cognito User Pool attribute introduced in the TRD (custom or standard attribute written by a Lambda or service for the first time): verify a consolidated attribute ownership table exists covering ALL attributes written by the same code path. The table must include: attribute name, Cognito `mutable` setting, which system writes it (Lambda name / iOS client / admin tool), when it is written (at user creation / on first login / on update), and any write restrictions. A table that covers only the new custom attribute while omitting standard attributes (`email`, `given_name`, `family_name`) written by the same Lambda leaves implementers without a complete ownership picture. Flag any missing standard-attribute rows as WARNING.

Return: CRITICAL (blocks implementation or production risk) / WARNING (reduces quality) / SUGGESTION. Reference §section and FR number for each finding.
```

**Cycles 2–5 prompt (delta):**
```
Delta completeness review of updated TRD. Focus only on whether previous issues were resolved.

Updated TRD:
[paste full updated TRD]

Previous cycle issues:
CRITICAL: [list]
WARNING: [list]

For each: ✅ RESOLVED / ❌ STILL CRITICAL / ⚠️ STILL WARNING / 🆕 NEW CRITICAL / 🆕 NEW WARNING.

Note any fixes that introduced new hidden assumptions, API contract gaps, or section inconsistencies.
Do NOT re-evaluate SUGGESTION-only items unless now relevant.

Return: ✅ RESOLVED / ❌ STILL CRITICAL / ⚠️ STILL WARNING / 🆕 NEW CRITICAL / 🆕 NEW WARNING.
```

---

**Reviewer C — Independent Second Opinion** (`subagent_type: Plan`, model: **Composer 2.5** / `composer-2.5-fast`)

**Cycle 1 prompt:**
```
Independent second-opinion review of a TRD for Step iOS. You have NOT seen any prior review. Find issues the primary reviewer may have missed.

TRD content:
[paste full TRD text]

Be contrarian — your job is to find what the primary reviewer likely missed:

1. HIDDEN ASSUMPTIONS — what does the TRD implicitly assume is already decided, already built, or universally understood — but is actually ambiguous? These stall implementation. Flag each as WARNING.

2. SCOPE BOUNDARY LEAKAGE — are there FRs or API contracts that implicitly require work outside the stated scope, without any tracking reference? Flag as CRITICAL.

3. CROSS-SECTION CONSISTENCY — do §4 (schema), §5 (API), §6 (service), §7 (state machine), §8 (errors), and §16 (traceability) all tell exactly the same story? Any contradiction between sections — even subtle — is CRITICAL.

4. IMPLEMENTATION TRAPS — are there acceptance criteria, state transitions, or API contracts that look correct but would be hard to implement correctly on iOS 17+ / Lambda+DynamoDB? (e.g. a "real-time update" requirement with no subscription defined, a "sort by X" requirement without X being indexed) Flag each as WARNING with the technical reason.

5. MISSING UNHAPPY PATHS — beyond what §8 lists, what edge cases will real users hit within 60 days of launch?
   - What happens if a user has a very slow connection (3G)?
   - What happens if the list has 1000+ items?
   - What happens if the coach deletes a class while a user is viewing it?
   - What happens if a user logs out during a fetch?
   Flag each missing edge case as WARNING.

6. ANALYTICS COVERAGE — does §10.1 capture all meaningful user interactions with this feature? Flag any FR-level user action without an analytics event as SUGGESTION.

7. ROLLOUT RISK — if this TRD is implemented as written and shipped to production, what is the single most likely cause of a production incident in the first 2 weeks? State it explicitly.

Return: CRITICAL / WARNING / SUGGESTION, plus a "ROLLOUT RISK:" summary at the end (2-3 sentences maximum).
```

**Cycles 2–5 prompt (delta):**
```
Delta independent review of updated TRD.

Updated TRD:
[paste full updated TRD]

Previous cycle issues:
CRITICAL: [list]
WARNING: [list]

For each: ✅ RESOLVED / ❌ STILL CRITICAL / ⚠️ STILL WARNING / 🆕 NEW CRITICAL / 🆕 NEW WARNING.

Also check: did any fixes introduce new hidden assumptions, scope leakage, or section contradictions?
Do NOT re-evaluate SUGGESTION-only items unless now relevant.

Return: ✅ RESOLVED / ❌ STILL CRITICAL / ⚠️ STILL WARNING / 🆕 NEW CRITICAL / 🆕 NEW WARNING.
Updated ROLLOUT RISK (1-2 sentences).
```

---

### Cycle Decision Logic

After all three reviewers return, consolidate (merge duplicates, keep most severe classification):

```
=== TRD REVIEW CYCLE N/5 ===

CRITICAL (must fix — blocks implementation):
- [merged from all three reviewers, or "None"]

WARNING (should fix — reduces quality):
- [merged, or "None"]

SUGGESTIONS (optional — skip if time is limited):
- [merged, or "None"]

ROLLOUT RISK: [from Reviewer C]
```

**Decision:**
- **Zero CRITICAL and zero WARNING** → TRD is READY. Go to Phase 5 immediately. Stop cycling.
- **Cycle 1: zero BROKEN (Reviewer A) AND zero CRITICAL (Reviewers B and C)** → fast exit even if WARNINGs exist.
- **Issues found + cycles remaining** → fix all CRITICAL and WARNING, create new version file.
- **5 cycles reached with remaining issues** → go to Phase 5, flag all unresolved items clearly.

### ⚠️ Large Document — Always Write in 3 Parts

TRDs always exceed the 32 000-token output limit. **Never attempt a single-shot write.** Always use exactly 3 parts with these fixed section boundaries:

| Part | Sections | Tool |
|------|----------|------|
| **Part 1** | §0.0 (header) through §9 (API contract) inclusive | `Write` — creates the file |
| **Part 2** | §10 (auth/security) through §17 (risks) | `Edit` — appends via placeholder |
| **Part 3** | §18 (traceability) through end (decisions, appendices, gate) | `Edit` — appends via placeholder |

**Procedure:**
1. Announce: `📄 Writing TRD in 3 parts (FE+BE TRDs always exceed 32k token limit).`
2. **Part 1**: `Write` tool — §0 header through end of §9, ending the file content with `<!-- PART_2_CONTINUES -->`
3. Announce: `✅ Part 1 written (§0–§9). Writing Part 2...`
4. **Part 2**: `Edit` tool — `old_string: "<!-- PART_2_CONTINUES -->"` → §10 through end of §17, ending with `<!-- PART_3_CONTINUES -->`
5. Announce: `✅ Part 2 written (§10–§17). Writing Part 3...`
6. **Part 3**: `Edit` tool — `old_string: "<!-- PART_3_CONTINUES -->"` → §18 through final line of document

> FE-only Simple features may fit in 2 parts (split after §11). FE+BE Complex features always need 3. When in doubt, use 3.

**Start Part 1 as soon as Agent A returns** (while B/C still run). Incorporate B/C findings into Parts 2–3 once they complete.

### Creating a New Version File

1. Compute new version: v1.0 → v1.1 → v1.2 … v1.5
2. New filename: same base, version incremented.
   `Coach_Page_Live_Classes_TRD_v.1.0.md` → `Coach_Page_Live_Classes_TRD_v.1.1.md`
3. Write the new file with ALL fixes applied:
   - Correct every broken file path, field name, type name, index name, line reference
   - Rewrite vague acceptance criteria as concrete Given/When/Then
   - Add missing error states to §8
   - Add specific measurable thresholds to §9 (replace every vague statement)
   - Add missing nullability markers to §5
   - Add missing state transitions to §7
   - Move implicit blocking decisions into §15 with owner and deadline
   - Complete §16 traceability for unmapped BRD requirements
   - Update version and date in header (Status stays "Draft")
   - Add / update `## Revision History` at bottom
   - Apply SUGGESTION items only if they add AI-readiness; skip cosmetic-only ones
   - Leave unfixed ONLY items requiring human product decisions — flag them in §15
4. Announce: `Created v1.X — proceeding to Cycle N+1.`
5. Pass ✅ CONFIRMED list to next Reviewer A prompt. Update the working file path. Continue.

---

## Phase 5 — Jira & Final Output

### Step 1 — Jira script

Only if no Jira ticket was provided in $ARGUMENTS:
```bash
python3 Scripts/create_jira_ticket.py "documents/Requirenments/<Feature_Name>_TRD_v.X.X.md"
```

If Jira ticket was already provided: skip (ticket already exists).
If `.env` missing: warn "Set up `.env` with JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY."

### Step 2 — Final output

```
=== TRD CREATED ===

File: documents/Requirenments/<Feature_Name>_TRD_v.X.X.md
Area: FE / BE / FE+BE
Priority: P0 / P1 / P2
Jira: SS-XXXX (created / pre-existing / skipped)

Review cycles run: N/5
Final version: vX.X
Verdict: READY ✅ / NEEDS HUMAN REVIEW ⚠️

Document summary:
- §3 FR count: N (P0: N, P1: N, P2: N)
- §4 Schema changes: Yes (N types/fields) | No
- §5 New API operations: N
- §15 Open blocking decisions: N
- Review issues corrected: N across N versions

Version history:
- v1.0 → v1.1: [summary of fixes]
...

⚠️ Remaining issues (if NEEDS HUMAN REVIEW):
  - [list with explanation of why not auto-resolved]

⚠️ Open decisions requiring sign-off before Implementation Plan:
  - [from §15, or "None — proceed to /create-implementation-plan"]

Next step: Resolve open decisions (§15), then run /create-implementation-plan with this TRD.
```

---

## File Naming & Location

```
documents/Requirenments/<Feature_Name>_TRD_v.1.0.md
```

Examples:
- `Coach_Page_Live_Classes_TRD_v.1.0.md`
- `Push_Notification_Preferences_TRD_v.1.0.md`
- `Activity_Journal_Lambda_Refactor_TRD_v.1.0.md`

For large features with multiple documents: create a subdirectory:
`documents/Requirenments/<FeatureName>/<Feature_Name>_TRD_v.1.0.md`

---

## Style Rules (always enforce)

- Use `file:line` for ALL code references — never vague descriptions
- Fenced code blocks with language tags: `swift`, `graphql`, `javascript`, `json`
- ASCII diagrams for architecture and state machines
- Tables for: error states, schema changes, NFRs, integration points, mirror references
- Given/When/Then for ALL acceptance criteria — concrete inputs and expected outputs
- Every FR must have: at least one AC, at least one BRD traceability entry in §16
- Mark inferred (not code-verified) claims: `⚠️ Unverified:`
- Mark blocking open decisions: `⚠️ BLOCKS IMPLEMENTATION`
- Never write "should be" or "probably" — either specify or put in §15 as open decision
- Never prescribe code patterns — describe behavior only
- The document must be self-contained — an AI with no other context must be able to read it and implement without guessing
