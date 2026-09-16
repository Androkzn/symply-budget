# iOS — build, run, and ship a TestFlight build from Xcode

**Goal:** build the latest repo code from Xcode and run it on a real device or
simulator **any time, with zero setup and no Metro dev server** — and Archive the
same build to TestFlight manually. No EAS.

## TL;DR

Every brand scheme **Runs and Archives the identical Release build** (JS bundle
embedded). No `localhost`, no dev server, no network dependency. What you see
running is exactly what you ship.

For a TestFlight upload, jump to [the runbook](#testflight-runbook).

---

## Run the latest on device or simulator

1. Xcode scheme selector → **Symply \<Brand\> (Production)** (prod backend) or
   **(Staging)** (staging backend).
2. Destination → your iPhone *or* any Simulator.
3. **⌘R.** Xcode bundles the current JS, embeds it, installs, and launches.
   Works on any network — even locked-down office Wi-Fi — because nothing talks
   to Metro.

## What each scheme action does

| Action  | Configuration      | JS bundle | Needs Metro? |
|---------|--------------------|-----------|--------------|
| Run     | `Release-<brand>`  | embedded  | **No**       |
| Archive | `Release-<brand>`  | embedded  | **No**       |
| Test    | `Debug-<brand>`    | —         | No           |

Backend is chosen by the scheme's `SIMPLEHOUSE_API_ENV` env var
(`production` / `staging`), **not** by Debug/Release — see
[src/config/env.ts](../../src/config/env.ts). So Release Run still hits the
correct backend for the scheme you picked.

---

## TestFlight runbook

Worked example is **Symply House**; substitute the brand everywhere for others.

> **Do not skip step 1 or step 2.** Step 1 is the only thing that stops you
> discovering a rejected build number after a 20-minute archive; step 2 is the
> only thing that writes this brand's identity into the native tree.

### 1. Check the build number is actually free on TestFlight

```sh
node scripts/ios/check-testflight-build-number.mjs symply-house
```

Read-only, ~2 seconds, App Store Connect **API key** auth (Keychain
`symply.asc.*`) — no Apple ID password, **no 2FA**.

- Exit **0** → the number is free, continue.
- Exit **1** → the number is taken. Bump `iosBuildNumber` in
  [`brands/symply-house/brand.cjs`](../../brands/symply-house/brand.cjs) to the
  number the script suggests, and re-run it. Also bump `SYMPLY_BUILD_NUMBER` in
  [`ios/Brand.xcconfig`](../../ios/Brand.xcconfig) so the committed House
  fallback keeps pace (see [the build-number trap](#the-build-number-trap)).
- Exit **2** → the check itself could not run (no Keychain key / offline).
  Verify by hand in App Store Connect → TestFlight → Builds before continuing.

Build numbers collide **per train**, where a train is the marketing version
(`CFBundleShortVersionString`). Bumping `iosVersion` frees the whole number
space again.

### 2. Prepare the native tree for this brand

```sh
npm run prepare:xcode:house
```

This writes `ios/Brand.generated.xcconfig` (bundle IDs, App Group, display name,
URL schemes, **version + build number**), rewrites
`ios/SymplyEcosystem/Supporting/Expo.plist` (EAS Update project + channel), pins
`ios/.xcode.env.local` to the brand so the JS bundle phase builds the right app,
re-applies the archive patches, and runs `pod install` through
[`scripts/ios/pod.sh`](../../scripts/ios/pod.sh).

Never run bare `pod` / `bundle exec pod`. The resolver enforces
**CocoaPods >= 1.17.0**; below that Expo's `ExpoModulesMacros` Swift macro
plugin is silently omitted from the generated Pods project and the archive dies
compiling `expo-crypto`. That failure is invisible on warm DerivedData.

### 3. Archive

Either the GUI or the CLI — they produce the same artifact.

**Xcode:** scheme **SymplyHouse-Production** → destination **Any iOS Device
(arm64)** → **Product → Archive**.

**CLI:**

```sh
cd ios
xcodebuild archive \
  -workspace SymplyEcosystem.xcworkspace \
  -scheme SymplyHouse-Production \
  -configuration Release-house \
  -destination 'generic/platform=iOS' \
  -archivePath "$HOME/Desktop/SymplyHouse.xcarchive" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=B2ZY5M2YW2
```

A cold archive (empty DerivedData) takes roughly 20–30 minutes — most of it
compiling Pods. Warm re-archives after a build-number bump are far quicker.

`-allowProvisioningUpdates` lets Xcode mint any missing App Store profile. It
uses the Apple ID session already stored in Xcode; if that session has expired
it fails rather than prompting, and a human must re-sign in
(**Xcode → Settings → Accounts**) — see [human-only steps](#human-only-steps).

### 4. Export / upload

**Xcode:** Organizer → **Distribute App → App Store Connect → Upload**.

**CLI export** (produces the `.ipa`; upload still needs credentials):

```sh
cd ios
xcodebuild -exportArchive \
  -archivePath "$HOME/Desktop/SymplyHouse.xcarchive" \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath "$HOME/Desktop/SymplyHouse-export" \
  -allowProvisioningUpdates
```

[`ios/ExportOptions.plist`](../../ios/ExportOptions.plist) is already set to
`method: app-store`, `signingStyle: automatic`, team `B2ZY5M2YW2`. Automatic
signing re-signs the archive with the **distribution** certificate at this step,
which is why the archive itself carrying a development signature is harmless.

### 5. After upload

Processing takes ~5–15 minutes. `ITSAppUsesNonExemptEncryption` is already
`false` in
[`ios/SymplyEcosystem/Info.plist`](../../ios/SymplyEcosystem/Info.plist), so
TestFlight will **not** stop and ask the export-compliance question.

Then assign the build to a group in App Store Connect → TestFlight:

| Group | Type | Notes |
|---|---|---|
| `Symply Internal` | internal | no beta review needed |
| `Symply External POC` | external, public link | needs **Beta App Review** |

---

## The build-number trap

There are **two** places a House build number lives, and they must agree:

| File | Role |
|---|---|
| [`brands/symply-house/brand.cjs`](../../brands/symply-house/brand.cjs) → `iosBuildNumber` | source of truth; `prepare:xcode:house` copies it into the gitignored `ios/Brand.generated.xcconfig` |
| [`ios/Brand.xcconfig`](../../ios/Brand.xcconfig) → `SYMPLY_BUILD_NUMBER` | committed House **fallback**, used whenever `Brand.generated.xcconfig` is absent |

`Brand.generated.xcconfig` is gitignored, so it is absent on a fresh clone and
after `./scripts/prepare-xcode.sh restore`. Archiving in that state silently
uses the `Brand.xcconfig` fallback. When the two drifted apart, that produced a
build number already on TestFlight and the upload failed at the last step with:

```text
ERROR ITMS-4238: "Redundant Binary Upload. There already exists a binary
upload with build version '29' for train '1.0.0'"
```

Keep them in lock-step, and let step 1 of the runbook catch it either way.

> `app.json`'s `ios.buildNumber` is a **third**, unrelated value. It feeds only
> the `expo prebuild` / EAS-managed path, never the committed `ios/` tree that
> this document builds, so it does not affect a manual archive.

---

## Signing reference (House)

| Thing | Value |
|---|---|
| Team | `B2ZY5M2YW2` |
| App | `com.symply.house` |
| Widget | `com.symply.house.widget` |
| Watch app | `com.symply.house.watchkitapp` |
| App Group | `group.com.symply.house` |
| ASC app id | `6790505308` |
| Release entitlements | `aps-environment: production`, Sign in with Apple, App Group, `applinks:simple-house-api[-staging].a-tekhtelev.workers.dev` |

Signing is **automatic** for both Run and Archive. The `Release-<brand>`
configurations carry an explicit `CODE_SIGN_IDENTITY` of `Apple Development` /
`iPhone Developer`, so the **archive** is signed for development — automatic
signing replaces it with the distribution certificate during export, so this
does not block the upload.

---

## "Always the latest code"

Release builds re-bundle JS from the current working tree on **every** build, so
Run and Archive always reflect the latest repo state. (Only native dependency
changes still require step 2's `pod install`.)

### …unless an OTA update overrides it

The archive embeds a JS bundle, but
[`Expo.plist`](../../ios/SymplyEcosystem/Supporting/Expo.plist) also sets
`EXUpdatesCheckOnLaunch = ALWAYS` against channel `symply-house-production` at
runtime version `1.0.0`. `expo-updates` runs whichever bundle is **newer**, so a
freshly built TestFlight build wins on first launch — but any
`eas update --channel symply-house-production` published *afterwards* at the
same runtime version replaces the JS in testers' hands. Don't publish to that
channel mid-test unless you mean to.

`Expo.plist` is **gitignored** and written per-brand by
[`scripts/ios/write-brand-expo-plist.cjs`](../../scripts/ios/write-brand-expo-plist.cjs)
during step 2. If it is missing or stale, the app can ask *another brand's* EAS
Update project for its JS — this has happened. Step 2 fixes it; never hand-edit.

---

## Human-only steps

Everything else in this document is automatable. These are not:

- **Apple ID / 2FA.** If Xcode's Apple ID session has lapsed,
  `-allowProvisioningUpdates` cannot mint profiles. Re-sign in at
  **Xcode → Settings → Accounts** (interactive 2FA).
- **The upload itself.** `Distribute App → Upload`, or `xcrun altool` /
  `notarytool` with an app-specific password or an ASC API key.
- **Assigning the build to a TestFlight group**, and submitting for **Beta App
  Review** for the external group.
- **Paid Applications Agreement** (App Store Connect → Business → Agreements,
  Tax, and Banking). Account-Holder-only, no API. This gates **in-app
  purchases** (all 10 subscription products sit at `MISSING_METADATA` until it
  is signed) — it does **not** gate a TestFlight build.

---

## If you ever want fast live-reload dev (Metro)

This is the *only* mode that needs Metro, so it's opt-in:

1. Edit Scheme → **Run → Build Configuration → `Debug-<brand>`**.
2. `npm start`, then ⌘R.
3. Use a **Simulator** (localhost works natively) or a network where the phone
   can reach the Mac (same Wi-Fi without client isolation, or Personal Hotspot).

---

## Notes

- Release Run builds a little slower than Debug (optimization + JS bundling) —
  that's the trade for zero Metro/network dependence.
- The Watch app target has **no** `CODE_SIGN_ENTITLEMENTS`, so it ships without
  the `group.com.symply.house` App Group that the widget uses to read the auth
  token. Pre-existing on builds 26–29; it does not block an archive.
- Watch app / Widget schemes are otherwise unchanged.
