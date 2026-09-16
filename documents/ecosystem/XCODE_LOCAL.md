# Local Xcode builds — Symply House / Budget / Kaizen / Language / Health

One native project (`ios/SymplyEcosystem.xcodeproj`). Each storefront is a **separate product FE** via brand pack + Metro + scheme (own bundle ID, API host, tabs, features).

## One-time

- Xcode + device signing team set
- Apple App IDs / profiles for each brand (House already shipping)
- Pods: `cd ios && ../scripts/ios/pod.sh install`
- **Path with spaces:** Expo/RN Archive scripts break when the repo lives under `…/Symply Ecosystem/…`. Use the no-space symlink:

```bash
ln -sfn "$HOME/Desktop/Symply Ecosystem/Simply Ecosystem" "$HOME/Desktop/symply-ecosystem"
cd "$HOME/Desktop/symply-ecosystem"
```

```bash
npm run verify:apps   # readiness smoke-check
```

## Manual Xcode Run / Archive (scheme-first)

Brand identity is on **per-brand build configurations** (`Debug-kaizen`, `Release-budget`, …). Selecting a brand scheme is enough — you do **not** need `prepare:xcode:*` before each build.

```bash
npm run start:kaizen          # Metro must match the scheme brand
open ios/SymplyEcosystem.xcworkspace
# Scheme → SymplyKaizen-Staging|Production → Run or Product → Archive
```

| Brand | Metro | Scheme (Production) | Configs | Bundle ID |
|-------|-------|---------------------|---------|-----------|
| House | `start:house` | SymplyHouse-Production | `Debug-house` / `Release-house` | `com.symply.house` |
| Budget | `start:budget` | SymplyBudget-Production | `Debug-budget` / `Release-budget` | `com.symply.budget` |
| Kaizen | `start:kaizen` | SymplyKaizen-Production | `Debug-kaizen` / `Release-kaizen` | `com.symply.kaizen` |
| Language | `start:language` | SymplyLanguage-Production | `Debug-language` / `Release-language` | `com.symply.language` |
| Health | `start:health` | SymplyHealth-Production | `Debug-health` / `Release-health` | `com.symply.health` |

Each brand scheme’s pre-action pins `ios/.xcode.env.local` and rebuilds widget tokens for that brand (JS bundle + widget). Native bundle ID / icon / display name come from the scheme’s build configuration.

Legacy `Debug` / `Release` stay House defaults for EAS/CI.

### When you still need `prepare:xcode:*`

- First-time / pods out of sync: `cd ios && ../scripts/ios/pod.sh install` (or full `npm run prepare:xcode:<brand>`)
- CLI archive helpers that call prepare under the hood
- Regenerating brand configs after adding a brand: `ruby scripts/ios/ensure-brand-configurations.rb` then `cd ios && ../scripts/ios/pod.sh install`

```bash
npm run prepare:xcode:restore   # optional: drop Brand.generated.xcconfig → House defaults
```

## CLI Archive → IPA

From the **symlink** path:

```bash
cd "$HOME/Desktop/symply-ecosystem"
./scripts/archive-brand.sh simple-house production   # → ios/build/archives/…/export/*.ipa
./scripts/archive-brand.sh simple-budget production
./scripts/archive-brand.sh symply-kaizen production
```

Then upload each IPA with **Transporter** / Xcode Organizer → Distribute → TestFlight.

## APIs

| Brand | Worker | Money |
|-------|--------|-------|
| House | `simple-house-api…` | `/home-budget/*` only |
| Budget | `simple-budget-api…` | Full `/budget|/savings|/wishes` |
| Kaizen | `symply-kaizen-api…` | Off |

## Notes

- IPA filename may still be `SymplyEcosystem.ipa` (Xcode target name); **bundle ID inside is brand-specific**.
- Archive sets `EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK=1` and `SENTRY_DISABLE_AUTO_UPLOAD=true`.
- Do not commit a hand-patched `ios/` tree for a single brand — identity lives in committed brand configs + gitignored `.xcode.env.local` / `Brand.generated.xcconfig`.
