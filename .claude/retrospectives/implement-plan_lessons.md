# Retrospective Ledger — implement-plan

<!-- Append-only. One entry per fix-skill invocation. Integrity gate on load: entries missing {Status, MAST code, Classification, Candidate rule} are quarantined. -->

## 2026-04-22 — Full DRIFT retailor from Step iOS to SimpleHouse

**Status:** APPLIED v1
**Supersedes:** none
**Superseded-by:** —
**Artifact:** none (skill never successfully executed against SimpleHouse — DRIFT found by static read + sibling reference pattern)
**Feedback source:** human — user directive "fix implementation plan skills both" + derived evidence from static read (every Hard Rule, Phase Grouping row, Agent Prompt field, and Verification Pass item references Step iOS infrastructure — Swift, Amplify, Cognito, Lambda, DynamoDB, aws-sdk v2 — that does not exist in the SimpleHouse stack)
**MAST code:** FM-1.2 (Disobey role spec — dominant) + FM-3.3 (Incorrect verification as secondary contamination)
**Classification:** DRIFT (entire file) + ABSENCE (all SimpleHouse-specific patterns)

### Gap
The skill as-shipped was the Step iOS implementation orchestrator, transplanted into SimpleHouse's `.claude/commands/` directory without retailoring. Every active rule referenced tooling that does not exist in SimpleHouse (xcodebuild, swiftc, amplify CLI, SwiftLint/SwiftFormat, `API.swift`, `amplify/generated/`, aws-sdk v2 Lambda, CloudFormation, DynamoDB, Cognito). Every verification pass check would have either hallucinated Swift/NSObject/Lambda concerns on a React Native / Cloudflare Workers codebase OR silently passed SimpleHouse-invariant violations (missing `authMiddleware`, missing household scoping, raw SQL in handlers, `aws-sdk` imports). The skill had never been successfully invoked against a SimpleHouse plan because it would abort on the first HARD RULE check.

### Causal chain (How-questions)
1. How did a Step-iOS-scoped skill end up in SimpleHouse's `.claude/commands/`? Because the entire directory was bulk-transplanted from the Step iOS project. Evidence: sibling `create-bugfix-plan.md`, `create-trd.md`, `review-plan.md` all still carry Step iOS self-descriptions.
2. How did the retailoring miss `implement-plan` when `create-implementation-plan` was retailored first? Because retailoring was reactive per trigger — `create-implementation-plan` was retailored when a SimpleHouse plan was being authored; `implement-plan` wasn't retailored because no one had yet reached execution of a SimpleHouse plan.
3. How did the name-paired siblings fail to co-rewrite? Because there is no file-pairing index, no `grep -l "Step iOS" .claude/commands/` audit hook, no CI gate.
4. How did "Step iOS" strings survive static review? Because skill files are activated only on `/implement-plan <path>` invocation; until someone runs it, the file is never read.
5. Bedrock: `.claude/commands/` files are treated as static configuration rather than living code coupled to the host project's stack. No stack-tag frontmatter, no lint rule ("no aws-sdk references in SimpleHouse repos"), no CI check. Project transplants therefore leak prior-project assumptions invisibly.

### Fishbone (contributing conditions)
- **Specification:** DOMINANT — the skill was authored for Step iOS. Every concrete reference names a Step-era artifact.
- **Prompt-rules:** Every HARD RULE enforces Step-iOS-specific bans; verification sections 5-11 are all Lambda/iOS.
- **Harness/context:** The file was not retailored when `create-implementation-plan` was. Nothing enforces cross-skill stack consistency.

### Candidate rule (v1 — full rewrite preserving 10 Chesterton-marked structural modules)

Full rewrite from Step iOS to SimpleHouse:

- Role: "implementation orchestrator for SimpleHouse (React Native 0.81 / Expo 54 + Cloudflare Workers + Hono + D1 + Drizzle + JWT)".
- New Project Stack Reference block (mirrors sibling `create-implementation-plan.md` v1 lines 13-66).
- Phase Grouping: `{Worker BE, RN FE, Shared+Tests}` replacing `{CloudFormation, Swift iOS, Lambda JS}`. Rare-case Agent D row retained for auxiliary `backend/lambda-processor/` Python Lambda.
- Agent Prompt Template HARD RULES: 14 SimpleHouse invariants (auth middleware, household scoping, no aws-sdk/amplify/Swift, Drizzle-only in handlers, typed `Env`, `storageHelpers`/`asyncStorage`, no `SecureStore` for non-secrets, no `any` without justification, `__DEV__` URL gating, no JWT in logs, `datetime('now')` in D1).
- Verification Pass replaced: 16 sections covering AC Sweep, Do-NOT Audit, Caller Map, Plan Notes, Migration Slot, TypeScript Strict Compile, TanStack+Zustand Sync, Worker Route Auth + Household Scoping, SSE Close-and-Reconnect + DO Rehydration, Worker Fixture Realism, Test Dependency Gate, WebView Sandbox (conditional), Expo Prebuild Trigger (conditional), Tool-Registry Parity (conditional), Idempotency Key + TTL (conditional), `anthropic-beta` Header + Cache-Control (conditional).
- Developer Action Checklist: Cloudflare wrangler commands + Expo/EAS + tsc/vitest/jest.
- Hard Rules (bottom): 20 always-enforce SimpleHouse invariants.

