# Home Projects - Feature Requirement / BRD

> Collaborative renovation and improvement planning for Symply House households. App-wide positioning stays in [symply-house BRD](../../apps/symply-house/BRD.md).

| Field | Value |
|-------|-------|
| **Doc type** | Feature BRD / requirement |
| **Feature id** | `home-projects` |
| **Owning app** | `simple-house` |
| **Display name** | Home Projects |
| **Status** | `draft` |
| **Version** | `v0.2` |
| **Created** | 2026-07-17 |
| **Last updated** | 2026-07-17 |
| **App BRD** | [documents/apps/symply-house/BRD.md](../../apps/symply-house/BRD.md) |
| **App TRD** | [documents/apps/symply-house/TRD.md](../../apps/symply-house/TRD.md) |
| **Feature TRD** | [HomeProjects_TRD.md](./HomeProjects_TRD.md) |
| **Implementation** | [HomeProjects_Implementation.md](./HomeProjects_Implementation.md) |

---

## Agent Kickoff Prompt

```text
Read first:
1. AGENTS.md
2. documents/ecosystem/PROJECT.md
3. documents/ecosystem/NAMING.md
4. documents/ecosystem/RELATIONSHIPS.md
5. documents/apps/symply-house/README.md
6. documents/apps/symply-house/BRD.md
7. documents/apps/symply-house/TRD.md
8. documents/apps/symply-house/features/README.md
9. documents/requirements/HomeProjects/HomeProjects_BRD.md
10. documents/requirements/HomeProjects/HomeProjects_TRD.md

Implement only after BRD/TRD acceptance. Follow HomeProjects_Implementation.md (v2.0 unified plan).
```

---

## 0. Version History

| Version | Date | Changes |
|---------|------|---------|
| v0.2 | 2026-07-17 | Align geometry P0 manual dims, remodel type alias, brand gate note |
| v0.1 | 2026-07-17 | Initial draft from competitor research + House architecture fit |

---

## 1. Overview

### 1.1 Summary

| Item | Value |
|------|-------|
| Feature name | Home Projects |
| Owning app | `simple-house` |
| Objective | Give households one shared place to plan renovations and improvements — scope, budget, timeline, materials, blockers, space plans, and progress — without becoming contractor ERP or a full CAD suite. |
| Primary users | Homeowner/primary operator, partner/household members, DIY planners, contractor-facing coordinators |
| Success metrics | See §1.4 |

### 1.2 One-Liner

**Home Projects** is the household renovation OS inside Symply House: turn “we should redo the bathroom / expand the sauna / replace the toilet” into a shared plan with budget, materials, timeline, space context, and clear next steps.

### 1.3 Problem

Households currently scatter renovation planning across:

- Notes apps and text threads
- Screenshots of products and prices
- Separate floor-plan tools (RoomSketcher, Planner 5D, Magicplan)
- Contractor emails / WhatsApp
- Spreadsheets for budget

Symply House already owns spaces, floor plans, tasks, contractors, chat, reports, and lightweight home budget context — but has no first-class **project** object that binds those pieces for a renovation or improvement.

### 1.4 Product Promise

A household can:

1. Start a project in under a minute (template or blank).
2. Attach it to a space (bathroom, sauna, door, whole home).
3. Capture as-built context (photos, existing floor plan, optional LiDAR room scan, optional AI wall/floor schematics).
4. Build a materials / selections board (paint, drywall, toilet, door, fixtures) with price, links, photos, status.
5. Track estimate vs actual budget and phases/milestones.
6. Surface blockers (permits, materials lead time, shared wall, weather, contractor availability).
7. Collaborate as a household — everyone sees the same project, comments, and decisions.
8. Convert work into House tasks / contractor follow-ups without leaving the project.

### 1.5 Success Metrics

| Outcome | Signal |
|---------|--------|
| Easy start | ≥70% of new projects created via template or 3-step wizard complete without abandon |
| Shared use | ≥2 household members view or edit a project within 14 days of creation (multi-member households) |
| Materials usefulness | Active projects average ≥5 selection items with at least price or link |
| Budget clarity | Users set a target budget on ≥60% of projects within first week |
| Space context | ≥50% of projects link a space and at least one photo or plan surface |
| AI optional | Core create / materials / budget / timeline flows work with AI off |
| Retention | Users reopen a project ≥3 times before marking it complete or archived |

### 1.6 Fleet Placement

