# New brand checklist

Use this when adding a **Symply Ecosystem** app. **Template parent:** Symply House (`brands/symply-house/`).

Full architecture: [Brand_Token_Ecosystem_Plan.md](./Brand_Token_Ecosystem_Plan.md) · [PROJECT.md](../ecosystem/PROJECT.md) · [WHITELABEL_TEMPLATE.md](./WHITELABEL_TEMPLATE.md) · Watch: [WATCH_SETUP_GUIDE.md](../engineering/watch/WATCH_SETUP_GUIDE.md)

## Fleet order (do not skip)

| # | Brand | Display | Notes |
|---|---|---|---|
| 1 | `simple-house` | Symply House | **Parent / template** — minimal budget |
| 2 | `simple-budget` | Symply Budget | Copy House pack; full budget |
| 3 | `symply-kaizen` | Symply Kaizen | Port from Kaizen donor |
| 4 | `simple-language` | Symply Language | RN rewrite from Swift |
| 5 | `simple-health` | Symply Health | RN rewrite last |

**Project** is Symply Ecosystem (this repo). Legacy Desktop apps are donors only. See [MIGRATION.md](../ecosystem/MIGRATION.md) · [NAMING.md](../ecosystem/NAMING.md).

**Budget:** one `src/features/budget/` module — `brand.features.budget = minimal | full`. Do not fork budget screens.

**Shared User / AI:** all brands use the same account (`user_id`). AI is account-level (`ai.status`); core flows must work with AI off. See [Shared_User_Smart_Engine_Research.md](./Shared_User_Smart_Engine_Research.md).

## 1. Brand pack

1. Copy `brands/symply-house/` → `brands/<id>/` (**House is the template**)
2. Edit:
   - `brand.config.ts` — id/name/slug/scheme/bundle IDs/`easProjectId` + `tabs` (+ `sfSymbol`)
   - `ios` — host, **widget**, **watch**, watch-extension bundle IDs + App Group + team ID
   - `integrations` — Google Auth, Apple Auth, Google Drive client IDs
   - `features.widget` / `features.watch` (default `true`)
   - `tokens.json` — colors/gradients/backgrounds only (never spacing/type)
   - `assets/` — appIcon, splash, logos (Login/Register + companions)
   - optional `app-icons/` — brand glyph pack (feeds widget xcassets)
3. Register in `brands/index.ts` **and** `brands/resolve.cjs` (Expo config-time CJS loader)
4. Keep `brands/<id>/brand.cjs` in sync with `brand.ts` (config cannot import TypeScript packs)
5. If Metro needs new image requires, extend `src/brand/assets.ts`
6. If the product needs domain screens House does not have, add **feature modules** under `src/features/<domain>/` and wire via `brand.tabs` — do not fork the app

Do **not** fork `LoginScreen`, Drive picker, Widget SwiftUI, or Watch SwiftUI.

**Platform baseline:** Expo SDK **57** / RN **0.86**. Never `expo prebuild --clean` on this repo (Watch + Widget). Nested native-stack navigators still need `EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK=1` until migrated.

## 2. OAuth / Apple (phone login + Drive)

- [ ] Google Cloud: OAuth clients for the **new** iOS bundle ID + Android package (Sign-In)
- [ ] Google Cloud: Drive API + Drive OAuth clients
- [ ] Reversed iOS client URL scheme via `app.config.ts` for the brand
- [ ] Apple Developer: App ID + **Sign in with Apple** for the host app
- [ ] Worker: append brand Google audiences to `GOOGLE_SIGNIN_CLIENT_IDS` (staging + production)
- [ ] Drive redirect scheme = `brand.scheme`

## 3. Widget + Apple Watch (required unless features opt out)

- [ ] Apple Developer: App IDs for **Widget extension** + **Watch app** (+ Watch extension if separate)
- [ ] App Group ID matches `brand.ios.appGroup` on host, widget, and watch entitlements
- [ ] EAS / `app.config` `appExtensions` list Watch (and Widget) with brand bundle IDs
- [ ] Run token/icon generators so Swift `BrandTokens` + widget assets match the brand
- [ ] Confirm widget deep links use `brand.scheme` / brand universal links
- [ ] Do **not** blind `expo prebuild --clean` on Symply Ecosystem (repo) (preserves Watch/Widget targets)

## 4. Validate + generate

```sh
APP_BRAND=<id> npm run validate:brand
APP_BRAND=<id> npm run design:build          # tokens + icons → RN + Swift + widget mint sync
# APP_BRAND=<id> npm run sync:widget-theme   # included in design:build; interim until BrandTokens in Xcode
```

## 5. Build / run

```sh
EXPO_PUBLIC_APP_BRAND=<id> APP_BRAND=<id> npx expo start
eas build --profile <id>-production
```

Add matching EAS **build profile** and **Update channel** in `eas.json`.
Profile `env` must set **both** `APP_BRAND` and `EXPO_PUBLIC_APP_BRAND`.

**Prebuild:** on Symply Ecosystem (repo) prefer **without** `--clean` (committed `ios/` + Watch/Widget). Kaizen-donor CNG `--clean` is donor-only — do not copy that wipe onto House.

## 6. Verify shared flows on the new brand

- [ ] Login: brand logo/splash/colors; Google + Apple succeed (**same Shared User account** as other Simple apps when linked)
- [ ] Google Drive picker connects and imports a file
- [ ] **Widget** builds; shows brand accent/name; tap opens brand app
- [ ] **Watch** installs with brand app; auth/tasks sync via `watch-sync`
- [ ] Phone `primary` matches Widget/Watch `BrandTokens`
- [ ] **AI off:** core product usable; no AI chrome / no model traffic
- [ ] **AI on:** AI gates unlock (same account entitlement as other entitled apps)

## Do not change per brand

- Shared tokens base / spacing / type
- Login/Register/Drive implementations
- WidgetKit + Watch SwiftUI trees and RN bridges (`watch-sync`, `widget-sync`)
- Font family (System / SF Pro)
- Shell components (headers, tab chrome, buttons)