# Retrospective Ledger — create-implementation-plan

<!-- Append-only. One entry per fix-skill invocation. Integrity gate on load: entries missing {Status, MAST code, Classification, Candidate rule} are quarantined. -->

## 2026-04-22 — Cross-doc consistency, forward-reference resolution, revision-history trust, parity-by-construction

**Status:** APPLIED v1
**Supersedes:** none
**Superseded-by:** —
**Artifact:** `documents/Requirenments/AI Houskeeper /MCP_UI_Implementation_Plan.md` (v1.0 shipped; reached v1.2 via 45-item cross-read cycle)
**Feedback source:** human — user cross-read producing 45 enumerated findings across Critical / Major / Gap / Hygiene tiers
**MAST code:** FM-2.4 (Information Inconsistency — dominant) + FM-1.3 (missing verification step) + FM-3.3 (incorrect verification)
**Classification:** 20 ABSENCE + 4 DISOBEDIENCE + 3 AMBIGUITY + 2 DRIFT + 1 pattern-level REGRESSION

### Gap
The skill produced an Implementation Plan that contained 45 distinct defects, clustered into 8 failure classes: intra-document contradictions (narrative ↔ task code drift), cross-document drift (TRD ↔ IP), security-critical code-vs-test mismatch (killswitch fail-open vs fail-closed), revision-history claims not actually applied, unverified external dependencies (model IDs, SDK versions, API shapes), phase-dependency graph gaps (forward-declared symbols), decision-propagation leaks, and completeness-by-construction gaps (parity claims without enforcement). The skill had no rule for 20 of the observed failures and rules too weak for 7 others. Additionally: the skill itself carried 2 DRIFT references (`dev` env that doesn't exist; `backend/database/migrations/` path that doesn't exist).

### Causal chain (How-questions)
1. How did 29+ distinct defects ship past Phase 4's 3-reviewer cycle? Because every reviewer check was scoped to either codebase-external factual claims (Reviewer A) OR in-task rule violations (Reviewer B). Neither had a cross-section within-doc consistency check.
2. How did the missing rules become invisible? Because Reviewer A's checklist enumerated 24 items, none of which asked "does section X agree with section Y within this document."
3. How did forward-references survive to shipping? Because §4 per-task block spec had no produces/consumes contract — dependencies were narrative, not greppable.
4. How did revision-history claims go unverified? Because the Phase 4 cycle's "apply fixes, bump version, announce" sequence treated the revision history as a disclosure, not a claim requiring verification.
5. Bedrock: the skill modeled "quality" as adherence to external facts (codebase state, TRD values) and in-task rules, but NOT as self-consistency of the produced document across sections. Self-consistency was an unowned property.

### Fishbone (contributing conditions)
- **Specification:** TRD may be ambiguous on some field values (migration path, flag keys) — partial DEFER to create-trd.
- **Prompt-rules:** DOMINANT — no reviewer prompt covered cross-section consistency, no task-block contract enforced dependency graph, no cycle step verified revision-history claims.
- **Harness/context:** Minor — reviewer agents have Read/Grep but no rule-prescribed way to run a topo-sort or identifier-consistency pass.

### Candidate rule (v1 — 9 in-place edits, all minimum-incision)

1. Version marker: `<!-- fix-skill: v 1 -->` after the description line (line 1 reserved for skill loader).
2. Stack-reference drift fix: `dev` env removed (no `[env.dev]` in wrangler.toml); `dev-preview` added; migrations path `backend/migrations/` (not `backend/database/migrations/`).
3. §0 Codebase Snapshot Note: ⚠️ Unverified tagging clause extended to external-contract claims (model IDs, SDK versions, third-party API shapes, beta headers).
4. §4 per-task block: `Produces:` / `Consumes:` fields required (with `external:` list for deps from `node_modules` / runtime / pre-existing repo). Reviewer A runs topo-sort. Optional for tasks with no cross-phase symbol flow.
5. Reviewer A new checks #25 (TRD↔IP field parity — fetch naming TRD sections, not full TRD; namespace-aware), #26 (forward-reference resolution), #27 (parity-universe enumeration — requires copy-pasted shell stdout evidence).
6. Reviewer A cycles 2-5: open each revision-history entry's file:line AND confirm ≥20 lines of structural context match the claim (string-presence alone is insufficient for ordering/scope-dependent fixes).
7. Reviewer B #16 (KILL SWITCH): extended to require code-literal ↔ test-assertion-literal match for every security-critical branch.
8. Reviewer B #24 (was INTERNAL TASK CONTRADICTIONS): broadened to INTERNAL CONTRADICTIONS across any section + identifier-consistency pass (enumerate flag keys, endpoint paths, tool names, model IDs, phase numbers, numeric tool counts, decision IDs).
9. Style Rule Tables: appended parity-universe enumeration requirement (only when universe not already in a preceding table).