| Concern | Requirement |
|---------|-------------|
| Shared User | Reuse existing `user_id` and household membership. No new accounts. |
| Brand system | House brand only for v1; UI through House tokens. Gate: `isHouseBrand()` + `gateHomeApiPaths` (no feature flag) |
| Data sharing | Project cost summaries may later Soft Transfer to Symply Budget with explicit consent. Deny-by-default. |
| AI | Core path works with AI off. Room scan / photo schematics / cost assist are optional AI/native enhancements. |
| Budget boundary | House keeps **project-level** estimate/actual for home improvements only. Full personal finance remains Symply Budget. |

---

## 2. Competitive Positioning

### 2.1 Competitor Map (2026)

| Competitor | Strength | Gap vs House opportunity |
|------------|----------|--------------------------|
| **Houzz Projects** | Ideabooks, cost calculator, product lists, checklists, pro finder | Marketplace-first; not tied to *your* household spaces, reports, tasks, utilities |
| **Houzz Pro / Buildertrend** | Pro job costing, selections, schedules, client portal | Built for builders, not household OS; heavy and paid for pros |
| **Planner 5D / RoomSketcher / Home Design 3D** | Friendly 2D→3D design, furniture catalogs | Weak household collaboration, maintenance history, contractors, reports |
| **Magicplan / CamPlan / Auto-Immo** | Excellent LiDAR/AR measure → 2D/elevations | Measure-first tools; weak long-lived household project management |
| **Notes + spreadsheets** | Flexible | No structure, no shared home context, easy to lose |

### 2.2 Winning Wedge For Symply House

Do **not** try to beat Houzz at marketplace or Planner 5D at photoreal 3D.

Win by being the **only place where renovation planning lives next to the home’s real data**:

```text
Space (bathroom) + Floor plan + Photos + Report findings
        ↓
   Home Project (Bathroom Reno)
        ↓
Selections · Budget · Timeline · Blockers · Tasks · Contractors · Chat
```

Differentiation principles:

1. **Household-native collaboration** (membership already exists).
2. **Space-linked truth** (projects hang off rooms/areas users already defined).
3. **Operational continuity** (projects create/update House tasks; they do not replace Tasks).
4. **Honest geometry** (measured scan or uploaded plan first; photo AI as scoping aid, not survey truth).
5. **Simple start, deep later** (template wizard → progressive disclosure).

### 2.3 Explicit Non-Goals (Product)

- Not a full BIM / CAD / construction ERP.
- Not a contractor marketplace (reuse Labor Hub / contractors).
- Not photoreal AR interior design as the core loop.
- Not a second chat product (reuse household chat or project-threaded activity).
- Not Symply Budget replacement.

---

## 3. Scope

### 3.1 In Scope

**Project lifecycle**

- Create, edit, archive, complete projects
- Types / templates: renovation (incl. remodel label), replacement, expansion, finish refresh, outdoor/structure, custom
- Status: `idea` → `planning` → `ready` → `in_progress` → `on_hold` → `done` → `archived`
- Link to one or more household spaces (and optional markers on existing floor plans)

**Planning surfaces**

- Vision / scope notes (what / why / constraints)
- Target budget + category breakdown (materials, labor, permits, contingency, other)
- Estimate vs actual line items
- Timeline: phases + milestones + target dates (not full Gantt in v1)
- Blockers with severity and resolution
- Selections / materials board (see §3.3)
- Attachments: photos, PDFs, links, existing floor/garden plan references
- Activity feed (who changed what)

**Space / plan context**

- Attach existing uploaded floor plans and annotate renovation zones
- Capture room photos from multiple angles as project evidence
- Optional **Room scan** (iOS LiDAR / RoomPlan) → structured walls/doors/windows → derived 2D floor + wall elevation views
- Optional **AI schematic assist** from photos → approximate wall/floor/ceiling elevations for scoping (labeled as approximate)
- “Before / proposed” plan notes (text + annotations; optional simple wall-move markup in later phase)

**Collaboration**

- All household members can view projects by default
- Roles: owner / editor / viewer (default: members are editors)
- Comments on project and on selection items
- Decision states on selections (`idea` / `shortlisted` / `approved` / `rejected` / `ordered` / `installed`)
- Notifications for key events (budget over target, blocker added, selection approved, phase due)

**Integrations inside House**

- Create tasks from project work items / checklist steps
- Link contractors and quotes to a project
- Surface project cost glance on lightweight House budget context
- AI Housekeeper can summarize a project and suggest next steps when AI enabled

