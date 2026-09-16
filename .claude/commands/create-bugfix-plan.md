Create a complete, production-ready Fix Plan or Improvements Plan document for the Step iOS project.

**Input:** $ARGUMENTS
This can be any of:
- A bug description: "Login screen crashes on iOS 16 when user has no profile photo"
- A Jira ticket number: "SS-2844"
- Both: "SS-2844 - Hide Activity Confirmed Snackbar"
- An improvement idea: "Add Crashlytics error tracking to all Lambda functions"

If no arguments provided, ask the user: "Please describe the bug or improvement, and optionally a Jira ticket number."

---

## MANDATORY: Read the Correct Template First

**Before doing anything else**, determine the plan type and read the corresponding template:

**Fix Plan** (single root cause, 1–3 files, one PR):
```
documents/Requirenments/Templates/Fix Plan Template.md
```

**Improvements Plan** (multi-phase, 4+ files, phased rollout, sweep/migration/refactor):
```
documents/Requirenments/Templates/Improvements Plan Template.md
```

**How to decide:**
- Bug with a single root cause → Fix Plan
- Coverage gap affecting many Lambdas / files → Improvements Plan
- Architectural migration, dead-code cleanup, multi-phase rollout → Improvements Plan
- If unsure: Fix Plan (can always upgrade to Improvements Plan if scope grows)

Each template defines:
- The **mandatory section structure** (§0–§9 for Fix Plan; §0–§7 + phases for Improvements Plan)
- The **AI authoring protocol** (single-pass vs staged Pass 1→2→3)
- The **Do Not Merge Gate** checklist
- The **kickoff prompt** to copy into the research agent

**The research methodology below feeds INTO the template structure — do not skip either.**

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

## Project Structure Reference (always use when researching)

```
amplify/
  backend/
    api/step/schema.graphql          ← DynamoDB schema — source of truth for all models
    function/{name}/src/index.js     ← Lambda handler (140 functions total — see list below)
    function/{name}/src/             ← May also contain promptBuilder.js, validators.js, etc.
  generated/models/                  ← 578 auto-generated Swift model files — DO NOT EDIT

amplifyconfiguration-dev.json        ← Dev env config (AppSync endpoint, Cognito, region)
amplifyconfiguration-stg.json        ← Stg env config
amplifyconfiguration-prod.json       ← Production env config
  → All envs: region us-east-2

step/
  Services/          ← Business logic singletons (120+ Swift files)
  APIServises/       ← Amplify GraphQL API services (28 files)
  Views/             ← SwiftUI views (200+ files across 14 subdirs)
  Models/            ← Data models
  Managers/          ← Navigation, Analytics, DeepLink, VideoPlayer
  Config/            ← Design tokens, themes, DebugConfig
```

**Key Lambda functions** (partial — search `amplify/backend/function/` for others):
`LLMchat3`, `generateAIMessages`, `generateReadinessMessage`, `generateRecommendationMicroMessage`,
`ciProfileInterpreter`, `ciActivityInterpreter`, `getCISnapshot`, `resolveActivityConfirmation`,
`createActivityJournal`, `editActivityJournal`, `getActivityJournals`, `dismissActivityJournal`,
`bookClass`, `cancelBookingClass`, `getEventOccurrences`, `getLiveClassesPublic`,
`getTodayRecommendations`, `getTopPicks`, `createWeeklyTarget`, `getOrCreateWeeklyTarget`,
`updateWeeklyTargetActuals`, `transmitDailyReadiness`, `generateStructuredReflection`,
`sendMessage`, `createConversation`, `updateMessageReadStatus`, `validateMessageOutput`,
`followUser`, `circleCore`, `circleSession`, `circleDetails`, `circleReactions`

---

## Phase 1 — Classify & Research (parallel)

First, read the input and determine:
- **Plan type:** Fix Plan (bug with root cause) or Improvements Plan (enhancement/coverage gap)
- **Area:** FE (SwiftUI/iOS), BE (Lambda/DynamoDB), or FE+BE
- **Short Title:** clear, title-cased, 3-6 words

Then launch agents **simultaneously** — for BE or FE+BE plans, launch three; for FE-only, launch two:

