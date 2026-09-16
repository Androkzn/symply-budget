# Simple ✦ — White-Label App Template Architecture

> One codebase → an ecosystem of ~10 apps ("Simple House", "Simple Budget",
> "Simple Kaizen" / Symply Kaizen, "Simple Language", "Simple Health", …) that share
> **layout, navigation, architecture, fonts, spacing, auth, Widget, Watch, and
> components**, and differ **in colors, icons, backgrounds, tabs, and which
> feature modules are enabled**. Adding a new app should be a **brand pack
> (+ optional feature modules), not a code fork**.

Status: **plan v2.6** (Jul 2026). **Platform locked: SimpleHouse.** Symply Kaizen is
the design-system donor (port `design:build` / Expo 57 / DTCG / coupling fixes —
**not** Style Dictionary or Unistyles). **Simple Budget** is brand #2 (extract
full budget from House; House keeps minimal budget only). Language and Health
remain native Swift until rewritten as brands.
Canonical fleet order + phases: [Brand_Token_Ecosystem_Plan.md](./Brand_Token_Ecosystem_Plan.md).
Shared identity / transfer / optional AI: [Shared_User_Smart_Engine_Research.md](./Shared_User_Smart_Engine_Research.md).
Kaizen donor (detail): `~/Desktop/Symply Ecosystem/Simply Kaizen/symply-kaizen/design/WHITELABEL_TEMPLATE.md`.

---

## 1. Why tokenization (the purpose)

A "brand" is data, not code. If every color/gradient/icon/spacing value is a
**token** resolved from one source, then the app's 200 screens never mention a
hex or a glyph — they reference `theme.colors.primary`, `<Icon name="today">`,
`Spacing.base`. Swapping brands becomes swapping the **token source**, and the
same tokens can be **generated for every runtime** (React Native, the iOS
widget, the Apple Watch app) so nothing drifts.

Symply Kaizen already proved this end-to-end (port into SimpleHouse):

- `design/tokens.json` → `scripts/build-tokens.mjs` → `tokens.generated.ts`
  (RN) **and** `native/DesignTokens.generated.swift` (`BrandTokens`, used by the
  widget + watch).
- `assets/app-icons/` → `scripts/build-iconset.mjs` → the RN `@brand/iconset`
  **and** the widget's `Assets.xcassets` catalog.
- Verified on Symply Kaizen: builds on device, logo + gradients from tokens,
  widget/watch compile against `BrandTokens`.

The template generalizes this from **one brand** to **N brands** on the
**SimpleHouse** platform repo.

---

## 2. Repo strategy — single codebase + per-brand config (recommended)

**Decision: SimpleHouse is the platform.** One Expo codebase, a `brands/`
directory, and a dynamic `app.config.ts` selected by `APP_BRAND` / `BRAND` +
EAS build profiles. Not a monorepo. Not four Desktop folders open in Cursor.

| Option | Verdict |
|---|---|
| **Single codebase + app variants** (SimpleHouse + `brands/<id>/`) | ✅ **Recommended.** Least drift; one place to fix Google login icon, AuthShell, Widget/Watch. |
| Open all Desktop apps (House + Symply Kaizen + Language + Health) in one Cursor folder | ❌ Does not create shared UI. Language/Health are Swift; AI context thrash. |
| Make Symply Kaizen the platform and port House into it | ❌ Discarded — House is the mature product; Symply Kaizen donates pipeline only. |
| Monorepo (Turborepo/Nx) with shared `core` + thin apps | Escape hatch **only if** feature modules are not enough. |

This matches Expo's official ["app variants"](https://docs.expo.dev/tutorial/eas/multiple-app-variants/)
pattern and scales to 10 via EAS build profiles + EAS Update channels.

**Fleet order:** SimpleHouse (platform, minimal budget) → **Simple Budget** (full budget extract) → Symply Kaizen → Simple Language rewrite → Simple Health rewrite (last).

---

## 3. The one file per app — the "brand pack"

Each app is a folder under `brands/`. **This is the only thing that changes
between apps.**

```
brands/
  simple-kaizen/
    brand.config.ts     # identity + tabs + feature flags (the manifest)
    tokens.json         # colors, gradients, backgrounds  (spacing/type/fonts inherited)
    app-icons/          # the icon package for this brand (drop-in, per §6)
    assets/             # appIcon.png, splash.png, adaptive-icon, notification-icon
  symply-house/
    …
brands/_shared/
    tokens.base.json    # spacing, radii, typography, fonts — SHARED, brand can't override
```

`brand.config.ts` shape (the manifest every app provides):

