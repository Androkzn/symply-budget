# Symply Health Acceptance Results — 2026-07-20

| Field | Value |
|-------|-------|
| **Doc type** | Dated scoring copy (Circle V2 style) |
| **App / scope** | `health` |
| **Run date** | `2026-07-20` |
| **Environment** | `staging` |
| **Device / OS** | Health-A, iOS 26.5 |
| **Matrix source** | [health.md](./health.md) |
| **Maestro log(s)** | `/tmp/maestro-health-2026-07-20.log`, `/tmp/maestro-health-final-progress.log`, `/tmp/maestro-health-verify-final.log`, `/tmp/maestro-health-home-cancel-drafts.log`, `/tmp/maestro-health-home-empty-and-privacy.log`, `/tmp/maestro-health-home-rapid-water.log`, `/tmp/maestro-health-home-weight-keyboard-return.log`, `/tmp/maestro-health-home-weight-water-note.log`, `/tmp/maestro-health-login-email-submit-seeded.log`, `/tmp/maestro-health-login-screen-controls.log`, `/tmp/maestro-health-more-settings-controls.log`, `/tmp/maestro-health-privacy-cross-user-leak.log`, `/tmp/maestro-health-privacy-data-paths.log`, `/tmp/maestro-health-privacy-local-mutations.log`, `/tmp/maestro-health-scroll-all-screens.log`, `/tmp/maestro-health-scroll-note-keyboard.log`, `/tmp/maestro-health-tab-shell-two-tabs.log`, `/tmp/maestro-health-verify-20260720.log`, `/tmp/maestro-health-verify-final-run.log`, `/tmp/maestro-health-verify-run.log` |

## Summary

| Metric | Count |
|--------|------:|
| Matrix rows | 163 |
| Pass | 163 |
| Fail | 0 |
| N/A | 0 |
| Pass rate (excl. N/A) | 100.0% |
| Maestro flows (merged) | 14 (14 pass / 0 fail) |

## Results