---

**Agent A — Deep Codebase Research** (`subagent_type: Explore`, model: **Cursor Grok 4.5** / `grok-4.5-fast-xhigh`, thoroughness: `very thorough`)

Prompt:
```
You are doing deep codebase research to build a fix/improvement plan for the Step iOS project at /Users/andreitekhtelev/Documents/DEVELOPMENT/step-ios-work.

BUG/IMPROVEMENT DESCRIPTION: [insert full $ARGUMENTS here]

Your job: find EVERYTHING relevant. Do not guess — only report what you find in the actual code.

1. SYMPTOM SEARCH — grep for all keywords from the description (class names, method names, screen names, error messages, UI strings). Cast a wide net.

2. ROOT CAUSE INVESTIGATION:
   - For each relevant file found: read the affected methods/functions in full
   - Trace the call chain from the entry point (UI action / Lambda trigger) to the failure point
   - Find the exact file path + line number where the bug originates or the improvement should go
   - Read surrounding context (20+ lines) to understand the pattern

3. CALL SITES — for any method you identify as the fix point, grep the whole codebase for all callers. State exactly how many call sites exist and list them.

4. SCHEMA CHECK — if the issue involves data models, read amplify/backend/api/step/schema.graphql for relevant types, keys, indexes. Read the generated model from amplify/generated/models/ for field types.

5. LAMBDA CHECK — if BE is involved, read the relevant amplify/backend/function/{name}/src/index.js. Confirm aws-sdk v2 usage, table name env vars, event shape.

6. PATTERN AUDIT — find 2-3 similar implementations in the codebase that the fix should mirror (same service, similar feature, neighboring files).

6b. CROSS-LAMBDA SAME-PATTERN SCAN — **only if the root cause is in a Lambda prompt, system instruction, validator, or shared utility:**
   - Extract the core missing constraint or faulty pattern (e.g. "no outdoor discovery guard", "missing input sanitisation", "no rate-limit check").
   - Grep ALL other Lambdas under `amplify/backend/function/` for the same missing constraint:
     - Read system prompts / SYSTEM_PROMPT constants in every Lambda that generates LLM output.
     - Read validator files (validators.js, promptBuilder.js, etc.) in every Lambda that validates output.
     - Read shared utilities if the fix point is in a shared helper.
   - For each Lambda found with the same gap: record it as a SAME-PATTERN HIT with file:line evidence.
   - For each Lambda confirmed clean (has the constraint): record as SAME-PATTERN CLEAR.
   - Never assume a Lambda is clean without reading it. "Handles it separately" is not evidence.

7. PROD BASELINE — run: git log --oneline -5 origin/work (or origin/main) to get the current prod baseline commit.

8. UNRELEASED AUDIT — run: git log --oneline work..HEAD to find unreleased commits. Check if any touch the files identified in step 2.

Return a structured report with:
- AFFECTED FILES: exact paths + relevant line numbers + code snippets
- CALL CHAIN: step-by-step trace from trigger to failure
- ROOT CAUSE: specific file:line with code evidence
- CALL SITES: all callers with paths + line numbers
- SCHEMA: relevant fields, keys, indexes (if applicable)
- PATTERN REFERENCES: 2-3 examples from codebase to mirror
- SAME-PATTERN SCAN: list of HITS (same gap found, file:line) and CLEAR (verified clean). Omit if step 6b was skipped.
- PROD BASELINE: commit hash + message
- UNRELEASED: list of relevant unreleased commits or "None"
```

---

**Agent B — Lambda Baseline** (`subagent_type: general-purpose`, model: **Composer 2.5** / `composer-2.5-fast`) — **BE and FE+BE plans only; skip for FE-only**