```ts
export default {
  id: 'simple-kaizen',
  name: 'Simple Kaizen',
  tagline: 'OS for Life',
  slug: 'simple-kaizen',
  scheme: 'simplekaizen',
  ios: { bundleIdentifier: 'com.simplekaizen.app', appleTeamId: '…' },
  android: { package: 'com.simplekaizen.app' },
  easProjectId: '…',
  // Tabs are DATA — count, order, labels, icons are per-brand:
  tabs: [
    { name: 'today',  label: 'Today',  icon: 'today',  sfSymbol: 'calendar' },
    { name: 'career', label: 'Career', icon: 'career', sfSymbol: 'briefcase' },
    { name: 'assess', label: 'Assess', icon: 'assess', sfSymbol: 'target' },
    { name: 'learn',  label: 'Learn',  icon: 'learn',  sfSymbol: 'book' },
    { name: 'more',   label: 'More',   icon: 'more',   sfSymbol: 'ellipsis' },
  ],
} satisfies BrandConfig;
```

Everything downstream reads the **active brand**
(`resolveActiveBrand(process.env.APP_BRAND ?? 'simple-house')`):

- `app.config.ts` → name/slug/scheme/bundle IDs/icon/splash from `brand.config.ts` + `brands/<b>/assets`.
- `scripts/build-tokens.mjs` → merges `brands/_shared/tokens.base.json` + `brands/<b>/tokens.json`.
- `scripts/build-iconset.mjs` → reads `brands/<b>/app-icons/`.
- The tab layout (§5) → renders `brand.tabs`.
- EAS profiles set **both** `APP_BRAND` and `EXPO_PUBLIC_APP_BRAND`.

---

## 4. Token pipeline — keep custom generator; DTCG source format

