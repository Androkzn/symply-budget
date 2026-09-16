# Symply Platform Acceptance Results — 2026-07-18

| Field | Value |
|-------|-------|
| **App / scope** | `platform` |
| **Run date** | `2026-07-18` |
| **Environment** | `staging` |
| **Device / OS** | Kaizen-A, iOS 26.5 |
| **Matrix source** | [platform.md](./platform.md) |
| **Maestro log** | `/tmp/maestro-platform-2026-07-18.log` |

## Summary

| Metric | Count |
|--------|------:|
| Maestro rows | 119 |
| Pass | 0 |
| Fail | 0 |
| N/A | 119 |
| Pass rate (excl. N/A) | — |

## Results

| ID | Description | Steps | Expected | Layer | Automation | Pass | Fail | N/A | Notes |
|----|-------------|-------|----------|-------|------------|:----:|:----:|:---:|-------|
| PLAT-SMOKE-001 | Logged-in app launches without crash | | | | Maestro | `e2e/maestro/subflows/launch-logged-in.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SMOKE-002 | Settings hub reachable from shell | | | | Maestro | `e2e/maestro/subflows/go-settings-tab.yaml`, `e2e/ | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SMOKE-003 | Notifications entry reachable | | | | Maestro | `e2e/maestro/subflows/open-notifications.yaml`, `e | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SMOKE-004 | Profile entry reachable | | | | Maestro | `e2e/maestro/subflows/open-profile.yaml`, `e2e/mae | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SMOKE-005 | Auth stack reachable when logged out | | | | Maestro | `e2e/maestro/auth/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SMOKE-006 | Joined-platform brand uses same auth testIDs | | | | Maestro | `e2e/maestro/kaizen/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SCROLL-001 | Settings scroll to bottom sentinel | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SCROLL-002 | Notifications scroll to bottom | | | | Maestro | `e2e/maestro/notifications/notifications-screen.ya | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SCROLL-003 | Profile scroll to bottom | | | | Maestro | `e2e/maestro/profile/profile-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SCROLL-004 | Login scroll on small phone | | | | Maestro | `e2e/maestro/auth/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SCROLL-005 | Register scroll to submit | | | | Maestro | `e2e/maestro/auth/register-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SCROLL-006 | Household management scroll | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-001 | Login screen load (logged out) | | | | Maestro | `e2e/maestro/auth/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-002 | Email sign-in CTA visible | | | | Maestro | `e2e/maestro/auth/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-003 | Email sign-in CTA interact | | | | Maestro | `e2e/maestro/auth/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-004 | Email field visible | | | | Maestro | `e2e/maestro/auth/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-005 | Password field visible | | | | Maestro | `e2e/maestro/auth/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-006 | Sign-in submit visible | | | | Maestro | `e2e/maestro/auth/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-007 | Forgot password link visible | | | | Maestro | `e2e/maestro/auth/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-008 | Sign up link visible | | | | Maestro | `e2e/maestro/auth/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-009 | Apple sign-in button visible (iOS) | | | | Maestro | `e2e/maestro/auth/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-010 | Google sign-in button visible | | | | Maestro | `e2e/maestro/auth/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-012 | Login empty submit validation | | | | Unit, Maestro | `src/screens/auth/__tests__/LoginScreen.data-bridg | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-015 | Email login success | | | | Unit, Maestro | `src/screens/auth/__tests__/LoginScreen.data-bridg | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-017 | Register screen load | | | | Maestro | `e2e/maestro/auth/register-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-018 | Register submit visible | | | | Maestro | `e2e/maestro/auth/register-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-019 | Register Google CTA visible | | | | Maestro | `e2e/maestro/auth/register-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-023 | Register new account success | | | | Unit, Maestro | `src/screens/auth/__tests__/RegisterScreen.data-br | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-033 | Accept invitation in-app | | | | API, Maestro | `e2e/maestro/platform/auth-accept-invite.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-039 | Biometric button visible when enrolled | | | | Maestro | `e2e/maestro/auth/biometric-remember-last-login.ya | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-040 | Biometric login success | | | | Maestro, Unit | `e2e/maestro/auth/biometric-remember-last-login.ya | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-042 | Biometric auto-prompt on launch | | | | Maestro | `e2e/maestro/auth/biometric-remember-last-login.ya | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-043 | Settings biometric row visible | | | | Maestro | `e2e/maestro/auth/biometric-settings-row.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-044 | Settings biometric toggle on | | | | Maestro | `e2e/maestro/auth/biometric-settings-row.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-045 | Settings biometric toggle off | | | | Maestro | `e2e/maestro/auth/biometric-settings-row.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-050 | Logout cancel | | | | Maestro | `e2e/maestro/profile/profile-destructive-actions.y | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-051 | Delete account confirm sheet | | | | Maestro | `e2e/maestro/profile/profile-destructive-actions.y | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-065 | E2E autologin bypasses biometric | | | | Maestro | `e2e/maestro/subflows/launch-logged-in.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-069 | Register cancel back to login | | | | Maestro | `e2e/maestro/auth/register-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-074 | Remember-last-login email display | | | | Maestro | `e2e/maestro/auth/biometric-remember-last-login.ya | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-001 | House welcome screen load | | | | Maestro | `e2e/maestro/onboarding/welcome.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-002 | Welcome funnel progression | | | | Maestro | `e2e/maestro/onboarding/funnel.yaml`, `e2e/maestro | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-003 | Create household path entry | | | | Maestro | `e2e/maestro/onboarding/create-household.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-004 | Create household submit | | | | Maestro, API | `e2e/maestro/onboarding/create-household.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-006 | Join household via code | | | | Maestro | `e2e/maestro/onboarding/join-household.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-007 | Join invalid code | | | | Maestro | `e2e/maestro/onboarding/join-household.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-008 | Space setup load | | | | Maestro | `e2e/maestro/onboarding/space-setup.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-009 | Add first space | | | | Maestro | `e2e/maestro/onboarding/space-setup.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-010 | Floor plan step skip | | | | Maestro | `e2e/maestro/onboarding/floor-plan.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-011 | Floor plan upload fixture | | | | Maestro | `e2e/maestro/onboarding/floor-plan.yaml`, `e2e/mae | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-012 | Initial report upload offer | | | | Maestro | `e2e/maestro/onboarding/upload-report.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-013 | Report upload pick PDF | | | | Maestro | `e2e/maestro/onboarding/upload-report.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-014 | Garbage setup step (House) | | | | Maestro | `e2e/maestro/onboarding/garbage-setup.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-018 | Language onboarding load | | | | Maestro, Unit | `e2e/maestro/language/onboarding.yaml`, `src/featu | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-019 | Language onboarding progression | | | | Maestro | `e2e/maestro/language/onboarding.yaml`, `e2e/maest | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-020 | Onboarding back preserves draft | | | | Maestro | `e2e/maestro/onboarding/create-household.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-026 | Create-household cancel writes nothing | | | | Maestro | `e2e/maestro/onboarding/create-household.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-027 | Join-household empty code validation | | | | Maestro | `e2e/maestro/onboarding/join-household.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-028 | Already-onboarded user skips the funnel | | | | Maestro | `e2e/maestro/subflows/launch-logged-in.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-029 | Onboarding funnel scroll sentinel | | | | Maestro | `e2e/maestro/onboarding/funnel.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-001 | Household settings entry visible | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-002 | Household management load (House) | | | | Maestro, API | `e2e/maestro/households/household-management.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-003 | Budget household screen load | | | | Maestro | `e2e/maestro/budget/budget-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-005 | Add property surface open | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-006 | Create household from manager | | | | API, Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-014 | Members list load | | | | Maestro | `e2e/maestro/platform/household-members.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-045 | Members roster scroll sentinel | | | | Maestro | `e2e/maestro/platform/household-members.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-046 | Property detail load (House) | | | | Maestro | `e2e/maestro/platform/property-detail.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SUB-010 | Pro tier unlocks feature | | | | Unit, Maestro | `e2e/maestro/platform/subscription-pro-tier.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-002 | AI gate allows entitled user | | | | Maestro | `e2e/maestro/mira/mira-chat-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-010 | Settings AI providers row (House) | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-011 | Connected accounts screen load | | | | Maestro | `e2e/maestro/aihousekeeper/connected-accounts.yaml | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-012 | AI Housekeeper settings load | | | | Maestro | `e2e/maestro/aihousekeeper/settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-041 | Profile → AI access entry point | | | | Maestro | `e2e/maestro/platform/ai-access-profile-entry.yaml | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-042 | AI access hub scroll sentinel | | | | Maestro | `e2e/maestro/platform/ai-access-scroll.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-001 | Notifications screen load | | | | Maestro | `e2e/maestro/notifications/notifications-screen.ya | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-002 | Empty notifications state | | | | Maestro | `e2e/maestro/notifications/notifications-screen.ya | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-004 | Notification row tap | | | | Maestro | `e2e/maestro/notifications/notifications-actions.y | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-005 | Mark all read | | | | Maestro | `e2e/maestro/notifications/notifications-actions.y | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-007 | Clear all notifications | | | | Maestro | `e2e/maestro/notifications/notifications-actions.y | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-014 | Notification preferences load | | | | Unit, Maestro | `e2e/maestro/platform/notification-settings-load.y | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-018 | Push permission first run | | | | Maestro | `e2e/maestro/platform/notifications-push-banner.ya | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-020 | Notifications scroll sentinel | | | | Maestro | `e2e/maestro/notifications/notifications-screen.ya | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-023 | Push-permission banner visible when undetermined | | | | Maestro | `e2e/maestro/platform/notifications-push-banner.ya | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-025 | Dismiss push banner | | | | Maestro | `e2e/maestro/platform/notifications-push-banner.ya | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-031 | Clear-all confirmation cancel | | | | Maestro | `e2e/maestro/notifications/notifications-actions.y | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-034 | Unread badge decrements on read | | | | Maestro | `e2e/maestro/notifications/notifications-actions.y | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-001 | Settings hub load | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml`, `e2e/ | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-002 | Appearance row visible | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-005 | Customization row visible | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-009 | Notification settings entry | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-010 | Calendar sync row (House) | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-011 | Spaces row (House) | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-012 | Floor plans row (House) | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-013 | AI Housekeeper settings row | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml`, `e2e/ | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-014 | AI insights dashboard entry | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-015 | Persona settings row | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-016 | Profile screen load | | | | Maestro | `e2e/maestro/profile/profile-screen.yaml`, `e2e/ma | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-017 | Profile edit display name | | | | Maestro | `e2e/maestro/profile/profile-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-018 | Profile edit cancel | | | | Maestro | `e2e/maestro/profile/profile-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-019 | Profile sign-out entry | | | | Maestro | `e2e/maestro/profile/profile-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-025 | Budget settings variant | | | | Maestro | `e2e/maestro/budget/budget-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-026 | Kaizen settings variant | | | | Maestro, Unit | `e2e/maestro/kaizen/settings.yaml`, `src/features/ | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-027 | Health settings via More | | | | Maestro | `e2e/maestro/health/subflows/go-more.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-028 | Language more settings | | | | Maestro | `e2e/maestro/language/more-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-031 | Settings scroll sentinel | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-041 | Profile avatar upload | | | | Maestro, Unit | `e2e/maestro/platform/profile-avatar-upload.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-001 | Data sharing entry (Budget) | | | | Maestro, API | `e2e/maestro/budget/budget-data-sharing.yaml`, `ba | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-002 | Connect Budget row (House) | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-003 | Soft Transfer connect screen load | | | | Maestro | `e2e/maestro/budget/budget-data-sharing.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-012 | Connect flow cancel | | | | Maestro | `e2e/maestro/budget/budget-data-sharing.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-013 | Export screen UI load | | | | Maestro, Unit | `e2e/maestro/budget/budget-soft-transfer-export.ya | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-014 | Export confirm success toast | | | | Maestro, Unit | `e2e/maestro/budget/budget-soft-transfer-export.ya | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-015 | Import screen list packages | | | | Maestro, Unit | `e2e/maestro/budget/budget-soft-transfer-import.ya | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-016 | Import confirm success | | | | Maestro, Unit | `e2e/maestro/budget/budget-soft-transfer-import.ya | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-017 | Health ST export row | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-018 | Language ST rows | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-027 | Export cancel writes nothing | | | | Maestro | `e2e/maestro/budget/budget-soft-transfer-export.ya | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-030 | Data sharing screen scroll | | | | Maestro | `e2e/maestro/budget/budget-data-sharing.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