### 3.2 Out Of Scope (v1–v1.5)

| Out of scope | Why |
|--------------|-----|
| Photoreal 3D walkthroughs / VR | Competitor territory; high cost; not required for planning |
| Automatic contractor bidding marketplace | Labor Hub owns pro discovery |
| Permit filing automation | Region-specific legal; provide checklist hooks only |
| Survey-grade CAD export as primary promise | Nice later; not MVP |
| Android LiDAR parity | Android ARCore path later; photo + manual measure first |
| Silent sync of full project ledger into Symply Budget | Soft Transfer package later, consent required |
| Multi-property portfolio PM for landlords | House is household ops, not property management SaaS |

### 3.3 Materials / Selections Model

Each selection item can carry:

| Field | Purpose |
|-------|---------|
| Name + category | Toilet, paint, drywall, door, vanity, tile, furniture, lighting, HVAC, custom |
| Qty + unit | e.g. 2 gallons, 12 sheets, 1 unit |
| Unit price + currency | Estimate or quote |
| Vendor + product URL | Shopping / research |
| Photos | Product or installed reference |
| Status | Idea → shortlisted → approved → ordered → installed (or rejected) |
| Linked surface | Wall A, floor, ceiling, fixture zone |
| Notes / alternatives | Compare option A vs B |
| Assignee | Who is deciding / buying |

Roll-up: project materials subtotal feeds budget estimate automatically when marked as estimate/approved.

### 3.4 Example Projects (Acceptance Scenarios)

| Example | What the product must support |
|---------|-------------------------------|
| **Bathroom renovation** | Full project: scope, budget, wall/floor photos or scan, tile/paint/fixtures selections, phases (demo → rough-in → finish), blockers (permit, lead time), contractor link |
| **Replace toilet** | Lightweight replacement template: 1–3 selection items, small budget, one task, photo before/after |
| **Replace door** | Replacement + measurements, hardware selections, optional wall elevation photo |
| **Sauna expansion** | Expansion type: remove/move wall intent, before photos, area notes, materials + labor budget, structural/permit blockers, linked space |
| **Paint + refresh** | Finish refresh: surface areas (from scan or manual), paint selections, DIY checklist |

### 3.5 Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| Household membership | feature | Collaboration boundary |
| Spaces / appliances | feature | Project location context |
| Floor plans | feature | Attach + annotate zones |
| Tasks / subtasks | feature | Work execution |
| Contractors / quotes | feature | Pro coordination |
| Chat / notifications | feature | Alerts + optional discussion |
| R2 attachments | backend | Photos, PDFs, exports |
| AI provider | backend / optional | Schematic + summary assist |
| RoomPlan native module | iOS native / optional | Accurate room geometry |
| Lightweight budget | House budget | Project cost glance only |

---

## 4. Requirements

| Req ID | Requirement | Priority | Notes |
|--------|-------------|----------|-------|
| BR-01 | Household members can create a Home Project with name, type, linked space(s), and status. | P0 | Wizard + templates |
| BR-02 | Projects are visible to all household members; edits respect role permissions. | P0 | Default editors |
| BR-03 | Users can capture scope notes, constraints, and goals on a project. | P0 | |
| BR-04 | Users can set target budget and track estimate vs actual by category. | P0 | Materials, labor, permits, contingency, other |
| BR-05 | Users can manage a selections/materials board with price, link, photo, qty, status. | P0 | |
| BR-06 | Users can define phases and milestones with dates. | P0 | Simple timeline |
| BR-07 | Users can add blockers with severity and mark them resolved. | P0 | |
| BR-08 | Users can attach photos, files, and links to a project and to selection items. | P0 | R2 |
| BR-09 | Users can link existing floor plans and mark renovation zones/areas. | P0 | Reuse floor-plan markers/zones |
| BR-10 | Users can create House tasks from project checklist items / work packages. | P1 | Bidirectional link |
| BR-11 | Users can link contractors and quotes to a project. | P1 | |
| BR-12 | Project activity feed shows meaningful changes for collaboration. | P1 | |
| BR-13 | Comments supported on project and selection items. | P1 | |
| BR-14 | Notifications for budget threshold, blocker, phase due, selection decision. | P1 | |
| BR-15 | Optional iOS RoomPlan scan produces structured room geometry and derived 2D floor + wall elevations attached to the project. | P2 | LiDAR devices; graceful fallback |
| BR-16 | Optional AI photo-to-schematic generates approximate wall/floor/ceiling elevations from multi-angle photos, clearly labeled approximate. | P2 | AI entitlement; AI-off fallback = manual |
| BR-17 | AI Housekeeper can summarize project status and suggest next actions when AI enabled. | P2 | |
| BR-18 | Templates for bathroom reno, replacement, expansion, paint refresh, custom. | P0 | |
| BR-19 | Projects can be filtered by status, space, and type; archived without delete. | P0 | Soft archive |
| BR-20 | Core flows work with AI disabled. | P0 | |
| BR-21 | Future Soft Transfer package draft for project cost summary → Symply Budget. | P3 | Consent required; not built in MVP |
| BR-22 | Material quantities can be assisted from measured surface areas when scan/plan dimensions exist. | P2 | Paint/flooring takeoff assist |
| BR-23 | Before/after photo sets supported per project. | P1 | |
| BR-24 | Export project summary PDF (scope, budget, selections, timeline) for contractors/household. | P2 | |

