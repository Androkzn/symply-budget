# Smart Project — Feature Requirement / BRD

> A describe-it entry point to Home Projects: the member says what they have and what they want, and AI drafts the project. Extends [HomeProjects_BRD](./HomeProjects_BRD.md); does not replace it.

| Field | Value |
|-------|-------|
| **Doc type** | Feature BRD / requirement |
| **Feature id** | `home-projects.smart-project` |
| **Owning app** | `simple-house` |
| **Display name** | Smart Project |
| **Status** | `built` — SP-A…SP-D landed 2026-08-31; pitched-ceiling fix 2026-09-01; flag off (`smartProject`) |
| **Version** | `v1.0` |
| **Created** | 2026-08-31 |
| **Last updated** | 2026-09-01 |
| **As built** | §14 |
| **Parent feature** | [HomeProjects_BRD.md](./HomeProjects_BRD.md) · [HomeProjects_TRD.md](./HomeProjects_TRD.md) |
| **Parent implementation** | [HomeProjects_Implementation.md](./HomeProjects_Implementation.md) (Phases 0–7) |
| **App BRD** | [documents/apps/symply-house/BRD.md](../../apps/symply-house/BRD.md) |

---

## Agent Kickoff Prompt

```text
Read first:
1. documents/requirements/HomeProjects/HomeProjects_BRD.md   (esp. §7 AI Strategy)
2. documents/requirements/HomeProjects/HomeProjects_TRD.md
3. documents/requirements/HomeProjects/HomeProjects_Implementation.md (§21 drafts/permissions)
4. This document

Smart Project is an ADDITIVE entry point. It must not change the manual
template path, and it must not weaken the geometry honesty rules in
HomeProjects_BRD §7.2/§7.3. Implement only after BRD acceptance.
```

---

## 0. Version History