### Rule hypothesis replay verdict
YES — for all 8 failure classes. Verified against the 45-item feedback: each gap maps to at least one patched rule. Cycle-2 narrowings applied after Reviewer A flagged ❌ BLOCKING on a fix-uniformity failure inside the patch itself (lines 157 + 438 still carrying the stale `backend/database/migrations/` path after line 69 was corrected).

### Side-effects
- Full TRD paste into every Reviewer A run → mitigated by cycle-2 narrowing ("fetch TRD header + naming sections, not full TRD").
- `Produces:`/`Consumes:` on trivial plans → mitigated by cycle-2 narrowing ("may be OMITTED when task neither defines new cross-file export nor consumes symbol produced in earlier phase").
- Parity-universe enumeration duplicating §5 → mitigated by cycle-2 narrowing ("only when universe not already in a preceding table").
- Revision-history string-presence gaming → mitigated by cycle-2 narrowing ("≥20 lines of structural context required for ordering/scope-dependent fixes").
- `external:` escape hatch abuse → mitigated by cycle-2 narrowing ("must resolve to already-installed dep OR pre-existing symbol; LLM-declared externals that don't grep-resolve are CRITICAL").
- Cross-namespace identifier normalization false negatives → mitigated by cycle-2 narrowing ("URL path segments and TS identifiers occupy different namespaces — do NOT cross-normalize").

### Cross-skill implications
- `implement-plan.md` is a downstream consumer of §4 `Produces:`/`Consumes:` — receives a verified contract (that skill also patched this cycle; see its ledger).
- `create-trd.md` still Step-iOS-only (orphan — flagged as out-of-scope; separate fix-skill cycle required).
- `review-plan.md` still Step-iOS-only (orphan — flagged).
- `create-bugfix-plan.md` still Step-iOS-only (orphan — flagged).
- These three sibling-skill drifts are the most likely next fix-skill targets.

### Known limitations (v1 — flagged for v2)
- Reviewer A cannot execute shell commands mid-review; `re-run find yourself` is aspirational until reviewer tool-access expands.
- `external:` entries are grep-provable but the grep is LLM-performed — still gameable at lower fidelity than the pre-fix state.
- No oscillation guard across review cycles (same task CRITICAL in cycle N and N+1) — deferred.
- No regression testing against a held-out set of prior successful artifacts (`.claude/golden/create-implementation-plan/`) — deferred until golden set exists.

---

## 2026-04-22-v2 — Absence sub-classes + DRIFT fix-uniformity mirroring

**Status:** APPLIED v2
**Supersedes:** none (v1 and v2 address disjoint sub-classes of the same parent failure family)
**Superseded-by:** —
**Artifact:** `documents/Requirenments/AI Houskeeper /MCP_UI_Implementation_Plan.md` (v1.2 emitted by v1-patched skill; in-session `review-plan` pass surfaced 5 ABSENCE sub-classes → patched to v1.3 via 30+ edits)
**Feedback source:** downstream — `review-plan` v1 invocation against the v1.2 artifact pair (TRD + IP); findings synthesized by the parent `/fix-skill` invocation into 5 distinct ABSENCE gap classes
**MAST code:** FM-2.4 Information Inconsistency (dominant, all 5) + FM-1.3 missing verification (secondary, gaps 2/3/5) + FM-3.3 incorrect verification (secondary, gaps 1/4)
**Classification:** 5 ABSENCE, all RECURRING at parent-class level — each maps to a v1-named parent failure class but represents an adjacent-but-distinct sub-class uncovered by v1's specific Candidate rule