---

## 5. UX And Content

### 5.1 Design Principles

1. **Start in 60 seconds** — name, template, space, rough budget. Everything else is progressive.
2. **One project home** — dashboard with status chips: Budget · Timeline · Materials · Plans · Blockers · Tasks.
3. **Selections feel like a shopping board**, not a spreadsheet (but spreadsheet power under the hood).
4. **Plans are evidence for scope**, not a design studio first.
5. **Honesty in AI** — never present approximate schematics as measured truth.
6. **Household clarity** — always show who decided / who owns the next step.

### 5.2 Surfaces

| Surface | Requirement |
|---------|-------------|
| Entry point | Home dashboard card + My Home / More section “Projects”; deep link from space detail (“Plan improvement”) |
| List | Active projects first; chips for status/budget health; empty state with 3 templates |
| Create wizard | 1) What are you doing? 2) Where? 3) Rough budget & target date → Create |
| Project hub | Overview + tabs/sections: Scope, Plans, Materials, Budget, Timeline, Blockers, Tasks, Activity |
| Selection detail | Photo, price, link, status actions, comments |
| Plan studio | Photos gallery + floor plan attach + elevations (scan/AI/manual) + zone markup |
| Empty state | “Plan a renovation or replacement” + Bathroom / Replace fixture / Expand space CTAs |
| Error state | Recoverable upload/scan failures with retry; never lose draft project shell |
| Copy tone | Practical homeowner language; avoid contractor jargon unless user expands advanced fields |
| Accessibility | Dynamic Type, VoiceOver labels on pins/zones, non-color status cues |

### 5.3 Simple Create Flow (Canonical)

```text
Tap "New project"
  → Choose template (Bathroom reno / Replace something / Expand or change layout / Paint & finish / Blank)
  → Pick space(s) (or "Whole home")
  → Optional: target budget + target finish month
  → Land on Project Hub with guided checklist:
       □ Add 3+ photos
       □ Add materials you are considering
       □ Set phases
       □ Note blockers
       □ Attach or scan plan
```

### 5.4 Plan / Geometry UX Strategy

| Path | Who | Accuracy promise | UX |
|------|-----|------------------|-----|
| A. Attach existing floor plan | Everyone | As good as source file | Reuse Floor Plans feature; mark zone “Bathroom reno” |
| B. Room scan (RoomPlan) | iOS LiDAR | Best available in-app measured geometry | Guided walk-around; review walls; generate floor + elevations |
| C. Manual dimensions | Everyone | User-entered | Width/length/height fields per room/wall |
| D. Photo schematic AI | AI-on users | Approximate scoping only | “Create draft elevations from photos” + disclaimer + edit |

**Recommendation:** Ship A+C in P0 (attach plan + manual dimensions), B in P2, D in P2 behind AI gate. Do not market D as “AI builds your construction drawings.”

Design references:

- [DesignSystem.md](../../design/DesignSystem.md)
- [UI_Rules_For_Chat_Generated_UI.md](../../design/UI_Rules_For_Chat_Generated_UI.md)

---

## 6. Data, Privacy, And Sharing

| Data | Owner | Requirement |
|------|-------|-------------|
| Project records | House / household | Scoped to `household_id`; members only |
| Photos / PDFs / scan exports | House / R2 | Same household auth as reports/floor plans |
| Comments / activity | House | Member identity via Shared User profile |
| AI photo/scan processing | House AI path | No training on user content; retention per existing AI policy |
| Cost summaries | House | May Soft Transfer later to Budget with consent |