Retained Chesterton-marked modules (concept preserved, bodies retailored):
1. Caller-map concept (highest-leverage; sibling does not have it).
2. "Fix failures immediately" discipline (stack-agnostic).
3. Parallel-agent launch rule.
4. Verification §§1-4 frame (AC Sweep / Do-NOT Audit / Caller Map Audit / Plan Notes Audit).
5. Developer Action Checklist frame.
6. Final Status Report frame.
7. Error-code-matrix invariant (generalized from Lambda to Worker).
8. Fan-out / concurrent-writer invariant (generalized from `Promise.all` MODULES to DO + SSE resume).
9. Fixture-realism invariant (generalized from `event.json` to Vitest Worker fixtures).
10. Staging-files boundary (generalized from `amplify add function` to wrangler secret / KV-put / migration slots).

### Rule hypothesis replay verdict
YES — the retailored skill references only infrastructure grep-verified in the SimpleHouse repo. A fresh invocation against a SimpleHouse plan proceeds past the first HARD RULE instead of aborting. The 16 verification sections are correctly scoped (with cycle-2 narrowings applied — see below).

### Side-effects
Cycle-1 reviewers surfaced 6 over-fit / scope-too-narrow / false-positive risks. All addressed in cycle-2 narrowings:
- §7 Zustand grep would false-positive on 4 pre-existing legitimate stores → narrowed to "flag only NEW store whose key also appears in sibling `invalidateQueries`".
- `storageHelpers`-only under-specified → broadened to "`storageHelpers` for imperative OR `asyncStorage` for persist middleware".
- `§8` household-membership helper-name grep was `verifyAccess`-only → expanded to `verifyAccess|getHousehold` (dominant codebase pattern is `getHousehold`).
- §9 DO-implies-SSE over-generalization → split into "SSE/HIGH_WRITE: close-and-reconnect" vs "pure-durable-state DO: hibernation-survival only".
- §16 `anthropic-beta` `prompt-caching-2024-07-31` hard-reject would false-positive on approved production plan retaining it → softened to "flag for review against current docs".
- Developer Checklist `--env dev-preview` unconditionally prescribed but block doesn't exist in wrangler.toml → pre-flight grep added; instructs developer to either add the block or skip dev-preview.
- Setup step 3 ts-morph unavailable case → explicit fallback grep patterns specified.
- Setup step 2 `Produces:`/`Consumes:` claim unenforceable on v1.0/v1.1 plans → best-effort inference fallback added.
- Phase Grouping over-splits small plans into 3 agents with ≤2 tasks each → threshold rule added: single orchestrator for <5 tasks; omit agents with zero-task domains.

### Cross-skill implications
- Aligned with `create-implementation-plan.md` v1 at the stack-reference layer (banned tokens, env names, migration path).
- `§12 WebView Sandbox` has partial content duplicate with create-implementation-plan Reviewer B #22 — cycle-2 narrowing did NOT consolidate; flagged as future consolidation cycle.
- `§14 Tool-Registry Parity` not yet mirrored into create-implementation-plan at plan-authoring layer — deferred.
- `§16 anthropic-beta` hygiene not yet mirrored into create-implementation-plan Agent A §6 — deferred.
- `backend/lambda-processor/` Python Lambda carve-out: global HARD RULES ban `aws-sdk` which would conflict with boto3-using Python Lambda. Cycle-2 did not fully address; deferred until first plan touches that folder.
- Orphan siblings still Step-iOS-only (`create-trd.md`, `review-plan.md`, `create-bugfix-plan.md`) — candidates for future fix-skill cycles.

### Known limitations (v1 — flagged for v2)
- Revision-history verification added in Setup step 2 catches string-presence drift but not semantic-correctness drift beyond ±20-line window.
- Caller map ts-morph fallback grep misses re-exports and aliased imports; known-limitation note added to caller-map output.
- Lambda-processor Python carve-out still under-specified.
- WebView sandbox checks duplicate across skills; consolidation cycle deferred.
- No golden-dataset regression test (`.claude/golden/implement-plan/`) yet.