### Gap
Five ABSENCE sub-classes surfaced post-v1:
1. **False revision-history claim** — "Endpoint paths standardised to `/ai-chat/*`" survived v1's positive-presence + structural-context gate because retired `/ai/chat/stream` survived at TRD §9:533 and was never negative-grepped.
2. **IP-ahead-of-TRD one-sided absence** — IP references `/ai-chat/tools/:id/undo`, `/ai-chat/prewarm`, `ui_block` SSE event; TRD §8/§8.4 silent. v1 #25 parity is symmetric-match; one-sided absence invisible.
3. **Non-Goal ↔ registry semantic contradiction** — TRD §23.7 `send_contractor_message` coexists with §2 Non-Goal "No contractor-to-homeowner chat." v1 #24 enumerates identifier values within doc; does not cross-check tool existence against Non-Goal prose.
4. **Pair-level arithmetic drift** — TRD 40+32+37+24=133 vs IP 38+31+37+23=129. Each internally correct; pair off by 4 housekeeper-persona tools the IP breakdown omitted.
5. **Stale-decision drift** — TRD §16 D-10/D-11/D-13 persisted as `OPEN — recommend X` across three revision cycles. §21 approval-gate checklist silently unchecked. No rule models decision-state freshness.

### Causal chain (How-questions)
1. How did the 5 sub-classes evade v1? v1's 9 Candidate rules targeted the specific defects enumerated in the initial 45-item cross-read; each sub-class above is adjacent-but-distinct.
2. How were adjacent sub-classes foreseeable? v1's bedrock causal finding ("self-consistency was an unowned property") named the parent class correctly; v1's fix covered value-level identifier drift, leaving absence-level / semantic-level / arithmetic-level / state-machine-level drift in the parent.
3. How do new sub-classes surface? Downstream `review-plan` passes on fresh artifacts widen the observed-defect set beyond the training cycle. Each novel artifact class (AI/chat; payments; migrations; …) is likely to surface new sub-classes.
4. Bedrock: skill-rule authoring is bounded by observed-defect cardinality at authoring time. Parent-class naming is cheap; sub-class enumeration requires traffic. Rule-budget forbids anticipatory sub-class enumeration.

### Fishbone (contributing conditions)
- **Specification:** Partial. The skill's "What an IP IS / IS NOT" (lines 89-95) correctly names self-consistency as a goal; the reviewer rules under-operationalize it for the 5 sub-classes above.
- **Prompt-rules:** DOMINANT. All 5 sub-classes are absence-of-rule failures. Confirmed across Agent α (TRACE near-miss audit) and Agent β (RULE HYPOTHESIS REPLAY).
- **Harness/context:** Minor. Reviewer tool access (Read/Grep/Bash) is sufficient for every proposed check; arithmetic delegation requires Bash (already available).

### Candidate rule (v2 — 2 in-place tightenings + 3 self-DRIFT + 2 sibling-DRIFT mirrors)

**APPLIED (in scope for `create-implementation-plan`):**

1. **Reviewer A #25 PARTITIONED-SUM RECONCILIATION clause.** When TRD or IP contains a claim of the form `Total = N (a+b+c+...)` or per-category breakdown table, delegate arithmetic via `python3 -c` (primary) / `node -e` (fallback) — no mental math. Compare recomputed sum vs stated total in same doc; compare TRD breakdown to IP breakdown pairwise when schemas match; fall back to flat-universe-total comparison when schemas differ. No-op when no partitioned sum exists. Covers Gap 4.

2. **Reviewer A cycles-2-5 revision-history clause (c).** Universal-claim negative evidence. Semantic-class trigger on `standardised / unified / consolidated / renamed / moved / replaced / deprecated-in-favour-of / normalised / aligned / harmonised / merged` (non-exhaustive; match on semantic assertion of uniform transformation, not literal verb). Grep retired value across named scope with word-boundary or quoted-token anchoring to avoid substring-containment FPs (e.g. `isAdmin` ⊂ `isAdminUser`). Exempt revision-history entry itself. Covers Gap 1.

3. **Project Stack Reference tree-diagram DRIFT fix** (line 56 + line 57). `database/migrations/` → `backend/migrations/`; env list updated to `(top-level default, staging [DO-broken], production, dev-preview)`. v1 fix-uniformity regression — v1 patched lines 69/157/438 but missed line 56.