Privacy rules:

- Projects inherit household privacy; no public links in v1.
- External product URLs are user-provided; app does not scrape paywalled content without consent.
- Scan/photo geometry is household-private.
- Export PDF is user-triggered.

Soft Transfer packages:

| Package | From | To | Consent | Status |
|---------|------|----|---------|--------|
| `home_project_cost_summary.v1` | House | Symply Budget | required | draft (P3) |

---

## 7. AI Strategy (Product Judgment)

### 7.1 What AI Should Do

| Capability | Value | Confidence |
|------------|-------|------------|
| Summarize project health | High | High |
| Suggest missing materials for template type | High | Medium |
| Draft phases/checklist from template + scope text | High | Medium |
| Estimate rough cost ranges from region + project type | Medium | Medium (ranges, not quotes) |
| Photo → approximate elevations / room diagram | High for scoping | Medium–Low for measurements |
| Detect blockers from notes (“load-bearing?”, “permit?”) | Medium | Medium |
| Takeoff assist from measured areas (paint gallons) | High when dimensions exist | High |

### 7.2 What AI Must Not Promise

- Construction-document accuracy from casual phone photos alone
- Structural engineering judgment (load-bearing wall removal)
- Guaranteed contractor quotes
- Automatic permit approval

### 7.3 Recommended Geometry Stack

```text
Best accuracy     → Apple RoomPlan (LiDAR) → parametric walls → 2D floor + elevations
Good enough       → Existing uploaded floor plan + zone markup + manual dims
Scoping aid       → Multi-photo multimodal AI → editable schematic elevations
Always available  → Photos + notes + checklist (AI off)
```

Photo-only pipeline (when used):

1. User captures 4–8 photos (each wall, floor, ceiling, corners).
2. Backend multimodal model produces SVG/JSON schematic: walls as rectangles, openings as placeholders, rough relative proportions.
3. User confirms / edits dimensions.
4. System labels output **Approximate — verify before ordering materials**.

This is valuable for bathroom/sauna scope understanding even when not survey-accurate.

---

## 8. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Scope creep into CAD/marketplace | Delays MVP; confuses House identity | Strict non-goals; phase gates |
| AI plan overpromise | Trust damage; bad purchases | Disclaimers; measured path preferred; edit loop |
| Duplicate of Tasks/Floor Plans | Fragmented UX | Projects orchestrate; do not fork those systems |
| Budget feature boundary blur | Conflicts with Symply Budget | Project ledger only; Soft Transfer later |
| RoomPlan device fragmentation | Only Pro iPhones | Fallback paths A/C/D; Android later |
| Collaboration conflicts | Overwrites / confusion | Activity feed + selection decision states |
| Attachment storage cost | R2 growth | Caps per project; compression; reuse report patterns |

---

## 9. Open Questions

| # | Question | Owner | Status |
|---|----------|-------|--------|
| Q1 | Navigation home: dedicated Projects tab vs My Home section + dashboard card? | Product | open — recommend My Home + dashboard for v1 |
| Q2 | Should viewers outside household (contractor guest link) be in v1.5? | Product | open — recommend no for v1 |
| Q3 | Default currency/region for cost ranges (CAD / Metro Vancouver first)? | Product | open — follow household locale |
| Q4 | RoomPlan via custom Expo module vs temporary export/import from Files? | Engineering | open — prefer Expo module in P2 |
| Q5 | Soft Transfer fields for Budget package v1? | Ecosystem | open — draft in RELATIONSHIPS when P3 starts |

---

## 10. Phased Product Releases

| Phase | Name | User value |
|-------|------|------------|
| **P0** | Project Core | Create/share projects, materials, budget, timeline, blockers, attachments, space + floor-plan link |
| **P1** | Ops Glue | Tasks, contractors, comments, activity, notifications, before/after |
| **P2** | Space Intelligence | RoomPlan scan, AI schematics, takeoff assist, PDF export, AI summary |
| **P3** | Fleet Bridge | Soft Transfer cost summary → Symply Budget; richer proposed-layout markup |

---

## 11. Acceptance

- [ ] Requirements are House-boundary safe (no Budget product takeover).
- [ ] AI-off path is documented and required for P0.
- [ ] Geometry honesty rules are explicit.
- [ ] Collaboration uses existing household membership.
- [ ] Feature TRD can be created without guessing product scope.
- [ ] Competitor wedge is clear: household OS project planning, not CAD/marketplace.
