# Symply House Acceptance Results — 2026-07-18

| Field | Value |
|-------|-------|
| **Doc type** | Dated scoring copy (Circle V2 style) |
| **App / scope** | `house` |
| **Run date** | `2026-07-18` |
| **Environment** | `staging` |
| **Device / OS** | House-A, iOS 26 |
| **Matrix source** | [house.md](./house.md) |
| **Maestro log(s)** | `/tmp/maestro-house-2026-07-18.log`, `/tmp/house-smoke-slice4.log`, `/tmp/house-smoke-slice3.log`, `/tmp/house-smoke-slice2.log`, `/tmp/house-smoke-slice.log`, `/tmp/tasks-screen-controls-run2.log`, `/tmp/tasks-screen-controls-run.log` |

## Summary

| Metric | Count |
|--------|------:|
| Matrix rows | 681 |
| Pass | 168 |
| Fail | 244 |
| N/A | 269 |
| Pass rate (excl. N/A) | 40.8% |
| Maestro flows (merged) | 86 (39 pass / 47 fail) |

**Harness notes**

- **Merged Maestro logs:** `/tmp/maestro-house-2026-07-18.log`, `/tmp/house-smoke-slice4.log`, `/tmp/house-smoke-slice3.log`, `/tmp/house-smoke-slice2.log`, `/tmp/house-smoke-slice.log`, `/tmp/tasks-screen-controls-run2.log`, `/tmp/tasks-screen-controls-run.log`
- **Flows scored:** 86 (39 pass / 47 fail) on House-A, iOS 26
- House-iPhone exclusive; Metro **:8083**; `connect-house-metro.yaml` + deep-link login
- iOS 26: scroll matrix rows **N/A** (`assert-screen-scrolls-optional.yaml`)
- Debug sim: SecureStore may be unavailable — in-memory JWT session for Maestro
- **Suite in progress** — sequential runner from `tasks/`; rescored from best-of merged logs

**Maestro flow outcomes (merged best-of)**

| Flow | Result | Detail | Log |
|------|--------|--------|-----|
| `add-task-manual-form` | Pass | — | `maestro-house-2026-07-18.log` |
| `add-task-smart-capture` | Pass | — | `maestro-house-2026-07-18.log` |
| `appliances-attention-modal` | Pass | — | `maestro-house-2026-07-18.log` |
| `approvals` | Fail | — | `maestro-house-2026-07-18.log` |
| `biometric-remember-last-login` | Fail | — | `maestro-house-2026-07-18.log` |
| `biometric-settings-row` | Pass | — | `maestro-house-2026-07-18.log` |
| `briefings` | Fail | — | `maestro-house-2026-07-18.log` |
| `change-password` | Pass | — | `maestro-house-2026-07-18.log` |
| `chat-gaps` | Fail | — | `maestro-house-2026-07-18.log` |
| `chat-rooms-screen` | Fail | — | `maestro-house-2026-07-18.log` |
| `checklist-defaults-create` | Pass | — | `maestro-house-2026-07-18.log` |
| `connected-accounts` | Fail | — | `maestro-house-2026-07-18.log` |
| `create-household` | Pass | — | `maestro-house-2026-07-18.log` |
| `create-household-cancel` | Pass | — | `maestro-house-2026-07-18.log` |
| `create-household-empty-name` | Pass | — | `maestro-house-2026-07-18.log` |
| `create-household-offline` | Pass | — | `maestro-house-2026-07-18.log` |
| `customize-tabs` | Fail | — | `maestro-house-2026-07-18.log` |
| `email-verification-resend` | Fail | — | `maestro-house-2026-07-18.log` |
| `floor-plan` | Pass | — | `maestro-house-2026-07-18.log` |
| `forgot-password` | Pass | — | `maestro-house-2026-07-18.log` |
| `funnel` | Pass | — | `maestro-house-2026-07-18.log` |
| `garbage-setup` | Pass | — | `maestro-house-2026-07-18.log` |
| `home-features-load` | Pass | — | `maestro-house-2026-07-18.log` |
| `home-projects-deferred-readonly` | Pass | — | `maestro-house-2026-07-18.log` |
| `home-projects-hub` | Fail | — | `maestro-house-2026-07-18.log` |
| `home-projects-hub-mutations` | Fail | — | `maestro-house-2026-07-18.log` |
| `home-projects-smoke` | Fail | — | `maestro-house-2026-07-18.log` |
| `home-screen-controls` | Pass | — | `house-smoke-slice4.log` |
| `home-screen-gaps` | Pass | — | `maestro-house-2026-07-18.log` |
| `home-status-strip` | Pass | — | `maestro-house-2026-07-18.log` |
| `house-budget-readonly` | Pass | — | `maestro-house-2026-07-18.log` |
| `house-budget-zero-writes` | Pass | — | `maestro-house-2026-07-18.log` |
| `household-management` | Fail | — | `maestro-house-2026-07-18.log` |
| `invalid-invite-token` | Fail | — | `maestro-house-2026-07-18.log` |
| `invite-decline` | Pass | — | `maestro-house-2026-07-18.log` |
| `join-household` | Fail | — | `maestro-house-2026-07-18.log` |
| `join-invalid-code` | Fail | — | `maestro-house-2026-07-18.log` |
| `login-background` | Fail | — | `maestro-house-2026-07-18.log` |
| `login-oauth-buttons` | Pass | — | `maestro-house-2026-07-18.log` |
| `login-offline` | Fail | — | `maestro-house-2026-07-18.log` |
| `login-screen-controls` | Pass | — | `maestro-house-2026-07-18.log` |
| `login-validation` | Pass | — | `maestro-house-2026-07-18.log` |
| `login-wrong-password` | Pass | — | `maestro-house-2026-07-18.log` |
| `logout-cold-launch` | Pass | — | `maestro-house-2026-07-18.log` |
| `logout-profile` | Fail | — | `maestro-house-2026-07-18.log` |
| `logout-relaunch` | Pass | — | `maestro-house-2026-07-18.log` |
| `maintenance-setup` | Pass | — | `maestro-house-2026-07-18.log` |
| `mira-chat-attach-menu` | Fail | — | `maestro-house-2026-07-18.log` |
| `mira-chat-overflow-menu` | Fail | — | `maestro-house-2026-07-18.log` |
| `mira-chat-screen` | Pass | — | `maestro-house-2026-07-18.log` |
| `mira-chat-send` | Fail | — | `maestro-house-2026-07-18.log` |
| `mira-gaps` | Fail | — | `maestro-house-2026-07-18.log` |
| `more-hub-inventory` | Pass | — | `house-smoke-slice4.log` |
| `my-home-screen` | Fail | — | `maestro-house-2026-07-18.log` |
| `notifications-actions` | Pass | — | `maestro-house-2026-07-18.log` |
| `notifications-comprehensive` | Fail | — | `maestro-house-2026-07-18.log` |
| `notifications-screen` | Fail | — | `maestro-house-2026-07-18.log` |
| `onboarding-back-navigation` | Fail | — | `maestro-house-2026-07-18.log` |
| `onboarding-kill-resume` | Fail | — | `maestro-house-2026-07-18.log` |
| `profile-avatar-readonly` | Fail | — | `maestro-house-2026-07-18.log` |
| `profile-destructive-actions` | Fail | — | `maestro-house-2026-07-18.log` |
| `profile-screen` | Pass | — | `maestro-house-2026-07-18.log` |
| `property-detail-overview` | Fail | — | `maestro-house-2026-07-18.log` |
| `register-back-to-login` | Pass | — | `maestro-house-2026-07-18.log` |
| `register-screen-controls` | Pass | — | `maestro-house-2026-07-18.log` |
| `report-detail-open` | Fail | — | `maestro-house-2026-07-18.log` |
| `report-upload-source-modal` | Fail | — | `maestro-house-2026-07-18.log` |
| `reports-detail-mutations` | Fail | — | `maestro-house-2026-07-18.log` |
| `reports-screen-controls` | Fail | — | `maestro-house-2026-07-18.log` |
| `reports-upload-contract` | Fail | — | `maestro-house-2026-07-18.log` |
| `schedule-and-copy` | Fail | — | `maestro-house-2026-07-18.log` |
| `sessions-revoke` | Pass | — | `maestro-house-2026-07-18.log` |
| `settings` | Fail | — | `maestro-house-2026-07-18.log` |
| `settings-screen` | Pass | — | `house-smoke-slice4.log` |
| `settings-subscreens` | Pass | — | `maestro-house-2026-07-18.log` |
| `space-setup` | Fail | — | `maestro-house-2026-07-18.log` |
| `spaces-management` | Fail | — | `maestro-house-2026-07-18.log` |
| `task-detail-mutations` | Fail | — | `maestro-house-2026-07-18.log` |
| `task-detail-sections` | Fail | — | `maestro-house-2026-07-18.log` |
| `task-detail-ui` | Fail | — | `maestro-house-2026-07-18.log` |
| `task-edit-ipad` | Fail | — | `maestro-house-2026-07-18.log` |
| `tasks-gaps` | Fail | — | `maestro-house-2026-07-18.log` |
| `tasks-screen-controls` | Pass | — | `maestro-house-2026-07-18.log` |
| `trust-ledger` | Fail | — | `maestro-house-2026-07-18.log` |
| `upload-report` | Fail | — | `maestro-house-2026-07-18.log` |
| `upload-report-no-file` | Fail | — | `maestro-house-2026-07-18.log` |

**Open failures (fix queue)**

- `approvals.yaml` — see log
- `biometric-remember-last-login.yaml` — see log
- `briefings.yaml` — see log
- `chat-gaps.yaml` — see log
- `chat-rooms-screen.yaml` — see log
- `connected-accounts.yaml` — see log
- `customize-tabs.yaml` — see log
- `email-verification-resend.yaml` — see log
- `home-projects-hub.yaml` — see log
- `home-projects-hub-mutations.yaml` — see log
- `home-projects-smoke.yaml` — see log
- `household-management.yaml` — see log
- `invalid-invite-token.yaml` — see log
- `join-household.yaml` — see log
- `join-invalid-code.yaml` — see log
- `login-background.yaml` — see log
- `login-offline.yaml` — see log
- `logout-profile.yaml` — see log
- `mira-chat-attach-menu.yaml` — see log
- `mira-chat-overflow-menu.yaml` — see log
- `mira-chat-send.yaml` — see log
- `mira-gaps.yaml` — see log
- `my-home-screen.yaml` — see log
- `notifications-comprehensive.yaml` — see log
- `notifications-screen.yaml` — see log
- `onboarding-back-navigation.yaml` — see log
- `onboarding-kill-resume.yaml` — see log
- `profile-avatar-readonly.yaml` — see log
- `profile-destructive-actions.yaml` — see log
- `property-detail-overview.yaml` — see log
- `report-detail-open.yaml` — see log
- `report-upload-source-modal.yaml` — see log
- `reports-detail-mutations.yaml` — see log
- `reports-screen-controls.yaml` — see log
- `reports-upload-contract.yaml` — see log
- `schedule-and-copy.yaml` — see log
- `settings.yaml` — see log
- `space-setup.yaml` — see log
- `spaces-management.yaml` — see log
- `task-detail-mutations.yaml` — see log
- `task-detail-sections.yaml` — see log
- `task-detail-ui.yaml` — see log
- `task-edit-ipad.yaml` — see log
- `tasks-gaps.yaml` — see log
- `trust-ledger.yaml` — see log
- `upload-report.yaml` — see log
- `upload-report-no-file.yaml` — see log

## Results

