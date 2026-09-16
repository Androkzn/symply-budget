# Symply Ecosystem - Design Notes

| Field | Value |
|-------|-------|
| **Doc type** | Shared platform design contract |
| **App id** | `_ecosystem` |
| **Display** | Symply Ecosystem |
| **Shared system** | [DesignSystem.md](../../design/DesignSystem.md) |
| **UI rules** | [UI_Rules_For_Chat_Generated_UI.md](../../design/UI_Rules_For_Chat_Generated_UI.md) |
| **White-label template** | [WHITELABEL_TEMPLATE.md](../../design/WHITELABEL_TEMPLATE.md) |
| **Brand token plan** | [Brand_Token_Ecosystem_Plan.md](../../design/Brand_Token_Ecosystem_Plan.md) |
| **Shared identity plan** | [Shared User + Smart Engine](../../design/Shared_User_Smart_Engine_Research.md) |

This document defines how the shared Symply platform should feel and behave across the fleet. It is not a brand guide for a storefront app. Child apps may specialize product surfaces through brand packs and feature modules, but shared flows must remain recognizable, token-driven, and privacy-clear.

## Design Promise

| Principle | Requirement |
|-----------|-------------|
| Same platform, distinct products | Apps feel like related Symply products without looking cloned; brand color/assets change, structure stays familiar. |
| No forked trust surfaces | Login, consent, AI entitlement, settings, Widget, Watch, and cloud integrations use one design system. |
| Brand is data | Product identity comes from `brands/<id>/` assets/tokens/tabs/copy keys, not hard-coded screen variants. |
| AI is optional | AI-on adds capability; AI-off states stay polished, manual, and useful. |
| Consent is visible | Data transfer requires a clear source, destination, package, purpose, and revocation path. |
| Health is stricter | Health-related sharing is denied until explicit Health design and privacy controls are approved. |

## Brand And Token System

| Layer | Owned by | Design rule |
|-------|----------|-------------|
| Shared base tokens | Platform | Spacing, radii, type, and font rhythm remain common across all brands. |
| Brand tokens | Brand pack | Colors, gradients, backgrounds, and accents may vary by brand. |
| Assets | Brand pack | Logos, icons, app icon, splash, and companion assets come from `brands/<id>/assets` or generated icon outputs. |
| Shell components | Platform | Headers, tab shell, cards, buttons, forms, modals, and settings patterns stay shared. |
| Native companions | Platform + brand ids | Widget/Watch layouts stay shared; accent/display identity comes from generated brand tokens and native ids. |

Do not hard-code brand hex values or display names in shared screens. Use the active brand APIs and generated tokens.

## Shared Surface Rules

| Surface | Shared design contract | Brand-specific inputs |
|---------|------------------------|-----------------------|
| Login/Register | Same layout, validation, error behavior, recovery flows, OAuth button treatment, and trust cues. | Logo, splash/background asset, primary accent, display name, OAuth client ids. |
| Onboarding/account | Same account framing and permission rhythm. | Product-specific copy keys where needed. |
| Tab shell | Phone and iPad navigation derive from one registry and keep consistent labels, selected state, and overflow behavior. | Tab order, labels, icons/SF symbols, feature-gated tabs. |
| Settings | Shared account, AI, privacy, integrations, and transfer patterns. | Product settings sections and brand copy. |
| AI access | One account-level pattern for off/trial/on states, upgrade/enable prompts, and manual fallback. | Product AI entry points and scope labels. |
| Soft Transfer consent | One consent sheet/pattern showing source app, destination app, package, contents summary, purpose, expiry, and revoke action. | Package-specific summary and product names. |
| Google/Apple/Drive | Same connection, error, and disconnect UX. | Client ids, app name, scheme, icon tint. |
| Widget | Shared glanceable layout, high contrast, and deep-link affordance. | Accent color, display name, icon assets, extension id. |
| Watch | Shared minimal-tap patterns and sync status. | Accent color, display name, complication/extension ids. |

## AI-Off And AI-On UX

| State | Requirement |
|-------|-------------|
| AI off | Hide or disable AI-only chrome; show manual actions in the same workflow; do not make the screen feel broken or empty. |
| Trial/on | Reveal AI affordances where useful; keep product-specific labels clear about what AI will do. |
| Entitlement unknown | Use neutral loading or unavailable states; do not optimistically start model calls. |
| Toggle off | Stop new AI requests/jobs, return to manual UI, and make the result understandable without alarmist copy. |
| Provider/BYOK issue | Separate account AI status from provider setup errors so users know whether AI is disabled or misconfigured. |

AI prompts and upgrade surfaces must not become the primary path for core CRUD, sync, notifications, Widget, Watch, or manual imports unless a child product doc explicitly approves that scope.

## Soft Transfer UX

Every transfer consent flow must answer these questions before the user confirms:

| Question | Example answer format |
|----------|-----------------------|
| What is moving? | `house.property.v1`: city, property type, non-sensitive household summary |
| From where? | Symply House |
| To where? | Symply Budget |
| Why? | Pre-fill Budget setup and reduce duplicate entry |
| How long? | One-time import or ongoing sync with expiry |
| How to stop? | Revoke from Settings -> Privacy / Data sharing |

Revoked or expired transfers should produce calm, actionable states. Avoid implying that one app can browse another app's full data.

## Shared Worker/D1 Design Implications

| Backend contract | Frontend/design implication |
|------------------|-----------------------------|
| One `user_id` | Account screens show one Symply account identity across brands. |
| App entitlements | App access failures explain product access, not login failure. |
| AI entitlement | AI gates are account-level and consistent across brands. |
| Consent registry | Privacy/settings surfaces can list active transfer permissions. |
| Transfer events | Imports can show last transfer time/status without exposing raw payload internals. |
| Package versions | UI copy names package contents in human terms and can handle unsupported versions gracefully. |

## Accessibility And Responsive Rules

- Preserve Dynamic Type, hit targets, contrast, and non-color status cues.
- Keep labels short enough for tab bars, sidebars, Widget, and Watch surfaces.
- Use brand color as emphasis, not the only indication of state.
- Maintain light/dark parity through generated tokens.
- Do not place explanatory platform prose inside operational screens; use clear labels, states, and concise help text.

## Anti-Patterns

- Forking shared auth, consent, tab shell, AI gates, Widget, Watch, or Drive UX for visual reasons.
- Adding brand-specific hard-coded colors or names outside brand packs/generated outputs.
- Treating `_ecosystem` like a marketing landing page or storefront app.
- Hiding manual paths behind AI prompts.
- Presenting Soft Transfer as automatic background sharing.
- Using Health examples in general transfer UX before Health contracts approve them.

## Design QA

- [ ] Brand tokens are the only source of brand colors in shared surfaces.
- [ ] Login/Register works as one layout with different brand assets.
- [ ] AI-off states are complete and manual flows remain obvious.
- [x] Soft Transfer consent names source, destination, package, purpose, expiry, and revoke path.
- [ ] Widget/Watch accents match generated brand tokens where enabled.
- [ ] Navigation labels fit phone tab and iPad sidebar constraints.
- [ ] No child app doc contradicts the shared design rules for auth, consent, AI, or native companions.