Prompt:
```
You are fetching real Lambda baseline data for a Step backend fix plan.
Working directory: /Users/andreitekhtelev/Documents/DEVELOPMENT/step-ios-work

Lambda function(s) involved: [insert function name(s) from Agent A findings, e.g. generateAIMessages]
Lambda naming pattern: {functionName}-dev, {functionName}-stg, {functionName}-production
AWS region: us-east-2

Run ALL of the following commands for EACH affected Lambda across dev and stg environments.
For production: fetch logs and metrics only (read-only, no invocations).

--- 0. READ ENV CONFIG FIRST ---
Read amplifyconfiguration-dev.json, amplifyconfiguration-stg.json, amplifyconfiguration-prod.json
to get region, AppSync endpoints, and Cognito pool IDs for each environment.
Region is us-east-2 for all envs. Amplify App ID: dy526yw1rln67. Environments: dev, stg, production (exact names — never "prod", never "staging"). NEVER invoke production Lambda without explicit permission.

--- 1. RECENT ERRORS (last 24h) ---
Run for stg (closest to production) and dev:
aws logs filter-log-events \
  --log-group-name /aws/lambda/{functionName}-stg \  # or -production for prod logs
  --start-time $(python3 -c "import time; print(int((time.time()-86400)*1000))") \
  --filter-pattern "ERROR" \
  --limit 10 \
  --region us-east-2 2>&1

aws logs filter-log-events \
  --log-group-name /aws/lambda/{functionName}-dev \
  --start-time $(python3 -c "import time; print(int((time.time()-86400)*1000))") \
  --filter-pattern "ERROR" \
  --limit 10 \
  --region us-east-2 2>&1

For production (read-only — logs only, NEVER invoke):
aws logs filter-log-events \
  --log-group-name /aws/lambda/{functionName}-production \
  --start-time $(python3 -c "import time; print(int((time.time()-86400)*1000))") \
  --filter-pattern "ERROR" \
  --limit 5 \
  --region us-east-2 2>&1

--- 2. ERROR RATE METRIC (last 24h, dev + stg) ---
For each env in [dev, stg] (use "production" for the production env name):
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value={functionName}-{env} \
  --start-time $(date -u -v-24H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 86400 \
  --statistics Sum \
  --region us-east-2 2>&1

--- 3. INVOCATION COUNT (last 24h, dev + stg) ---
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value={functionName}-{env} \
  --start-time $(date -u -v-24H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 86400 \
  --statistics Sum \
  --region us-east-2 2>&1

--- 4. FUNCTION CONFIGURATION ---
aws lambda get-function-configuration \
  --function-name {functionName}-stg \
  --region us-east-2 2>&1 | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('Runtime:', d.get('Runtime'))
print('Timeout:', d.get('Timeout'), 's')
print('Memory:', d.get('MemorySize'), 'MB')
print('Handler:', d.get('Handler'))
print('Last modified:', d.get('LastModified'))
" 2>&1

--- 5. RECENT LOG STREAM SAMPLE (stg, last 20 lines) ---
STREAM=$(aws logs describe-log-streams \
  --log-group-name /aws/lambda/{functionName}-stg \  # or -production for prod logs
  --order-by LastEventTime --descending --limit 1 \
  --region us-east-2 \
  --query 'logStreams[0].logStreamName' --output text 2>&1)
aws logs get-log-events \
  --log-group-name /aws/lambda/{functionName}-stg \  # or -production for prod logs
  --log-stream-name "$STREAM" \
  --limit 20 \
  --region us-east-2 \
  --query 'events[].message' --output text 2>&1

--- 6. SAMPLE INVOCATION (dev only — NEVER invoke prod without explicit permission) ---
Read amplify/backend/function/{functionName}/src/event.json if it exists.
If it exists, run:
aws lambda invoke \
  --function-name {functionName}-dev \
  --payload file://amplify/backend/function/{functionName}/src/event.json \
  --log-type Tail \
  --cli-binary-format raw-in-base64-out \
  --region us-east-2 \
  /tmp/lambda_response.json > /tmp/lambda_meta.json 2>&1

python3 -c "
import json, base64
meta = json.load(open('/tmp/lambda_meta.json'))
tail = meta.get('LogResult', '')
if tail: print('=== LOG TAIL ==='); print(base64.b64decode(tail).decode('utf-8', errors='replace'))
" 2>&1
python3 -m json.tool /tmp/lambda_response.json 2>&1

Return a structured LAMBDA BASELINE REPORT:
- FUNCTION CONFIG: runtime, timeout, memory per env
- ERROR RATE: errors/invocations in last 24h per env (dev, stg, production)
- RECENT ERRORS: paste actual CloudWatch error log lines (redact user IDs/emails)
- ACTUAL RESPONSE SHAPE: paste real response from dev invocation (or note if event.json missing)
- LOG PATTERN: what the normal success log looks like vs the error case
- ANOMALIES: any unexpected behavior, throttling, timeout patterns
- BASELINE VERDICT: is the bug currently happening in stg/production? Error rate? Frequency?
```

