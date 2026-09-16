# Symply Budget - Design Notes

| Field | Value |
|-------|-------|
| **App id** | `simple-budget` |
| **Display** | Symply Budget |
| **Shared system** | [DesignSystem.md](../../design/DesignSystem.md) |
| **White-label template** | [WHITELABEL_TEMPLATE.md](../../design/WHITELABEL_TEMPLATE.md) |
| **Brand tokens** | `brands/symply-budget/tokens.json` |
| **Brand config** | `brands/symply-budget/brand.cjs` |

Symply Budget should feel calm, precise, and financially trustworthy: a work surface for repeated monthly decisions, not a marketing page. It inherits the Symply shell and interaction model, but the first screen should make budget state scannable at a glance.

## Brand Identity

| Token / asset | Value | Use |
|---------------|-------|-----|
| Primary | `#2BB673` | Primary actions, active tab states, positive progress. |
| Primary dark | `#239A61` | Pressed/strong states and dark-mode brand accents. |
| Primary light | `#5FD49A` | Soft fills, progress backgrounds, non-critical highlights. |
| Ink | `#0A1325` | Light-mode financial data and dense table text. |
| Tone | Calm, operational, exact | Budgets need confidence, not hype. |
| Icons / logos | Brand pack only | Store and in-app identity. |

Do not hardcode brand colors in screens. Use shared theme APIs and generated tokens.

### Runtime palette and icons (2026-09-10)

The table above describes Classic Green. Budget defaults to Teal & Coral and also
supports Sage & Terracotta in Appearance. All three schemes resolve through
`useAppColors()` and update mounted icons immediately in light and dark mode.

The shared `Icon` uses monochrome brand artwork as a tintable shape. An explicit
`color` wins; otherwise `active` uses the current `primary`, `filled` uses white
on the caller's background, and inactive icons use `textSecondary`. Baked green
`selected`/`filledAccent` PNGs must not decide runtime foreground colors.
`IconBackgroundChip` uses primary for active chips unless explicitly overridden.
Semantic errors/warnings/success, disabled states and white-on-fill remain distinct.

Audit covered the shared icon/alias and tab/sidebar pipelines, Budget screens
(including savings, pension, mortgage, wishes and export), More/settings,
customization, header actions, chat FAB, and in-app logo consumers. Direct logo
reads in Budget headers, auth forms and biometric setup now use
`getLogoSplashForScheme`, matching HeaderLogo and SplashScreen.
Regression tests switch every kit icon through all three schemes without
remounting, in both themes, and check explicit semantic/neutral/white colors.

Validation: 68 relevant suites / 918 tests passed, with additional screen,
cloud-picker and production-environment checks passing. Full TypeScript check
passes after repairing the existing navigation, native API and test-fixture
incompatibilities. ESLint has no errors on the audited files (style warnings
remain). Device build (`SymplyBudget-Production`, `Debug-budget`) and installation on the
wired iPhone 13 Pro succeeded. Runtime inspection confirmed `API_ENV=production`
and the Budget production Worker URL. The sign-in screen renders the teal logo;
authenticated screens still require user sign-in for device visual verification.
Native and JavaScript log capture remains active. House-only address diagnostics
are now restricted to House instead of appearing as errors in Budget logs.
No backend deployment or store publication is part of this change.


## UX Principles

| Principle | Requirement |
|-----------|-------------|
| Budget-first | Open into budget state and decisions, not a generic House landing experience. |
| Dense but readable | Prefer compact summaries, tables, segmented controls, and charts that support repeat use. |
| Explain the number | Money totals need provenance: planned, actual, projected, imported, or transferred. |
| Review before save | AI/document imports and Soft Transfer packages must land in user-confirmed drafts. |
| Platform consistent | Use shared spacing, type, shell, auth, settings, Widget/Watch patterns. |
| AI optional | Keep manual entry and correction visible. |
| Accessible | Preserve contrast, Dynamic Type, hit targets, and non-color status cues. |

## Navigation

- Visible tabs come from `brands/symply-budget/brand.cjs`.
- Budget is the first tab; Home is supporting context.
- AI Housekeeper/Mira remains a shared optional assistant surface, not the budget data source of truth.
- Hidden routes remain reachable through More, contextual actions, or deep links.
- iPhone bottom tabs and iPad sidebar must use the same tab registry.

## Key Surface Notes

| Surface | Design direction |
|---------|------------------|
| Budget dashboard | Start with month state: remaining, planned, actual, upcoming, and trend. Avoid decorative hero content. |
| Planned items | Prioritize scanning, sorting, amount editing, target dates, and category/system labels. |
| Spendings | Make add/edit fast; show source/provenance for imported or task-linked expenses. |
| Bills | Use category chips, due-state badges, document indicators, and clear review screens for extracted bills. |
| Savings / registered accounts | Use conservative copy, clear disclaimers for estimates, and visible manual correction paths. |
| Long-term maintenance money | Use timeline/forecast views with system categories and planned-vs-actual cues. |
| Soft Transfer consent | Match shared consent patterns; show source app, package version, fields, and revocation path. |
| Empty states | Offer one focused action at a time: add item, import document, create goal, or review transfer. |

## Native Companions

| Companion | Design requirement |
|-----------|--------------------|
| Widget | Glanceable state only: month remaining, upcoming bill, savings headroom, or next budget task. |
| Watch | Minimal-tap actions such as view upcoming bill/reminder or mark a budget-related task done. |

Native companions must be powered by shared companion code and Budget brand tokens. Do not fork the Widget or Watch UI for Budget-specific visuals beyond brand configuration and approved data payloads.

## Trust And Data Display

- Use cents-accurate formatting for money and avoid float-looking intermediate values.
- Label estimates, AI-extracted values, and transferred values differently from confirmed manual records.
- Show account/household scope on import, transfer, and destructive actions.
- Avoid red/green-only meaning; pair color with icon/text state.
- Never show raw document text or sensitive extracted fields outside the active review context.

## Anti-Patterns

- Forking shared auth, tab shell, settings, Widget, or Watch for visual reasons.
- Hardcoding colors, brand names, or app ids in screens.
- Turning the Budget dashboard into a landing page or oversized hero.
- Saving AI imports or House transfers without a review step.
- Hiding the manual path behind AI-only copy.
- Expanding this doc into a full feature spec.

## Design QA

- [ ] Brand tokens are the only source of brand colors.
- [ ] Light and dark modes both look intentional.
- [ ] Navigation labels fit compact widths.
- [ ] Budget-first tab order is preserved.
- [ ] Money, due states, and estimates are distinguishable without relying only on color.
- [ ] AI-off states are polished.
- [ ] Widget/Watch match generated Budget brand tokens when enabled.