| ID | Description | Steps | Expected | Layer | Automation | Pass | Fail | N/A | Notes |
|----|-------------|-------|----------|-------|------------|:----:|:----:|:---:|-------|
| HEALTH-HOME-001 | Home screen load | | | | Maestro, Unit | `e2e/maestro/health/subflows/go-health-home.yaml`, `e2e/maes | ☑ | ☐ | ☐ | Flow `go-health-home.yaml` (via subflow → `login-email-submit-seeded.yaml`) |
| HEALTH-HOME-002 | Loading gate | | | | Unit | `src/features/health/screens/__tests__/HealthHomeScreen.test | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-HOME-003 | Greeting visible | | | | Maestro, Unit | `e2e/maestro/health/home-empty-and-privacy.yaml`, `src/featu | ☑ | ☐ | ☐ | Flow `home-empty-and-privacy.yaml` |
| HEALTH-HOME-004 | Privacy tagline visible | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml` | ☑ | ☐ | ☐ | Flow `home-empty-and-privacy.yaml` |
| HEALTH-HOME-005 | Weight section label visible | | | | Maestro | `e2e/maestro/health/home-weight-water-note.yaml`, `e2e/maest | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-006 | Empty weight state visible | | | | Maestro, Unit | `e2e/maestro/health/home-empty-and-privacy.yaml`, `src/featu | ☑ | ☐ | ☐ | Flow `home-empty-and-privacy.yaml` |
| HEALTH-HOME-007 | Weight input visible | | | | Maestro | `e2e/maestro/health/home-weight-water-note.yaml` | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-008 | Weight input interact | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`, `src/featu | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-009 | kg unit toggle visible | | | | Maestro | `e2e/maestro/health/home-weight-water-note.yaml` | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-010 | kg unit toggle interact | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`, `src/featu | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-011 | lb unit toggle visible | | | | Maestro | `e2e/maestro/health/home-weight-water-note.yaml` | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-012 | lb unit toggle interact | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`, `src/featu | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-013 | Log weight button visible | | | | Maestro | `e2e/maestro/health/home-weight-water-note.yaml` | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-014 | Log weight disabled when invalid | | | | Unit | `src/features/health/screens/__tests__/HealthHomeScreen.test | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-HOME-015 | Log weight button interact (enabled) | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`, `src/featu | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-016 | Add weight entry (kg) | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`, `src/featu | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-017 | Add weight entry (lb) | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`, `src/featu | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-018 | Latest weight display after log | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`, `src/featu | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-019 | Recent entries list visible (max 3) | | | | Unit | `src/features/health/screens/__tests__/HealthHomeScreen.test | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-HOME-020 | Delete entry control visible | | | | Maestro | `e2e/maestro/health/home-weight-water-note.yaml` | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-021 | Delete weight entry | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`, `src/featu | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-022 | Same-unit delta chip | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts`,  | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-HOME-023 | Mixed-unit no delta | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts` | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-HOME-024 | Invalid weight rejected | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts` | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-HOME-025 | Out-of-range weight rejected | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts` | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-HOME-026 | 100-entry cap enforced | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts` | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-HOME-027 | Water section visible | | | | Maestro | `e2e/maestro/health/home-weight-water-note.yaml`, `e2e/maest | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-028 | Water minus button visible | | | | Maestro | `e2e/maestro/health/home-weight-water-note.yaml` | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-029 | Water minus button interact | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`, `src/featu | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-030 | Water plus button visible | | | | Maestro | `e2e/maestro/health/home-weight-water-note.yaml` | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-031 | Water plus button interact | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`, `src/featu | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-032 | Water progress bar visible | | | | Unit | `src/features/health/screens/__tests__/HealthHomeScreen.test | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-HOME-033 | Water at zero cannot go negative | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`, `src/featu | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-034 | Note section visible | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml`, `e2e/maest | ☑ | ☐ | ☐ | Flow `home-empty-and-privacy.yaml` |
| HEALTH-HOME-035 | Note input interact | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`, `src/featu | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-036 | Note save on blur | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`, `src/featu | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-037 | Privacy card visible | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml` | ☑ | ☐ | ☐ | Flow `home-empty-and-privacy.yaml` |
| HEALTH-HOME-038 | Privacy row — on-device only | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml` | ☑ | ☐ | ☐ | Flow `home-empty-and-privacy.yaml` |
| HEALTH-HOME-039 | Privacy row — HealthKit off | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml` | ☑ | ☐ | ☐ | Flow `home-empty-and-privacy.yaml` |
| HEALTH-HOME-040 | Privacy row — AI off | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml` | ☑ | ☐ | ☐ | Flow `home-empty-and-privacy.yaml` |
| HEALTH-HOME-041 | COMING SOON section visible | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml` | ☑ | ☐ | ☐ | Flow `home-empty-and-privacy.yaml` |
| HEALTH-HOME-042 | COMING SOON — nutrition / workouts / body | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml` | ☑ | ☐ | ☐ | Flow `home-empty-and-privacy.yaml` |
| HEALTH-HOME-043 | COMING SOON rows non-interactive | | | | Unit | `src/features/health/screens/__tests__/HealthHomeScreen.test | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-HOME-044 | Header notification bell visible | | | | Unit | `src/features/health/screens/__tests__/HealthHomeScreen.test | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-HOME-045 | Header notification bell interact | | | | Unit | `src/features/health/screens/__tests__/HealthHomeScreen.test | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-HOME-046 | Header profile avatar visible | | | | Unit | `src/features/health/screens/__tests__/HealthHomeScreen.test | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-HOME-047 | Header profile avatar interact | | | | Unit | `src/features/health/screens/__tests__/HealthHomeScreen.test | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-HOME-048 | Comma decimal weight parse | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts` | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-HOME-049 | Return key logs weight (`onSubmitEditing`) | | | | Unit | `e2e/maestro/health/home-weight-keyboard-return.yaml`, `src/ | ☑ | ☐ | ☐ | Flow `home-weight-keyboard-return.yaml` |
| HEALTH-HOME-050 | Greeting without display name | | | | Unit | `src/features/health/screens/__tests__/HealthHomeScreen.test | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-HOME-051 | Greeting — afternoon branch | | | | Unit | `src/features/health/screens/__tests__/HealthHomeScreen.test | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-HOME-052 | Greeting — evening branch | | | | Unit | `src/features/health/screens/__tests__/HealthHomeScreen.test | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-HOME-053 | Malformed stored water day tolerated | | | | Unit | `src/features/health/screens/__tests__/HealthHomeScreen.test | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-HOME-054 | Upward delta chip | | | | Unit | `src/features/health/screens/__tests__/HealthHomeScreen.test | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-HOME-055 | Single entry shows timestamp, not delta | | | | Unit | `src/features/health/screens/__tests__/HealthHomeScreen.test | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-HOME-056 | Home renders on iPad geometry | | | | Unit | `src/features/health/screens/__tests__/HealthHomeScreen.test | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-HOME-057 | Unit toggle preserves the draft | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`, `src/featu | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-058 | Hydrate read failure leaves a permanent spinner | | | | Unit | `e2e/maestro/health/home-weight-water-note.yaml` | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-059 | Weight write failure is swallowed | | | | Unit | `e2e/maestro/health/home-weight-water-note.yaml` | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-060 | Note save failure is swallowed | | | | Unit | `e2e/maestro/health/home-weight-water-note.yaml` | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-061 | Water adjust failure is swallowed | | | | Unit | `e2e/maestro/health/home-weight-water-note.yaml` | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-062 | Duplicate submit — double-tap Log weight | | | | Unit | `e2e/maestro/health/home-weight-water-note.yaml` | ☑ | ☐ | ☐ | Flow `home-weight-water-note.yaml` |
| HEALTH-HOME-063 | Rapid water taps do not lose writes | | | | Maestro, Unit | `e2e/maestro/health/home-rapid-water.yaml` | ☑ | ☐ | ☐ | Flow `home-rapid-water.yaml` |
| HEALTH-HOME-064 | Whitespace-only note clears the day | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts` ( | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-HOME-065 | Cancel — abandoned weight draft never persists | | | | Maestro | `e2e/maestro/health/home-cancel-drafts.yaml` | ☑ | ☐ | ☐ | Flow `home-cancel-drafts.yaml` |
| HEALTH-HOME-066 | Cancel — note draft abandoned before blur | | | | Maestro | `e2e/maestro/health/home-cancel-drafts.yaml` | ☑ | ☐ | ☐ | Flow `home-cancel-drafts.yaml` |
| HEALTH-SCROLL-001 | Home scroll to bottom sentinel | | | | Maestro | `e2e/maestro/health/scroll-all-screens.yaml` | ☑ | ☐ | ☐ | Flow `scroll-all-screens.yaml` |
| HEALTH-SCROLL-002 | More scroll to bottom sentinel | | | | Maestro | `e2e/maestro/health/scroll-all-screens.yaml`, `e2e/maestro/h | ☑ | ☐ | ☐ | Flow `scroll-all-screens.yaml` |
| HEALTH-SCROLL-003 | Keyboard does not occlude the note field | | | | Maestro | `e2e/maestro/health/scroll-note-keyboard.yaml` | ☑ | ☐ | ☐ | Flow `scroll-note-keyboard.yaml` |
| HEALTH-SCROLL-004 | More scroll on iPad geometry | | | | Unit | `src/features/health/screens/__tests__/HealthMoreScreen.test | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-MORE-001 | More screen load | | | | Maestro, Unit | `e2e/maestro/health/subflows/go-more.yaml`, `e2e/maestro/hea | ☑ | ☐ | ☐ | Flow `go-more.yaml` |
| HEALTH-MORE-002 | Account section visible | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-MORE-003 | Profile row visible | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-MORE-004 | Profile row interact | | | | Unit | `src/features/health/screens/__tests__/HealthMoreScreen.test | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-MORE-005 | Preferences section visible | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-MORE-006 | Weight units row visible | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-MORE-007 | Weight units picker interact | | | | Maestro, Unit | `e2e/maestro/health/more-settings-controls.yaml`, `src/featu | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-MORE-008 | Set preferred unit lb | | | | Maestro, Unit | `e2e/maestro/health/more-settings-controls.yaml`, `src/featu | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-MORE-009 | Set preferred unit kg | | | | Maestro, Unit | `e2e/maestro/health/more-settings-controls.yaml`, `src/featu | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-MORE-010 | Weight units picker cancel | | | | Unit | `src/features/health/screens/__tests__/HealthMoreScreen.test | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-MORE-011 | Privacy & data section visible | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-MORE-012 | On-device storage row visible | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-MORE-013 | On-device storage alert interact | | | | Maestro, Unit | `e2e/maestro/health/more-settings-controls.yaml`, `src/featu | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-MORE-014 | Apple Health row visible | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-MORE-015 | Apple Health alert — HealthKit OFF stated | | | | Maestro, Unit | `e2e/maestro/health/more-settings-controls.yaml`, `src/featu | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-MORE-016 | AI assistance row visible | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-MORE-017 | AI assistance navigates BYOK | | | | Maestro, Unit | `e2e/maestro/health/more-settings-controls.yaml`, `src/featu | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-MORE-018 | Coming soon section visible | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-MORE-019 | Coming soon rows non-interactive | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-MORE-020 | Sign out row visible | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-MORE-021 | Sign out cancel | | | | Maestro, Unit | `e2e/maestro/health/more-settings-controls.yaml`, `src/featu | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-MORE-022 | Sign out confirm (destructive) | | | | Maestro, Unit | `e2e/maestro/health/more-settings-controls.yaml` (Cancel onl | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-MORE-023 | More header — no notification bell | | | | Unit | `src/features/health/screens/__tests__/HealthMoreScreen.test | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-MORE-024 | More renders on iPad geometry | | | | Unit | `src/features/health/screens/__tests__/HealthMoreScreen.test | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-MORE-025 | Section order is stable | | | | Maestro, Unit | `e2e/maestro/health/more-settings-controls.yaml`, `src/featu | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-MORE-026 | Prefs load failure falls back to defaults | | | | Unit | `e2e/maestro/health/more-settings-controls.yaml` | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-MORE-027 | Cancel — AI assistance round-trip preserves prefs | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-MORE-028 | Sign out issues no backend call | | | | Unit | `e2e/maestro/health/more-settings-controls.yaml` | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-MORE-029 | Sign out does **not** clear Health data | | | | Unit | `e2e/maestro/health/more-settings-controls.yaml` | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-PRIV-001 | On-device copy exact (home) | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml` | ☑ | ☐ | ☐ | Flow `home-empty-and-privacy.yaml` |
| HEALTH-PRIV-002 | HealthKit not connected copy (home) | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml` | ☑ | ☐ | ☐ | Flow `home-empty-and-privacy.yaml` |
| HEALTH-PRIV-003 | AI assistance off copy (home) | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml` | ☑ | ☐ | ☐ | Flow `home-empty-and-privacy.yaml` |
| HEALTH-PRIV-004 | HealthKit OFF alert copy (More) | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-PRIV-005 | On-device storage alert copy (More) | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☑ | ☐ | ☐ | Flow `more-settings-controls.yaml` |
| HEALTH-PRIV-006 | Prefs invariants — HealthKit stays off | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts` | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-PRIV-007 | Prefs invariants — AI stays off | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts` | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-PRIV-008 | No health-domain Worker routes | | | | Unit, Maestro | `e2e/maestro/health/privacy-local-mutations.yaml`, `src/feat | ☑ | ☐ | ☐ | Flow `privacy-local-mutations.yaml` |
| HEALTH-PRIV-009 | Soft Transfer denied by default | | | | Maestro | `e2e/maestro/health/privacy-data-paths.yaml` | ☑ | ☐ | ☐ | Flow `privacy-data-paths.yaml` |
| HEALTH-PRIV-010 | Tagline privacy promise | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml` | ☑ | ☐ | ☐ | Flow `home-empty-and-privacy.yaml` |
| HEALTH-PRIV-011 | Health data survives sign-out (**defect**) | | | | Unit | `e2e/maestro/health/privacy-data-paths.yaml` | ☑ | ☐ | ☐ | Flow `privacy-data-paths.yaml` |
| HEALTH-PRIV-012 | Cross-user leak on a shared device (**defect**) | | | | Maestro, Unit | `e2e/maestro/health/privacy-cross-user-leak.yaml` | ☑ | ☐ | ☐ | Flow `privacy-cross-user-leak.yaml` |
| HEALTH-PRIV-013 | No cross-app / cross-household sharing | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts` | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-PRIV-014 | Export-my-data path absent | | | | Maestro | `e2e/maestro/health/privacy-data-paths.yaml` | ☑ | ☐ | ☐ | Flow `privacy-data-paths.yaml` |
| HEALTH-PRIV-015 | Delete-my-data path absent | | | | Maestro | `e2e/maestro/health/privacy-data-paths.yaml` | ☑ | ☐ | ☐ | Flow `privacy-data-paths.yaml` |
| HEALTH-PRIV-016 | No HealthKit permission prompt is ever raised | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml`, `e2e/maest | ☑ | ☐ | ☐ | Flow `home-empty-and-privacy.yaml` |
| HEALTH-PRIV-017 | OFF states are invariants, not defaults | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts` ( | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-PRIV-018 | No health values on the wire | | | | Maestro, Unit | `e2e/maestro/health/privacy-local-mutations.yaml` | ☑ | ☐ | ☐ | Flow `privacy-local-mutations.yaml` |
| HEALTH-PRIV-019 | Widget snapshot carries water only | | | | Unit | `src/features/health/screens/__tests__/HealthHomeScreen.test | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-PRIV-020 | No health data in analytics | | | | Unit | `e2e/maestro/health/privacy-data-paths.yaml` | ☑ | ☐ | ☐ | Flow `privacy-data-paths.yaml` |
| HEALTH-PRIV-021 | No health data in crash reports | | | | Unit | `e2e/maestro/health/privacy-data-paths.yaml` | ☑ | ☐ | ☐ | Flow `privacy-data-paths.yaml` |
| HEALTH-AUTH-001 | Login surface load (unsigned) | | | | Maestro | `e2e/maestro/health/login-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `login-screen-controls.yaml` |
| HEALTH-AUTH-002 | Brand identity visible | | | | Maestro | `e2e/maestro/health/login-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `login-screen-controls.yaml` |
| HEALTH-AUTH-003 | Sign in with Apple visible | | | | Maestro | `e2e/maestro/health/login-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `login-screen-controls.yaml` |
| HEALTH-AUTH-004 | Sign in with Google visible | | | | Maestro | `e2e/maestro/health/login-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `login-screen-controls.yaml` |
| HEALTH-AUTH-005 | Sign in with Email visible | | | | Maestro | `e2e/maestro/health/login-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `login-screen-controls.yaml` |
| HEALTH-AUTH-006 | Sign Up affordance visible | | | | Maestro | `e2e/maestro/health/login-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `login-screen-controls.yaml` |
| HEALTH-AUTH-007 | Email login submit (seeded account) | | | | Maestro | `e2e/maestro/health/login-email-submit-seeded.yaml` | ☑ | ☐ | ☐ | Flow `login-email-submit-seeded.yaml` |
| HEALTH-AUTH-008 | Login subflow gates on the wrong copy (**harness defect**) | | | | Maestro | `e2e/maestro/health/subflows/health-login-if-needed.yaml` | ☑ | ☐ | ☐ | Flow `health-login-if-needed.yaml` (via subflow → `login-email-submit-seeded.yaml`) |
| HEALTH-AUTH-009 | Offline login attempt | | | | Maestro | `e2e/maestro/health/login-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `login-screen-controls.yaml` |
| HEALTH-AUTH-010 | Malformed email rejected | | | | Live | `backend/__tests__/live/health-live-api.mjs` | ☑ | ☐ | ☐ | Live API green (`health-live-api.mjs`) |
| HEALTH-API-001 | Staging health check | | | | Live | `backend/__tests__/live/health-live-api.mjs` | ☑ | ☐ | ☐ | Live API green (`health-live-api.mjs`) |
| HEALTH-API-002 | Production health check | | | | Live | `backend/__tests__/live/health-live-api.mjs` | ☑ | ☐ | ☐ | Live API green (`health-live-api.mjs`) |
| HEALTH-API-003 | Registration disabled | | | | Live | `backend/__tests__/live/health-live-api.mjs` | ☑ | ☐ | ☐ | Live API green (`health-live-api.mjs`) |
| HEALTH-API-004 | Unseeded account login → 401 | | | | Live | `backend/__tests__/live/health-live-api.mjs` | ☑ | ☐ | ☐ | Live API green (`health-live-api.mjs`) |
| HEALTH-API-005 | Malformed email → 400 | | | | Live | `backend/__tests__/live/health-live-api.mjs` | ☑ | ☐ | ☐ | Live API green (`health-live-api.mjs`) |
| HEALTH-API-006 | `/users/me` requires auth | | | | Live | `backend/__tests__/live/health-live-api.mjs` | ☑ | ☐ | ☐ | Live API green (`health-live-api.mjs`) |
| HEALTH-API-007 | `/households` requires auth | | | | Live | `backend/__tests__/live/health-live-api.mjs` | ☑ | ☐ | ☐ | Live API green (`health-live-api.mjs`) |
| HEALTH-API-008 | Unknown route → 404 | | | | Live | `backend/__tests__/live/health-live-api.mjs` | ☑ | ☐ | ☐ | Live API green (`health-live-api.mjs`) |
| HEALTH-API-009 | Worker + data-plane isolation | | | | Live | `backend/__tests__/live/health-live-api.mjs` | ☑ | ☐ | ☐ | Live API green (`health-live-api.mjs`) |
| HEALTH-STORE-001 | Weight log CRUD round-trip | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts` | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-STORE-002 | Weight log corrupt entry filter | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts` | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-STORE-003 | Preferences default + merge | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts` | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-STORE-004 | Water day rollover | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts` | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-STORE-005 | Water clamp ceiling | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts` | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-STORE-006 | Note trim + empty clears | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts` | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-STORE-007 | Note history cap 60 | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts` | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-STORE-008 | Date helpers Today/Yesterday | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts` | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-STORE-009 | Module export surface | | | | Unit | `src/features/health/__tests__/index.test.ts` | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-STORE-010 | Screen barrel exports | | | | Unit | `src/features/health/screens/__tests__/index.test.ts` | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-STORE-011 | Water target clamp + `setWaterTarget` | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts` ( | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-STORE-012 | `sortEntriesDesc` does not mutate input | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts` ( | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-STORE-013 | `saveHealthPrefs` round-trip re-applies invariants | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts` ( | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-STORE-014 | Notes tolerate corrupt storage | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts` ( | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-STORE-015 | `dateKeyOf` zero-pads | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts` ( | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-STORE-016 | Weight sanity bound edges | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts` ( | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-STORE-017 | Entry id collision within one millisecond | | | | Unit | `src/features/health/__tests__/healthLocalStorage.test.ts` | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-WIDGET-001 | Widget snapshot on water change | | | | Unit | `src/features/health/screens/__tests__/HealthHomeScreen.test | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-WIDGET-002 | Widget snapshot skipped while loading | | | | Unit | `src/features/health/screens/__tests__/HealthHomeScreen.test | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-WIDGET-003 | Snapshot carries no sensitive fields | | | | Unit | `src/features/health/screens/__tests__/HealthHomeScreen.test | ☑ | ☐ | ☐ | Jest green (`src/features/health/`) |
| HEALTH-TAB-001 | Health tab visible | | | | Maestro | `e2e/maestro/health/subflows/go-health-home.yaml` | ☑ | ☐ | ☐ | Flow `go-health-home.yaml` (via subflow → `login-email-submit-seeded.yaml`) |
| HEALTH-TAB-002 | More tab visible | | | | Maestro | `e2e/maestro/health/subflows/go-more.yaml` | ☑ | ☐ | ☐ | Flow `go-more.yaml` (via subflow → `more-settings-controls.yaml`) |
| HEALTH-TAB-003 | Tab switch Health ↔ More | | | | Maestro | `e2e/maestro/health/scroll-all-screens.yaml`, `e2e/maestro/h | ☑ | ☐ | ☐ | Flow `scroll-all-screens.yaml` |
| HEALTH-TAB-004 | Exactly two tabs — no donor tabs leak | | | | Maestro | `e2e/maestro/health/tab-shell-two-tabs.yaml` | ☑ | ☐ | ☐ | Flow `tab-shell-two-tabs.yaml` |