---

**Agent C — Modern Practices Research** (`subagent_type: general-purpose`, model: **Cursor Grok 4.5** / `grok-4.5-fast-xhigh`)

Prompt:
```
You are researching modern best practices for a specific iOS/backend issue. Use WebSearch extensively.

ISSUE DESCRIPTION: [insert full $ARGUMENTS here]

Determine the core technology pattern(s) involved (e.g. SwiftUI async state management, DynamoDB pagination, AppSync GraphQL subscriptions, AWS Lambda error handling, iOS optimistic UI, etc.)

Research each relevant pattern:

1. Search: "[pattern] Swift 2025 best practices"
2. Search: "[pattern] Apple Human Interface Guidelines 2024"
3. Search: "[pattern] AWS Amplify Swift official documentation"
4. Search: "common pitfalls [pattern] iOS production"
5. Search: "SwiftUI [pattern] WWDC 2024" (if FE)
6. Search: "AWS Lambda [pattern] best practices 2025" (if BE)

For each finding, provide:
- The recommended modern approach
- Known pitfalls to avoid
- Source URL
- Whether the approach applies directly to this issue

Return:
- RECOMMENDED APPROACH: the modern best practice for this issue
- PITFALLS: common mistakes to avoid
- RELEVANT PATTERNS: specific Swift/AWS code patterns to use
- SOURCES: list of URLs consulted
```

---

## Phase 2 — Synthesize & Write Plan

After both agents return, synthesize their findings into a complete plan document.

### Follow the template — this is mandatory

The template you read at the start of this skill is the **canonical structure authority**. Do not deviate from its section order, mandatory markers, or formatting rules.

- **Fix Plan** → follow `documents/Requirenments/Templates/Fix Plan Template.md` §0–§9 exactly
- **Improvements Plan** → follow `documents/Requirenments/Templates/Improvements Plan Template.md` §0–§7 exactly

Map agent findings to template sections as follows:

| Agent output | Template section |
|---|---|
| Agent A — root cause trace, code snippets, file:line refs | §2 Root Cause (Fix) / §2 Current State (Improvements) |
| Agent A — prod baseline (last commit, unreleased changes) | §2.0 Prod Baseline & Unreleased Audit |
| Agent A — same-pattern scan results | §8.1 Same-Pattern Scan (Fix) / Related Findings (Improvements) |
| Agent B — Lambda CloudWatch metrics | §2.1 Lambda Baseline (BE plans only) |
| Agent B — modern best practices, recommended approach | §4 Fix Details "Why" blockquotes (Fix) / Phase tasks (Improvements) |
| Agent B — pitfalls to avoid | §4 Fix Details notes + §8.3 Modern Practices |

### Non-negotiable authoring rules (apply regardless of template type)

- **Never** suggest editing `amplify/generated/` or `API.swift`
- **Never** suggest Lambda-specific IAM roles or `aws-sdk` v3
- **Never** use `#if DEBUG` for logging — use `DebugConfig.Services.<flag>`
- Note if user needs to build in Xcode (no build commands in plan)
- All code locations use `file:line` notation (e.g. `path/to/file.swift:42`)
- Root cause must cite actual code found by Agent A — never speculate
- §8.1 Same-Pattern Scan must have explicit HIT/CLEAR rows for every file Agent A scanned; never write "out of scope" without evidence

**FE-specific:**
- Logging: `if DebugConfig.Services.{service} { debugLog("...", emoji: "🔧") }` — never `#if DEBUG`
- No force unwrap in SwiftUI views — use `guard let` or optional binding
- Line limit: 120 chars warning, 150 error; no `self.` unless required
- `@MainActor` for UI-touching service methods; prefer `async/await` over callbacks