**Do not migrate to Style Dictionary as the default engine.** Kaizen-donor research
(confirmed): SD cannot emit this identity’s gradient + Liquid Glass +
per-`ColorScheme` Swift helpers (SD issue #895 open). Port/keep custom
`scripts/build-tokens.mjs` instead.

Do instead:

- **Keep / port `build-tokens.mjs`** — gradients, glass, per-scheme Swift, icon catalog.
- **Adopt DTCG source format** (`$value` / `$type`) in
  `brands/_shared/tokens.base.json` + `brands/<b>/tokens.json`.
- Outputs: `tokens.generated.ts` (RN), `DesignTokens.generated.swift`
  (`BrandTokens` for Widget + Watch); Android `colors.xml` when Android ships.
- Revisit Style Dictionary only if Android multi-format pain justifies wrapping
  the custom emitter.

---

## 5. Navigation — native tabs, configured by the brand file

The app already uses **expo-router file-based routing** with `app/(tabs)`.
Adopt **Expo Router native tabs** (`expo-router/unstable-native-tabs`) so the
tab bar is a real `UITabBarController` — you inherit the **iOS 26 Liquid Glass**
tab bar and **SF Symbol** icons for free, and Material 3 on Android.

### Current shipping path (SimpleHouse platform, post-SDK 57)

- **Primary chrome:** custom `FloatingTabBar` (phone) + `SidebarTabBar` (iPad) driven by
  `src/navigation/tabRegistry.ts` ← `brand.tabs` / `featureTabs`.
- **Icons now:** `BrandSymbol` (`src/components/common/BrandSymbol.tsx`) uses
  `expo-symbols` on iOS when `sfSymbol` is set; Ionicons (`@expo/vector-icons`)
  elsewhere / as fallback.
- **Do not flip** to `unstable-native-tabs` until phone + iPad parity is verified
  (Mira avatar tab, chat badge, hide-on-nested routes, feature-gated Tasks).

### Target path (Native Tabs)

- One **`src/navigation/tabRegistry.ts`** driven by `brand.tabs` feeds **both**
  Native Tabs and the iPad sidebar (sidebar stays custom until Native Tabs has
  an equivalent).
- SDK 55+ API: compound components only —
  `NativeTabs.Trigger.Icon` / `.Label` / `.Badge` (not standalone `Icon` imports).
- Icons: SF Symbol name (`brand.tabs[].sfSymbol`) natively on iOS; Ionicons /
  brand glyph on Android where a symbol isn't defined.

### Fallback (documented)

| Layer | Choice |
|---|---|
| Preferred | `expo-router/unstable-native-tabs` |
| If `unstable-` regresses | Callstack **`react-native-bottom-tabs@1.4.0`** (Expo Router adapter) |
| Shipping today | Custom Floating + Sidebar (above) |

Both Native Tabs and Callstack require dev/prebuild builds (we already use those).

### SDK 56+ React Navigation import rule

App code must not import `@react-navigation/native` / `bottom-tabs` for hooks —
use `expo-router/react-navigation` and `expo-router/js-tabs`. Nested
`createNativeStackNavigator` stacks under tabs still need
`EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK=1` until migrated to `expo-router`
`Stack` layouts.

Headers, the "More" sheet, and any custom footers stay as **shared** components
in `src/components/layout/` and consume tokens — never brand-hardcoded.

---

## 6. Icons — one system, per-brand sets, native-shared

- Move `assets/app-icons/` → `brands/<b>/app-icons/`; `build-iconset.mjs` reads
  the **active brand's** set → RN `@brand/iconset` + the widget `Assets.xcassets`.
- A brand swaps the **whole glyph set** (drop-in package) and its **tint/gradient**
  (from tokens). Per-tab icon choice is data in `brand.config.ts`.
- Add **`expo-symbols`** for native SF Symbols on tab bar / nav; keep
  `@expo/vector-icons` as the cross-platform fallback behind the existing `Icon`
  wrapper.
- **Render engine (Symply Kaizen):** emit each glyph as compiled `react-native-svg`
  `<Path>` primitives and tint via `color` — avoid `SvgXml` re-parsing on every
  tint. Prefer vector assets over 96px raster PNGs on native.

---

## 7. Theming — keep ThemeContext (brand is build-time)

**Do not adopt Unistyles / Restyle for white-label.** Brand is selected at
**build** time (`APP_BRAND`); the only runtime theme change is **light/dark**,
which `ThemeContext` already handles.

Do instead:

- Consolidate dual color APIs (`useAppColors` vs `useTheme`) → **one** API over
  generated tokens.
- Keep `ThemeContext` as the light/dark provider.
- Fonts/spacing/typography from `brands/_shared/tokens.base.json` — identical
  across brands by design.

---

## 8. Native per-brand assets (icon / splash / fonts / companions)

For **separate apps** (our case), drive these from `app.config.ts` + the brand
pack:

- **App icon / splash:** `app.config.ts` points at `brands/<b>/assets/*`.
  Optionally ship an Apple Icon Composer `.icon` per brand. Avoid
  `expo-dynamic-app-icon` for the fleet.
- **Fonts:** shared via `expo-font` in the shared layer.
- **Widget / Watch:** shared SwiftUI + generated `BrandTokens`. Parameterize
  App Group + extension bundle IDs from the brand; generate entitlements /
  Swift `appGroup` constants where practical.

### Prebuild (do not confuse House with Kaizen donor)

| Model | Rule |
|---|---|
| **SimpleHouse** — committed `ios/`, hand-owned Watch/Widget | Prefer **`expo prebuild` without `--clean`**. Blind `--clean` can wipe companions. |
| **Kaizen donor** — CNG plugins regenerate targets | `--clean` required there; quit Xcode first. |

Port Kaizen-donor **generators**, not its wipe workflow, until House companions are
plugin-owned.

---

## 9. Component layering (maximize reuse)

```
src/
  components/
    ui/       # Button, GlassCard, Avatar, inputs — brand-agnostic, token-driven
    layout/   # TabBar/footer, ScreenHeader, sheets, backgrounds — SHARED shell
  brand/      # token/logo/icon ENGINE (reads active brand) — no per-brand literals
  screens/    # app screens — shared; content/text from config or i18n
  theme/      # tokens.generated + ThemeContext (light/dark)
brands/<b>/   # the ONLY per-app code (see §3)
```

Rule enforced by lint/CI: **no hex, gradient, glyph, or brand string outside
`brands/`, `*.generated.*`, and the token/icon engine.** (We already added a
`.prettierignore`/eslint ignore for generated files; add a lint rule to flag raw
colors in components.)

---

## 10. Dependency roadmap (from the fact-checked audit)

**SimpleHouse today may still be on SDK 54** — upgrade once to **Expo SDK 57 /
RN 0.86 / React 19.2** (Symply Kaizen is already there). Always install with
`npx expo install` (never bare `npm i`).

| Phase | Do | Risk |
|---|---|---|
| **0** | `npx expo install --fix` after SDK 57; hold gesture-handler at ~2.32 — **do not** jump to 3.x | none |
| **1** | `npx expo install expo-image expo-haptics expo-symbols expo-glass-effect` — SF Symbols + Liquid Glass (guard with `isLiquidGlassAvailable()`) | low |
| **2** | Port Kaizen-donor **custom token/icon generators** + DTCG sources; consolidate **one color API + ThemeContext**. **No** Style Dictionary / Unistyles. | low–med |
| **3** | Migrate tabs → `expo-router/unstable-native-tabs`; keep `react-native-bottom-tabs@1.4.0` fallback | med |
| **4** | Opt-in per brand: `@expo/ui` (alpha — wrap it); `expo-live-activity` behind `brand.features` | higher |

**Conflict flags:** ❌ `@bacons/apple-targets` if it fights existing Watch/Widget ownership. ❌ `gesture-handler@3.x`. ⚠️ `@expo/ui` is alpha — wrap it. **House:** do not blind `prebuild --clean`.

---

## 11. "Create a new Simple X app" — the runbook

See also [NEW_BRAND_CHECKLIST.md](./NEW_BRAND_CHECKLIST.md). Platform default brand is **`simple-house`**.

To add **Simple Budget** (brand #2) or any later app:

1. `cp -r brands/simple-house brands/<id>` and edit:
   - `brand.config.ts` — id/name/slug/scheme/bundle IDs/easProjectId + `tabs` + integrations + ios extensions + `features.budget`.
   - `tokens.json` — colors/gradients/backgrounds only (DTCG).
   - `app-icons/` — brand icon package (per icon README).
   - `assets/` — appIcon/splash/adaptive-icon PNGs.
2. Add domain feature modules only if this product needs screens House does not have.
3. Add an EAS build profile + Update channel for `<id>` in `eas.json` with **`APP_BRAND` and `EXPO_PUBLIC_APP_BRAND`**.
4. Generate + build:
   ```bash
   APP_BRAND=<id> npm run design:build      # tokens + icons for this brand
   APP_BRAND=<id> npm run validate:brand
   APP_BRAND=<id> eas build -p ios --profile <id>-production
   ```
No auth/shell forks. Shared fonts, spacing, layout, Login/Google/Apple/Drive, Widget, and Watch stay one implementation.

---

## 12. Migration path from today → template (incremental, low-risk)

Canonical phases: [Brand_Token_Ecosystem_Plan.md](./Brand_Token_Ecosystem_Plan.md).

1. **Platform = SimpleHouse.** Harden `brands/symply-house/`; clear coupling debt (dual colors, hex, tab registry).
2. **Port Kaizen-donor pipeline.** `design:build` + DTCG; **not** Style Dictionary / Unistyles; aim Expo 57.
3. **Make config brand-aware.** `app.config.ts` + generators read `APP_BRAND` (default `simple-house`). Prefer `--no-clean` prebuild. Re-verify Widget + Watch.
4. **Native tabs + shared auth.** Brand tabs; AuthShell; Google/Apple/Drive from `brand.integrations` (EAS secrets).
5. **Second brand = Simple Budget** + Shared User / AI entitlement spine.
6. **Third brand = Symply Kaizen.** Align `BrandConfig` / env / `tabRegistry` first so packs drop in.
7. **Language, then Health.** RN rewrites; Swift repos archived.

---

## 13. Verification (per phase)

- **RN:** `npm run typecheck && npm test`; run `APP_BRAND=<b> npm run design:build`
  and diff generated files; launch on simulator (`expo run:ios`) and screenshot.
- **Two-brand proof:** build `simple-house` and `simple-budget` from the same
  `src/`; confirm House shows minimal budget only and Budget shows the full suite
  (app + widget + watch).
- **AI off / on:** core usable with AI off; entitlement unlocks AI gates.
- **Native tabs / Liquid Glass:** visual check on an iOS 26 simulator; verify SF
  Symbols + glass tab bar; Android Material tabs.
- **Guardrail:** CI lint rule fails on raw hex/glyph/brand-string outside
  `brands/` and generated files.

---

## 14. Open decisions (resolved)

| Topic | Decision |
|---|---|
| Platform vs Kaizen donor | **SimpleHouse** platform; Kaizen donor + brand #3 |
| Simple Budget | Brand #2; House keeps **minimal** budget; full suite in Budget brand |
| Mega-folder of all Desktop apps | **No** for Cursor/AI; optional human archive only |
| Fleet order | House → Simple Budget → Symply Kaizen → Language → Health |
| Token engine | **Custom `build-tokens.mjs` + DTCG** (locked); not Style Dictionary |
| Theming engine | **ThemeContext + one color API** (locked); Unistyles not a milestone |
| Icon emit | Compiled `react-native-svg` Path; avoid SvgXml re-parse |
| Prebuild | House **`--no-clean`**; Kaizen-donor CNG `--clean` is donor-only |
| Env | `APP_BRAND` + `EXPO_PUBLIC_APP_BRAND` on every EAS profile |
| Feature divergence | Feature modules + `brand.tabs`; monorepo only if needed |
| Native tabs | After SDK 57; Callstack fallback documented |
| Shared User / AI | See [Shared_User_Smart_Engine_Research.md](./Shared_User_Smart_Engine_Research.md) |
