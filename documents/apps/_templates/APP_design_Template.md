# [App Display Name] - Design Notes

| Field | Value |
|-------|-------|
| **App id** | `[brand-id]` |
| **Display** | `Symply [Product]` |
| **Shared system** | [DesignSystem.md](../../design/DesignSystem.md) |
| **White-label template** | [WHITELABEL_TEMPLATE.md](../../design/WHITELABEL_TEMPLATE.md) |
| **Brand tokens** | `brands/<id>/tokens.json` |
| **Brand config** | `brands/<id>/brand.cjs` |

[One paragraph describing how this app should feel in the Symply fleet.]

## Brand Identity

| Token / asset | Value | Use |
|---------------|-------|-----|
| Primary | `[hex]` | Primary actions and active states |
| Tone | `[calm / focused / clinical / playful / etc.]` | Product feel |
| Icons / logos | Brand pack only | Store and in-app identity |

Do not hardcode brand colors in screens. Use shared theme APIs and generated tokens.

## UX Principles

| Principle | Requirement |
|-----------|-------------|
| Platform consistent | Use shared spacing, type, shell, auth, settings, Widget/Watch patterns. |
| Domain specific | Make the app feel tailored to its product domain without forking shared components. |
| AI optional | Keep manual paths visible unless product explicitly approves AI-only behavior. |
| Accessible | Preserve contrast, Dynamic Type, hit targets, and non-color status cues. |

## Navigation

- Visible tabs come from `brands/<id>/brand.cjs`.
- Hidden routes remain reachable through More, Home, contextual actions, or deep links.
- iPhone bottom tabs and iPad sidebar must use the same tab registry.

## Key Surface Notes

| Surface | Design direction |
|---------|------------------|
| [Surface] | [Design note] |

## Native Companions

| Companion | Design requirement |
|-----------|--------------------|
| Widget | Short, glanceable, high-contrast state. |
| Watch | Minimal-tap flows; preserve app identity through generated tokens. |

## Anti-Patterns

- Forking shared auth, tab shell, settings, Widget, or Watch for visual reasons.
- Hardcoding colors or brand names in screens.
- Using a generic landing-page style for an operational app.
- Expanding this doc into a full feature spec.

## Design QA

- [ ] Brand tokens are the only source of brand colors.
- [ ] Light and dark modes both look intentional.
- [ ] Navigation labels fit compact widths.
- [ ] AI-off states are polished.
- [ ] Widget/Watch match generated brand tokens when enabled.