**BE-specific:**
- `aws-sdk` v2 only — flag v3 usage as a related finding
- Shared IAM role `step-lambda-shared-{env}` — never function-specific
- Table names via `Fn::ImportValue` env vars — never hardcoded
- Always log: `console.log(\`EVENT: \${JSON.stringify(event)}\`)`
- User ID: `event.identity?.claims?.sub`; Mutations: `event.arguments.input`; Queries: `event.arguments.*`
- Error response: `{ success: false, error: { message: "..." } }`
- Environments: `dev`, `stg`, `production` — region `us-east-2`; Lambda naming: `{functionName}-{env}`
- Lambda invoke in plans: always `file://` + `--cli-binary-format raw-in-base64-out` (never `fileb://`)
- Deployment: `amplify push` required after code changes — note in §5 Verification; developer runs manually
- Tests: if Lambda has tests, note `npm install` must be run in `src/` first

---

## Phase 3 — Multi-Cycle Review Loop (up to 3 cycles)

> **PARALLELISM RULE:** Every cycle, launch all three reviewers in a **single message** with concurrent Agent tool calls. Wait for all three before synthesizing.

Three independent reviewers run simultaneously every cycle. Iterate until zero CRITICAL and zero WARNING remain. At the start of each cycle: `--- PLAN REVIEW CYCLE N/3 ---`

---

**Reviewer A — Codebase Accuracy** (`subagent_type: Explore`, model: **Cursor Grok 4.5** / `grok-4.5-fast-xhigh`, thoroughness: `very thorough`)

**Cycle 1 prompt:**
```
Validate this Fix Plan / Improvements Plan against the actual Step iOS codebase at /Users/andreitekhtelev/Documents/DEVELOPMENT/step-ios-work.

Plan content:
[paste full plan text]

Verify EVERY factual claim. This document guides implementation — inaccuracies cause wasted engineering time:

1. FILE PATHS — does every mentioned file exist? Glob each one. Flag any missing path as CRITICAL.
2. LINE NUMBERS — read the actual file at each referenced line range. Confirm the "Before" code shown matches what is really there. Flag ANY stale reference — even minor differences.
3. SYMBOLS — grep every method name, class name, @Published var, Lambda handler name, GraphQL field name. Flag any that don't exist in the codebase.
4. ROOT CAUSE EVIDENCE — is the root cause section citing actual code? Read the exact file:line claimed. Flag unverifiable root cause claims as CRITICAL.
5. SAME-PATTERN SCAN — if §8.1 exists: for every HIT, read the file:line cited and confirm the same gap is present. For every CLEAR, confirm the file was actually read (not assumed clean). Flag any CLEAR without file:line evidence as CRITICAL.
6. LAMBDA BASELINE — for BE plans: does §2.1 have real CloudWatch data (actual numbers, not "N%" or "N" placeholders)? Flag missing real data as CRITICAL.
7. PROD BASELINE — does §2.0 have a real commit hash (not a placeholder)? Flag placeholder as WARNING.
8. BEFORE/AFTER CODE — do the "Before" code blocks match the actual current file contents at the stated line numbers? Flag any discrepancy as CRITICAL.

Return:
- ✅ CONFIRMED: each verified item (be specific — include file:line)
- ❌ BROKEN: each mismatch with exact current state
- ⚠️ UNVERIFIABLE: items impossible to check and why
```

**Cycles 2–3 prompt (incremental):**
```
Incremental validation for updated plan — re-check only BROKEN/UNVERIFIABLE items.

Updated plan: [paste full updated plan]
Previously CONFIRMED (skip): [paste ✅ list]
Re-check list: [paste ❌ and ⚠️ lists]

Return: ✅ NOW CONFIRMED / ❌ STILL BROKEN / 🆕 NEW BROKEN / ⚠️ STILL UNVERIFIABLE
```

---

**Reviewer B — Completeness & Mandatory Sections** (`subagent_type: Plan`, model: **Cursor Grok 4.5** / `grok-4.5-fast-xhigh`)

