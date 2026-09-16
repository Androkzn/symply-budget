# Retrospective Ledger — review-plan

<!-- Append-only. One entry per fix-skill invocation. Integrity gate on load: entries missing {Status, MAST code, Classification, Candidate rule} are quarantined. -->

## 2026-04-23-v2 — Sibling-mirror of create-implementation-plan v3 + review-plan's own absence gaps

**Status:** APPLIED v2
**Supersedes:** none (first logged entry; v1 was the 2026-04-22 full rewrite documented in-skill but never ledger-logged)
**Superseded-by:** —
**Artifact:** `documents/Requirenments/AI Houskeeper /MCP_UI_Implementation_Plan_v2.0.md` — Aihousekeeper proactive-layer plan (769 lines), reviewed by this very skill across 4 cycles producing v2.1 → v2.4 via 400+ lines of corrections
**Feedback source:** downstream / self-referential — the in-session `/review-plan` invocation against a create-implementation-plan artifact produced findings that exposed (a) Reviewer B MISPLACED-deferrals from the sister skill's v3 fix-skill cycle (M3, M4, M6 sibling mirrors required per Reviewer A #23 FIX UNIFORMITY), and (b) review-plan's own Cycle-1 blind spots on G1 (phantom columns), G2 (ALTER collision), G7 (dead-code edits), G8 (cost arithmetic), G9 (MMKV registry drift sub-classes)
**MAST code:** FM-3.3 (Incorrect verification — dominant; under-specified check universes for G1/G2/G8) + FM-2.4 (Information Inconsistency — G9 closed-list enumerations, G7 stale carve-out) + FM-1.1 (Disobey task spec — G7 the skill's own #11 carried a prescription that contradicted ground-truth `package.json:4`)
**Classification:** 6 DISOBEDIENCE (existing rules too weak / carried stale carve-out) + 1 ABSENCE (G8 — no arithmetic rule at all) + 1 ABSENCE-sub-class (G9 MMKV not in closed identifier list). No REGRESSION. No DRIFT that wasn't a carve-out bug (E3 strikes the `except for linking` carve-out that was itself drift-shaped)

### Gap

Eight gap classes surfaced during review-plan's own use of itself against the Aihousekeeper v2.0 artifact:

1. **Agent A #4 DRIZZLE SCHEMA column-grep absence.** Rule checks "table/column names, FKs, indexes match" but does NOT grep columns referenced in WHERE / SET / SELECT / Drizzle query-builder chains against `schema*.ts`. Cycle 1 accepted v2.0's references to `contractors.phone_e164` (doesn't exist), `household_members.revoked_at` (doesn't exist), `household_members.notification_channel_preference` (doesn't exist), `push_tokens.app_version` (doesn't exist), `ai_tool_pending.aihousekeeper_followup_id` (doesn't exist).

2. **Agent A #5 MIGRATION NUMBERING direction-check absence.** Rule checks for numbering collisions but not for DDL-direction collisions. Cycle 1 accepted v2.0's `ALTER TABLE household_members ADD COLUMN role` — `role` already exists at `schema.ts:146`.

3. **Agent A #11 stale carve-out.** Rule says "`src/App.tsx` is **dead code** except for the `linking` config reference." But `package.json:4` has `main: expo-router/entry`, so `src/App.tsx` is fully dead — the carve-out was wrong. Cycle 1 accepted v2.0's prescription to edit `src/App.tsx linking.config`.

4. **Agent A #12 DEEP LINKS weak wording.** "If the plan references `src/App.tsx linking`, confirm it's actually routed through expo-router today" — vague; defers to prose rather than probing `package.json:main`. Same gap as #3.

5. **Agent A #22 closed-list TRD↔IP FIELD PARITY.** Pair-mode identifier-consistency sweep enumerated 8 identifier classes but excluded plan-declared registry identifiers (MMKV, CONFIG_KV, analytics events, cache/queue/DO/SSE/push `data.type`, Drizzle-enum literals). Cycle 1 missed MMKV-key drift sub-classes.

6. **Agent A #26 closed-list IDENTIFIER CONSISTENCY (intra-doc).** Same gap as #5 for the intra-doc variant. Cycle 1 would have missed more subtle intra-doc drift on the same identifier classes.

7. **Agent B #23 closed-list INTERNAL CONTRADICTIONS.** Same gap as #5/#6 at the safety-review layer.

8. **No arithmetic-reconciliation check at all.** Step 2.5 "Numbers & Identifier Consistency Pass" counts rows but does not sum addends or recompute multiplicative expressions. Cycle 1 accepted v2.0's LLM cost table whose rows under-estimated by 5-10× (e.g. "Haiku, 300 in + 100 out × 5/day × 30 = $0.012/mo" omitted output-token cost; true cost ~$0.120/mo). Grand total was self-consistent with the under-estimated rows, so no downstream sanity-check fired.

### Causal chain (How-questions)

1. **How** did review-plan miss G1/G2/G7/G8/G9 in Cycle 1 of its own pass on v2.0? Because every Agent A / Agent B check had a scoped claim-universe smaller than the universe of claims the review target actually makes. Closed-list enumerations (#22/#26/#B23), narrow column checks (#4), numbering-only migrations (#5), vague linking guidance (#12), no arithmetic rule (#28 didn't exist).
2. **How** does review-plan's rule design produce scoped universes? By authoring rules in response to specific observed failure traces — each rule captures the class of defect its trigger-case exhibited. The universe of "new defect classes not yet observed" remains implicit.
3. **How** does this design degrade? When a new artifact surfaces defects whose shape is adjacent to but not identical to a prior rule's scope. The rule reads the artifact, the new defect matches no scoped universe, nothing triggers.
4. **How** does create-implementation-plan's v3 parent cycle address this same pattern? By extending scoped universes (M2 symbol classes, M3 DDL direction, M6 open-list registry). Review-plan needs the same treatment at its own review layer; the create-IP v3 fix alone doesn't cover the review-layer because review-plan reads the PLAN, not the CODE — its scope is different.
5. **Bedrock:** scoped-universe rule authoring is a known MAST FM-3.3 failure mode. The response must be open-list semantics (E5/E6/E7) + structural evidence requirements (create-IP's per-class CONFIRMED/BROKEN/COUNT evidence table, which review-plan should adopt for its own #4 when this recurs) + explicit arithmetic delegation (E8). Not merely "add more sub-classes."

### Fishbone (contributing conditions)

- **Specification:** #11 carve-out was wrong at spec-level (stale reference to dead code; violated line 27 of the same skill). E3 corrects this.
- **Prompt-rules:** DOMINANT for 6 of 8 gaps (E1/E2/E5/E6/E7/E8). Existing rules' check-universes were too narrow; open-list and DDL-direction extensions close the gap.
- **Harness-context:** Minor. Reviewer agents have Read/Grep/Bash; E8's Bash-delegated arithmetic is supported. No missing tool access.

### Candidate rule (v2 — 8 minimum-incision edits)

All edits are extensions to existing numbered checks OR one new check (E8). Rule-budget: Agent A 27 → 28, Agent B 27 → 27, Hard Rules 22 → 22. Under create-IP v2-ledger 30-rule consolidation ceiling.

1. **E1 Agent A #4 DRIZZLE SCHEMA** — added "for every D1 column referenced in WHERE/SET/SELECT/Drizzle-query-builder, grep the column against the matching table in `schema*.ts`. Missing column = CRITICAL." Covers G1.
2. **E2 Agent A #5 MIGRATION NUMBERING AND DDL DIRECTION** — added DDL direction consistency (ADD requires absent, DROP/WHERE/SET require present, CREATE TABLE requires absent). Named the D1 runtime errors (`duplicate column name`, `no such column`). Covers G2.
3. **E3 Agent A #11 EXPO-ROUTER vs REACT-NAVIGATION** — struck stale "except for the `linking` config reference" carve-out. ANY edit to `src/App.tsx` for navigation OR linking = CRITICAL unless explicitly reviving classic entry. Covers G7 spec-error.
4. **E4 Agent A #12 DEEP LINKS** — rewrote to active-entry-FIRST probe: read `package.json main`; if `expo-router/entry`, `src/App.tsx linking.config` edits are DEAD CODE and CRITICAL. Covers G7 prescription-error.
5. **E5 Agent A #22 TRD↔IP FIELD PARITY** — opened closed-list to include plan-declared registry identifiers (MMKV keys, CONFIG_KV keys, analytics events, cache keys, queue names, DO binding names, SSE event types, push `data.type` values, Drizzle-enum text-column literals), marked as "non-exhaustive examples." Covers G9 pair-mode.
6. **E6 Agent A #26 IDENTIFIER CONSISTENCY (intra-doc)** — same open-list extension with explicit prefix-drift example (`aihousekeeper_has_seen_aihousekeeper_intro` vs `has_seen_aihousekeeper_intro`). Covers G9 intra-doc.
7. **E7 Agent B #23 INTERNAL CONTRADICTIONS** — same open-list extension. Covers G9 safety-layer.
8. **E8 NEW Agent A #28 ARITHMETIC RECONCILIATION** — partitioned-sum reconciliation AND multi-factor arithmetic (`qty × unit_cost`) with Bash delegation. LLM cost rows MUST show both input and output token factors OR declare `output=0` with rationale. Grand-total self-consistency with under-estimated row values does NOT excuse row-level errors. No-op on plans without numeric breakdowns. Covers G8.

### Rule hypothesis replay verdict

**YES for all 8 gaps** (Target 1 Phase 3 validated the candidate-rule shapes; Target 2 single-agent validation confirmed shape applies to review-plan's review layer):

- E1 catches G1: column-literal grep against schema file returns zero for `phone_e164` → CRITICAL in Cycle 1.
- E2 catches G2: direction check greps `role` in `household_members` schema → PRESENT but ADD → CRITICAL.
- E3+E4 catch G7: `package.json:main === "expo-router/entry"` → `src/App.tsx linking.config` edits = CRITICAL.
- E5/E6/E7 catch G9: open-list pass extracts `aihousekeeper_has_seen_aihousekeeper_intro` AND `has_seen_aihousekeeper_intro` → two values for same logical identifier = CRITICAL.
- E8 catches G8: Bash-recomputed row 300×5×30×$1/M + 100×5×30×$5/M = $0.120/mo, vs stated $0.012 → factor-N mismatch = CRITICAL.

### Side-effects

- E1 column grep: LOW FP risk — objective against a fixed file glob.
- E2 DDL direction: LOW — deterministic; no-ops on plans without DDL.
- E3 dead-code CRITICAL: LOW — carve-out ("unless explicitly reviving classic entry") preserves legitimate re-adoption case.
- E4 active-entry probe: LOW — objective (`grep main package.json`).
- E5/E6/E7 open-list: LOW — "plan-declared registry block" gate means no-op when no registry exists. "Non-exhaustive examples" clarifier prevents reviewers from reading the new list as a second closed list.
- E8 arithmetic: LOW-MEDIUM — LLM-cost "input+output or output=0" is domain-opinionated but scoped to LLM rows. No-op when no cost table exists.

### Cross-skill implications

- **Mirrors applied from `create-implementation-plan` v3** (Target 1 of this session): M3 (DDL direction) → E2. M4 (active-entry + deep-link) → E3+E4. M6 (open-list registry) → E5+E6+E7. M5 (multi-factor arithmetic) → E8 (Target 1's Reviewer B said layered separation was an option; real-world data showed review-plan missed G8 in Cycle 1, so the mirror is correct).
- **NOT mirrored this cycle** (future fix-skill candidates): M1 (file+dir paths normative — review-plan's #1 already says "glob each", marginally weaker but not a demonstrated miss on v2.0); M2 full symbol-class expansion (review-plan #3 has slightly broader enumeration than create-IP's was; review-layer column check lives in E1 on #4 where it semantically belongs); M7 (NF-gate→ADR — not demonstrated as a Cycle-1 miss on v2.0, though review-plan caught NF-15 binding issue only belatedly); M8 (CLI subcommand — review-plan has no §0 analog; could be added at Agent A as new #29 in a future cycle); M9 (Phase 5 editorial dedup — review-plan's Step 4 could extend).
- **`implement-plan.md`** still needs M3 + M4 mirrors for execution-layer DDL safety + dead-code-edit refusal. Out of scope for Target 2; flag for its own fix-skill cycle.
- **`create-trd.md`** and **`create-bugfix-plan.md`** still Step-iOS-only per v1 ledger of create-implementation-plan. No change.

### Known limitations (v2 — flagged for v3)

1. **G4 phantom dependency** (`expo-server-sdk` claimed "already a dependency" but not in `package.json`) has no review-plan sibling rule. If recurs, add to Agent A #3 or as new check.
2. **G6 phantom CLI subcommand** (`wrangler queues consumer tail` — doesn't exist) has no review-plan sibling. Create-IP M8 added CLI subcommands to §0 external-contract class; review-plan lacks §0. Future addition candidate.
3. **G10 NF-gate→ADR binding** has no review-plan sibling. Create-IP M7 at Reviewer B #8; review-plan Agent B #8 DEFINITION OF DONE could extend.
4. **G11 editorial dedup** is a generation-layer concern; review-plan's Step 4 "Apply fixes + bump version" might extend with a dedup pass.
5. **Revision Log v1 off-by-one reference** — says "Agent B check #24" but current file has #24 as CROSS-DOCUMENT CONSISTENCY and #23 as INTERNAL CONTRADICTIONS. Editorial fix deferred.
6. **Golden-set regression testing** — still aspirational; no `.claude/golden/review-plan/` fixtures.
7. **CLI subcommand check for review-plan's own invocations** (e.g. it cites `python3 -c` and `node -e` in E8) — these are trusted canonical commands, no verification needed at this time, but surfaces the meta-question: when a skill prescribes CLI verbs to its agents, should THOSE be verified? Out of scope for v2.

### Supersession log

None. v1 was the 2026-04-22 full rewrite documented in-skill (Revision Log); no prior ledger entry existed before this one. v2 extends / rewrites v1's rules in-place; nothing removed.
