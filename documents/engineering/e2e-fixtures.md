# E2E upload fixtures — real documents on the simulator

How Symply Ecosystem E2E flows perform **real** document/photo uploads instead
of asserting-and-cancelling the native pickers. One canonical manifest feeds
Maestro flows, Jest, Vitest, backend node tests, and the backend shell
integration scripts.

## Source of truth

- **Binaries** live in `resourses/testing/` at the repo root (real PDFs, images,
  and `.txt` files, grouped by app). They are **not** copied into git elsewhere —
  the machine is disk-constrained and some files are large (25 MB inspection
  report, 8 MB book).
- **Manifest**: [`e2e/fixtures/manifest.json`](../../e2e/fixtures/manifest.json)
  maps a stable logical `key` → the real file, a **sanitized** `name` (spaces,
  double `.pdf.pdf`, and one `.png`-that-is-actually-JPEG are corrected), `mime`,
  `kind` (`image` | `document`), owning `app`, and the upload `targets` it feeds.
- **Resolver**: [`e2e/fixtures/index.js`](../../e2e/fixtures/index.js) (plain
  CommonJS + a `.d.ts`) is the one accessor every runner shares:
  `fixture(key)`, `pickerAsset(key)`, `fixtureText`, `fixtureBytes`,
  `fixtureArrayBuffer`, `fixtureFile`, `listFixtures(app?)`, `fixturesFor(target)`,
  `assertExists`.

Add or change a fixture in one place (the manifest); every consumer follows.

## Two delivery channels onto the simulator

`scripts/e2e/seed-fixtures.sh <UDID> [house|budget|kaizen|all]` stages the real
files onto a booted iOS Simulator, matching how the app's pickers read them:

| `kind`     | Picker in the app                                   | How it's seeded |
|------------|-----------------------------------------------------|-----------------|
| `image`    | `expo-image-picker` / `react-native-image-crop-picker` (Gallery / camera roll) | `xcrun simctl addmedia` → **Photos** library |
| `document` | `expo-document-picker` (`UIDocumentPickerViewController`) | copied into the **Files** app's `com.apple.FileProvider.LocalStorage` → visible under **On My iPhone › SymplyE2E/** and mirrored to the LocalStorage root for picker reliability |

The script normalizes each file to its sanitized `name` first, so picker `type`
filters, Photos, and Maestro selectors all match. It is idempotent.

### Wiring
Every runner seeds automatically right after `simctl boot` (before `maestro
test`):

- `scripts/run-e2e.sh` (House), `scripts/run-e2e-kaizen.sh`,
  `scripts/e2e/run-house-suite.sh`, `run-budget-suite.sh`, `run-kaizen-suite.sh`.
- Opt out with `E2E_SEED_FIXTURES=0`. Override the House runner's app with
  `E2E_SEED_APP=budget` etc.

> First run on a brand-new sim: the Files `LocalStorage` provider may not exist
> until the Files app (or any document picker) has opened once. The seed script
> detects this, warns, and skips document seeding — open a picker once and
> re-run, or just run the E2E suite twice.

## Driving the native pickers in Maestro

Two reusable subflows do the out-of-process picker work:

- [`e2e/maestro/subflows/pick-document-from-files.yaml`](../../e2e/maestro/subflows/pick-document-from-files.yaml)
  — navigates Files → On My iPhone → SymplyE2E and taps the file. Requires env
  `DOC_NAME` (the fixture's sanitized `name`, e.g. `resume.pdf`).
- [`e2e/maestro/subflows/pick-photo-from-library.yaml`](../../e2e/maestro/subflows/pick-photo-from-library.yaml)
  — selects the most-recently-added seeded photo and confirms (handles both the
  PHPicker and the crop-picker confirm screens).

A flow taps its in-app source button (by `testID` — see below — or by the native
action-sheet text), then `runFlow`s the matching subflow, then asserts a real
post-upload marker.

### Picker source `testID`s
House: `reports-source-device`, `onboarding-upload-report-button`,
`floor-plan-source-file` / `-camera`, `garden-plan-source-file` / `-camera`,
`utility-bill-source-file`, `property-tax-source-file`.
Kaizen file panel: `kaizen-upload-source-camera` / `-gallery` / `-file` / `-drive`.
Budget (pre-existing): `budget-receipt-gallery/-file/-scan-button`,
`budget-item-ai-gallery/-file/-generate`, `savings-import-gallery/-file/-analyze`,
`pension-import-pick-file/-analyze`, `chat-room-attach`.

## Known limitations

- **Photo determinism**: the photo subflow taps the *newest* photo, so whichever
  image fixture is seeded **last** for that app is the one picked. Photo flows
  therefore assert a generic "upload succeeded / draft appeared" marker rather
  than content specific to one image. Document flows are fully deterministic
  (picked by filename).
- **New `testID`s require a fresh native build** to appear in the bundle
  (`npm run ios -- --device "<sim>"`).
- The Files-picker UI can shift between iOS versions; the document subflow guards
  every navigation hop and degrades gracefully.

## Non-simulator consumers

- **Jest** (app): `src/test-utils/fixtures.ts` re-exports the resolver; picker
  mocks return `pickerAsset(key)` and text assertions use `fixtureText(key)`.
- **node:test/tsx** (`backend-language/`): imports the shared resolver directly
  for real bytes / text.
- **Vitest** (`backend/`): the Worker runs under **workerd**, whose `fs` proxy
  mangles this repo's spaced path (`Symply Ecosystem` → `%20`) and can't load the
  disk resolver. So `backend/vitest.config.ts` has a `symply-fixtures` Vite plugin
  that reads a curated set of **small** fixtures on the Node host and inlines them
  (base64) into a `virtual:symply-fixtures` module; `backend/src/test-utils/fixtures.ts`
  decodes them behind the same API. Large fixtures (inspection report, book) are
  intentionally excluded from unit tests for speed.
- **Shell integration** (staging/Lambda): `backend/scripts/test-floor-plan-regions-e2e.sh`
  and `backend/lambda-processor/scripts/test-lambda-deployment.sh` resolve their
  default document from the manifest (override with `IMAGE=` / `TEST_PDF=`).