4. **Agent A test-audit DRIFT fix** (line 188). `ls backend/src/__tests__/` → `ls backend/__tests__/`. Directory does not exist.

5. **Reviewer A #19 TESTS DRIFT fix** (line 451). Worker test glob corrected to `backend/__tests__/**/*.test.ts`; framework citation expanded to `@cloudflare/vitest-pool-workers`.

**APPLIED (SIBLING SKILLS — fix-uniformity mirror per own Reviewer A #23):**

6. `review-plan.md:139` — same test-path DRIFT fix. Without this, reviewer would check plans against a non-existent directory.
7. `implement-plan.md:99` — same test-path DRIFT fix. Without this, Agent C file-assignment references a non-existent directory.

**NOT APPLIED — deferred as MISPLACED (see Cross-skill implications below):**

- Reverse-direction IP→TRD contract-surface pass (Gap 2). DUPLICATE with `review-plan.md` Agent A #22 + Agent B #24 which already do bidirectional sweep in pair-mode. Correct home: `review-plan`.
- Non-Goal × enumerated-artifact semantic MATRIX (Gap 3). MISPLACED — Non-Goals live in TRD §1/§3/§21 handoff gate; IP-authoring reviewer has partial view. Agent γ flagged HIGH over-constraint risk (noun-phrase grep without NLI calibration). Correct home: `review-plan` pair-mode Agent B (has both docs) OR `create-trd.md` §21 handoff-gate extension.
- Decision-state freshness — `OPEN` persisting ≥2 cycles without re-stamp = CRITICAL (Gap 5). MISPLACED — decision table schema lives in TRD §19 Status + §20 Date; IP author has no authority to mutate. Correct home: `create-trd.md` Phase 4 cycle check #6 extension.

### Rule hypothesis replay verdict
**2 of 5 caught in-scope** (Gaps 1 and 4 via edits #2 and #1 respectively). Replay verdict = YES for each: negative-grep on "standardised to `/ai-chat/*`" with word-boundary match catches the TRD §9:533 survivor; partitioned-sum reconciliation with `python3 -c` catches the 40+32+37+24 vs 38+31+37+23 mismatch and the schema-incompatible-partition fallback handles TRD-vs-IP category differences. **3 of 5 correctly homed elsewhere** (Gaps 2, 3, 5).

### Side-effects
- Diff edit #1 arithmetic delegation: near-zero FP risk (arithmetic is deterministic); scoped to docs with partitioned-sum claims. Use of `python3 -c` primary avoids Python 2 symlink issues; `node -e` fallback covers Alpine-style environments.
- Diff edit #2 universal-claim negative evidence: medium FP risk mitigated by (a) word-boundary anchoring, (b) semantic-class verb list explicitly non-exhaustive so authors inventing new verbs ("normalised", "harmonised") still trigger, (c) exemption of revision-history entry itself, (d) explicit-exception carve-out.
- Diff edits #3-7 DRIFT fixes: zero FP risk — filesystem ground truth confirmed (`backend/__tests__/smoke.test.ts` exists, `backend/src/__tests__/` does not).

### Cross-skill implications
- **`review-plan.md`:** gained sibling-DRIFT test-path fix (line 139). Also inherits the 3 deferred rules (Gap 2, 3 candidate homes). Recommended next `/fix-skill` target once review-plan has had live traffic to surface its own ABSENCE sub-classes.
- **`implement-plan.md`:** gained sibling-DRIFT test-path fix (line 99). Otherwise unaffected by v2.
- **`create-trd.md`:** inherits Gap 5 (decision-state freshness) and optionally Gap 3 (Non-Goal × artifact). Currently Step-iOS-only per skill registry description — needs SimpleHouse port before any fix-skill pass can land. Flag as orphan, priority 2.
- **`create-bugfix-plan.md`:** still Step-iOS-only. Orphan, priority 3.

### Known limitations (v2 — flagged for v3)
- Three MISPLACED deferrals are carried forward to the correct sibling skills; no cross-skill tracker yet documents these deferred-rule transits. Potential for ledger drift if sibling skills never run fix-skill.
- Calibration gates for WARNING-tier rules (pattern from Reviewer A Edit D) not yet implemented. When WARNING tiers are introduced, they need explicit tracking mechanism (FP ledger heading + promotion criteria + sunset clause).
- `python3 -c` delegation assumes shell/Python availability. Alpine-style containers without Python still require `node -e` fallback — fallback is documented in the rule but not tested against a real constrained environment.
- Golden-set regression testing — v1 flagged; still deferred. Agent γ reinforced: 2025 consensus is mature enough to recommend; 6-case starter (one per failure class + clean baseline) is the minimum viable gate. Operational commitment, not a rule.
- Rule-budget still at v1 count (Style 22 / Reviewer A 27 / Reviewer B 24). Each future v3+ fix-skill cycle must consolidate if total crosses 30.

---

## 2026-04-23-v3 — Phantom-existence-claim verification + dead-code-edit prevention + multi-factor arithmetic + open-list registry drift

**Status:** APPLIED v3
**Supersedes:** none (v2 and v3 address disjoint sub-classes of the same parent FM-2.4 + FM-3.3 families; no Candidate rules overlap)
**Superseded-by:** —
**Artifact:** `documents/Requirenments/AI Houskeeper /MCP_UI_Implementation_Plan_v2.0.md` (Aihousekeeper proactive-layer plan — 769 lines; corrected to v2.4 via 4-cycle `/review-plan` pass producing ~400 lines of fixes)
**Feedback source:** downstream — in-session `/review-plan` run against a create-implementation-plan artifact; 4 cycles produced 19 CRITICAL + 30+ WARNING findings across 11 gap classes; parent `/fix-skill` invocation synthesized into structured gap list
**MAST code:** FM-3.3 Incorrect Verification (dominant — under-specified verification rule universes for G1-G5); FM-2.4 Information Inconsistency (secondary — G7 internal contradiction, G9 closed-list too narrow, G10 cross-section integrity gap); FM-1.1 Disobey Task Spec (G7 — skill body internally contradictory); FM-3.1 Premature Termination (G11 — skipped editorial pass)
**Classification:** 5 ABSENCE (G2, G3, G6, G10, G11) + 3 DISOBEDIENCE (G1, G4, G5 — existing rule verifies too-narrow universe) + 1 AMBIGUITY (G8 — v2 partitioned-sum scoped too tight) + 1 AMBIGUITY+DRIFT (G7 — lines 22 ↔ 164/446 contradict each other) + 1 ABSENCE-sub-class (G9 — MMKV registry keys not in closed identifier enum list)

### Gap
Eleven distinct defect classes surfaced from a single artifact (Aihousekeeper proactive-layer plan v2.0):

1. **G1 phantom columns (5×)**: plan referenced `contractors.phone_e164`, `household_members.revoked_at` / `.notification_channel_preference`, `push_tokens.app_version`, `ai_tool_pending.aihousekeeper_followup_id` — none exist. Reviewer A #3 SYMBOLS did not include D1 column names in its grep universe.
2. **G2 ALTER column collision**: plan's `ALTER TABLE household_members ADD COLUMN role` — `role` already exists at `schema.ts:146`. No rule for DDL direction consistency (ADD vs existing, DROP vs absent, CREATE vs existing).
3. **G3 phantom migration (predecessor unshipped)**: plan said "v1.2's last migration at TRD-write time was `0034_ai_chat.sql`" — v1.2 hadn't shipped; actual latest is `0033_maintenance_subtasks.sql`. No rule for past-tense / cross-plan migration dependency.
4. **G4 phantom dependency**: `expo-server-sdk` claimed "already a dependency" — zero hits in `backend/package.json`. v1 ledger line 62 explicitly warned: "`external:` entries are grep-provable but the grep is LLM-performed — still gameable." v1 Candidate rule #4 was correct; the executor exploited the prose-vs-structured-field gap by asserting "already installed" in prose.
5. **G5 phantom files**: `SettingsStack.tsx`, `HomeStack.tsx`, `backend/test/services/...` — none exist. Reviewer A #1 FILE PATHS wording ("every mentioned file") didn't explicitly cover directories; `e.g.` examples in skill body were interpreted as illustrative rather than normative.
6. **G6 phantom CLI subcommand**: `wrangler queues consumer tail` — not a real Wrangler subcommand in any version. §0 external-contract class listed model IDs / SDK versions / third-party API shapes / beta headers but not CLI subcommand names.
7. **G7 dead-code edit prescription**: plan edited `src/App.tsx linking.config` — but `package.json:4` sets `main: expo-router/entry`, making `src/App.tsx` dead code. Skill line 22 CORRECTLY flags this; Reviewer A #14 + Agent A §3 step 3 BOTH wrongly prescribed the edit. Classic fix-uniformity failure at the skill's own authoring level.
8. **G8 multi-factor arithmetic off 5-10×**: cost-table rows of form "Haiku, 300 in + 100 out × 5/day × 30 = $0.012/mo" omitted output-token costs (true $0.120/mo). v2 PARTITIONED-SUM RECONCILIATION covers `Total = a+b+c` — scoped too narrowly to catch `Σ(qty × unit_cost)` errors.
9. **G9 registry-vs-prose identifier drift (MMKV prefix)**: plan's MMKV key registry used `aihousekeeper_has_seen_aihousekeeper_intro`; 3 downstream task bodies dropped the prefix. v1 Reviewer B #24 closed-list enumeration named 7 identifier classes — MMKV / CONFIG_KV / analytics / cache / queue / DO / SSE / push-data.type were not in the list.
10. **G10 NF-gate non-binding (prose checklist)**: NF-15 cost-mitigation gate was a bulleted checklist item in §3; no matching §2 ADR row; no hard-link to any artifact. Enforcement deferred to editorial will.
11. **G11 duplicate-bullet hygiene**: §12 File Summary had two "Modified backend files" bullets (multi-part edit slip). No final-pass de-dup / sentinel-cleanup step.

### Causal chain (How-questions)
1. **How** did 11 defect classes survive create-implementation-plan v2's 5-cycle Phase-4 review? Because every reviewer check had a narrowly-scoped claim universe: Reviewer A #3 SYMBOLS greps code symbols, not D1 columns; Reviewer A #6 MIGRATION NUMBERING checks number collisions, not DDL direction; Reviewer A #14 DEEP LINKS presumes `src/App.tsx` is live; Reviewer B #24 INTERNAL CONTRADICTIONS enumerates a closed identifier list.
2. **How** are narrowly-scoped universes authored in the first place? Because rule authors (prior fix-skill cycles) reason from enumerated failure traces — v1's 45-item review produced a rule set covering 9 specific sub-classes; v2's subsequent review produced 2 more tightenings. Each sub-class is observation-derived, not derived by enumeration of a claim typology.
3. **How** does a scoped universe silently miss an adjacent sub-class? Because the rule wording doesn't signal "this is the closed list" vs "this is representative." Executors read #3 as "grep every symbol" (which, read strictly, means the code-symbol classes listed — not all identifiers in the plan).
4. **How** is the scope gap invisible until a new artifact surfaces it? Because the reviewer output schema doesn't require per-claim-class evidence — a reviewer can CONFIRM a class by grepping one representative, never revealing that adjacent classes went unchecked.
5. **Bedrock**: the skill encodes verification rules as grep targets without an output-schema requirement of per-class evidence. Adjacent claim classes survive as invisible gaps until a downstream review catches them. Fix requires both (a) broader claim-class enumeration AND (b) per-class evidence output as a structural guard — both applied in M2.

### Fishbone (contributing conditions)
- **Specification:** Partial. The skill's §0 "external-contract claims" enumeration is incomplete (missed CLI subcommand class). Reviewer B #8 DoD has no NF-gate-to-ADR integrity rule. These are authoring-gap specs, not "skill should exist differently."
- **Prompt-rules:** DOMINANT. 9 of 11 gaps resolved by in-place tightenings to existing prompt rules (M1-M7 extensions). M4 is the exception — fixes an internal contradiction in the skill body itself. M9 adds a Phase-5 editorial step.
- **Harness-context:** Minor. Reviewer tool-access (Read/Grep/Bash) is sufficient; per-class evidence-table output in M2 requires the reviewer to emit a structured artifact, which Claude handles natively.

### Candidate rule (v3 — 9 minimum-incision edits)

All edits are in-place tightenings of existing numbered rules OR one-line extensions to §0 / Phase 5. Zero new numbered rules. Rule-budget stays at Style 22 / Reviewer A 27 / Reviewer B 24 (under v2's stated consolidation threshold of 30).

1. **§0 Codebase Snapshot Note** — extended external-contract class with CLI subcommand names + flag names (wrangler/eas/expo/gh/npm, "anything beyond first positional"). ⚠️ Unverified unless linked to docs URL OR `--help` output. Covers G6.
2. **Reviewer A #1 FILE PATHS** — tightened to include directory paths; declared skill-body examples **normative not illustrative**. Covers G5.
3. **Reviewer A #3 SYMBOLS** — extended symbol universe to 4 code-internal identifier classes (D1 columns, wrangler bindings, "already-installed" packages, pre-existing migration filenames). Each paired with canonical source path. Per-class CONFIRMED/BROKEN/COUNT evidence table required (structural partial-satisfaction guard). Scope restricted to code-internal identifiers; external-contract prose deferred to §0 (M8). Covers G1/G3/G4.
4. **Reviewer A #6 MIGRATION NUMBERING AND DDL DIRECTION** — extended with DDL direction consistency (ADD requires absent, DROP/WHERE/SET require present, CREATE TABLE requires absent). Covers G2.
5. **Reviewer A #14 DEEP LINKS** — rewrote to active-entry-FIRST check via `package.json main`. If `expo-router/entry`, `src/App.tsx linking.config` edits are DEAD CODE and CRITICAL. Covers G7.
6. **Agent A §3 step 3** — mirror of edit #5 wording into research-agent prompt (per Reviewer A #23 FIX UNIFORMITY; v1 Cycle-1 precedent). Same ground as G7.
7. **Reviewer A #25 PARTITIONED-SUM** — extended with clause (vi) MULTI-FACTOR ARITHMETIC: per-row `qty × unit_cost` recomputation via Bash interpreter. LLM cost rows MUST show input+output factors or declare `output=0` with rationale. Covers G8.
8. **Reviewer B #8 DEFINITION OF DONE** — extended with NF-GATE BINDING: every NF-N gate must match §2 ADR row OR carry explicit "TRD §X contract, not re-decided" note. Prose-only checklist = WARNING. Covers G10.
9. **Reviewer B #24 INTERNAL CONTRADICTIONS** — opened closed-list identifier enumeration to plan-declared registries (MMKV, CONFIG_KV, analytics events, cache keys, queue names, DO binding names, SSE event types, push `data.type` values, Drizzle-enum text-column literal values with CHECK + Zod-enum grep). Covers G9.
10. **Phase 5 new subsection "Final-Pass Editorial Check (v3 M9)"** — 3 bullets: de-dup adjacent bullets/rows, verify no sentinel remains, verify header/filename/revision version consistency. Covers G11.

### Rule hypothesis replay verdict

**YES for all 11 gaps.** Cycle-1 reviewers verified each gap is caught by the patched rule; Cycle-2 re-verification after narrowing/broadening confirmed no gap was lost in revision. Specific replays:

- G1: M2's D1-column grep against `backend/src/db/schema*.ts` catches `phone_e164` absence.
- G2: M3's DDL direction check catches `ADD COLUMN role` while `role` exists.
- G3: M2's pre-existing migration filename grep catches `0034_ai_chat.sql` absence from `ls backend/migrations/`.
- G4: M2's "already installed" prose grep against `backend/package.json` catches `expo-server-sdk` absence.
- G5: M1's directory glob catches `backend/test/`; normative examples catch `SettingsStack.tsx`.
- G6: M8's ⚠️ Unverified requirement forces `wrangler queues consumer tail` to either cite docs or `--help` — neither exists.
- G7: M4's active-entry-FIRST check catches `src/App.tsx linking.config` edits when `main=expo-router/entry`.
- G8: M5's per-row recomputation via Bash interpreter catches omitted output-token cost.
- G9: M6's open-list registry enumeration catches `aihousekeeper_has_seen_aihousekeeper_intro` vs `has_seen_aihousekeeper_intro`.
- G10: M7's NF-gate-to-ADR requirement flags NF-15 without §2 row.
- G11: M9's final-pass dedup catches duplicate "Modified backend files" bullets.

### Side-effects

- **M2 per-class evidence table**: LOW risk. Structurally mitigates the "partial satisfaction" failure Reviewer C flagged. Missing rows in the evidence table are themselves the failure signal, visible in reviewer output.
- **M3 DDL direction**: LOW — deterministic grep; false-positive-free for non-migration plans (no-op).
- **M4 App.tsx CRITICAL**: LOW — carve-out ("unless classic entry is being revived") preserves escape hatch.
- **M5 multi-factor arithmetic**: MEDIUM → LOW after "output=0 with rationale" escape hatch. Forces LLM cost rows to show both input + output or declare zero. Rare output-free calls (embedding, classification-via-tool-choice) can be annotated.
- **M6 open-list registry**: LOW — only fires when plan declares a registry block. Opens rather than removes closed list.
- **M7 NF-gate binding**: MEDIUM. Plans citing multiple TRD NF gates may need several §2 additions. "TRD contract, not re-decided" carve-out handles the common case; plans genuinely gating on new NF decisions correctly require ADR rows.
- **M8 CLI subcommands**: LOW — only fires on explicit CLI invocations; ⚠️ Unverified marker is cheap.
- **M9 editorial dedup**: LOW — pure post-write hygiene; no content implications.

### Cross-skill implications

Per Reviewer B, 4 of the 9 diffs require sibling mirrors to preserve cross-skill coherence (same precedent as v2):

- **M3 mirror** → `review-plan.md` #5 MIGRATION NUMBERING + `implement-plan.md` §5 Migration Slot Check. DDL direction belongs at review + execution layers too.
- **M4 mirror** → `review-plan.md:134-135`. The "except for the 'linking' config reference" carve-out is factually wrong per ground-truth `package.json`. Also a SHOULD mirror into `implement-plan` (execution-layer dead-code protection).
- **M6 mirrors** → `review-plan.md:145`, `:149`, `:243` (three identifier-consistency clauses in review-plan's Agent A #22 + #26 + Agent B #23).
- **M5 NOT mirrored**. Reviewer B factual correction: ground-truth grep confirmed `review-plan.md` has no partitioned-sum clause — v2 ledger's implicit assumption of dual ownership was wrong. Layered enforcement is correct: create-IP prevents at authoring; review-plan does NOT re-catch the same arithmetic.

All 4 sibling mirrors scheduled for **Target 2 of this fix-skill session** (`/fix-skill` on `review-plan.md`) — parent invocation sequence c.

Other siblings:
- `implement-plan.md` — gets M3 + M4 mirrors when its own fix-skill cycle runs. Out of scope for this Target 2 but surfaced here.
- `create-trd.md` — still Step-iOS-only; SimpleHouse port required before any fix-skill pass can land (v2 ledger already flagged).
- `create-bugfix-plan.md` — still Step-iOS-only.

### Known limitations (v3 — flagged for v4)

- **Rule-budget still at v2 count** (Style 22 / Reviewer A 27 / Reviewer B 24 — all in-place extensions). Reviewer C flagged M2 as approaching comprehension threshold (5 sub-classes would have exceeded; we trimmed to 4 + per-class evidence-table guard). Next v4 extension must consider splitting Reviewer A #3 into #3 SYMBOLS (code names) and #3b EXISTENCE VERIFICATION (D1 columns, bindings, packages, migrations). That would push Reviewer A to 28 — still under 30 but requires consolidation somewhere else.
- **Reviewer A #10 RATE LIMITING** is a candidate for consolidation into #11 WRANGLER BINDINGS (Reviewer C suggestion). Deferred — not blocking v3.
- **Golden-set regression testing** still aspirational (v1/v2 flagged; still no `.claude/golden/create-implementation-plan/` fixtures).
- **Reviewer A cannot actually execute shell commands mid-review** for the directory-glob / grep requirements in M1/M2/M3 — still LLM-performed. Per-class evidence-table output in M2 is the best mitigation we have.
- **Next likely failure class** (per Reviewer C NEXT-FAILURE PREDICTION): payments/subscription feature plans with Drizzle `.$type<PaymentMetadata>()` annotations referring to phantom TS types. M2's grep scope is column names, not TS type annotations. Deferred — one observed failure away from being a v4 candidate.

### Supersession log

None this cycle. All v3 edits are extensions or in-place tightenings. v1 edits remain in force; v2 edits remain in force. No prior Candidate rule is superseded.