| Version | Date | Changes |
|---------|------|---------|
| v1.2 | 2026-09-02 | **"What should we draft?"** — a fourth member step asks for steps / tasks / materials, and nothing unticked is suggested (`include`, enforced by `applyIncludeToGeneration`). Materials became a real shopping list: the prompt now asks for the must-have consumables an installation cannot proceed without (a window's foam and sealant, a vent's ducting and clamps, insulation's adhesive and membrane), and `coverage_per_unit` is finally written through to the selection, so a material carries a QUANTITY off the member's own measured area instead of a bare name. Generated tasks are written to the project for the first time. "Delete all" on the materials list. |
| v1.1 | 2026-09-01 | Pitched ceilings. First real member request (a shed, open to its rafters) exposed a double under-count in the takeoff; `ridge_height_m` added, ceiling follows the slope, gable triangles counted as wall. |
| v1.0 | 2026-08-31 | Built, SP-A…SP-D. Q3/Q4/Q5 resolved in §12; as-built record in §14. |
| v0.1 | 2026-08-31 | Initial draft. Three product decisions locked (§3). |

---

## 1. Overview

### 1.1 One-Liner

**Smart Project** turns a paragraph, a few photos and some measurements into a drafted Home Project — phases, surfaces, material quantities and tasks — that the member reviews and publishes.

### 1.2 Problem

The current wizard ([CreateHomeProjectWizard.tsx](../../../src/screens/home-projects/CreateHomeProjectWizard.tsx)) opens with a grid of sixteen template tiles. That grid makes two assumptions:

1. **The project is a known room type.** Bathroom, kitchen, basement, roof. The tiles are nouns from a house.
2. **The scope is implied by the type.** Picking "Bathroom reno" seeds a bathroom-reno checklist regardless of whether the room is currently studs or currently fine.

Both assumptions fail on the case that motivated this spec:

> *"I have a shed. It has a roof, walls and a concrete floor, but inside it's only an empty frame — ready to cover with insulation, wall covering, electrical cable and lights. I want to convert it to a woodworking shop."*

No tile matches. The type is not a room in the house; the scope is defined by what is **already done** as much as by what is wanted; and the target *use* — woodworking — drives requirements (dust collection, 240 V circuits, task-level lighting) that no room-type template carries.

A member in that position today writes it all into the free-text `summary` field and builds every phase, surface and material by hand.

### 1.3 Worked Example — the shed

What the member supplies:

| Input | Value |
|-------|-------|
| Description | the paragraph above |
| Photos | 4 interior shots, one per wall |
| Dimensions | 6.0 m × 3.6 m, wall height 2.4 m |

What Smart Project drafts:

| Output | Example |
|--------|---------|
| Title / type | "Shed → woodworking shop", `type: conversion` |
| As-is state | roof ✅ · exterior walls ✅ · slab ✅ · interior finish ❌ · electrical ❌ |
| Phases | Electrical rough-in → Insulation → Wall covering → Lighting → Fit-out |
| Surfaces | Walls 46.1 m² · Ceiling 21.6 m² · Floor 21.6 m² |
| Quantities | ~46 m² batt insulation · ~15 sheets 4×8 sheathing (10 % waste) |
| Tasks | "Confirm shed circuit capacity at the panel", "Check permit for a subpanel" |
| Blockers | "240 V for a table saw may need a new subpanel — electrician required" |
| Budget lines | Labels + categories only, **no dollar amounts** (§3) |

Everything above is editable, and the project is invisible to the rest of the household until the member publishes it.

---

## 2. What Is Actually New

[HomeProjects_BRD §7](./HomeProjects_BRD.md) already anticipates most AI assistance inside a project — draft phases from scope text, suggest missing materials, takeoff assist from measured areas. Smart Project adds three things that section does **not** cover.

| # | Gap | Why it is not already covered |
|---|-----|-------------------------------|
| **G1** | **Description as the entry point.** Today AI assists *inside* an existing project. Smart Project *creates* one from prose. | §7 assumes a template was already chosen; template choice is what seeds the checklist. Here the model must infer type, template (or none) and scope together. |
| **G2** | **As-is state.** "Roof, walls and slab are done; interior is not." | Nothing in the schema records what already exists. Without it the model plans work that is finished, which is worse than planning nothing — the member has to *delete* wrong phases, and deletion is a worse edit than addition. |
| **G3** | **Change of use.** Shed → woodworking shop; garage → gym; attic → office. | Templates are room-type-keyed. The *target use* carries requirements (dust extraction, circuit load, lighting level, ventilation) that room type cannot express. |

G2 is the one with a data-model consequence (§9). G1 and G3 are prompt-and-UX work.

---

## 3. Locked Product Decisions

These three were decided ahead of the spec; the rest of the document assumes them.

| # | Decision | Rationale |
|---|----------|-----------|
| **D1** | **AI produces a reviewable draft, never a live project.** | A wrong material or a phantom phase that lands directly in the household's shared plan is read as fact by everyone else in the household. Review is the difference between a suggestion and a mistake. |
| **D2** | **Dimensions are typed by the member.** Photos inform scope and condition, never measurement. | Preserves [BRD §7.3](./HomeProjects_BRD.md) — measured or entered geometry first, photos as scoping aid. A quantity derived from an estimated area compounds the error into a purchase. |
| **D3** | **Quantities, not prices.** AI outputs "≈15 sheets"; it does not output dollars. | Consistent with the deliberate removal of cost hints from the template tiles: *"a wrong anchor is worse than none."* A generated budget is that hazard at ten times the surface area. See §8. |

### D1 is satisfied by machinery that already exists

`home_projects.visibility` (`draft` | `published`, migration 0163) already means *"only `created_by` can see this."* From [HomeProjects_Implementation §21](./HomeProjects_Implementation.md):

> A draft is its creator's alone, not "creator plus grantees" … Publishing is the act that shares it. A peer's draft answers `NotFound`, never `Forbidden`.

So Smart Project writes a **real project with `visibility='draft'`** rather than rendering a parallel preview surface. This is a deliberate reading of D1 — rows *are* written before the member confirms — and it is the better one:

- The member reviews in the **real** hub, Surface Studio and material screens, so what they approve is exactly what they get. A bespoke preview renderer would drift from the real screens the moment either changed.
- Generation is asynchronous (§7). A draft survives app close, a preview held in memory does not.
- Publishing is already an audited, permission-aware action with a resolver shared between Worker and device ledger.

The property D1 actually protects — *nothing wrong reaches the household unreviewed* — holds exactly.

---

## 4. Scope

### 4.1 In scope

- A **"Describe it"** path alongside the template grid on step 1 of the wizard
- Freeform description + optional photos + **typed** dimensions
- Async generation producing a `visibility='draft'` project with phases, surfaces (option groups with areas), material quantities, tasks and blockers
- A review pass with per-item confidence and an explicit **Publish** action
- Discard, regenerate, and "keep my edits, regenerate the rest"
- Full function with AI **off** — the manual template path is untouched

### 4.2 Out of scope

- Prices, cost ranges, or contractor quotes (D3)
- Dimensions inferred from photos (D2) — the existing `geometry/ai-schematic` job stays what it is, a labelled scoping aid
- Structural judgment (load-bearing walls), permit determination, or code compliance
- Generating a floor plan or elevations — Smart Project consumes geometry, it does not produce it
- Re-running against a **published** project (v-next; see §13 Q2)

---

## 5. Requirements

| ID | Requirement | Priority | Notes |
|----|-------------|----------|-------|
| SP-01 | Member can start a project from a freeform description instead of a template tile. | P0 | Entry point on wizard step 1 |
| SP-02 | Member can attach 0–8 photos to the description. | P0 | Reuses `homeProjectAttachments` / R2 |
| SP-03 | Member can enter dimensions (per-space L×W×H, or per-wall). Skipping is allowed. | P0 | Typed only (D2) |
| SP-04 | Generation is asynchronous with visible progress and a cancel action. | P0 | Mirrors `enqueueAiSchematic` / `cancelGeometryJob` |
| SP-05 | Output is written as a project with `visibility='draft'`, owned by the creator alone. | P0 | D1 |
| SP-06 | The model records **as-is state** — which elements already exist — and plans no work against them. | P0 | G2; §9 |
| SP-07 | Draft includes phases in dependency order (rough-in before cover-up). | P0 | |
| SP-08 | Draft includes surfaces as option groups with `area_value` computed from **entered** dimensions, `area_source='manual'`. | P0 | Never `'geometry'` unless real geometry was linked |
| SP-09 | Draft includes material **quantities** with units and waste factor. No `estimate_cents`. | P0 | D3 |
| SP-10 | Draft includes tasks and blockers, including questions the member must answer (panel capacity, permits). | P1 | |
| SP-11 | Every generated item is editable and individually deletable before publish. | P0 | |
| SP-12 | Every generated item carries a visible "AI drafted" marker until the member touches it. | P0 | Marker clears on edit |
| SP-13 | Items the model is unsure of are flagged low-confidence and sorted to the top of review. | P1 | |
| SP-14 | Member can discard the whole draft in one action. | P0 | |
| SP-15 | Member can regenerate while keeping items they have already edited. | P2 | |
| SP-16 | Publishing converts the draft to `visibility='published'`; household notification fires then, not before. | P0 | |
| SP-17 | Change-of-use projects carry the target use, and it drives requirements. | P1 | G3 |
| SP-18 | Feature works with AI disabled: the entry point is hidden, template path unaffected. | P0 | Inherits BR-20 |
| SP-19 | Generation is gated by AI entitlement and recorded in `ai_usage`. | P0 | `usageRecorderFor` |
| SP-20 | Description, photos and dimensions are household-private and not used for training. | P0 | Inherits BRD §6 |

---

## 6. UX Flow

```text
Wizard step 1
├── [ Describe it ]  ← new, above the template grid, AI-gated
└── template grid    ← unchanged

  ↓ Describe it

Step A — Describe          "What have you got, and what do you want?"
                           multiline text · photo picker · example prompt

Step B — Measure           per-space L × W × H, or per-wall
                           "Skip — I'll add these later" is allowed,
                           with the consequence stated: no quantities

Step C — Photos            optional; camera / library / Files / Drive

Step D — What to draft     "What should we draft?"
                           Steps · Tasks · Materials, each a tick box,
                           all three on by default. Nothing unticked is
                           suggested anywhere. The as-is record and the
                           questions come with every draft regardless.

Step E — Generating…       progress + Cancel  (async, survives backgrounding)

Step F — Review draft      the real hub screens, in draft mode
                           low-confidence items first, "AI drafted" chips,
                           edit / delete anything, or "Delete all" on the
                           whole materials list
                           [ Discard ]            [ Publish to household ]
```

**Step B is where the honesty lives.** Skipping dimensions must not silently degrade to guessed areas — it produces a draft with phases and tasks but no surfaces and no quantities, and says so.

**Step D is where the member's own judgement lives.** Somebody who keeps their own material list wants the steps and would otherwise have to delete a twenty-line shopping list to get them — and deleting a plausible-looking row is the edit this whole feature exists to avoid (§1.2). The promise is absolute in both directions: what is ticked is drafted, and what is not ticked appears nowhere, not even folded into a task title. It is enforced twice — the prompt says which sections to return, and `applyIncludeToGeneration` strips the rest on the way back, because an instruction is a request and this is the guarantee.

Two sections are never on the tick list. `as_is` is not a suggestion — it is why a phase was skipped, and the review banner renders it — and blockers are questions asked back at the member, which is the one thing a draft must never withhold to look shorter.

---

## 7. AI Contract

Follows the established pattern: `generateStructuredWithFallback` ([backend/src/ai/fallback.ts](../../../backend/src/ai/fallback.ts)) with a prompt module under [backend/src/ai/prompts/](../../../backend/src/ai/prompts/), alongside `extract-material-listing`.

**Input**

| Field | Source |
|-------|--------|
| `description` | member prose |
| `photos[]` | R2 attachments, multimodal |
| `dimensions` | typed, normalised to metres |
| `household_context` | space list, locale/currency, existing template catalogue |

**Output** (structured, validated before any row is written)

```text
{ title, type, template_key?, target_use?,
  as_is:      [{ element, state: 'present'|'absent'|'unknown', evidence }],
  phases:     [{ title, sort_order, depends_on[] }],
  surfaces:   [{ name, category, area_value, area_unit, waste_factor_pct }],
  materials:  [{ surface, label, quantity, unit, confidence }],
  tasks:      [{ title, phase, rationale }],
  blockers:   [{ title, severity, question }],
  confidence: { overall, per_section } }
```

**Areas and quantities are computed, not generated.** The model returns which surfaces exist and their category; it does **not** return numbers it derived itself. A language model doing multiplication is an avoidable class of error, and the arithmetic is already written and shared:

| Step | Owner |
|------|-------|
| Typed dimensions → validated model | `parseRoomSurfaceModel` / `roomSurfaceModelSchema` ([packages/contracts/src/room-surface-model.ts](../../../packages/contracts/src/room-surface-model.ts)) |
| Model → surface areas, openings, subareas | [packages/contracts/src/room-surface/](../../../packages/contracts/src/room-surface/) (`geometry.ts`, `derive.ts`, `subareas.ts`) |
| Areas + materials → purchase quantities with waste | `computeTakeoff` ([room-surface/takeoff.ts](../../../packages/contracts/src/room-surface/takeoff.ts)) |

`roomSurfaceModelSchema` being a Zod schema matters for more than validation: the model's structured output can be checked against the **same** schema the rest of the feature already trusts, so a malformed generation is rejected at the boundary rather than half-written into a draft. And because these live in `@symply/contracts`, the Worker and the device ledger compute identical quantities — the same reason [home-project-access.ts](../../../packages/contracts/src/home-project-access.ts) is shared.

---

## 8. Honesty Rules

Inherits [HomeProjects_BRD §7.2](./HomeProjects_BRD.md) in full, and adds:

- **No prices.** Smart Project must never write `estimate_cents`. Budget lines get labels and categories; the member or their contractor supplies the numbers.
- **No invented dimensions.** If dimensions were skipped, surfaces and quantities are absent — not estimated. `area_source` stays truthful.
- **No implied completeness.** The review screen says "a starting point, not a scope of work". A generated plan that looks finished discourages the member from checking it.
- **No structural or permit conclusions.** Those surface as *blockers phrased as questions* ("Is this wall load-bearing? — confirm before demolition"), never as answers.
- **Marketing constraint.** Same as BR-16: this is not "AI builds your renovation plan". It drafts a starting point from what you told it.

---

## 9. Data Model Delta

Almost everything reuses existing tables. Reuse map:

| Output | Existing table |
|--------|----------------|
| Project, description, goals, constraints | `home_projects` (`summary`, `goals`, `constraints`) |
| Draft gating | `home_projects.visibility` — **no change needed** |
| Phases / milestones | `home_project_phases`, `home_project_milestones` |
| Surfaces with area | `home_project_option_groups` (`area_value`, `area_unit`, `area_source`, `waste_factor_pct`) |
| Materials | `home_project_selections` |
| Budget lines | `home_project_budget_lines` (labels only, `estimate_cents = 0`) |
| Tasks | `home_project_tasks` → House tasks |
| Blockers | `home_project_blockers` |
| Photos | `home_project_attachments` |
| Typed dimensions | `home_project_geometry` (`source='manual'`, `payload_json` holds a `RoomSurfaceModel`) |
| Area + quantity arithmetic | `@symply/contracts` `room-surface/` — **no new maths** |
| Job status | `home_project_geometry` pattern — status / confidence / disclaimer / error_code |

**Two additions required:**

1. **As-is state (G2).** No column expresses "this already exists". Options: a `home_project_as_is` table keyed by project + element, or a JSON blob on `home_projects`. A table is preferable — as-is state is per-element, gets edited individually in review, and a blob makes "mark the slab as already done" a read-modify-write on the whole project.
2. **Provenance (SP-12).** A per-row "AI drafted, untouched" marker. `home_project_selections` already carries a `source` discriminator (`'manual' | 'link_og' | 'link_ai'`) — extend that idea consistently rather than inventing a second mechanism.

Migration number must be claimed on `main` first ([BRANCHING.md](../../ecosystem/BRANCHING.md)).

---

## 10. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Plan looks authoritative; member skips verification | Wrong purchases, wasted money | Draft framing, confidence flags, "starting point" copy, publish is deliberate |
| Model plans work already done (G2) | Member must delete phases — a worse edit than adding | As-is state is a first-class output, not a prompt hint |
| Quantities wrong because dimensions were wrong | Over/under-buying | Areas computed server-side; dimensions echoed back in review for confirmation |
| Change-of-use advice strays into code/electrical judgment | Safety, liability | Blockers phrased as questions; explicit non-goal in §4.2 |
| Generation latency makes the wizard feel broken | Abandonment | Async job with progress + cancel; draft persists |
| Cost of multimodal generation per project | Unit economics | AI entitlement gate, `ai_usage` recording, photo count capped at 8 |

---

## 11. Phasing

| Phase | Scope |
|-------|-------|
| **SP-A** | Describe + typed dimensions → phases, tasks, blockers. No photos, no surfaces. Proves the draft/review/publish loop. |
| **SP-B** | Surfaces + quantities from typed dimensions. Server-side area arithmetic. As-is state (G2). |
| **SP-C** | Photos as multimodal context for condition and scope. Still no measurement from photos. |
| **SP-D** | Change-of-use requirement packs (G3); regenerate-keeping-edits (SP-15). |

SP-A is shippable alone and is the honest test of whether members trust a generated plan enough to publish it.

---

## 12. Open Questions

| # | Question | Status |
|---|----------|--------|
| Q1 | Does a Smart Project draft count against the AI entitlement per generation or per project? | **Open — product.** Built as per *generation*: `usageRecorderFor({ feature: 'home_project_smart_draft' })` records each call, and a regenerate costs again. Changing to per-project is a service-layer change, not a schema one. |
| Q2 | Can Smart Project run against an existing **published** project ("re-plan this")? | **Open — product.** Not built. `enqueueSmartDraft` always creates a new draft project; there is no path that regenerates over existing rows. |
| Q3 | Does as-is state belong to the project, or to the linked household **space**? | **Resolved: the project.** Built as `home_project_as_is(project_id, element)`. Space-scoping would make one member's "the slab is done" a fact about the house that a later, differently-scoped project inherits silently — and the evidence string is quoted from *this* description. Promoting it to the space later is an additive migration; demoting it would not be. |
| Q4 | Local-first: does generation require connectivity, and what does the ledger show? | **Resolved: unavailable, and hidden.** Both tables are Tier B, all seven API methods throw `HouseLocalUnsupportedError` with their own copy, and `isSmartProjectAvailable()` hides the entry point. Routing remote would create a project in D1 that the device's own `list` can never return — an orphan the member is then notified about. |
| Q5 | Do change-of-use packs (G3) live as data or in the prompt? | **Resolved: both, deliberately.** The prompt asks for change-of-use requirements; `TARGET_USE_REQUIRED_ELEMENTS` is a small reviewable safety net that adds a blocker when the model omits something load-bearing (a woodworking shop with no ventilation question). Data alone would be a second template system; prompt alone leaves the safety item to chance. |

---

## 13. As Built

Landed 2026-08-31 on `house-v2`, SP-A through SP-D, behind `smartProject` (default **off**).

| Area | Files |
|------|-------|
| Shared contract | [packages/contracts/src/smart-project.ts](../../../packages/contracts/src/smart-project.ts) — schema, as-is catalogue, area derivation, phase ordering |
| Migration | [backend/migrations/0166_home_project_smart_draft.sql](../../../backend/migrations/0166_home_project_smart_draft.sql) |
| Drizzle | `homeProjectAsIs`, `homeProjectSmartDrafts`, `draft_source`/`draft_confidence`, `home_projects.target_use` |
| Prompt | [backend/src/ai/prompts/smart-project.ts](../../../backend/src/ai/prompts/smart-project.ts) |
| Job | [backend/src/services/ai/home-project-smart-draft-job-handler.ts](../../../backend/src/services/ai/home-project-smart-draft-job-handler.ts) + queue consumer + cron sweep + `wrangler.toml` (3 envs) |
| Service / routes | `enqueueSmartDraft`, `getSmartDraft`, `cancelSmartDraft`, `publishSmartDraft`, as-is CRUD |
| Client | [SmartProjectWizard.tsx](../../../src/screens/home-projects/SmartProjectWizard.tsx), [SmartDraftReviewBanner.tsx](../../../src/components/home-projects/SmartDraftReviewBanner.tsx), API + hooks |
| Local-first | Both tables Tier B; seven throws with member-facing copy; entry point gated |

**Tests: 83 added, all passing**, plus 19 existing guard assertions updated (registry classification, throw-site copy, cascade lists, delete-route inventory) that the new tables tripped.

| Suite | New | Covers |
|-------|-----|--------|
| `packages/contracts/__tests__/smart-project.test.ts` | 35 | area arithmetic incl. **pitched roofs**, phase ordering + cycles, as-is filtering, schema refuses areas/prices |
| `backend/…/home-projects-smart-draft.test.ts` | 21 | draft privacy (peer gets 404 not 403), publish, idempotence, cancel, as-is CRUD |
| `backend/…/home-project-smart-draft-job-handler.test.ts` | 19 | no prices anywhere, areas only from typed dimensions, as-is suppression, malformed/entitlement/cancel paths |
| `src/screens/home-projects/__tests__/smartProject.test.ts` | 7 | the two-gate availability rule, `dropped_json` parsing survives junk |
| `backend/…/home-project-smart-draft-shed-live.test.ts` | 1 | the first real member request end-to-end: photos → as-is → phases → gable-correct quantities |

**E2E: 2 Maestro flows.** `home-projects-smart-project-gated.yaml` guards the flag-off default (entry card absent, template path unaffected, banner absent on a template project) and runs today. `home-projects-smart-project.yaml` drives the full describe → measure → generate → review → publish path and is tagged `ai`; it **cannot pass** until migration 0166 is on staging, the queues exist and the flag is on. Screens carry the testIDs both need.

### Three deviations from the spec as written, and why

1. **§7 said the model returns surfaces and the server computes areas. It does — via `createRoomSurfaceModel`.** Rather than new arithmetic, a Smart Project room is the *same document* the surface editor produces, so a generated room opens in that editor and can be edited by hand with nothing knowing it was generated.
2. **Generated tasks are held on the draft row (`tasks_json`), not written as House tasks.** A House task is household-shared the moment it exists, so materialising them at generation would put work in everyone's list for a project nobody else can see. `publishSmartDraft` is the only thing that creates them.
3. **Materials get `unit_price_cents = NULL`, not `0`.** Zero renders as "$0.00", which is a price. NULL means nobody has priced this yet.

### Pitched ceilings — found by the first real request, fixed

The first member input was a shed: *"length 5 m width 3m hight 2.5 m … add OSB
panel to cover walls and ceiling"*, with photos showing it open to its rafters.
Running it through the pipeline exposed a real defect.

`deriveSmartProjectSurfaces` took the ceiling area from the floor polygon, which
is correct for a flat ceiling and wrong for a vaulted one. It under-counted
**twice**: the sloped faces are longer than their footprint, and a gable adds a
triangle of wall at each end — both of which this member would be sheeting.

| Surface | Reported as flat | Actually (0.7 m rise) | Short by |
|---|---|---|---|
| Ceiling | 15.0 m² | 16.55 m² | a sheet of OSB, a bag of insulation |
| Walls | 40.0 m² | 42.1 m² | a sheet of OSB |

Both errors run **short**, which is the direction that stops a job. And sheds and
garages — the motivating examples for the whole feature — are rarely flat, so
this was not an edge case.

**Fixed** by adding `ridge_height_m` to the space dimensions:
`ceilingAreaFor` follows the slope, `wallAreaFor` adds the gable triangles, and
surfaces a pitch changed are flagged `pitched` so review can explain the number.
Asked for as a **height** rather than a pitch in degrees, because a member owns
a tape measure and not an inclinometer; a swapped wall/peak pair clamps to flat
rather than producing a negative roof. The wall-height field is now labelled
"Wall height" — plain "Height" is ambiguous in exactly the space this matters,
and the member's own "hight 2.5 m" could have meant either.

Areas are also rounded to centimetre-squared for display: `round4` is right for
polygon vertices and wrong for a measurement a member reads, where `16.5529 m²`
claims precision no tape earns.

**Known divergence:** Surface Studio still renders these rooms with a flat
ceiling — `RoomSurfaceModel` has no concept of a pitch, and teaching it one
touches the editor, the preview and the takeoff. The *quantities* are correct
(they come from `ceilingAreaFor`), but a member who opens the editor sees a
different ceiling than their material list. Worth closing before this ships
widely.

### Not built

- **Photos are accepted and passed through but not yet read.** `attachment_ids` flows from the client to the queue message as R2 keys, and the prompt is told the count — but the job does not attach image content to the provider call. SP-C is wired end-to-end except for that last step. This is the one place the feature is narrower than §11 claims.
- Regenerate-keeping-edits (SP-15, P2) and re-planning a published project (Q2).

### Before this ships

- Migration `0166` must be claimed and applied on **`main`** for staging **and** production, all four fleet brands, before `deploy:fleet`. This work is on `house-v2`; per [BRANCHING.md](../../ecosystem/BRANCHING.md) the migration and shared Worker code land on `main`.
- The four queues (`home-project-smart-draft{,-dlq}` × staging/prod) must exist before the Worker referencing them deploys.
- `smartProject` stays off until both are done.

---

## 14. Acceptance

- [ ] The manual template path is provably unchanged.
- [ ] AI-off behaviour is specified and the core wizard works without it.
- [ ] No requirement produces a price (D3).
- [ ] No requirement derives a dimension from a photo (D2).
- [ ] Nothing reaches other household members before an explicit publish (D1).
- [ ] As-is state (G2) has a data model, not just a prompt instruction.
- [ ] Geometry honesty rules from the parent BRD are intact.
- [ ] Feature TRD can be written without guessing product scope.