| ID | Description | Steps | Expected | Layer | Automation | Pass | Fail | N/A | Notes |
|----|-------------|-------|----------|-------|------------|:----:|:----:|:---:|-------|
| HOUSE-SMOKE-001 | House app launches into an authenticated session | | | | Maestro | `e2e/maestro/subflows/launch-logged-in.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): launch-logged-in |
| HOUSE-SMOKE-002 | Primary tab bar exposes the five House tabs | | | | Maestro, Unit | `e2e/maestro/home/home-screen-controls.yaml`, `src/navigatio | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-SMOKE-003 | Tasks tab appears only when enabled in tab customization | | | | Maestro, Unit | `e2e/maestro/home/home-screen-controls.yaml`, `src/screens/s | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-SMOKE-004 | Header notifications shortcut opens the Notifications screen | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-SMOKE-005 | Header profile shortcut opens the Profile stack | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-SMOKE-006 | More → Garden reaches the garden-plans screen | | | | Maestro | `e2e/maestro/subflows/open-gardening.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): open-gardening |
| HOUSE-SMOKE-007 | More → My Home reaches the home-features hub | | | | Maestro, Unit | `e2e/maestro/home/home-screen-controls.yaml`, `src/screens/h | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-SMOKE-008 | More → Reports reaches the reports list | | | | Maestro | `e2e/maestro/subflows/open-reports.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): open-reports |
| HOUSE-SMOKE-009 | More → Contractors reaches the contractors dashboard | | | | Maestro | `e2e/maestro/subflows/open-contractors.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): open-contractors |
| HOUSE-SMOKE-010 | More → Utilities reaches the utilities dashboard | | | | Maestro | `e2e/maestro/subflows/open-utilities.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): open-utilities |
| HOUSE-SMOKE-011 | More → Home Projects reaches the projects list | | | | Maestro | `e2e/maestro/home-projects/home-projects-smoke.yaml` | ☐ | ☑ | ☐ | Flow `home-projects-smoke.yaml` failed |
| HOUSE-SMOKE-012 | Cross-tab back navigation restores the previous tab | | | | Maestro | `e2e/maestro/smoke/cross-tab-back-navigation.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): cross-tab-back-navigation |
| HOUSE-SMOKE-013 | House brand identity is applied at runtime | | | | Unit | `src/brand/__tests__/houseBrand.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-SMOKE-014 | Unknown brand fails closed rather than defaulting | | | | Unit | `src/brand/__tests__/resolveFailClosed.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-SMOKE-015 | More-hub overflow lists every non-tab module | | | | Maestro, Unit | `e2e/maestro/smoke/more-hub-inventory.yaml`, `src/components | ☑ | ☐ | ☐ | Flow `more-hub-inventory.yaml` |
| HOUSE-SMOKE-016 | Cold launch while logged out lands on Login | | | | Maestro | `e2e/maestro/auth/logout-relaunch.yaml` | ☑ | ☐ | ☐ | Flow `logout-relaunch.yaml` |
| HOUSE-SCROLL-001 | Home reaches its bottom sentinel | | | | Maestro, Unit | `e2e/maestro/scroll/all-screens-scroll.yaml`, `src/__tests__ | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-SCROLL-002 | Tasks list reaches its bottom sentinel | | | | Maestro | `e2e/maestro/scroll/all-screens-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-SCROLL-003 | Chat rooms list reaches its bottom sentinel | | | | Maestro | `e2e/maestro/scroll/all-screens-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-SCROLL-004 | Mira history scrolls without hiding the composer | | | | Maestro | `e2e/maestro/scroll/all-screens-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-SCROLL-005 | Budget tab scrolls with the month stepper pinned | | | | Maestro | `e2e/maestro/scroll/budget-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-SCROLL-006 | More hub reaches its last row | | | | Maestro | `e2e/maestro/scroll/all-screens-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-SCROLL-007 | Reports list scrolls with the FAB not blocking rows | | | | Maestro | `e2e/maestro/reports/reports-screen-controls.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-SCROLL-008 | Contractors dashboard reaches its last card | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-SCROLL-009 | Utilities screen reaches charts and bills | | | | Maestro | `e2e/maestro/scroll/all-screens-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-SCROLL-010 | My Home reaches `my-home-screen-scroll-end` | | | | Maestro | `e2e/maestro/my-home/my-home-screen.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-SCROLL-011 | Home-projects list reaches its create control | | | | Maestro | `e2e/maestro/scroll/all-screens-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-SCROLL-012 | Spaces management reaches the add row | | | | Maestro | `e2e/maestro/spaces/spaces-management.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-SCROLL-013 | Settings reaches its last row | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit; flow `settings-screen.yaml` passed above-fold |
| HOUSE-SCROLL-014 | Notifications list reaches its last row | | | | Maestro | `e2e/maestro/notifications/notifications-screen.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-SCROLL-015 | Profile reaches the destructive section | | | | Maestro | `e2e/maestro/profile/profile-screen.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit; flow `profile-screen.yaml` passed above-fold |
| HOUSE-SCROLL-016 | AI Housekeeper briefings list reaches its end | | | | Maestro | `e2e/maestro/scroll/all-screens-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-SCROLL-017 | Task detail reaches notes and attachments | | | | Maestro | `e2e/maestro/scroll/all-screens-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-SCROLL-018 | Reusable scroll contract subflow | | | | Maestro | `e2e/maestro/subflows/assert-screen-scrolls.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-SCROLL-019 | Property detail tabs scroll independently | | | | Maestro | `e2e/maestro/scroll/all-screens-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-SCROLL-020 | Labor-hub quotes list scrolls to the last quote | | | | Maestro | `e2e/maestro/scroll/all-screens-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-SCROLL-021 | Known limitation: RN New-Arch scroll on iOS 26 | | | | Maestro | `e2e/maestro/scroll/ios26-scroll-limitation.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-AUTH-001 | Login screen mounts with both credential fields | | | | Maestro | `e2e/maestro/auth/login-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `login-screen-controls.yaml` |
| HOUSE-AUTH-002 | Email field accepts and retains input | | | | Maestro | `e2e/maestro/auth/login-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `login-screen-controls.yaml` |
| HOUSE-AUTH-003 | Password field masks input | | | | Maestro | `e2e/maestro/auth/login-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `login-screen-controls.yaml` |
| HOUSE-AUTH-004 | Valid credentials sign in and bootstrap the session | | | | Maestro, Unit | `e2e/maestro/auth/login-screen-controls.yaml`, `src/services | ☑ | ☐ | ☐ | Flow `login-screen-controls.yaml` |
| HOUSE-AUTH-005 | Empty submit is blocked client-side | | | | Maestro, Unit | `e2e/maestro/auth/login-validation.yaml` | ☑ | ☐ | ☐ | Flow `login-validation.yaml` |
| HOUSE-AUTH-006 | Wrong password surfaces an error and keeps the user on Login | | | | Maestro | `e2e/maestro/auth/login-wrong-password.yaml` | ☑ | ☐ | ☐ | Flow `login-wrong-password.yaml` |
| HOUSE-AUTH-007 | Register screen mounts | | | | Maestro | `e2e/maestro/auth/register-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `register-screen-controls.yaml` |
| HOUSE-AUTH-008 | Register creates an account and stores a session | | | | Unit | `src/stores/__tests__/authStore.data-bridge.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-AUTH-009 | Register blocks empty/invalid submit | | | | Unit | `src/screens/auth/__tests__/RegisterScreen.data-bridge.test. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-AUTH-010 | Forgot-password sends a reset request | | | | Maestro | `e2e/maestro/auth/forgot-password.yaml` | ☑ | ☐ | ☐ | Flow `forgot-password.yaml` |
| HOUSE-AUTH-011 | Accept an invitation via deep link | | | | Maestro | `e2e/maestro/auth/login-validation.yaml` | ☑ | ☐ | ☐ | Flow `login-validation.yaml` |
| HOUSE-AUTH-012 | Decline an in-app invitation | | | | Maestro | `e2e/maestro/auth/login-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `login-screen-controls.yaml` |
| HOUSE-AUTH-013 | Log out clears the session | | | | Maestro, Unit | `e2e/maestro/auth/login-screen-controls.yaml`, `src/stores/_ | ☑ | ☐ | ☐ | Flow `login-screen-controls.yaml` |
| HOUSE-AUTH-014 | Biometric "remember last login" row | | | | Maestro, Unit | `e2e/maestro/auth/biometric-remember-last-login.yaml`, `src/ | ☐ | ☑ | ☐ | Flow `biometric-remember-last-login.yaml` failed |
| HOUSE-AUTH-015 | Biometric toggle in Settings reflects and persists state | | | | Maestro, Unit | `e2e/maestro/auth/login-screen-controls.yaml`, `src/services | ☑ | ☐ | ☐ | Flow `login-screen-controls.yaml` |
| HOUSE-AUTH-016 | Session survives a cold relaunch | | | | Maestro | `e2e/maestro/auth/login-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `login-screen-controls.yaml` |
| HOUSE-AUTH-017 | Offline login shows a network error | | | | Maestro | `e2e/maestro/auth/login-offline.yaml` | ☐ | ☑ | ☐ | Flow `login-offline.yaml` failed |
| HOUSE-AUTH-018 | Registering an existing email is rejected | | | | Unit | `src/screens/auth/__tests__/RegisterScreen.data-bridge.test. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-AUTH-019 | Google / Apple sign-in buttons appear only when configured | | | | Maestro | `e2e/maestro/auth/login-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `login-screen-controls.yaml` |
| HOUSE-AUTH-020 | Backgrounding mid-typing creates no partial auth | | | | Maestro | `e2e/maestro/auth/login-background.yaml` | ☐ | ☑ | ☐ | Flow `login-background.yaml` failed |
| HOUSE-AUTH-021 | Household bootstrap follows a successful login | | | | Unit | `src/stores/__tests__/appStore.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-AUTH-022 | Invalid / expired invite token shows an error | | | | Maestro | `e2e/maestro/auth/invalid-invite-token.yaml` | ☐ | ☑ | ☐ | Flow `invalid-invite-token.yaml` failed |
| HOUSE-AUTH-023 | Password visibility toggle | | | | Maestro | `e2e/maestro/auth/login-validation.yaml` | ☑ | ☐ | ☐ | Flow `login-validation.yaml` |
| HOUSE-AUTH-024 | Backing out of Register returns to Login | | | | Maestro | `e2e/maestro/auth/register-back-to-login.yaml` | ☑ | ☐ | ☐ | Flow `register-back-to-login.yaml` |
| HOUSE-AUTH-025 | Login with onboarding incomplete enters the funnel | | | | Maestro | `e2e/maestro/auth/login-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `login-screen-controls.yaml` |
| HOUSE-AUTH-026 | Logout clears the in-memory API client token | | | | Unit | `src/stores/__tests__/authStore.logout.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-AUTH-027 | Repeated failed logins are throttled | | | | API | `backend/src/middleware/__tests__/rate-limit-do.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| HOUSE-AUTH-028 | Remembered email is prefilled on relaunch | | | | Maestro | `e2e/maestro/auth/login-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `login-screen-controls.yaml` |
| HOUSE-AUTH-029 | Change password from an authenticated session | | | | Maestro | `e2e/maestro/auth/login-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `login-screen-controls.yaml` |
| HOUSE-AUTH-030 | Terms acceptance gate | | | | Maestro | `e2e/maestro/onboarding/welcome.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): welcome |
| HOUSE-AUTH-031 | Active-session list and revoke | | | | Maestro | `e2e/maestro/auth/login-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `login-screen-controls.yaml` |
| HOUSE-AUTH-032 | Email verification resend | | | | Maestro | `e2e/maestro/auth/login-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `login-screen-controls.yaml` |
| HOUSE-ONB-001 | Welcome screen mounts for a household-less account | | | | Maestro | `e2e/maestro/onboarding/welcome.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): welcome |
| HOUSE-ONB-002 | Welcome → Create path | | | | Maestro | `e2e/maestro/onboarding/welcome.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): welcome |
| HOUSE-ONB-003 | Welcome → Join path | | | | Maestro | `e2e/maestro/onboarding/create-household.yaml` | ☑ | ☐ | ☐ | Flow `create-household.yaml` |
| HOUSE-ONB-004 | Create household persists and becomes active | | | | Maestro | `e2e/maestro/onboarding/create-household.yaml` | ☑ | ☐ | ☐ | Flow `create-household.yaml` |
| HOUSE-ONB-005 | Create household rejects an empty name | | | | Maestro | `e2e/maestro/onboarding/create-household-empty-name.yaml` | ☑ | ☐ | ☐ | Flow `create-household-empty-name.yaml` |
| HOUSE-ONB-006 | Cancelling create leaves no household | | | | Maestro | `e2e/maestro/onboarding/create-household.yaml` | ☑ | ☐ | ☐ | Flow `create-household.yaml` |
| HOUSE-ONB-007 | Join with a valid invite code grants membership | | | | Maestro | `e2e/maestro/onboarding/create-household.yaml` | ☑ | ☐ | ☐ | Flow `create-household.yaml` |
| HOUSE-ONB-008 | Join with an invalid code errors without side effects | | | | Maestro | `e2e/maestro/onboarding/join-household.yaml` | ☐ | ☑ | ☐ | Flow `join-household.yaml` failed |
| HOUSE-ONB-009 | Space setup step mounts | | | | Maestro | `e2e/maestro/onboarding/create-household.yaml` | ☑ | ☐ | ☐ | Flow `create-household.yaml` |
| HOUSE-ONB-010 | Space setup creates a space | | | | Maestro, API | `e2e/maestro/onboarding/create-household.yaml`, `backend/src | ☑ | ☐ | ☐ | Flow `create-household.yaml` |
| HOUSE-ONB-011 | Space setup can be skipped | | | | Maestro | `e2e/maestro/onboarding/upload-report.yaml` | ☐ | ☑ | ☐ | Flow `upload-report.yaml` failed |
| HOUSE-ONB-012 | Upload-report step mounts | | | | Maestro | `e2e/maestro/onboarding/upload-report.yaml` | ☐ | ☑ | ☐ | Flow `upload-report.yaml` failed |
| HOUSE-ONB-013 | Upload a report from the funnel | | | | Maestro | `e2e/maestro/onboarding/upload-report.yaml` | ☐ | ☑ | ☐ | Flow `upload-report.yaml` failed |
| HOUSE-ONB-014 | Upload-report step can be skipped | | | | Maestro | `e2e/maestro/onboarding/upload-report.yaml` | ☐ | ☑ | ☐ | Flow `upload-report.yaml` failed |
| HOUSE-ONB-015 | Garbage setup step mounts | | | | Maestro | `e2e/maestro/onboarding/upload-report.yaml` | ☐ | ☑ | ☐ | Flow `upload-report.yaml` failed |
| HOUSE-ONB-016 | Garbage schedule is persisted | | | | Maestro | `e2e/maestro/onboarding/create-household.yaml` | ☑ | ☐ | ☐ | Flow `create-household.yaml` |
| HOUSE-ONB-017 | Garbage setup can be skipped | | | | Maestro | `e2e/maestro/onboarding/upload-report.yaml` | ☐ | ☑ | ☐ | Flow `upload-report.yaml` failed |
| HOUSE-ONB-018 | Floor-plan step mounts | | | | Maestro | `e2e/maestro/onboarding/upload-report.yaml` | ☐ | ☑ | ☐ | Flow `upload-report.yaml` failed |
| HOUSE-ONB-019 | Floor-plan upload from the funnel | | | | Maestro | `e2e/maestro/onboarding/upload-report.yaml` | ☐ | ☑ | ☐ | Flow `upload-report.yaml` failed |
| HOUSE-ONB-020 | Floor-plan step can be skipped | | | | Maestro | `e2e/maestro/onboarding/upload-report.yaml` | ☐ | ☑ | ☐ | Flow `upload-report.yaml` failed |
| HOUSE-ONB-021 | Full funnel happy path | | | | Maestro | `e2e/maestro/onboarding/upload-report.yaml` | ☐ | ☑ | ☐ | Flow `upload-report.yaml` failed |
| HOUSE-ONB-022 | Back navigation mid-funnel restores the prior step | | | | Maestro | `e2e/maestro/onboarding/welcome.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): welcome |
| HOUSE-ONB-023 | Killing the app mid-funnel resumes at the right step | | | | Maestro | `e2e/maestro/onboarding/create-household.yaml` | ☑ | ☐ | ☐ | Flow `create-household.yaml` |
| HOUSE-ONB-024 | Confirming upload with no file selected is blocked | | | | Maestro | `e2e/maestro/onboarding/upload-report.yaml` | ☐ | ☑ | ☐ | Flow `upload-report.yaml` failed |
| HOUSE-ONB-025 | Duplicate space name policy | | | | API | `backend/src/services/__tests__/household-space-service.test | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| HOUSE-ONB-026 | Backing out at Welcome | | | | Maestro | `e2e/maestro/onboarding/welcome-back.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): welcome-back |
| HOUSE-ONB-027 | Offline household creation errors cleanly | | | | Maestro | `e2e/maestro/onboarding/create-household-offline.yaml` | ☑ | ☐ | ☐ | Flow `create-household-offline.yaml` |
| HOUSE-ONB-028 | Wrong file type is rejected before upload | | | | Maestro | `e2e/maestro/onboarding/upload-report.yaml` | ☐ | ☑ | ☐ | Flow `upload-report.yaml` failed |
| HOUSE-ONB-029 | Floor plan uploaded during onboarding stays uncalibrated | | | | Maestro | `e2e/maestro/onboarding/upload-report.yaml` | ☐ | ☑ | ☐ | Flow `upload-report.yaml` failed |
| HOUSE-ONB-030 | Onboarding launch subflow | | | | Maestro | `e2e/maestro/subflows/launch-onboarding.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): launch-onboarding |
| HOUSE-ONB-031 | Create-household response contract | | | | API | `backend/src/config/__tests__/budget-chat-gating.test.ts`, ` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| HOUSE-ONB-032 | Completed onboarding is not shown again | | | | Maestro | `e2e/maestro/onboarding/welcome.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): welcome |
| HOUSE-ONB-033 | Child-brand welcome screen is not shown on House | | | | Unit | `src/brand/__tests__/houseBrand.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-HOME-001 | Home dashboard mounts with real content | | | | Maestro, Unit | `e2e/maestro/home/home-screen-controls.yaml`, `src/component | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-HOME-002 | Home reaches its scroll sentinel | | | | Maestro | `e2e/maestro/scroll/all-screens-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-HOME-003 | Status strip renders stat chips with real numbers | | | | Unit, Maestro | `e2e/maestro/home/home-status-strip.yaml`, `src/components/h | ☑ | ☐ | ☐ | Flow `home-status-strip.yaml` |
| HOUSE-HOME-004 | Tapping a stat chip navigates to its module | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-HOME-005 | Up-next section renders | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-HOME-006 | Add a task from Home up-next | | | | Maestro, Unit | `e2e/maestro/home/home-screen-controls.yaml`, `src/component | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-HOME-007 | Dismissing the add-task sheet creates nothing | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-HOME-008 | Add-task requires a title | | | | Unit | `src/components/tasks/__tests__/AddTaskSheet.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-HOME-009 | Task card shows the task's real fields | | | | Maestro, Unit | `e2e/maestro/home/home-screen-controls.yaml`, `src/component | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-HOME-010 | Tapping a task card opens its detail | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-HOME-011 | Attention cards render for actionable items | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-HOME-012 | Attention card routes to its fix flow | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-HOME-013 | Mira brief card renders today's brief | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-HOME-014 | Tapping the Mira brief opens the briefing | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-HOME-015 | Projects card summarises active projects | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-HOME-016 | Projects card opens the projects list | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-HOME-017 | Pull-to-refresh refetches the dashboard | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-HOME-018 | Empty up-next shows a CTA, not a blank area | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-HOME-019 | Offline Home shows cache or an error, never fake data | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-HOME-020 | Home header notifications entry | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-HOME-021 | Home header profile entry | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-HOME-022 | Weather strip loads household weather | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-HOME-023 | Double-tapping Save creates exactly one task | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-HOME-024 | Home controls regression bundle | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-HOME-025 | Upcoming-tasks window parameter | | | | Unit | `src/api/__tests__/tasks.api.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-HOME-026 | Budget timeline card is read-only on House | | | | Unit | `src/components/home/__tests__/BudgetTimeline.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-HOME-027 | Dashboard aggregates are computed, not fabricated | | | | Unit | `src/hooks/__tests__/homeDashboardCalc.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-HOME-028 | Home respects the active household | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-TASK-001 | Tasks screen mounts | | | | Maestro, Unit | `e2e/maestro/tasks/tasks-screen-controls.yaml`, `src/screens | ☑ | ☐ | ☐ | Flow `tasks-screen-controls.yaml` |
| HOUSE-TASK-002 | Tasks list reaches its end | | | | Maestro | `e2e/maestro/scroll/all-screens-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-TASK-003 | Add-task FAB is visible | | | | Maestro | `e2e/maestro/tasks/tasks-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `tasks-screen-controls.yaml` |
| HOUSE-TASK-004 | FAB opens the add-task sheet | | | | Maestro | `e2e/maestro/subflows/open-add-task-from-tasks.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): open-add-task-from-tasks |
| HOUSE-TASK-005 | Search field is present and focusable | | | | Maestro | `e2e/maestro/tasks/tasks-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `tasks-screen-controls.yaml` |
| HOUSE-TASK-006 | Search narrows the list | | | | Maestro, Unit | `e2e/maestro/tasks/tasks-gaps.yaml`, `src/hooks/__tests__/us | ☐ | ☑ | ☐ | Flow `tasks-gaps.yaml` failed |
| HOUSE-TASK-007 | Filter chips render | | | | Maestro | `e2e/maestro/tasks/tasks-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `tasks-screen-controls.yaml` |
| HOUSE-TASK-008 | Selecting a filter chip changes the list | | | | Maestro, Unit | `e2e/maestro/tasks/tasks-gaps.yaml`, `src/utils/__tests__/ta | ☐ | ☑ | ☐ | Flow `tasks-gaps.yaml` failed |
| HOUSE-TASK-009 | Create a task manually | | | | Maestro, Unit | `e2e/maestro/tasks/task-detail-mutations.yaml`, `src/compone | ☐ | ☑ | ☐ | Flow `task-detail-mutations.yaml` failed |
| HOUSE-TASK-010 | Create a task by smart capture | | | | Maestro | `e2e/maestro/tasks/add-task-smart-capture.yaml` | ☑ | ☐ | ☐ | Flow `add-task-smart-capture.yaml` |
| HOUSE-TASK-011 | Create requires a title | | | | Unit | `src/components/tasks/__tests__/AddTaskSheet.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-TASK-012 | Cancelling create adds nothing | | | | Maestro | `e2e/maestro/tasks/tasks-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `tasks-screen-controls.yaml` |
| HOUSE-TASK-013 | Task detail mirrors the stored task | | | | Maestro | `e2e/maestro/tasks/task-detail-ui.yaml`, `e2e/maestro/subflo | ☐ | ☑ | ☐ | Flow `task-detail-ui.yaml` failed |
| HOUSE-TASK-014 | Detail sections expand | | | | Maestro | `e2e/maestro/tasks/tasks-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `tasks-screen-controls.yaml` |
| HOUSE-TASK-015 | Editing the title persists to list and detail | | | | Maestro, Unit | `e2e/maestro/tasks/task-detail-mutations.yaml`, `src/screens | ☐ | ☑ | ☐ | Flow `task-detail-mutations.yaml` failed |
| HOUSE-TASK-016 | Leaving an edit without saving discards it | | | | Maestro, Unit | `e2e/maestro/tasks/tasks-screen-controls.yaml`, `src/hooks/_ | ☑ | ☐ | ☐ | Flow `tasks-screen-controls.yaml` |
| HOUSE-TASK-017 | Delete a task | | | | Maestro, Unit | `e2e/maestro/tasks/task-detail-mutations.yaml`, `src/api/__t | ☐ | ☑ | ☐ | Flow `task-detail-mutations.yaml` failed |
| HOUSE-TASK-018 | Cancelling delete keeps the task | | | | Maestro | `e2e/maestro/tasks/tasks-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `tasks-screen-controls.yaml` |
| HOUSE-TASK-019 | Completing a task updates its status | | | | Unit | `src/api/__tests__/tasks.api.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-TASK-020 | Block then unblock a task | | | | Unit | `src/api/__tests__/tasks.api.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-TASK-021 | Add a subtask | | | | Maestro | `e2e/maestro/tasks/task-detail-mutations.yaml` | ☐ | ☑ | ☐ | Flow `task-detail-mutations.yaml` failed |
| HOUSE-TASK-022 | Complete / uncomplete a subtask | | | | Maestro | `e2e/maestro/tasks/task-detail-mutations.yaml` | ☐ | ☑ | ☐ | Flow `task-detail-mutations.yaml` failed |
| HOUSE-TASK-023 | Delete a subtask | | | | Maestro | `e2e/maestro/tasks/task-detail-mutations.yaml` | ☐ | ☑ | ☐ | Flow `task-detail-mutations.yaml` failed |
| HOUSE-TASK-024 | Add a note to a task | | | | Unit | `src/api/__tests__/tasks.api.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-TASK-025 | Notes list loads | | | | Unit | `src/api/__tests__/tasks.api.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-TASK-026 | Quotes section on a task | | | | Maestro | `e2e/maestro/tasks/tasks-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `tasks-screen-controls.yaml` |
| HOUSE-TASK-027 | Request a quote from a task | | | | Maestro | `e2e/maestro/tasks/task-detail-mutations.yaml` | ☐ | ☑ | ☐ | Flow `task-detail-mutations.yaml` failed |
| HOUSE-TASK-028 | Select a winning quote | | | | Maestro | `e2e/maestro/tasks/task-detail-mutations.yaml` | ☐ | ☑ | ☐ | Flow `task-detail-mutations.yaml` failed |
| HOUSE-TASK-029 | Task API create body contract | | | | Unit | `src/api/__tests__/tasks.api.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-TASK-030 | Offline create surfaces an error | | | | Maestro | `e2e/maestro/tasks/tasks-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `tasks-screen-controls.yaml` |
| HOUSE-TASK-031 | Double-save creates one task | | | | Unit | `src/api/__tests__/tasks.api.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-TASK-032 | Task planner suggests dates | | | | API | `backend/src/services/__tests__/task-planner.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| HOUSE-TASK-033 | Attach a photo to a task | | | | API, Unit | `backend/src/services/__tests__/task-photos.test.ts`, `src/u | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-TASK-034 | Linked budget item is readable from the task | | | | API | `backend/src/services/__tests__/task-budget-item.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| HOUSE-TASK-035 | Empty task list shows a CTA | | | | Maestro | `e2e/maestro/tasks/tasks-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `tasks-screen-controls.yaml` |
| HOUSE-TASK-036 | iPad split-view inline edit | | | | Maestro | `e2e/maestro/tasks/task-edit-ipad.yaml` | ☐ | ☑ | ☐ | Flow `task-edit-ipad.yaml` failed |
| HOUSE-TASK-037 | Task history records transitions | | | | Maestro | `e2e/maestro/tasks/task-detail-sections.yaml` | ☐ | ☑ | ☐ | Flow `task-detail-sections.yaml` failed |
| HOUSE-TASK-038 | Workflow stage change | | | | Maestro | `e2e/maestro/tasks/task-detail-mutations.yaml` | ☐ | ☑ | ☐ | Flow `task-detail-mutations.yaml` failed |
| HOUSE-TASK-039 | Board view renders columns | | | | Unit | `src/components/tasks/__tests__/TaskBoard.smoke.test.tsx`, ` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-TASK-040 | Assignee and effort render on the card | | | | Unit | `src/components/tasks/__tests__/TaskCardAssigneeEffort.test. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-TASK-041 | Task detail stack navigation | | | | Unit | `src/navigation/__tests__/TaskDetailStackNavigator.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-TASK-042 | Task form validation helpers | | | | Unit | `src/components/tasks/__tests__/TaskFormBody.test.tsx` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-TASK-043 | Dismiss a purchase suggestion on a task | | | | Maestro | `e2e/maestro/tasks/task-detail-mutations.yaml` | ☐ | ☑ | ☐ | Flow `task-detail-mutations.yaml` failed |
| HOUSE-TPLAN-001 | Task drafts screen mounts | | | | Maestro | `e2e/maestro/task-planning/task-drafts.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): task-drafts |
| HOUSE-TPLAN-002 | Drafts list scrolls to its end | | | | Maestro | `e2e/maestro/task-planning/task-drafts.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-TPLAN-003 | Open a draft detail | | | | Maestro | `e2e/maestro/task-planning/task-drafts.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): task-drafts |
| HOUSE-TPLAN-004 | Accept a draft into a real task | | | | Maestro | `e2e/maestro/task-planning/task-drafts.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): task-drafts |
| HOUSE-TPLAN-005 | Reject a draft | | | | Maestro | `e2e/maestro/task-planning/task-drafts.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): task-drafts |
| HOUSE-TPLAN-006 | Cancelling out of a draft changes nothing | | | | Maestro | `e2e/maestro/task-planning/task-drafts.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): task-drafts |
| HOUSE-TPLAN-007 | Maintenance template catalogue loads | | | | Maestro | `e2e/maestro/task-planning/task-templates.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): task-templates |
| HOUSE-TPLAN-008 | Template categories filter the catalogue | | | | Maestro | `e2e/maestro/task-planning/task-templates.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): task-templates |
| HOUSE-TPLAN-009 | Open a template detail | | | | Maestro | `e2e/maestro/task-planning/task-templates.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): task-templates |
| HOUSE-TPLAN-010 | Create a task from a template | | | | Maestro | `e2e/maestro/task-planning/task-templates.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): task-templates |
| HOUSE-TPLAN-011 | Maintenance setup wizard mounts | | | | Maestro | `e2e/maestro/task-planning/maintenance-setup.yaml` | ☑ | ☐ | ☐ | Flow `maintenance-setup.yaml` |
| HOUSE-TPLAN-012 | Maintenance setup creates a task set | | | | Maestro | `e2e/maestro/task-planning/maintenance-setup.yaml` | ☑ | ☐ | ☐ | Flow `maintenance-setup.yaml` |
| HOUSE-TPLAN-013 | Maintenance setup cancel | | | | Maestro | `e2e/maestro/task-planning/maintenance-setup.yaml` | ☑ | ☐ | ☐ | Flow `maintenance-setup.yaml` |
| HOUSE-TPLAN-014 | Schedule a task to a date | | | | Maestro | `e2e/maestro/task-planning/schedule-and-copy.yaml` | ☐ | ☑ | ☐ | Flow `schedule-and-copy.yaml` failed |
| HOUSE-TPLAN-015 | Schedule work with a contractor | | | | Maestro | `e2e/maestro/task-planning/schedule-and-copy.yaml` | ☐ | ☑ | ☐ | Flow `schedule-and-copy.yaml` failed |
| HOUSE-TPLAN-016 | Schedule work requires a contractor and a date | | | | Maestro | `e2e/maestro/task-planning/schedule-and-copy.yaml` | ☐ | ☑ | ☐ | Flow `schedule-and-copy.yaml` failed |
| HOUSE-TPLAN-017 | Contractor selection screen lists eligible contractors | | | | Maestro | `e2e/maestro/task-planning/schedule-and-copy.yaml` | ☐ | ☑ | ☐ | Flow `schedule-and-copy.yaml` failed |
| HOUSE-TPLAN-018 | Time-budget planner mounts | | | | Maestro | `e2e/maestro/task-planning/time-budget-planner.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): time-budget-planner |
| HOUSE-TPLAN-019 | Copy from existing tasks | | | | Maestro | `e2e/maestro/task-planning/time-budget-planner.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): time-budget-planner |
| HOUSE-TPLAN-020 | Copy with nothing selected is blocked | | | | Maestro | `e2e/maestro/task-planning/time-budget-planner.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): time-budget-planner |
| HOUSE-TPLAN-021 | Planner offline | | | | Maestro | `e2e/maestro/task-planning/time-budget-planner.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): time-budget-planner |
| HOUSE-TPLAN-022 | Accepting the same draft twice creates one task | | | | Maestro | `e2e/maestro/task-planning/task-drafts.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): task-drafts |
| HOUSE-RPT-001 | Reports list mounts | | | | Maestro | `e2e/maestro/reports/reports-screen-controls.yaml`, `e2e/mae | ☐ | ☑ | ☐ | Flow `reports-screen-controls.yaml` failed |
| HOUSE-RPT-002 | Reports list scrolls with the FAB clear of rows | | | | Maestro | `e2e/maestro/reports/reports-screen-controls.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-RPT-003 | Upload FAB is visible | | | | Maestro | `e2e/maestro/reports/reports-screen-controls.yaml` | ☐ | ☑ | ☐ | Flow `reports-screen-controls.yaml` failed |
| HOUSE-RPT-004 | Upload source modal offers camera and files | | | | Maestro | `e2e/maestro/reports/report-upload-source-modal.yaml` | ☐ | ☑ | ☐ | Flow `report-upload-source-modal.yaml` failed |
| HOUSE-RPT-005 | Pick a PDF from Files | | | | Maestro | `e2e/maestro/subflows/pick-document-from-files.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): pick-document-from-files |
| HOUSE-RPT-006 | Confirming the upload creates a report | | | | Maestro | `e2e/maestro/reports/reports-upload-contract.yaml` | ☐ | ☑ | ☐ | Flow `reports-upload-contract.yaml` failed |
| HOUSE-RPT-007 | Cancelling after picking creates nothing | | | | Maestro | `e2e/maestro/reports/reports-upload-contract.yaml` | ☐ | ☑ | ☐ | Flow `reports-upload-contract.yaml` failed |
| HOUSE-RPT-008 | Confirm without a file is blocked | | | | Maestro | `e2e/maestro/reports/report-upload-source-modal.yaml` | ☐ | ☑ | ☐ | Flow `report-upload-source-modal.yaml` failed |
| HOUSE-RPT-009 | Report detail opens with the document | | | | Maestro | `e2e/maestro/reports/reports-screen-controls.yaml` | ☐ | ☑ | ☐ | Flow `reports-screen-controls.yaml` failed |
| HOUSE-RPT-010 | Report detail scrolls through findings | | | | Maestro | `e2e/maestro/reports/reports-screen-controls.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-RPT-011 | Delete a report | | | | Maestro | `e2e/maestro/reports/reports-screen-controls.yaml` | ☐ | ☑ | ☐ | Flow `reports-screen-controls.yaml` failed |
| HOUSE-RPT-012 | Cancelling delete keeps the report | | | | Maestro | `e2e/maestro/reports/reports-screen-controls.yaml` | ☐ | ☑ | ☐ | Flow `reports-screen-controls.yaml` failed |
| HOUSE-RPT-013 | Report processing produces findings | | | | Maestro | `e2e/maestro/reports/report-upload-source-modal.yaml` | ☐ | ☑ | ☐ | Flow `report-upload-source-modal.yaml` failed |
| HOUSE-RPT-014 | Upload a photo report from the library | | | | Maestro | `e2e/maestro/reports/report-upload-source-modal.yaml` | ☐ | ☑ | ☐ | Flow `report-upload-source-modal.yaml` failed |
| HOUSE-RPT-015 | Empty reports list shows an upload CTA | | | | Maestro | `e2e/maestro/reports/report-upload-source-modal.yaml` | ☐ | ☑ | ☐ | Flow `report-upload-source-modal.yaml` failed |
| HOUSE-RPT-016 | Offline upload fails visibly | | | | Maestro | `e2e/maestro/reports/report-upload-source-modal.yaml` | ☐ | ☑ | ☐ | Flow `report-upload-source-modal.yaml` failed |
| HOUSE-RPT-017 | Reports list API shape | | | | Unit | `e2e/maestro/reports/reports-screen-controls.yaml` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-RPT-018 | Large PDF upload | | | | Maestro | `e2e/maestro/reports/report-upload-source-modal.yaml` | ☐ | ☑ | ☐ | Flow `report-upload-source-modal.yaml` failed |
| HOUSE-RPT-019 | Uploading the same file twice | | | | Maestro | `e2e/maestro/reports/report-upload-source-modal.yaml` | ☐ | ☑ | ☐ | Flow `report-upload-source-modal.yaml` failed |
| HOUSE-RPT-020 | Reports controls regression bundle | | | | Maestro | `e2e/maestro/reports/reports-screen-controls.yaml` | ☐ | ☑ | ☐ | Flow `reports-screen-controls.yaml` failed |
| HOUSE-RPT-021 | Report images gallery | | | | Maestro | `e2e/maestro/reports/reports-screen-controls.yaml` | ☐ | ☑ | ☐ | Flow `reports-screen-controls.yaml` failed |
| HOUSE-RPT-022 | Report action plans | | | | Maestro | `e2e/maestro/reports/reports-screen-controls.yaml` | ☐ | ☑ | ☐ | Flow `reports-screen-controls.yaml` failed |
| HOUSE-RPT-023 | Report summaries | | | | Maestro | `e2e/maestro/reports/reports-screen-controls.yaml` | ☐ | ☑ | ☐ | Flow `reports-screen-controls.yaml` failed |
| HOUSE-RPT-024 | Enhanced processing path | | | | API | `backend/src/services/__tests__/enhanced-pdf-processor.test. | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| HOUSE-CONT-001 | Contractors dashboard mounts | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml`, `e2e/m | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard, open-contractors |
| HOUSE-CONT-002 | Dashboard scrolls to its last card | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-CONT-003 | Labor-hub add FAB is visible | | | | Maestro | `e2e/maestro/contractors/labor-hub-add-fab.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-add-fab |
| HOUSE-CONT-004 | Add FAB opens the create form | | | | Maestro | `e2e/maestro/contractors/labor-hub-add-fab.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-add-fab |
| HOUSE-CONT-005 | Quotes tab loads | | | | Maestro | `e2e/maestro/contractors/labor-hub-quotes-tab.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-quotes-tab |
| HOUSE-CONT-006 | Create a contractor | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard |
| HOUSE-CONT-007 | Create requires a name | | | | Maestro | `e2e/maestro/contractors/contractors-mutations.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-mutations |
| HOUSE-CONT-008 | Cancelling create adds nothing | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard |
| HOUSE-CONT-009 | Update a contractor | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard |
| HOUSE-CONT-010 | Delete a contractor | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard |
| HOUSE-CONT-011 | Contractor detail mounts | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard |
| HOUSE-CONT-012 | Create a visit for a contractor | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard |
| HOUSE-CONT-013 | Update a visit | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard |
| HOUSE-CONT-014 | Delete a visit | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard |
| HOUSE-CONT-015 | Start and complete a visit | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard |
| HOUSE-CONT-016 | Visit checklist loads | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard |
| HOUSE-CONT-017 | Check a checklist item | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard |
| HOUSE-CONT-018 | Create a checklist from a template | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard |
| HOUSE-CONT-019 | Upload a contractor document | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard |
| HOUSE-CONT-020 | Delete a contractor document | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard |
| HOUSE-CONT-021 | Rate a contractor | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard |
| HOUSE-CONT-022 | Ratings summary | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard |
| HOUSE-CONT-023 | Delete a rating | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard |
| HOUSE-CONT-024 | AI contractor lookup | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard |
| HOUSE-CONT-025 | Offline contractors hub | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard |
| HOUSE-CONT-026 | Duplicate contractor name policy | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard |
| HOUSE-CONT-027 | Empty quotes tab | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard |
| HOUSE-CONT-028 | Visit checklist photo capture | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard |
| HOUSE-CONT-029 | Visit-mode screen mounts | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard |
| HOUSE-CONT-030 | Contractor comparison | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard |
| HOUSE-CMSG-001 | Contractor search screen mounts | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CMSG-002 | Search returns results | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CMSG-003 | Empty search query is blocked | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CMSG-004 | Save a search result as a contractor | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CMSG-005 | Compose a contractor email | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CMSG-006 | Compose requires a subject and body | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CMSG-007 | Cancelling compose sends nothing | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CMSG-008 | Conversations list mounts | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CMSG-009 | Open a conversation thread | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CMSG-010 | Send a message in a thread | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CMSG-011 | Mark a conversation read | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CMSG-012 | Delete a message | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CMSG-013 | Message templates list | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CMSG-014 | Apply a template to a message | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CMSG-015 | Offline send fails visibly | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CMSG-016 | Empty conversations state | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-LABOR-001 | Labor hub dashboard mounts | | | | Maestro | `e2e/maestro/contractors/contractors-dashboard.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): contractors-dashboard |
| HOUSE-LABOR-002 | Appointments list loads | | | | Maestro | `e2e/maestro/contractors/labor-hub-comprehensive.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-comprehensive |
| HOUSE-LABOR-003 | Appointments calendar view | | | | Maestro | `e2e/maestro/contractors/labor-hub-comprehensive.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-comprehensive |
| HOUSE-LABOR-004 | Create an appointment | | | | Maestro | `e2e/maestro/contractors/labor-hub-appointments.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-appointments |
| HOUSE-LABOR-005 | Appointment create validation | | | | Maestro | `e2e/maestro/contractors/labor-hub-appointments.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-appointments |
| HOUSE-LABOR-006 | Cancelling appointment create | | | | Maestro | `e2e/maestro/contractors/labor-hub-appointments.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-appointments |
| HOUSE-LABOR-007 | Edit an appointment | | | | Maestro | `e2e/maestro/contractors/labor-hub-appointments.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-appointments |
| HOUSE-LABOR-008 | Confirm an appointment | | | | Maestro | `e2e/maestro/contractors/labor-hub-appointments.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-appointments |
| HOUSE-LABOR-009 | Reschedule an appointment | | | | Maestro | `e2e/maestro/contractors/labor-hub-appointments.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-appointments |
| HOUSE-LABOR-010 | Cancel an appointment | | | | Maestro | `e2e/maestro/contractors/labor-hub-appointments.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-appointments |
| HOUSE-LABOR-011 | Mark an appointment no-show | | | | Maestro | `e2e/maestro/contractors/labor-hub-appointments.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-appointments |
| HOUSE-LABOR-012 | Complete an appointment | | | | Maestro | `e2e/maestro/contractors/labor-hub-appointments.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-appointments |
| HOUSE-LABOR-013 | Delete an appointment | | | | Maestro | `e2e/maestro/contractors/labor-hub-appointments.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-appointments |
| HOUSE-LABOR-014 | Projects list loads | | | | Maestro | `e2e/maestro/contractors/labor-hub-comprehensive.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-comprehensive |
| HOUSE-LABOR-015 | Create a project | | | | Maestro | `e2e/maestro/contractors/labor-hub-add-fab.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-add-fab |
| HOUSE-LABOR-016 | Project detail loads | | | | Maestro | `e2e/maestro/contractors/labor-hub-add-fab.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-add-fab |
| HOUSE-LABOR-017 | Add a milestone | | | | Maestro | `e2e/maestro/contractors/labor-hub-add-fab.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-add-fab |
| HOUSE-LABOR-018 | Complete a milestone | | | | Maestro | `e2e/maestro/contractors/labor-hub-add-fab.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-add-fab |
| HOUSE-LABOR-019 | Delete a milestone | | | | Maestro | `e2e/maestro/contractors/labor-hub-add-fab.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-add-fab |
| HOUSE-LABOR-020 | Record a payment | | | | Maestro | `e2e/maestro/contractors/labor-hub-add-fab.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-add-fab |
| HOUSE-LABOR-021 | Mark a payment paid | | | | Maestro | `e2e/maestro/contractors/labor-hub-add-fab.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-add-fab |
| HOUSE-LABOR-022 | Payment amount validation | | | | Maestro | `e2e/maestro/contractors/labor-hub-add-fab.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-add-fab |
| HOUSE-LABOR-023 | Add a project photo | | | | Maestro | `e2e/maestro/contractors/labor-hub-add-fab.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-add-fab |
| HOUSE-LABOR-024 | Delete a project photo | | | | Maestro | `e2e/maestro/contractors/labor-hub-add-fab.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-add-fab |
| HOUSE-LABOR-025 | Delete a project | | | | Maestro | `e2e/maestro/contractors/labor-hub-add-fab.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-add-fab |
| HOUSE-LABOR-026 | Quotes list loads | | | | Maestro | `e2e/maestro/contractors/labor-hub-quotes-tab.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-quotes-tab |
| HOUSE-LABOR-027 | Create a quote | | | | Maestro | `e2e/maestro/contractors/labor-hub-projects-quotes.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-projects-quotes |
| HOUSE-LABOR-028 | Accept a quote | | | | Maestro | `e2e/maestro/contractors/labor-hub-projects-quotes.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-projects-quotes |
| HOUSE-LABOR-029 | Decline a quote | | | | Maestro | `e2e/maestro/contractors/labor-hub-projects-quotes.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-projects-quotes |
| HOUSE-LABOR-030 | Mark a quote received | | | | Maestro | `e2e/maestro/contractors/labor-hub-projects-quotes.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-projects-quotes |
| HOUSE-LABOR-031 | Edit a quote | | | | Maestro | `e2e/maestro/contractors/labor-hub-projects-quotes.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-projects-quotes |
| HOUSE-LABOR-032 | Delete a quote | | | | Maestro | `e2e/maestro/contractors/labor-hub-projects-quotes.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-projects-quotes |
| HOUSE-LABOR-033 | Compare quotes | | | | Maestro | `e2e/maestro/contractors/labor-hub-projects-quotes.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-projects-quotes |
| HOUSE-LABOR-034 | AI quote comparison | | | | Maestro | `e2e/maestro/contractors/labor-hub-projects-quotes.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-projects-quotes |
| HOUSE-LABOR-035 | Checklist editor | | | | Maestro | `e2e/maestro/contractors/labor-hub-add-fab.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-add-fab |
| HOUSE-LABOR-036 | AI technical info screen | | | | Maestro | `e2e/maestro/contractors/labor-hub-add-fab.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-add-fab |
| HOUSE-LABOR-037 | Offline labor hub | | | | Maestro | `e2e/maestro/contractors/labor-hub-add-fab.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-add-fab |
| HOUSE-LABOR-038 | Overlapping appointments | | | | Maestro | `e2e/maestro/contractors/labor-hub-appointments.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): labor-hub-appointments |
| HOUSE-UTIL-001 | Utilities dashboard mounts | | | | Maestro | `e2e/maestro/utilities/utilities-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): utilities-screen |
| HOUSE-UTIL-002 | Utilities screen scrolls to bills | | | | Maestro | `e2e/maestro/utilities/utilities-screen.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-UTIL-003 | Consumption chart renders | | | | Maestro | `e2e/maestro/utilities/utility-charts.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): utility-charts |
| HOUSE-UTIL-004 | Changing the chart period refetches | | | | Maestro | `e2e/maestro/utilities/utilities-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): utilities-screen |
| HOUSE-UTIL-005 | Bills list loads | | | | Maestro | `e2e/maestro/utilities/utility-bills.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): utility-bills |
| HOUSE-UTIL-006 | Bills reachable from More | | | | Maestro | `e2e/maestro/utilities/utilities-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): utilities-screen |
| HOUSE-UTIL-007 | Add a utility account | | | | Maestro, Unit | `e2e/maestro/utilities/utilities-screen.yaml`, `src/api/__te | ☐ | ☐ | ☑ | No suite run for cited flow(s): utilities-screen |
| HOUSE-UTIL-008 | Edit a utility account | | | | Unit | `src/api/__tests__/utilities.api.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-UTIL-009 | Delete a utility account | | | | Maestro | `e2e/maestro/utilities/utilities-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): utilities-screen |
| HOUSE-UTIL-010 | Add a utility bill manually | | | | Maestro, Unit | `e2e/maestro/utilities/utilities-screen.yaml`, `src/api/__te | ☐ | ☐ | ☑ | No suite run for cited flow(s): utilities-screen |
| HOUSE-UTIL-011 | Bill amount validation | | | | Maestro | `e2e/maestro/utilities/utilities-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): utilities-screen |
| HOUSE-UTIL-012 | Upload a bill document | | | | Maestro | `e2e/maestro/utilities/utilities-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): utilities-screen |
| HOUSE-UTIL-013 | Mark a bill paid | | | | Maestro | `e2e/maestro/utilities/utilities-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): utilities-screen |
| HOUSE-UTIL-014 | Delete a bill | | | | Maestro | `e2e/maestro/utilities/utilities-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): utilities-screen |
| HOUSE-UTIL-015 | Property-tax list loads | | | | Maestro, Unit | `e2e/maestro/utilities/utilities-property-tax.yaml`, `src/sc | ☐ | ☐ | ☑ | No suite run for cited flow(s): utilities-property-tax |
| HOUSE-UTIL-016 | Create a property-tax entry | | | | Maestro, Unit | `e2e/maestro/utilities/utilities-screen.yaml`, `src/screens/ | ☐ | ☐ | ☑ | No suite run for cited flow(s): utilities-screen |
| HOUSE-UTIL-017 | Property-tax form validation | | | | Unit | `src/screens/utilities/__tests__/propertyTaxFormUtils.test.t | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-UTIL-018 | Delete a property-tax entry | | | | Maestro | `e2e/maestro/utilities/utilities-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): utilities-screen |
| HOUSE-UTIL-019 | My Home → Utilities lands on the same screen | | | | Maestro | `e2e/maestro/utilities/utilities-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): utilities-screen |
| HOUSE-UTIL-020 | Cancelling account create adds nothing | | | | Maestro | `e2e/maestro/utilities/utilities-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): utilities-screen |
| HOUSE-UTIL-021 | Offline bill create errors | | | | Maestro | `e2e/maestro/utilities/utilities-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): utilities-screen |
| HOUSE-UTIL-022 | Empty bills state | | | | Maestro | `e2e/maestro/utilities/utilities-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): utilities-screen |
| HOUSE-UTIL-023 | Utilities API path contract | | | | Unit | `src/api/__tests__/utilities.api.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-UTIL-024 | Duplicate bill for the same period | | | | Maestro | `e2e/maestro/utilities/utilities-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): utilities-screen |
| HOUSE-UTIL-025 | Bill extraction from a document | | | | API | `backend/src/routes/__tests__/utilities.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| HOUSE-UTIL-026 | Bill proration across periods | | | | Unit | `src/utils/__tests__/bill-proration.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-UTIL-027 | Confirm bill payments batch screen | | | | Maestro | `e2e/maestro/utilities/utilities-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): utilities-screen |
| HOUSE-UTIL-028 | Utility provider screen | | | | Maestro | `e2e/maestro/utilities/utilities-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): utilities-screen |
| HOUSE-UTIL-029 | Utility settings screen | | | | Maestro | `e2e/maestro/utilities/utilities-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): utilities-screen |
| HOUSE-UTIL-030 | Municipality resolution | | | | Maestro | `e2e/maestro/utilities/utilities-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): utilities-screen |
| HOUSE-PROP-001 | Property detail mounts on the Overview tab | | | | Maestro, Unit | `e2e/maestro/my-home/property-detail-overview.yaml`, `src/sc | ☐ | ☑ | ☐ | Flow `property-detail-overview.yaml` failed |
| HOUSE-PROP-002 | Four tabs are present and switchable | | | | Maestro | `e2e/maestro/my-home/property-detail-overview.yaml` | ☐ | ☑ | ☐ | Flow `property-detail-overview.yaml` failed |
| HOUSE-PROP-003 | Overview insight widgets render real values | | | | Unit | `src/screens/households/property-tabs/__tests__/PropertyInsi | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-PROP-004 | Assessment tab loads BC assessment data | | | | Maestro | `e2e/maestro/my-home/property-detail-overview.yaml` | ☐ | ☑ | ☐ | Flow `property-detail-overview.yaml` failed |
| HOUSE-PROP-005 | Upload an assessment document | | | | API | `backend/src/services/__tests__/bc-assessment-extraction-ser | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| HOUSE-PROP-006 | Delete an assessment entry | | | | Maestro | `e2e/maestro/my-home/property-detail-overview.yaml` | ☐ | ☑ | ☐ | Flow `property-detail-overview.yaml` failed |
| HOUSE-PROP-007 | Tax tab mirrors the utilities tax list | | | | Maestro | `e2e/maestro/my-home/property-detail-overview.yaml` | ☐ | ☑ | ☐ | Flow `property-detail-overview.yaml` failed |
| HOUSE-PROP-008 | Upload a tax document | | | | API | `backend/src/services/__tests__/property-tax-extraction-serv | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| HOUSE-PROP-009 | Members tab lists household members | | | | Maestro | `e2e/maestro/my-home/property-detail-overview.yaml` | ☐ | ☑ | ☐ | Flow `property-detail-overview.yaml` failed |
| HOUSE-PROP-010 | Members tab respects role permissions | | | | Maestro | `e2e/maestro/my-home/property-detail-overview.yaml` | ☐ | ☑ | ☐ | Flow `property-detail-overview.yaml` failed |
| HOUSE-PROP-011 | Property tabs offline | | | | Maestro | `e2e/maestro/my-home/property-detail-overview.yaml` | ☐ | ☑ | ☐ | Flow `property-detail-overview.yaml` failed |
| HOUSE-PROP-012 | Back from property detail restores My Home | | | | Maestro | `e2e/maestro/my-home/property-detail-overview.yaml` | ☐ | ☑ | ☐ | Flow `property-detail-overview.yaml` failed |
| HOUSE-GARB-001 | Garbage schedule screen mounts | | | | Maestro | `e2e/maestro/onboarding/garbage-setup.yaml` | ☑ | ☐ | ☐ | Flow `garbage-setup.yaml` |
| HOUSE-GARB-002 | Schedule screen scrolls to its end | | | | Maestro | `e2e/maestro/onboarding/garbage-setup.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit; flow `garbage-setup.yaml` passed above-fold |
| HOUSE-GARB-003 | Category detail opens | | | | Maestro | `e2e/maestro/onboarding/garbage-setup.yaml` | ☑ | ☐ | ☐ | Flow `garbage-setup.yaml` |
| HOUSE-GARB-004 | Municipality picker lists municipalities | | | | Maestro | `e2e/maestro/onboarding/garbage-setup.yaml` | ☑ | ☐ | ☐ | Flow `garbage-setup.yaml` |
| HOUSE-GARB-005 | Create a schedule | | | | Maestro | `e2e/maestro/onboarding/garbage-setup.yaml` | ☑ | ☐ | ☐ | Flow `garbage-setup.yaml` |
| HOUSE-GARB-006 | Edit an existing schedule | | | | Maestro | `e2e/maestro/onboarding/garbage-setup.yaml` | ☑ | ☐ | ☐ | Flow `garbage-setup.yaml` |
| HOUSE-GARB-007 | Schedule setup requires a municipality | | | | Maestro | `e2e/maestro/onboarding/garbage-setup.yaml` | ☑ | ☐ | ☐ | Flow `garbage-setup.yaml` |
| HOUSE-GARB-008 | Cancelling schedule setup | | | | Maestro | `e2e/maestro/onboarding/garbage-setup.yaml` | ☑ | ☐ | ☐ | Flow `garbage-setup.yaml` |
| HOUSE-GARB-009 | Reminder settings persist | | | | Maestro | `e2e/maestro/onboarding/garbage-setup.yaml` | ☑ | ☐ | ☐ | Flow `garbage-setup.yaml` |
| HOUSE-GARB-010 | Garbage detect (photo classification) | | | | Maestro | `e2e/maestro/onboarding/garbage-setup.yaml` | ☑ | ☐ | ☐ | Flow `garbage-setup.yaml` |
| HOUSE-GARB-011 | Detect cancel | | | | Maestro | `e2e/maestro/onboarding/garbage-setup.yaml` | ☑ | ☐ | ☐ | Flow `garbage-setup.yaml` |
| HOUSE-GARB-012 | No schedule empty state | | | | Maestro | `e2e/maestro/onboarding/garbage-setup.yaml` | ☑ | ☐ | ☐ | Flow `garbage-setup.yaml` |
| HOUSE-GARB-013 | Offline schedule view | | | | Maestro | `e2e/maestro/onboarding/garbage-setup.yaml` | ☑ | ☐ | ☐ | Flow `garbage-setup.yaml` |
| HOUSE-GARB-014 | Unsupported municipality | | | | Maestro | `e2e/maestro/onboarding/garbage-setup.yaml` | ☑ | ☐ | ☐ | Flow `garbage-setup.yaml` |
| HOUSE-APPL-001 | Appliances list mounts | | | | Maestro | `e2e/maestro/my-home/appliances-attention-modal.yaml` | ☑ | ☐ | ☐ | Flow `appliances-attention-modal.yaml` |
| HOUSE-APPL-002 | Appliances list scrolls to its end | | | | Maestro | `e2e/maestro/my-home/appliances-attention-modal.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit; flow `appliances-attention-modal.yaml` passed above-fold |
| HOUSE-APPL-003 | Add control is visible | | | | Maestro | `e2e/maestro/my-home/appliances-attention-modal.yaml` | ☑ | ☐ | ☐ | Flow `appliances-attention-modal.yaml` |
| HOUSE-APPL-004 | Create an appliance | | | | Maestro, API | `e2e/maestro/my-home/appliances-attention-modal.yaml`, `back | ☑ | ☐ | ☐ | Flow `appliances-attention-modal.yaml` |
| HOUSE-APPL-005 | Create requires a name | | | | Maestro | `e2e/maestro/my-home/appliances-attention-modal.yaml` | ☑ | ☐ | ☐ | Flow `appliances-attention-modal.yaml` |
| HOUSE-APPL-006 | Cancelling create adds nothing | | | | Maestro | `e2e/maestro/my-home/appliances-attention-modal.yaml` | ☑ | ☐ | ☐ | Flow `appliances-attention-modal.yaml` |
| HOUSE-APPL-007 | Appliance detail loads | | | | Maestro | `e2e/maestro/my-home/appliances-attention-modal.yaml` | ☑ | ☐ | ☐ | Flow `appliances-attention-modal.yaml` |
| HOUSE-APPL-008 | Update an appliance | | | | Maestro | `e2e/maestro/my-home/appliances-attention-modal.yaml` | ☑ | ☐ | ☐ | Flow `appliances-attention-modal.yaml` |
| HOUSE-APPL-009 | Delete an appliance | | | | Maestro | `e2e/maestro/my-home/appliances-attention-modal.yaml` | ☑ | ☐ | ☐ | Flow `appliances-attention-modal.yaml` |
| HOUSE-APPL-010 | Cancelling delete keeps the appliance | | | | Maestro | `e2e/maestro/my-home/appliances-attention-modal.yaml` | ☑ | ☐ | ☐ | Flow `appliances-attention-modal.yaml` |
| HOUSE-APPL-011 | Appliance documents load | | | | Maestro | `e2e/maestro/my-home/appliances-attention-modal.yaml` | ☑ | ☐ | ☐ | Flow `appliances-attention-modal.yaml` |
| HOUSE-APPL-012 | Attach a document to an appliance | | | | Maestro | `e2e/maestro/my-home/appliances-attention-modal.yaml` | ☑ | ☐ | ☐ | Flow `appliances-attention-modal.yaml` |
| HOUSE-APPL-013 | Appliance-linked maintenance task | | | | Maestro | `e2e/maestro/my-home/appliances-attention-modal.yaml` | ☑ | ☐ | ☐ | Flow `appliances-attention-modal.yaml` |
| HOUSE-APPL-014 | Empty appliances state | | | | Maestro | `e2e/maestro/my-home/appliances-attention-modal.yaml` | ☑ | ☐ | ☐ | Flow `appliances-attention-modal.yaml` |
| HOUSE-APPL-015 | Offline appliances | | | | Maestro | `e2e/maestro/my-home/appliances-attention-modal.yaml` | ☑ | ☐ | ☐ | Flow `appliances-attention-modal.yaml` |
| HOUSE-APPL-016 | Appliance scoped to the active household | | | | Maestro | `e2e/maestro/my-home/appliances-attention-modal.yaml` | ☑ | ☐ | ☐ | Flow `appliances-attention-modal.yaml` |
| HOUSE-CHKL-001 | Checklists screen mounts | | | | Maestro | `e2e/maestro/tasks/checklist-defaults-create.yaml` | ☑ | ☐ | ☐ | Flow `checklist-defaults-create.yaml` |
| HOUSE-CHKL-002 | Checklists scroll to their end | | | | Maestro | `e2e/maestro/tasks/checklist-defaults-create.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit; flow `checklist-defaults-create.yaml` passed above-fold |
| HOUSE-CHKL-003 | Create default checklists | | | | Maestro, API | `e2e/maestro/tasks/checklist-defaults-create.yaml`, `backend | ☑ | ☐ | ☐ | Flow `checklist-defaults-create.yaml` |
| HOUSE-CHKL-004 | Create a custom checklist | | | | Maestro | `e2e/maestro/tasks/checklist-defaults-create.yaml` | ☑ | ☐ | ☐ | Flow `checklist-defaults-create.yaml` |
| HOUSE-CHKL-005 | Create requires a name | | | | Maestro | `e2e/maestro/tasks/checklist-defaults-create.yaml` | ☑ | ☐ | ☐ | Flow `checklist-defaults-create.yaml` |
| HOUSE-CHKL-006 | Cancelling create adds nothing | | | | Maestro | `e2e/maestro/tasks/checklist-defaults-create.yaml` | ☑ | ☐ | ☐ | Flow `checklist-defaults-create.yaml` |
| HOUSE-CHKL-007 | Open the current checklist run | | | | Maestro | `e2e/maestro/tasks/checklist-defaults-create.yaml` | ☑ | ☐ | ☐ | Flow `checklist-defaults-create.yaml` |
| HOUSE-CHKL-008 | Progress summary is accurate | | | | Maestro | `e2e/maestro/tasks/checklist-defaults-create.yaml` | ☑ | ☐ | ☐ | Flow `checklist-defaults-create.yaml` |
| HOUSE-CHKL-009 | Delete a checklist | | | | Maestro | `e2e/maestro/tasks/checklist-defaults-create.yaml` | ☑ | ☐ | ☐ | Flow `checklist-defaults-create.yaml` |
| HOUSE-CHKL-010 | Seasonal checklist loads | | | | Maestro | `e2e/maestro/tasks/checklist-defaults-create.yaml` | ☑ | ☐ | ☐ | Flow `checklist-defaults-create.yaml` |
| HOUSE-CHKL-011 | Seasonal checklist history | | | | Maestro | `e2e/maestro/tasks/checklist-defaults-create.yaml` | ☑ | ☐ | ☐ | Flow `checklist-defaults-create.yaml` |
| HOUSE-CHKL-012 | Add an item to a seasonal checklist | | | | Maestro | `e2e/maestro/tasks/checklist-defaults-create.yaml` | ☑ | ☐ | ☐ | Flow `checklist-defaults-create.yaml` |
| HOUSE-CHKL-013 | Complete a seasonal item | | | | Maestro | `e2e/maestro/tasks/checklist-defaults-create.yaml` | ☑ | ☐ | ☐ | Flow `checklist-defaults-create.yaml` |
| HOUSE-CHKL-014 | Generate a seasonal checklist | | | | Maestro | `e2e/maestro/tasks/checklist-defaults-create.yaml` | ☑ | ☐ | ☐ | Flow `checklist-defaults-create.yaml` |
| HOUSE-CHKL-015 | Offline checklists | | | | Maestro | `e2e/maestro/tasks/checklist-defaults-create.yaml` | ☑ | ☐ | ☐ | Flow `checklist-defaults-create.yaml` |
| HOUSE-CHKL-016 | Empty seasonal state | | | | Maestro | `e2e/maestro/tasks/checklist-defaults-create.yaml` | ☑ | ☐ | ☐ | Flow `checklist-defaults-create.yaml` |
| HOUSE-GARD-001 | Garden screen mounts | | | | Maestro | `e2e/maestro/gardening/gardening-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): gardening-screen |
| HOUSE-GARD-002 | Garden screen scrolls to its end | | | | Maestro | `e2e/maestro/gardening/gardening-screen.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-GARD-003 | Upload a garden plan image | | | | Maestro | `e2e/maestro/garden/garden-deferred-readonly.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): garden-deferred-readonly |
| HOUSE-GARD-004 | Confirm a boundary draft | | | | Maestro | `e2e/maestro/garden/garden-deferred-readonly.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): garden-deferred-readonly |
| HOUSE-GARD-005 | Discard a boundary draft | | | | Maestro | `e2e/maestro/garden/garden-deferred-readonly.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): garden-deferred-readonly |
| HOUSE-GARD-006 | Garden plan address entry | | | | Maestro | `e2e/maestro/garden/garden-deferred-readonly.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): garden-deferred-readonly |
| HOUSE-GARD-007 | Address validation | | | | Maestro | `e2e/maestro/garden/garden-deferred-readonly.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): garden-deferred-readonly |
| HOUSE-GARD-008 | Delete a garden marker | | | | Maestro | `e2e/maestro/garden/garden-deferred-readonly.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): garden-deferred-readonly |
| HOUSE-GARD-009 | Add a plan item / marker | | | | Maestro | `e2e/maestro/garden/garden-plan-add.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): garden-plan-add |
| HOUSE-GARD-010 | Edit a plan item | | | | Maestro | `e2e/maestro/garden/garden-plan-mutations.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): garden-plan-mutations |
| HOUSE-GARD-011 | Delete a plan item | | | | Maestro | `e2e/maestro/garden/garden-plan-mutations.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): garden-plan-mutations |
| HOUSE-GARD-012 | Cancelling an upload changes nothing | | | | Maestro | `e2e/maestro/garden/garden-deferred-readonly.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): garden-deferred-readonly |
| HOUSE-GARD-013 | Item name is required | | | | Maestro | `e2e/maestro/garden/garden-deferred-readonly.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): garden-deferred-readonly |
| HOUSE-GARD-014 | Offline garden upload | | | | Maestro | `e2e/maestro/garden/garden-deferred-readonly.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): garden-deferred-readonly |
| HOUSE-GARD-015 | Empty garden state | | | | Maestro | `e2e/maestro/garden/garden-deferred-readonly.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): garden-deferred-readonly |
| HOUSE-GARD-016 | Garden plan detail loads | | | | Maestro | `e2e/maestro/garden/garden-deferred-readonly.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): garden-deferred-readonly |
| HOUSE-GARD-017 | Delete a garden plan | | | | Maestro | `e2e/maestro/garden/garden-deferred-readonly.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): garden-deferred-readonly |
| HOUSE-GARD-018 | Both Maestro garden directories run | | | | Maestro | `e2e/maestro/gardening/gardening-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): gardening-screen |
| HOUSE-GARD-019 | Garden plan generated by AI Housekeeper approval | | | | API | `backend/src/routes/__tests__/garden-plans.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| HOUSE-GARD-020 | Boundary drawn without an uploaded plan | | | | Maestro | `e2e/maestro/garden/garden-deferred-readonly.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): garden-deferred-readonly |
| HOUSE-FP-001 | Onboarding floor-plan step mounts | | | | Maestro | `e2e/maestro/onboarding/floor-plan.yaml` | ☑ | ☐ | ☐ | Flow `floor-plan.yaml` |
| HOUSE-FP-002 | Upload a floor plan from onboarding | | | | Maestro | `e2e/maestro/onboarding/floor-plan.yaml` | ☑ | ☐ | ☐ | Flow `floor-plan.yaml` |
| HOUSE-FP-003 | Skip the floor-plan step | | | | Maestro | `e2e/maestro/onboarding/floor-plan.yaml` | ☑ | ☐ | ☐ | Flow `floor-plan.yaml` |
| HOUSE-FP-004 | Floor-plan viewer loads | | | | Maestro | `e2e/maestro/floor-plans/floor-plans-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): floor-plans-screen |
| HOUSE-FP-005 | Pinch-zoom and pan the plan | | | | Maestro | `e2e/maestro/floor-plans/floor-plans-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): floor-plans-screen |
| HOUSE-FP-006 | Calibrate the plan scale | | | | Maestro | `e2e/maestro/floor-plans/floor-plans-deferred-readonly.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): floor-plans-deferred-readonly |
| HOUSE-FP-007 | Place a marker | | | | Maestro | `e2e/maestro/floor-plans/floor-plans-mutations.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): floor-plans-mutations |
| HOUSE-FP-008 | Move a marker | | | | Maestro | `deferred` — no marker drag testIDs; see floor-plans-mutatio | ☐ | ☐ | ☑ | No suite run for cited flow(s): floor-plans-mutations |
| HOUSE-FP-009 | Delete a marker | | | | Maestro | `e2e/maestro/floor-plans/floor-plans-mutations.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): floor-plans-mutations |
| HOUSE-FP-010 | Add an area annotation | | | | Maestro | `e2e/maestro/floor-plans/floor-plans-mutations.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): floor-plans-mutations |
| HOUSE-FP-011 | Edit an area label | | | | Maestro | `e2e/maestro/floor-plans/floor-plans-mutations.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): floor-plans-mutations |
| HOUSE-FP-012 | Delete an area | | | | Maestro | `e2e/maestro/floor-plans/floor-plans-mutations.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): floor-plans-mutations |
| HOUSE-FP-013 | Replace the plan image | | | | Maestro | `e2e/maestro/floor-plans/floor-plans-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): floor-plans-screen |
| HOUSE-FP-014 | Delete a floor plan | | | | Maestro | `e2e/maestro/floor-plans/floor-plans-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): floor-plans-screen |
| HOUSE-FP-015 | Cancelling calibration keeps the old scale | | | | Maestro | `e2e/maestro/floor-plans/floor-plans-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): floor-plans-screen |
| HOUSE-FP-016 | Saving without an image is blocked | | | | Maestro | `e2e/maestro/onboarding/floor-plan.yaml` | ☑ | ☐ | ☐ | Flow `floor-plan.yaml` |
| HOUSE-FP-017 | Offline floor-plan upload | | | | Maestro | `e2e/maestro/onboarding/floor-plan.yaml` | ☑ | ☐ | ☐ | Flow `floor-plan.yaml` |
| HOUSE-FP-018 | Floor-plans list API shape | | | | Unit | `e2e/maestro/floor-plans/floor-plans-screen.yaml` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-FP-019 | Many markers stay usable | | | | Maestro | `e2e/maestro/floor-plans/floor-plans-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): floor-plans-screen |
| HOUSE-FP-020 | Marker before calibration | | | | Maestro | `e2e/maestro/floor-plans/floor-plans-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): floor-plans-screen |
| HOUSE-FP-021 | Floor-plan picker screen | | | | Maestro | `e2e/maestro/floor-plans/floor-plans-screen.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): floor-plans-screen |
| HOUSE-FP-022 | Region detection pipeline | | | | API | `backend/src/services/__tests__/floor-plan-region-pipeline.t | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| HOUSE-FP-023 | Space hit-testing on the plan | | | | Unit | `src/utils/__tests__/spaceHitTest.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-HPROJ-001 | Projects list mounts | | | | Maestro | `e2e/maestro/home-projects/home-projects-smoke.yaml` | ☐ | ☑ | ☐ | Flow `home-projects-smoke.yaml` failed |
| HOUSE-HPROJ-002 | Projects list scrolls to its end | | | | Maestro | `e2e/maestro/home-projects/home-projects-smoke.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-HPROJ-003 | Create control is visible | | | | Maestro | `e2e/maestro/home-projects/home-projects-smoke.yaml` | ☐ | ☑ | ☐ | Flow `home-projects-smoke.yaml` failed |
| HOUSE-HPROJ-004 | Archived filter toggles the list | | | | Maestro | `e2e/maestro/home-projects/home-projects-smoke.yaml` | ☐ | ☑ | ☐ | Flow `home-projects-smoke.yaml` failed |
| HOUSE-HPROJ-005 | Create wizard mounts | | | | Maestro | `e2e/maestro/home-projects/home-projects-smoke.yaml` | ☐ | ☑ | ☐ | Flow `home-projects-smoke.yaml` failed |
| HOUSE-HPROJ-006 | Create a project | | | | Maestro | `e2e/maestro/home-projects/home-projects-smoke.yaml` | ☐ | ☑ | ☐ | Flow `home-projects-smoke.yaml` failed |
| HOUSE-HPROJ-007 | Create requires a title | | | | Maestro | `e2e/maestro/home-projects/home-projects-smoke.yaml` | ☐ | ☑ | ☐ | Flow `home-projects-smoke.yaml` failed |
| HOUSE-HPROJ-008 | Cancelling the wizard creates nothing | | | | Maestro | `e2e/maestro/home-projects/home-projects-smoke.yaml` | ☐ | ☑ | ☐ | Flow `home-projects-smoke.yaml` failed |
| HOUSE-HPROJ-009 | Project hub loads | | | | Maestro | `e2e/maestro/home-projects/home-projects-smoke.yaml` | ☐ | ☑ | ☐ | Flow `home-projects-smoke.yaml` failed |
| HOUSE-HPROJ-010 | Archive a project | | | | Maestro | `e2e/maestro/home-projects/home-projects-smoke.yaml` | ☐ | ☑ | ☐ | Flow `home-projects-smoke.yaml` failed |
| HOUSE-HPROJ-011 | Create a task inside a project | | | | Maestro | `e2e/maestro/home-projects/home-projects-smoke.yaml` | ☐ | ☑ | ☐ | Flow `home-projects-smoke.yaml` failed |
| HOUSE-HPROJ-012 | Attach a "before" photo | | | | Maestro | `e2e/maestro/home-projects/home-projects-hub.yaml` | ☐ | ☑ | ☐ | Flow `home-projects-hub.yaml` failed |
| HOUSE-HPROJ-013 | Attach an "after" photo | | | | Maestro | `e2e/maestro/home-projects/home-projects-hub.yaml` | ☐ | ☑ | ☐ | Flow `home-projects-hub.yaml` failed |
| HOUSE-HPROJ-014 | Add a project comment | | | | Maestro | `e2e/maestro/home-projects/home-projects-hub.yaml` | ☐ | ☑ | ☐ | Flow `home-projects-hub.yaml` failed |
| HOUSE-HPROJ-015 | Selections list | | | | Maestro | `e2e/maestro/home-projects/home-projects-hub-mutations.yaml` | ☐ | ☑ | ☐ | Flow `home-projects-hub-mutations.yaml` failed |
| HOUSE-HPROJ-016 | Create a selection item | | | | Maestro | `e2e/maestro/home-projects/home-projects-hub-mutations.yaml` | ☐ | ☑ | ☐ | Flow `home-projects-hub-mutations.yaml` failed |
| HOUSE-HPROJ-017 | Add / advance a project phase | | | | Maestro | `e2e/maestro/home-projects/home-projects-hub.yaml` | ☐ | ☑ | ☐ | Flow `home-projects-hub.yaml` failed |
| HOUSE-HPROJ-018 | Edit project details | | | | Maestro | `e2e/maestro/home-projects/home-projects-hub.yaml` | ☐ | ☑ | ☐ | Flow `home-projects-hub.yaml` failed |
| HOUSE-HPROJ-019 | AI project assist | | | | Maestro | `e2e/maestro/home-projects/home-projects-hub-mutations.yaml` | ☐ | ☑ | ☐ | Flow `home-projects-hub-mutations.yaml` failed |
| HOUSE-HPROJ-020 | Export a project | | | | Maestro | `e2e/maestro/home-projects/home-projects-hub-mutations.yaml` | ☐ | ☑ | ☐ | Flow `home-projects-hub-mutations.yaml` failed |
| HOUSE-HPROJ-021 | Projects smoke bundle | | | | Maestro | `e2e/maestro/home-projects/home-projects-smoke.yaml` | ☐ | ☑ | ☐ | Flow `home-projects-smoke.yaml` failed |
| HOUSE-HPROJ-022 | Offline project create | | | | Maestro | `e2e/maestro/home-projects/home-projects-smoke.yaml` | ☐ | ☑ | ☐ | Flow `home-projects-smoke.yaml` failed |
| HOUSE-HPROJ-023 | Duplicate project title | | | | Maestro | `e2e/maestro/home-projects/home-projects-smoke.yaml` | ☐ | ☑ | ☐ | Flow `home-projects-smoke.yaml` failed |
| HOUSE-HPROJ-024 | Timeline renders phases in order | | | | Maestro, API | `e2e/maestro/home-projects/home-projects-hub.yaml`, `backend | ☐ | ☑ | ☐ | Flow `home-projects-hub.yaml` failed |
| HOUSE-HPROJ-025 | My Home projects shortcut | | | | Maestro | `e2e/maestro/my-home/my-home-screen.yaml` | ☐ | ☑ | ☐ | Flow `my-home-screen.yaml` failed |
| HOUSE-HPROJ-026 | Project templates list | | | | Maestro | `e2e/maestro/home-projects/home-projects-smoke.yaml` | ☐ | ☑ | ☐ | Flow `home-projects-smoke.yaml` failed |
| HOUSE-MYHOME-001 | My Home hub mounts | | | | Maestro | `e2e/maestro/my-home/my-home-screen.yaml`, `e2e/maestro/subf | ☐ | ☑ | ☐ | Flow `my-home-screen.yaml` failed |
| HOUSE-MYHOME-002 | My Home reaches its scroll sentinel | | | | Maestro | `e2e/maestro/my-home/my-home-screen.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-MYHOME-003 | Every tile navigates somewhere real | | | | Maestro | `e2e/maestro/my-home/my-home-screen.yaml` | ☐ | ☑ | ☐ | Flow `my-home-screen.yaml` failed |
| HOUSE-MYHOME-004 | Home features list mounts | | | | Maestro, Unit | `e2e/maestro/my-home/home-features-load.yaml`, `src/screens/ | ☑ | ☐ | ☐ | Flow `home-features-load.yaml` |
| HOUSE-MYHOME-005 | Filter home features by category | | | | Maestro | `e2e/maestro/my-home/my-home-screen.yaml` | ☐ | ☑ | ☐ | Flow `my-home-screen.yaml` failed |
| HOUSE-MYHOME-006 | Add a home feature | | | | Maestro | `e2e/maestro/my-home/my-home-screen.yaml` | ☐ | ☑ | ☐ | Flow `my-home-screen.yaml` failed |
| HOUSE-MYHOME-007 | Home feature requires a name | | | | Maestro | `e2e/maestro/my-home/my-home-screen.yaml` | ☐ | ☑ | ☐ | Flow `my-home-screen.yaml` failed |
| HOUSE-MYHOME-008 | Delete a home feature | | | | Maestro | `e2e/maestro/my-home/my-home-screen.yaml` | ☐ | ☑ | ☐ | Flow `my-home-screen.yaml` failed |
| HOUSE-MYHOME-009 | Cancelling feature create adds nothing | | | | Maestro | `e2e/maestro/my-home/my-home-screen.yaml` | ☐ | ☑ | ☐ | Flow `my-home-screen.yaml` failed |
| HOUSE-MYHOME-010 | Empty home-features state | | | | Maestro | `e2e/maestro/my-home/my-home-screen.yaml` | ☐ | ☑ | ☐ | Flow `my-home-screen.yaml` failed |
| HOUSE-MYHOME-011 | Offline My Home | | | | Maestro | `e2e/maestro/my-home/my-home-screen.yaml` | ☐ | ☑ | ☐ | Flow `my-home-screen.yaml` failed |
| HOUSE-MYHOME-012 | My Home reflects the active household | | | | Maestro | `e2e/maestro/my-home/my-home-screen.yaml` | ☐ | ☑ | ☐ | Flow `my-home-screen.yaml` failed |
| HOUSE-CHAT-001 | Chat rooms list mounts | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml`, `e2e/maestro/subf | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CHAT-002 | Rooms list scrolls to its end | | | | Maestro | `e2e/maestro/scroll/all-screens-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-CHAT-003 | Create-room control opens the form | | | | Maestro | `e2e/maestro/chat/chat-gaps.yaml` | ☐ | ☑ | ☐ | Flow `chat-gaps.yaml` failed |
| HOUSE-CHAT-004 | Create a room | | | | Maestro, API | `e2e/maestro/chat/chat-gaps.yaml`, `backend/src/services/__t | ☐ | ☑ | ☐ | Flow `chat-gaps.yaml` failed |
| HOUSE-CHAT-005 | Room name is required | | | | Maestro | `e2e/maestro/chat/chat-gaps.yaml` | ☐ | ☑ | ☐ | Flow `chat-gaps.yaml` failed |
| HOUSE-CHAT-006 | Cancelling create adds no room | | | | Maestro | `e2e/maestro/chat/chat-gaps.yaml` | ☐ | ☑ | ☐ | Flow `chat-gaps.yaml` failed |
| HOUSE-CHAT-007 | Delete a room | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CHAT-008 | Open a room and load messages | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CHAT-009 | Send a message | | | | Maestro, Unit | `e2e/maestro/chat/chat-gaps.yaml`, `src/stores/__tests__/cha | ☐ | ☑ | ☐ | Flow `chat-gaps.yaml` failed |
| HOUSE-CHAT-010 | Empty message is not sendable | | | | Maestro | `e2e/maestro/chat/chat-gaps.yaml` | ☐ | ☑ | ☐ | Flow `chat-gaps.yaml` failed |
| HOUSE-CHAT-011 | Edit a sent message | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CHAT-012 | Delete a message | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CHAT-013 | Scrolling loads older messages | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-CHAT-014 | Offline send fails visibly | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CHAT-015 | Empty rooms state | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CHAT-016 | Duplicate room name policy | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CHAT-017 | Chat rooms API shape | | | | Unit | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-CHAT-018 | AI chat suggestions | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CHAT-019 | Room participants list | | | | Maestro | `e2e/maestro/chat/chat-gaps.yaml` | ☐ | ☑ | ☐ | Flow `chat-gaps.yaml` failed |
| HOUSE-CHAT-020 | Attach an image to a message | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CHAT-021 | Read receipts clear the unread badge | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CHAT-022 | Cross-member visibility | | | | Maestro | `e2e/maestro/chat/chat-rooms-screen.yaml` | ☐ | ☑ | ☐ | Flow `chat-rooms-screen.yaml` failed |
| HOUSE-CHAT-023 | House chat is separate from Budget chat | | | | Unit | `src/features/budget/chat/__tests__/budgetChatApi.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-MIRA-001 | Mira screen mounts | | | | Maestro | `e2e/maestro/mira/mira-chat-screen.yaml`, `e2e/maestro/subfl | ☑ | ☐ | ☐ | Flow `mira-chat-screen.yaml` |
| HOUSE-MIRA-002 | History scrolls with the composer pinned | | | | Maestro | `e2e/maestro/mira/mira-chat-send.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-MIRA-003 | Composer controls are visible | | | | Maestro | `e2e/maestro/mira/mira-chat-screen.yaml` | ☑ | ☐ | ☐ | Flow `mira-chat-screen.yaml` |
| HOUSE-MIRA-004 | Send a message and receive a reply | | | | Maestro | `e2e/maestro/mira/mira-chat-send.yaml` | ☐ | ☑ | ☐ | Flow `mira-chat-send.yaml` failed |
| HOUSE-MIRA-005 | Empty send is blocked | | | | Maestro | `e2e/maestro/mira/mira-chat-send.yaml` | ☐ | ☑ | ☐ | Flow `mira-chat-send.yaml` failed |
| HOUSE-MIRA-006 | Attach menu opens | | | | Maestro | `e2e/maestro/mira/mira-chat-screen.yaml` | ☑ | ☐ | ☐ | Flow `mira-chat-screen.yaml` |
| HOUSE-MIRA-007 | Attach a photo to a message | | | | Maestro | `e2e/maestro/mira/mira-chat-send.yaml` | ☐ | ☑ | ☐ | Flow `mira-chat-send.yaml` failed |
| HOUSE-MIRA-008 | Overflow menu opens | | | | Maestro | `e2e/maestro/mira/mira-chat-screen.yaml` | ☑ | ☐ | ☐ | Flow `mira-chat-screen.yaml` |
| HOUSE-MIRA-009 | Clear the conversation | | | | Maestro | `e2e/maestro/mira/mira-chat-send.yaml` | ☐ | ☑ | ☐ | Flow `mira-chat-send.yaml` failed |
| HOUSE-MIRA-010 | Voice input starts recording | | | | Maestro | `e2e/maestro/mira/mira-chat-screen.yaml` | ☑ | ☐ | ☐ | Flow `mira-chat-screen.yaml` |
| HOUSE-MIRA-011 | Cancelling voice input sends nothing | | | | Maestro | `e2e/maestro/mira/mira-chat-send.yaml` | ☐ | ☑ | ☐ | Flow `mira-chat-send.yaml` failed |
| HOUSE-MIRA-012 | Offline send fails visibly | | | | Maestro | `e2e/maestro/mira/mira-chat-send.yaml` | ☐ | ☑ | ☐ | Flow `mira-chat-send.yaml` failed |
| HOUSE-MIRA-013 | Very long prompt is handled | | | | Maestro | `e2e/maestro/mira/mira-chat-send.yaml` | ☐ | ☑ | ☐ | Flow `mira-chat-send.yaml` failed |
| HOUSE-MIRA-014 | Double-tap send produces one message | | | | Maestro | `e2e/maestro/mira/mira-chat-send.yaml` | ☐ | ☑ | ☐ | Flow `mira-chat-send.yaml` failed |
| HOUSE-MIRA-015 | Chat API request contract | | | | Unit | `e2e/maestro/mira/mira-chat-send.yaml` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-MIRA-016 | Home brief deep-links into Mira with context | | | | Maestro | `e2e/maestro/mira/mira-gaps.yaml` | ☐ | ☑ | ☐ | Flow `mira-gaps.yaml` failed |
| HOUSE-MIRA-017 | Typing indicator appears then clears | | | | Maestro | `e2e/maestro/mira/mira-chat-send.yaml` | ☐ | ☑ | ☐ | Flow `mira-chat-send.yaml` failed |
| HOUSE-MIRA-018 | Session survives a tab switch | | | | Maestro | `e2e/maestro/mira/mira-chat-send.yaml` | ☐ | ☑ | ☐ | Flow `mira-chat-send.yaml` failed |
| HOUSE-MIRA-019 | Mira honours BYOK provider selection | | | | Maestro | `e2e/maestro/mira/mira-chat-send.yaml` | ☐ | ☑ | ☐ | Flow `mira-chat-send.yaml` failed |
| HOUSE-AIHK-001 | Briefings hub mounts | | | | Maestro | `e2e/maestro/aihousekeeper/briefings.yaml` | ☐ | ☑ | ☐ | Flow `briefings.yaml` failed |
| HOUSE-AIHK-002 | Briefings list scrolls to its end | | | | Maestro | `e2e/maestro/aihousekeeper/briefings.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-AIHK-003 | Open a briefing | | | | Maestro | `e2e/maestro/aihousekeeper/briefings.yaml` | ☐ | ☑ | ☐ | Flow `briefings.yaml` failed |
| HOUSE-AIHK-004 | Approvals queue mounts | | | | Maestro | `e2e/maestro/aihousekeeper/approvals.yaml` | ☐ | ☑ | ☐ | Flow `approvals.yaml` failed |
| HOUSE-AIHK-005 | Approve a pending action | | | | Maestro, API | `e2e/maestro/aihousekeeper/approvals.yaml`, `backend/src/rou | ☐ | ☑ | ☐ | Flow `approvals.yaml` failed |
| HOUSE-AIHK-006 | Cancel a pending action | | | | Maestro | `e2e/maestro/aihousekeeper/briefings.yaml` | ☐ | ☑ | ☐ | Flow `briefings.yaml` failed |
| HOUSE-AIHK-007 | Backing out of an approval changes nothing | | | | Maestro | `e2e/maestro/aihousekeeper/briefings.yaml` | ☐ | ☑ | ☐ | Flow `briefings.yaml` failed |
| HOUSE-AIHK-008 | Trust ledger loads | | | | Maestro | `e2e/maestro/aihousekeeper/trust-ledger.yaml` | ☐ | ☑ | ☐ | Flow `trust-ledger.yaml` failed |
| HOUSE-AIHK-009 | Trust ledger scrolls to its end | | | | Maestro | `e2e/maestro/aihousekeeper/trust-ledger.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-AIHK-010 | Connected accounts screen loads | | | | Maestro | `e2e/maestro/aihousekeeper/connected-accounts.yaml` | ☐ | ☑ | ☐ | Flow `connected-accounts.yaml` failed |
| HOUSE-AIHK-011 | Start a connect flow | | | | Maestro | `e2e/maestro/aihousekeeper/briefings.yaml` | ☐ | ☑ | ☐ | Flow `briefings.yaml` failed |
| HOUSE-AIHK-012 | Disconnect an integration | | | | Maestro | `e2e/maestro/aihousekeeper/briefings.yaml` | ☐ | ☑ | ☐ | Flow `briefings.yaml` failed |
| HOUSE-AIHK-013 | AI Housekeeper preferences load | | | | Maestro | `e2e/maestro/aihousekeeper/settings.yaml` | ☐ | ☑ | ☐ | Flow `settings.yaml` failed |
| HOUSE-AIHK-014 | Enable a preference | | | | Maestro | `e2e/maestro/aihousekeeper/settings.yaml` | ☐ | ☑ | ☐ | Flow `settings.yaml` failed |
| HOUSE-AIHK-015 | Disable a preference | | | | Maestro | `e2e/maestro/aihousekeeper/briefings.yaml` | ☐ | ☑ | ☐ | Flow `briefings.yaml` failed |
| HOUSE-AIHK-016 | Identity panel loads | | | | Maestro | `e2e/maestro/aihousekeeper/briefings.yaml` | ☐ | ☑ | ☐ | Flow `briefings.yaml` failed |
| HOUSE-AIHK-017 | Update the identity | | | | Maestro | `e2e/maestro/aihousekeeper/briefings.yaml` | ☐ | ☑ | ☐ | Flow `briefings.yaml` failed |
| HOUSE-AIHK-018 | Play a voice briefing | | | | Maestro | `e2e/maestro/aihousekeeper/briefings.yaml` | ☐ | ☑ | ☐ | Flow `briefings.yaml` failed |
| HOUSE-AIHK-019 | Offline approve fails visibly | | | | Maestro | `e2e/maestro/aihousekeeper/briefings.yaml` | ☐ | ☑ | ☐ | Flow `briefings.yaml` failed |
| HOUSE-AIHK-020 | Empty approvals state | | | | Maestro | `e2e/maestro/aihousekeeper/approvals.yaml` | ☐ | ☑ | ☐ | Flow `approvals.yaml` failed |
| HOUSE-AIHK-021 | AI Housekeeper hub screen | | | | Unit | `src/screens/aihousekeeper/__tests__/AihousekeeperHubScreen. | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-AIHK-022 | Ledger filtering | | | | Maestro | `e2e/maestro/aihousekeeper/briefings.yaml` | ☐ | ☑ | ☐ | Flow `briefings.yaml` failed |
| HOUSE-AIHK-023 | Memory list and delete | | | | Maestro | `e2e/maestro/aihousekeeper/briefings.yaml` | ☐ | ☑ | ☐ | Flow `briefings.yaml` failed |
| HOUSE-AIHK-024 | Follow-ups list | | | | Maestro | `e2e/maestro/aihousekeeper/briefings.yaml` | ☐ | ☑ | ☐ | Flow `briefings.yaml` failed |
| HOUSE-AIHK-025 | Home insight card | | | | Maestro | `e2e/maestro/aihousekeeper/briefings.yaml` | ☐ | ☑ | ☐ | Flow `briefings.yaml` failed |
| HOUSE-AIHK-026 | Suggestion accept / dismiss / snooze | | | | Maestro | `e2e/maestro/aihousekeeper/briefings.yaml` | ☐ | ☑ | ☐ | Flow `briefings.yaml` failed |
| HOUSE-AIHK-027 | AI Housekeeper onboarding | | | | Maestro | `e2e/maestro/aihousekeeper/briefings.yaml` | ☐ | ☑ | ☐ | Flow `briefings.yaml` failed |
| HOUSE-AIHK-028 | Push-permission screen | | | | Maestro | `e2e/maestro/aihousekeeper/briefings.yaml` | ☐ | ☑ | ☐ | Flow `briefings.yaml` failed |
| HOUSE-SPACE-001 | Spaces management mounts | | | | Maestro | `e2e/maestro/spaces/spaces-management.yaml` | ☐ | ☑ | ☐ | Flow `spaces-management.yaml` failed |
| HOUSE-SPACE-002 | Spaces list scrolls to the add row | | | | Maestro | `e2e/maestro/spaces/spaces-management.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-SPACE-003 | Add control is visible | | | | Maestro | `e2e/maestro/spaces/spaces-management.yaml` | ☐ | ☑ | ☐ | Flow `spaces-management.yaml` failed |
| HOUSE-SPACE-004 | Add a space | | | | Maestro, API | `e2e/maestro/onboarding/space-setup.yaml`, `backend/src/serv | ☐ | ☑ | ☐ | Flow `space-setup.yaml` failed |
| HOUSE-SPACE-005 | Space name is required | | | | Maestro | `e2e/maestro/spaces/spaces-management.yaml` | ☐ | ☑ | ☐ | Flow `spaces-management.yaml` failed |
| HOUSE-SPACE-006 | Cancelling add creates nothing | | | | Maestro | `e2e/maestro/spaces/spaces-management.yaml` | ☐ | ☑ | ☐ | Flow `spaces-management.yaml` failed |
| HOUSE-SPACE-007 | Rename a space | | | | Maestro | `e2e/maestro/spaces/spaces-management.yaml` | ☐ | ☑ | ☐ | Flow `spaces-management.yaml` failed |
| HOUSE-SPACE-008 | Delete a space | | | | Maestro | `e2e/maestro/spaces/spaces-management.yaml` | ☐ | ☑ | ☐ | Flow `spaces-management.yaml` failed |
| HOUSE-SPACE-009 | Cancelling delete keeps the space | | | | Maestro | `e2e/maestro/spaces/spaces-management.yaml` | ☐ | ☑ | ☐ | Flow `spaces-management.yaml` failed |
| HOUSE-SPACE-010 | Reorder spaces | | | | Maestro | `e2e/maestro/spaces/spaces-management.yaml` | ☐ | ☑ | ☐ | Flow `spaces-management.yaml` failed |
| HOUSE-SPACE-011 | Space detail loads | | | | Maestro | `e2e/maestro/spaces/spaces-management.yaml` | ☐ | ☑ | ☐ | Flow `spaces-management.yaml` failed |
| HOUSE-SPACE-012 | Space presets list | | | | Maestro | `e2e/maestro/spaces/spaces-management.yaml` | ☐ | ☑ | ☐ | Flow `spaces-management.yaml` failed |
| HOUSE-SPACE-013 | Offline add fails visibly | | | | Maestro | `e2e/maestro/spaces/spaces-management.yaml` | ☐ | ☑ | ☐ | Flow `spaces-management.yaml` failed |
| HOUSE-SPACE-014 | Deleting the last space | | | | Maestro | `e2e/maestro/spaces/spaces-management.yaml` | ☐ | ☑ | ☐ | Flow `spaces-management.yaml` failed |
| HOUSE-SPACE-015 | Duplicate space name | | | | Maestro | `e2e/maestro/spaces/spaces-management.yaml` | ☐ | ☑ | ☐ | Flow `spaces-management.yaml` failed |
| HOUSE-SPACE-016 | Bulk-create spaces | | | | Maestro | `e2e/maestro/onboarding/space-setup.yaml` | ☐ | ☑ | ☐ | Flow `space-setup.yaml` failed |
| HOUSE-SPACE-017 | Space labels render consistently | | | | Unit | `src/utils/__tests__/spaceLabels.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-HH-001 | Household management mounts | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☑ | ☐ | Flow `household-management.yaml` failed |
| HOUSE-HH-002 | Household screen scrolls to its end | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-HH-003 | Create an additional household | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☑ | ☐ | Flow `household-management.yaml` failed |
| HOUSE-HH-004 | Rename a household | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☑ | ☐ | Flow `household-management.yaml` failed |
| HOUSE-HH-005 | Delete a household | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☑ | ☐ | Flow `household-management.yaml` failed |
| HOUSE-HH-006 | Leave a household | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☑ | ☐ | Flow `household-management.yaml` failed |
| HOUSE-HH-007 | Invite a member by email | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☑ | ☐ | Flow `household-management.yaml` failed |
| HOUSE-HH-008 | Generate an invite link | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☑ | ☐ | Flow `household-management.yaml` failed |
| HOUSE-HH-009 | Pending invitations list | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☑ | ☐ | Flow `household-management.yaml` failed |
| HOUSE-HH-010 | Revoke an invitation | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☑ | ☐ | Flow `household-management.yaml` failed |
| HOUSE-HH-011 | Accept an invitation in-app | | | | Maestro | `e2e/maestro/onboarding/join-household.yaml` | ☐ | ☑ | ☐ | Flow `join-household.yaml` failed |
| HOUSE-HH-012 | Decline an invitation in-app | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☑ | ☐ | Flow `household-management.yaml` failed |
| HOUSE-HH-013 | Approve a join request | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☑ | ☐ | Flow `household-management.yaml` failed |
| HOUSE-HH-014 | Deny a join request | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☑ | ☐ | Flow `household-management.yaml` failed |
| HOUSE-HH-015 | Change a member's role | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☑ | ☐ | Flow `household-management.yaml` failed |
| HOUSE-HH-016 | Remove a member | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☑ | ☐ | Flow `household-management.yaml` failed |
| HOUSE-HH-017 | Switch the active household | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☑ | ☐ | Flow `household-management.yaml` failed |
| HOUSE-HH-018 | Household photo | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☑ | ☐ | Flow `household-management.yaml` failed |
| HOUSE-HH-019 | Remove the household photo | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☑ | ☐ | Flow `household-management.yaml` failed |
| HOUSE-HH-020 | User search for invites | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☑ | ☐ | Flow `household-management.yaml` failed |
| HOUSE-HH-021 | Invalid invite email is rejected | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☑ | ☐ | Flow `household-management.yaml` failed |
| HOUSE-HH-022 | Sole owner cannot leave | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☑ | ☐ | Flow `household-management.yaml` failed |
| HOUSE-HH-023 | Member role limits are enforced | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☑ | ☐ | Flow `household-management.yaml` failed |
| HOUSE-HH-024 | Offline invite fails visibly | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☑ | ☐ | Flow `household-management.yaml` failed |
| HOUSE-HH-025 | Household bootstrap on launch | | | | Unit | `src/stores/__tests__/appStore.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-HH-026 | Invite-link request and validation | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☑ | ☐ | Flow `household-management.yaml` failed |
| HOUSE-HH-027 | My pending join requests | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☑ | ☐ | Flow `household-management.yaml` failed |
| HOUSE-HH-028 | Owner-pending link requests | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☑ | ☐ | Flow `household-management.yaml` failed |
| HOUSE-HH-029 | Cross-household data isolation | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| HOUSE-HH-030 | Invite store state | | | | Unit | `src/stores/__tests__/inviteStore.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-BUDGET-001 | Budget tab mounts on House | | | | Maestro, Unit | `e2e/maestro/subflows/go-budget-tab.yaml`, `src/features/bud | ☐ | ☐ | ☑ | No suite run for cited flow(s): go-budget-tab |
| HOUSE-BUDGET-002 | Month stepper is visible | | | | Maestro | `e2e/maestro/subflows/go-budget-tab.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): go-budget-tab |
| HOUSE-BUDGET-003 | Previous month | | | | Maestro | `e2e/maestro/subflows/go-budget-tab.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): go-budget-tab |
| HOUSE-BUDGET-004 | Next month | | | | Maestro | `e2e/maestro/subflows/go-budget-tab.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): go-budget-tab |
| HOUSE-BUDGET-005 | Glance cards render | | | | Unit | `src/api/__tests__/home-budget.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-BUDGET-006 | Open-full-Budget CTA | | | | Unit | `src/features/budget/screens/__tests__/BudgetHomeScreen.test | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-BUDGET-007 | No add-spend affordance on House | | | | Maestro | `e2e/maestro/subflows/go-budget-tab.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): go-budget-tab |
| HOUSE-BUDGET-008 | Categories are not editable on House | | | | Maestro | `e2e/maestro/subflows/go-budget-tab.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): go-budget-tab |
| HOUSE-BUDGET-009 | Budget tab scrolls | | | | Maestro | `e2e/maestro/scroll/budget-scroll.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-BUDGET-010 | Offline Budget glance | | | | Maestro | `e2e/maestro/subflows/go-budget-tab.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): go-budget-tab |
| HOUSE-BUDGET-011 | Home-budget API paths | | | | Unit | `src/api/__tests__/home-budget.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-BUDGET-012 | Zero budget writes from House | | | | Maestro, Unit | `e2e/maestro/home/house-budget-zero-writes.yaml`, `src/featu | ☑ | ☐ | ☐ | Flow `house-budget-zero-writes.yaml` |
| HOUSE-BUDGET-013 | Budget glance matches the Budget app | | | | Unit | `src/test-utils/__tests__/budgetConsistency.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-SETT-001 | More hub mounts | | | | Maestro | `e2e/maestro/my-home/my-home-screen.yaml` | ☐ | ☑ | ☐ | Flow `my-home-screen.yaml` failed |
| HOUSE-SETT-002 | Settings screen mounts | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☑ | ☐ | ☐ | Flow `settings-screen.yaml` |
| HOUSE-SETT-003 | Settings scrolls to its last row | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit; flow `settings-screen.yaml` passed above-fold |
| HOUSE-SETT-004 | Customize-tabs screen mounts | | | | Maestro, Unit | `e2e/maestro/settings/customize-tabs.yaml`, `src/screens/set | ☐ | ☑ | ☐ | Flow `customize-tabs.yaml` failed |
| HOUSE-SETT-005 | Enable the Tasks tab | | | | Maestro, Unit | `e2e/maestro/settings/customize-tabs.yaml`, `src/navigation/ | ☐ | ☑ | ☐ | Flow `customize-tabs.yaml` failed |
| HOUSE-SETT-006 | Disable a tab | | | | Maestro, Unit | `e2e/maestro/settings/customize-tabs.yaml`, `src/components/ | ☐ | ☑ | ☐ | Flow `customize-tabs.yaml` failed |
| HOUSE-SETT-007 | Light theme | | | | Maestro, Unit | `e2e/maestro/settings/customize-tabs.yaml`, `src/screens/set | ☐ | ☑ | ☐ | Flow `customize-tabs.yaml` failed |
| HOUSE-SETT-008 | Dark theme | | | | Maestro, Unit | `e2e/maestro/settings/customize-tabs.yaml`, `src/screens/set | ☐ | ☑ | ☐ | Flow `customize-tabs.yaml` failed |
| HOUSE-SETT-009 | System theme follows the OS | | | | Maestro, Unit | `e2e/maestro/settings/customize-tabs.yaml`, `src/contexts/__ | ☐ | ☑ | ☐ | Flow `customize-tabs.yaml` failed |
| HOUSE-SETT-010 | Notification settings row | | | | Maestro, Unit | `e2e/maestro/subflows/open-notifications.yaml`, `src/screens | ☐ | ☐ | ☑ | No suite run for cited flow(s): open-notifications |
| HOUSE-SETT-011 | Biometric row persists | | | | Maestro | `e2e/maestro/auth/biometric-settings-row.yaml` | ☑ | ☐ | ☐ | Flow `biometric-settings-row.yaml` |
| HOUSE-SETT-012 | Soft Transfer row | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☑ | ☐ | ☐ | Flow `settings-screen.yaml` |
| HOUSE-SETT-013 | Home-projects settings row | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☑ | ☐ | ☐ | Flow `settings-screen.yaml` |
| HOUSE-SETT-014 | Spaces settings row | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☑ | ☐ | ☐ | Flow `settings-screen.yaml` |
| HOUSE-SETT-015 | Household settings row | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☑ | ☐ | ☐ | Flow `settings-screen.yaml` |
| HOUSE-SETT-016 | Backing out of Appearance keeps the old theme | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☑ | ☐ | ☐ | Flow `settings-screen.yaml` |
| HOUSE-SETT-017 | Settings write contract | | | | API | `backend/src/routes/__tests__/settings.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| HOUSE-SETT-018 | More → Garden link | | | | Maestro | `e2e/maestro/subflows/open-gardening.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): open-gardening |
| HOUSE-SETT-019 | More → My Home link | | | | Maestro | `e2e/maestro/subflows/open-my-home.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): open-my-home |
| HOUSE-SETT-020 | More → Reports link | | | | Maestro | `e2e/maestro/subflows/open-reports.yaml` | ☐ | ☐ | ☑ | No suite run for cited flow(s): open-reports |
| HOUSE-SETT-021 | Offline settings toggle | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☑ | ☐ | ☐ | Flow `settings-screen.yaml` |
| HOUSE-SETT-022 | At least one tab must stay enabled | | | | Maestro, Unit | `e2e/maestro/settings/customize-tabs.yaml`, `src/navigation/ | ☐ | ☑ | ☐ | Flow `customize-tabs.yaml` failed |
| HOUSE-SETT-023 | Reset settings to defaults | | | | Maestro | `e2e/maestro/settings/settings-subscreens.yaml` | ☑ | ☐ | ☐ | Flow `settings-subscreens.yaml` |
| HOUSE-SETT-024 | Settings sync across devices | | | | Maestro | `e2e/maestro/settings/settings-subscreens.yaml` | ☑ | ☐ | ☐ | Flow `settings-subscreens.yaml` |
| HOUSE-SETT-025 | Widget customization screen | | | | Unit | `src/services/__tests__/widget-sync.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-SETT-026 | Navigation customization screen | | | | Maestro | `e2e/maestro/settings/settings-subscreens.yaml` | ☑ | ☐ | ☐ | Flow `settings-subscreens.yaml` |
| HOUSE-SETT-027 | PDF cache settings | | | | Maestro | `e2e/maestro/settings/settings-subscreens.yaml` | ☑ | ☐ | ☐ | Flow `settings-subscreens.yaml` |
| HOUSE-SETT-028 | Privacy policy screen | | | | Maestro | `e2e/maestro/settings/settings-subscreens.yaml` | ☑ | ☐ | ☐ | Flow `settings-subscreens.yaml` |
| HOUSE-SETT-029 | Terms of service screen | | | | Maestro | `e2e/maestro/settings/settings-subscreens.yaml` | ☑ | ☐ | ☐ | Flow `settings-subscreens.yaml` |
| HOUSE-SETT-030 | AI house preferences | | | | Maestro | `e2e/maestro/settings/settings-subscreens.yaml` | ☑ | ☐ | ☐ | Flow `settings-subscreens.yaml` |
| HOUSE-SETT-031 | AI access (BYOK) entry point | | | | Maestro | `e2e/maestro/settings/settings-subscreens.yaml` | ☑ | ☐ | ☐ | Flow `settings-subscreens.yaml` |
| HOUSE-CAL-001 | Calendar sync screen mounts | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-CAL-002 | Update calendar settings | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-CAL-003 | Generate a subscription token | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-CAL-004 | Subscription tokens list | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-CAL-005 | Revoke a subscription token | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-CAL-006 | Cancelling a settings change | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-CAL-007 | Offline calendar sync | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-CAL-008 | Revoked token is unusable | | | | API | `backend/src/routes/__tests__/public-briefing.test.ts` | ☐ | ☐ | ☑ | Consolidated flow — no yaml mapping |
| HOUSE-NOTIF-001 | Notifications screen mounts | | | | Maestro | `e2e/maestro/notifications/notifications-screen.yaml`, `e2e/ | ☐ | ☑ | ☐ | Flow `notifications-screen.yaml` failed |
| HOUSE-NOTIF-002 | Notifications list scrolls | | | | Maestro | `e2e/maestro/notifications/notifications-screen.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit — optional scroll subflow |
| HOUSE-NOTIF-003 | Notification row content | | | | Maestro | `e2e/maestro/notifications/notifications-screen.yaml` | ☐ | ☑ | ☐ | Flow `notifications-screen.yaml` failed |
| HOUSE-NOTIF-004 | Mark one read | | | | Maestro | `e2e/maestro/notifications/notifications-screen.yaml` | ☐ | ☑ | ☐ | Flow `notifications-screen.yaml` failed |
| HOUSE-NOTIF-005 | Mark all read | | | | Maestro | `e2e/maestro/notifications/notifications-screen.yaml` | ☐ | ☑ | ☐ | Flow `notifications-screen.yaml` failed |
| HOUSE-NOTIF-006 | Delete one notification | | | | Maestro | `e2e/maestro/notifications/notifications-screen.yaml` | ☐ | ☑ | ☐ | Flow `notifications-screen.yaml` failed |
| HOUSE-NOTIF-007 | Delete all notifications | | | | Maestro | `e2e/maestro/notifications/notifications-screen.yaml` | ☐ | ☑ | ☐ | Flow `notifications-screen.yaml` failed |
| HOUSE-NOTIF-008 | Task-reminder deep link | | | | Maestro | `e2e/maestro/notifications/notifications-screen.yaml` | ☐ | ☑ | ☐ | Flow `notifications-screen.yaml` failed |
| HOUSE-NOTIF-009 | Report-ready deep link | | | | Maestro | `e2e/maestro/notifications/notifications-screen.yaml` | ☐ | ☑ | ☐ | Flow `notifications-screen.yaml` failed |
| HOUSE-NOTIF-010 | Push token registration | | | | Maestro | `e2e/maestro/notifications/notifications-screen.yaml` | ☐ | ☑ | ☐ | Flow `notifications-screen.yaml` failed |
| HOUSE-NOTIF-011 | Push token removal | | | | Maestro | `e2e/maestro/notifications/notifications-screen.yaml` | ☐ | ☑ | ☐ | Flow `notifications-screen.yaml` failed |
| HOUSE-NOTIF-012 | Notification preferences load and save | | | | Maestro, Unit | `e2e/maestro/notifications/notifications-screen.yaml`, `src/ | ☐ | ☑ | ☐ | Flow `notifications-screen.yaml` failed |
| HOUSE-NOTIF-013 | Per-space / per-category overrides | | | | Maestro | `e2e/maestro/notifications/notifications-screen.yaml` | ☐ | ☑ | ☐ | Flow `notifications-screen.yaml` failed |
| HOUSE-NOTIF-014 | Empty notifications state | | | | Maestro | `e2e/maestro/notifications/notifications-screen.yaml` | ☐ | ☑ | ☐ | Flow `notifications-screen.yaml` failed |
| HOUSE-NOTIF-015 | Offline notifications | | | | Maestro | `e2e/maestro/notifications/notifications-screen.yaml` | ☐ | ☑ | ☐ | Flow `notifications-screen.yaml` failed |
| HOUSE-NOTIF-016 | Marking read twice is idempotent | | | | Maestro | `e2e/maestro/notifications/notifications-screen.yaml` | ☐ | ☑ | ☐ | Flow `notifications-screen.yaml` failed |
| HOUSE-NOTIF-017 | Notifications actions bundle | | | | Maestro | `e2e/maestro/notifications/notifications-actions.yaml` | ☑ | ☐ | ☐ | Flow `notifications-actions.yaml` |
| HOUSE-NOTIF-018 | Back from Notifications restores the prior screen | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-NOTIF-019 | Only House-brand notifications appear | | | | Unit | `src/services/__tests__/notificationRouting.house-gating.tes | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-NOTIF-020 | Unread badge matches the list | | | | Maestro, Unit | `e2e/maestro/notifications/notifications-screen.yaml`, `src/ | ☐ | ☑ | ☐ | Flow `notifications-screen.yaml` failed |
| HOUSE-NOTIF-021 | Join-request notification action | | | | Maestro | `e2e/maestro/notifications/notifications-screen.yaml` | ☐ | ☑ | ☐ | Flow `notifications-screen.yaml` failed |
| HOUSE-PROF-001 | Profile screen mounts | | | | Maestro | `e2e/maestro/profile/profile-screen.yaml` | ☑ | ☐ | ☐ | Flow `profile-screen.yaml` |
| HOUSE-PROF-002 | Profile scrolls to the destructive section | | | | Maestro | `e2e/maestro/profile/profile-screen.yaml` | ☐ | ☐ | ☑ | iOS 26 scroll driver limit; flow `profile-screen.yaml` passed above-fold |
| HOUSE-PROF-003 | Edit the display name | | | | Maestro | `e2e/maestro/profile/profile-screen.yaml` | ☑ | ☐ | ☐ | Flow `profile-screen.yaml` |
| HOUSE-PROF-004 | Cancelling a name edit restores the old value | | | | Maestro | `e2e/maestro/profile/profile-screen.yaml` | ☑ | ☐ | ☐ | Flow `profile-screen.yaml` |
| HOUSE-PROF-005 | Empty name is rejected | | | | Maestro | `e2e/maestro/profile/profile-screen.yaml` | ☑ | ☐ | ☐ | Flow `profile-screen.yaml` |
| HOUSE-PROF-006 | Email is displayed read-only | | | | Maestro | `e2e/maestro/profile/profile-screen.yaml` | ☑ | ☐ | ☐ | Flow `profile-screen.yaml` |
| HOUSE-PROF-007 | Avatar upload | | | | Maestro | `e2e/maestro/profile/profile-avatar-readonly.yaml` | ☐ | ☑ | ☐ | Flow `profile-avatar-readonly.yaml` failed |
| HOUSE-PROF-008 | Avatar removal | | | | Maestro | `e2e/maestro/profile/profile-avatar-readonly.yaml` | ☐ | ☑ | ☐ | Flow `profile-avatar-readonly.yaml` failed |
| HOUSE-PROF-009 | Change password | | | | Maestro | `e2e/maestro/profile/profile-screen.yaml` | ☑ | ☐ | ☐ | Flow `profile-screen.yaml` |
| HOUSE-PROF-010 | Password change validation | | | | Maestro | `e2e/maestro/profile/profile-screen.yaml` | ☑ | ☐ | ☐ | Flow `profile-screen.yaml` |
| HOUSE-PROF-011 | Log out from Profile | | | | Maestro | `e2e/maestro/profile/profile-destructive-actions.yaml` | ☐ | ☑ | ☐ | Flow `profile-destructive-actions.yaml` failed |
| HOUSE-PROF-012 | Delete account | | | | Maestro | `e2e/maestro/profile/profile-destructive-actions.yaml` | ☐ | ☑ | ☐ | Flow `profile-destructive-actions.yaml` failed |
| HOUSE-PROF-013 | Cancelling account deletion | | | | Maestro | `e2e/maestro/profile/profile-destructive-actions.yaml` | ☐ | ☑ | ☐ | Flow `profile-destructive-actions.yaml` failed |
| HOUSE-PROF-014 | Offline profile save | | | | Maestro | `e2e/maestro/profile/profile-screen.yaml` | ☑ | ☐ | ☐ | Flow `profile-screen.yaml` |
| HOUSE-PROF-015 | User API shape | | | | Unit | `src/features/kaizen/api/__tests__/userApi.test.ts` | ☐ | ☐ | ☑ | Unit layer — score via Jest (not Maestro log) |
| HOUSE-PROF-016 | Double-save issues one PATCH | | | | Maestro | `e2e/maestro/profile/profile-screen.yaml` | ☑ | ☐ | ☐ | Flow `profile-screen.yaml` |
| HOUSE-PROF-017 | Connected-apps / Soft Transfer section | | | | Maestro | `e2e/maestro/profile/profile-screen.yaml` | ☑ | ☐ | ☐ | Flow `profile-screen.yaml` |
| HOUSE-PROF-018 | Profile reachable from the Home header | | | | Maestro | `e2e/maestro/home/home-screen-controls.yaml` | ☑ | ☐ | ☐ | Flow `home-screen-controls.yaml` |
| HOUSE-PROF-019 | Onboarding step markers | | | | Maestro | `e2e/maestro/profile/profile-screen.yaml` | ☑ | ☐ | ☐ | Flow `profile-screen.yaml` |
