# Symply Health Acceptance Results — 2026-07-18

| Field | Value |
|-------|-------|
| **App / scope** | `health` |
| **Run date** | `2026-07-18` |
| **Environment** | `staging` |
| **Device / OS** | Kaizen-A, iOS 26.5 |
| **Matrix source** | [health.md](./health.md) |
| **Maestro log** | `/tmp/maestro-health-2026-07-18.log` |

## Summary

| Metric | Count |
|--------|------:|
| Maestro rows | 85 |
| Pass | 0 |
| Fail | 0 |
| N/A | 85 |
| Pass rate (excl. N/A) | — |

## Results

| ID | Description | Steps | Expected | Layer | Automation | Pass | Fail | N/A | Notes |
|----|-------------|-------|----------|-------|------------|:----:|:----:|:---:|-------|
| HEALTH-HOME-001 | Home screen load | | | | Maestro, Unit | `e2e/maestro/health/subflows/go-health-home.yaml`, | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-003 | Greeting visible | | | | Maestro, Unit | `e2e/maestro/health/home-empty-and-privacy.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-004 | Privacy tagline visible | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-005 | Weight section label visible | | | | Maestro | `e2e/maestro/health/home-weight-water-note.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-006 | Empty weight state visible | | | | Maestro, Unit | `e2e/maestro/health/home-empty-and-privacy.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-007 | Weight input visible | | | | Maestro | `e2e/maestro/health/home-weight-water-note.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-008 | Weight input interact | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-009 | kg unit toggle visible | | | | Maestro | `e2e/maestro/health/home-weight-water-note.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-010 | kg unit toggle interact | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-011 | lb unit toggle visible | | | | Maestro | `e2e/maestro/health/home-weight-water-note.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-012 | lb unit toggle interact | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-013 | Log weight button visible | | | | Maestro | `e2e/maestro/health/home-weight-water-note.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-015 | Log weight button interact (enabled) | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-016 | Add weight entry (kg) | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-017 | Add weight entry (lb) | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-018 | Latest weight display after log | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-020 | Delete entry control visible | | | | Maestro | `e2e/maestro/health/home-weight-water-note.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-021 | Delete weight entry | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-027 | Water section visible | | | | Maestro | `e2e/maestro/health/home-weight-water-note.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-028 | Water minus button visible | | | | Maestro | `e2e/maestro/health/home-weight-water-note.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-029 | Water minus button interact | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-030 | Water plus button visible | | | | Maestro | `e2e/maestro/health/home-weight-water-note.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-031 | Water plus button interact | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-033 | Water at zero cannot go negative | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-034 | Note section visible | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-035 | Note input interact | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-036 | Note save on blur | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-037 | Privacy card visible | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-038 | Privacy row — on-device only | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-039 | Privacy row — HealthKit off | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-040 | Privacy row — AI off | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-041 | COMING SOON section visible | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-042 | COMING SOON — nutrition / workouts / body | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-057 | Unit toggle preserves the draft | | | | Maestro, Unit | `e2e/maestro/health/home-weight-water-note.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-063 | Rapid water taps do not lose writes | | | | Maestro, Unit | `e2e/maestro/health/home-rapid-water.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-065 | Cancel — abandoned weight draft never persists | | | | Maestro | `e2e/maestro/health/home-cancel-drafts.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-HOME-066 | Cancel — note draft abandoned before blur | | | | Maestro | `e2e/maestro/health/home-cancel-drafts.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-SCROLL-001 | Home scroll to bottom sentinel | | | | Maestro | `e2e/maestro/health/scroll-all-screens.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-SCROLL-002 | More scroll to bottom sentinel | | | | Maestro | `e2e/maestro/health/scroll-all-screens.yaml`, `e2e | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-SCROLL-003 | Keyboard does not occlude the note field | | | | Maestro | `e2e/maestro/health/scroll-note-keyboard.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-MORE-001 | More screen load | | | | Maestro, Unit | `e2e/maestro/health/subflows/go-more.yaml`, `e2e/m | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-MORE-002 | Account section visible | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-MORE-003 | Profile row visible | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-MORE-005 | Preferences section visible | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-MORE-006 | Weight units row visible | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-MORE-007 | Weight units picker interact | | | | Maestro, Unit | `e2e/maestro/health/more-settings-controls.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-MORE-008 | Set preferred unit lb | | | | Maestro, Unit | `e2e/maestro/health/more-settings-controls.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-MORE-009 | Set preferred unit kg | | | | Maestro, Unit | `e2e/maestro/health/more-settings-controls.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-MORE-011 | Privacy & data section visible | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-MORE-012 | On-device storage row visible | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-MORE-013 | On-device storage alert interact | | | | Maestro, Unit | `e2e/maestro/health/more-settings-controls.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-MORE-014 | Apple Health row visible | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-MORE-015 | Apple Health alert — HealthKit OFF stated | | | | Maestro, Unit | `e2e/maestro/health/more-settings-controls.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-MORE-016 | AI assistance row visible | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-MORE-017 | AI assistance navigates BYOK | | | | Maestro, Unit | `e2e/maestro/health/more-settings-controls.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-MORE-018 | Coming soon section visible | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-MORE-019 | Coming soon rows non-interactive | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-MORE-020 | Sign out row visible | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-MORE-021 | Sign out cancel | | | | Maestro, Unit | `e2e/maestro/health/more-settings-controls.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-MORE-022 | Sign out confirm (destructive) | | | | Maestro, Unit | `e2e/maestro/health/more-settings-controls.yaml` ( | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-MORE-025 | Section order is stable | | | | Maestro, Unit | `e2e/maestro/health/more-settings-controls.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-MORE-027 | Cancel — AI assistance round-trip preserves prefs | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-PRIV-001 | On-device copy exact (home) | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-PRIV-002 | HealthKit not connected copy (home) | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-PRIV-003 | AI assistance off copy (home) | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-PRIV-004 | HealthKit OFF alert copy (More) | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-PRIV-005 | On-device storage alert copy (More) | | | | Maestro | `e2e/maestro/health/more-settings-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-PRIV-008 | No health-domain Worker routes | | | | Unit, Maestro | `e2e/maestro/health/privacy-local-mutations.yaml`, | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-PRIV-010 | Tagline privacy promise | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-PRIV-012 | Cross-user leak on a shared device (**defect**) | | | | Maestro, Unit | `e2e/maestro/health/privacy-cross-user-leak.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-PRIV-014 | Export-my-data path absent | | | | Maestro | `e2e/maestro/health/privacy-data-paths.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-PRIV-015 | Delete-my-data path absent | | | | Maestro | `e2e/maestro/health/privacy-data-paths.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-PRIV-016 | No HealthKit permission prompt is ever raised | | | | Maestro | `e2e/maestro/health/home-empty-and-privacy.yaml`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-PRIV-018 | No health values on the wire | | | | Maestro, Unit | `e2e/maestro/health/privacy-local-mutations.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-AUTH-001 | Login surface load (unsigned) | | | | Maestro | `e2e/maestro/health/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-AUTH-002 | Brand identity visible | | | | Maestro | `e2e/maestro/health/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-AUTH-003 | Sign in with Apple visible | | | | Maestro | `e2e/maestro/health/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-AUTH-004 | Sign in with Google visible | | | | Maestro | `e2e/maestro/health/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-AUTH-005 | Sign in with Email visible | | | | Maestro | `e2e/maestro/health/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-AUTH-006 | Sign Up affordance visible | | | | Maestro | `e2e/maestro/health/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-AUTH-008 | Login subflow gates on the wrong copy (**harness defect**) | | | | Maestro | `e2e/maestro/health/subflows/health-login-if-neede | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-TAB-001 | Health tab visible | | | | Maestro | `e2e/maestro/health/subflows/go-health-home.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-TAB-002 | More tab visible | | | | Maestro | `e2e/maestro/health/subflows/go-more.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-TAB-003 | Tab switch Health ↔ More | | | | Maestro | `e2e/maestro/health/scroll-all-screens.yaml`, `e2e | ☐ | ☐ | ☑ | Suite not run or log missing |
| HEALTH-TAB-004 | Exactly two tabs — no donor tabs leak | | | | Maestro | `e2e/maestro/health/tab-shell-two-tabs.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
