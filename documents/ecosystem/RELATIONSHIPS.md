# Ecosystem relationships

> Cross-app contracts. Child BRDs must not contradict this file or [`_ecosystem/`](../apps/_ecosystem/README.md).

## Parent → child

| Parent owns | Children must |
|-------------|----------------|
| Shared User (`user_id`) | Reuse account; no second auth |
| Brand ecosystem | Ship via `brands/<id>/` only |
| Soft Transfer + consent | Opt-in; deny by default for Health |
| Design tokens pipeline | Brand colors only; shared spacing/type |
| Worker AI AuthZ | Respect `ai.status`; AI-off paths |

## Shared surfaces (do not fork)

| Surface | Location | Branding via |
|---------|----------|--------------|
| Login / Register | `src/screens/auth/` | brand assets |
| Tab shell | Floating + Sidebar + `tabRegistry` | `brand.tabs` |
| Widget / Watch | `ios/` companions | generated brand tokens |
| Google / Apple / Drive | integrations in brand pack | client IDs per brand |

## Soft Transfer (v1 — Data Bridge)

Runtime brands: `symply-house`, `symply-budget`, `symply-kaizen`, `symply-health`, `symply-language` (see [NAMING.md](./NAMING.md)).

| From | To | Packages | Consent |
|------|-----|----------|---------|
| `symply-house` | `symply-budget` | `house.property.v1`, `profile.core.v1`, `home_project_cost_summary.v1` | required |
| `symply-budget` | `symply-house` | `budget.summary.v1`, `profile.core.v1` | required |
| `symply-house` | `symply-health` | `profile.core.health.v1` | required |
| `symply-health` | `symply-house` | `health.summary.v1` | required |
| `symply-house` | `symply-language` | `profile.core.language.v1` | required |
| `symply-language` | `symply-house` | `language.summary.v1` | required |
| Kaizen packages | later (Phase E) | control-plane join only in v1 | required when added |

Canonical plan: [Ecosystem_Data_Bridge_Plan.md](../design/Ecosystem_Data_Bridge_Plan.md) **v1.16** (greenfield). Research/background: [Shared User research](../design/Shared_User_Smart_Engine_Research.md).

## Feature ownership (budget example)

| Concern | Owner app | Mode |
|---------|-----------|------|
| Minimal budget UX | `simple-house` | `features.budget = minimal` |
| Full budget product | `simple-budget` | `features.budget = full` |
| Module code | shared `src/features/budget/` | gated by brand |

## Dependency order (build fleet)

1. `_ecosystem` contracts stable enough to brand  
2. `simple-house` (host)  
3. `simple-budget` (first feature-split proof)  
4. `symply-kaizen` (third brand E2E)  
5. `simple-language` (RN rewrite)  
6. `simple-health` (RN rewrite, last / sensitive)

Do not skip ahead for shared UI work — see [NEW_BRAND_CHECKLIST.md](../design/NEW_BRAND_CHECKLIST.md).