**Cycle 1 prompt:**
```
Deep completeness and safety review of a Fix Plan / Improvements Plan for Step iOS.

Stack: SwiftUI iOS 17+ / AWS Amplify AppSync / DynamoDB / Lambda Node.js (v2 SDK only) / Cognito.

Plan content: [paste full plan text]

Hard project rules (violation = CRITICAL):
- FE: no force unwrap in views, DebugConfig.Services logging (never #if DEBUG), lines 120/150 chars, @MainActor for UI-touching methods
- BE: aws-sdk v2 only, step-lambda-shared-{env} shared IAM, table names via Fn::ImportValue, always log EVENT JSON, user ID from event.identity?.claims?.sub
- Never edit amplify/generated/ or API.swift

Evaluate:

1. MANDATORY SECTIONS — for Fix Plan: are §2.0 Prod Baseline, §8.1 Same-Pattern Scan, and §9 Do Not Merge Gate all present and populated (not placeholder)? Flag any missing mandatory section as CRITICAL.
   For Improvements Plan: are all phase pre-conditions, rollback plans, and verification ACs present? Flag missing as CRITICAL.

2. ROOT CAUSE CERTAINTY — is the root cause proven (citing actual code) or speculative? Flag unproven root causes as CRITICAL.

3. BEFORE/AFTER COMPLETENESS — does every fix step have a Before code block, After code block, and a "Why" explanation? Flag missing ones as CRITICAL.

4. VERIFICATION COMPLETENESS — does §5 Verification have: acceptance criteria with a security gate checkbox, a step-by-step procedure table, negative tests, and a post-implementation evidence section? Flag missing as WARNING.

5. SAME-PATTERN SCAN INTEGRITY — does §8.1 list EVERY Lambda/file scanned (not just HITs)? Are all CLEAR entries backed by file:line evidence? Flag any CLEAR without evidence as CRITICAL.

6. DO NOT MERGE GATE — is the §9 gate checklist present and complete (covering root cause, verified fix, same-pattern scan, security check, rollback, etc.)? Flag missing as CRITICAL.

7. ROLLBACK — is the rollback procedure actionable? For BE plans: does it note whether amplify push is needed? Flag vague rollback as WARNING.

8. BACKWARD COMPAT — does §7 explicitly address API/schema changes, older app versions, and analytics events? Flag "N/A" without justification as WARNING.

9. PROJECT RULE COMPLIANCE — do any suggested code changes violate the hard project rules above? Flag each violation as CRITICAL.

10. AI-IMPLEMENTATION READINESS — if an AI coding assistant reads this plan, what will it get wrong? Flag each dangerous ambiguity as CRITICAL or WARNING.

Return: CRITICAL / WARNING / SUGGESTION (reference §section for each).
```

**Cycles 2–3 prompt (delta):**
```
Delta review of updated plan. Focus only on whether previous issues were resolved.

Updated plan: [paste full updated plan]
Previous cycle: CRITICAL: [list] / WARNING: [list]

For each: ✅ RESOLVED / ❌ STILL CRITICAL / ⚠️ STILL WARNING / 🆕 NEW CRITICAL / 🆕 NEW WARNING.
```

---

**Reviewer C — Independent Risk & Edge Cases** (`subagent_type: Plan`, model: **Composer 2.5** / `composer-2.5-fast`)

**Cycle 1 prompt:**
```
Independent adversarial review of a Fix Plan / Improvements Plan for Step iOS. You have NOT seen any prior review. Find what the other reviewers missed.

Plan content: [paste full plan text]

Be contrarian:

1. DEPLOYMENT RISKS — could the fix as written create a deployment window where things are worse? For BE: is there a gap between Lambda deploy and schema deploy? Flag as CRITICAL.

2. FIX COMPLETENESS — does the "After" code in each fix step fully eliminate the root cause, or could a variation of the bug still occur? Flag as WARNING.

3. REGRESSION RISKS — could any fix step break an existing feature? For each changed file: what other features depend on the changed code? Flag potential regressions as WARNING.

4. SAME-PATTERN GAPS — are there other files or Lambdas NOT mentioned in §8.1 that likely have the same pattern? Use judgment based on the fix description. Flag likely missing HITs as WARNING.

5. VERIFICATION GAPS — are there failure modes that the §5 verification procedure would NOT catch? Flag each gap as WARNING.

6. SECURITY — does the fix introduce or leave any security vulnerability (injection, auth bypass, unvalidated input, PII exposure)? Flag as CRITICAL.

7. MOST LIKELY REGRESSION — in one sentence: what is the single most likely unintended consequence of shipping this fix as written?

Return: CRITICAL / WARNING / SUGGESTION, plus "MOST LIKELY REGRESSION:" (1 sentence).
```

**Cycles 2–3 prompt (delta):**
```
Delta risk review of updated plan.

Updated plan: [paste full updated plan]
Previous cycle: CRITICAL: [list] / WARNING: [list]

For each: ✅ RESOLVED / ❌ STILL CRITICAL / ⚠️ STILL WARNING / 🆕 NEW CRITICAL / 🆕 NEW WARNING.
Updated MOST LIKELY REGRESSION (1 sentence).
```

---

### Cycle Decision Logic

After all three reviewers return, consolidate:

```
=== PLAN REVIEW CYCLE N/3 ===

CRITICAL (must fix — blocks ship):
- [merged from all three reviewers, or "None"]

WARNING (should fix — reduces quality):
- [merged, or "None"]

MOST LIKELY REGRESSION: [from Reviewer C]
```

**Decision:**
- **Zero CRITICAL and zero WARNING** → Plan is READY. Go to Phase 4. Stop cycling.
- **Issues found + cycles remaining** → fix all CRITICAL and WARNING, increment version (v1.0 → v1.1 → v1.2), proceed to next cycle.
- **3 cycles reached** → go to Phase 4, flag all unresolved items.

### Version File on Each Cycle

Correct every stale reference, add missing mandatory sections, fix Before/After code, add CLEAR evidence to same-pattern scan. Update version/date in header, add to Revision History. Announce: `Created v1.X — proceeding to Cycle N+1.`

---

## Phase 4 — Create File & Run Jira Script

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

Construct the filename:
```
Fix Plan - <Short Title> - *<AREA>* (v 1.0).md
Improvements Plan - <Short Title> - *<AREA>* (v 1.0).md
```
Examples:
- `Fix Plan - Login Screen Crash No Profile Photo - *FE* (v 1.0).md`
- `Improvements Plan - Lambda Error Tracking Coverage - *BE* (v 1.0).md`

Write the file to: `documents/Bugfixes and improvements/<filename>`

The document header must be:
```markdown
# <Type> Plan - <Short Title> (v 1.0)

**Date:** <today's date, e.g. April 9, 2026>
**Version:** 1.0
**Status:** Planned
**App areas:** <FE | BE | FE+BE>
**Severity:** <Critical | High | Medium | Low> — <one-line impact>
**Author:** andrei@step.co
```

If a Jira ticket number was provided in $ARGUMENTS, add after Severity:
```
**Jira:** [SS-XXXX](https://step-co.atlassian.net/browse/SS-XXXX)
```

### Step 2 — Run Jira script

**Only if no Jira ticket was provided in $ARGUMENTS** (the script will create one):
```bash
python3 Scripts/create_jira_ticket.py "documents/Bugfixes and improvements/<filename>.md"
```

**If a Jira ticket was already provided**, skip the script (ticket already exists — the `**Jira:**` field in the header is enough).

**Do NOT run** if the file starts with `[FIXED]` or `[IMPLEMENTED]`.

If the `.env` file is missing, warn the user: "Set up `.env` with JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY before running the Jira script."

### Step 3 — Final output

Print:
```
=== PLAN CREATED ===

File: documents/Bugfixes and improvements/<filename>
Type: Fix Plan / Improvements Plan
Area: FE / BE / FE+BE
Jira: SS-XXXX (created / pre-existing / skipped — .env missing)

Key findings:
- Root cause: <1 sentence>
- Affected files: <count>
- Risk: Low / Medium / High
- Estimated scope: <1-2 sentences>

Next step: Implement per §4, then run /review-plan on this file before merging.
```
