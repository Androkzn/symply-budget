# Symply Platform Acceptance Results — language

| Field | Value |
|-------|-------|
| **Doc type** | Dated scoring copy (Circle V2 style) |
| **App / scope** | `platform` |
| **Run date** | `language` |
| **Environment** | `/tmp/maestro-language-full4.log` |
| **Device / OS** | /tmp/maestro-language-2026-07-19.log |
| **Matrix source** | [platform.md](./platform.md) |
| **Maestro log(s)** | `/tmp/maestro-platform-language.log` |

## Summary

| Metric | Count |
|--------|------:|
| Matrix rows | 378 |
| Pass | 0 |
| Fail | 0 |
| N/A | 378 |
| Pass rate (excl. N/A) | — |
| Maestro flows (merged) | 0 (0 pass / 0 fail) |

## Results

| ID | Description | Steps | Expected | Layer | Automation | Pass | Fail | N/A | Notes |
|----|-------------|-------|----------|-------|------------|:----:|:----:|:---:|-------|
| PLAT-SMOKE-001 | Logged-in app launches without crash | | | | Maestro | `e2e/maestro/subflows/launch-logged-in.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SMOKE-002 | Settings hub reachable from shell | | | | Maestro | `e2e/maestro/subflows/go-settings-tab.yaml`, `e2e/maestro/se | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SMOKE-003 | Notifications entry reachable | | | | Maestro | `e2e/maestro/subflows/open-notifications.yaml`, `e2e/maestro | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SMOKE-004 | Profile entry reachable | | | | Maestro | `e2e/maestro/subflows/open-profile.yaml`, `e2e/maestro/profi | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SMOKE-005 | Auth stack reachable when logged out | | | | Maestro | `e2e/maestro/auth/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SMOKE-006 | Joined-platform brand uses same auth testIDs | | | | Maestro | `e2e/maestro/kaizen/login-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SCROLL-001 | Settings scroll to bottom sentinel | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SCROLL-002 | Notifications scroll to bottom | | | | Maestro | `e2e/maestro/notifications/notifications-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
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
| PLAT-AUTH-008 | Sign up link visible | | | | Maestro | `e2e/maestro/auth/login-screen-controls.yaml` (visibility),  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-009 | Apple sign-in button visible (iOS) | | | | Maestro | `e2e/maestro/auth/login-oauth-buttons.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-010 | Google sign-in button visible | | | | Maestro | `e2e/maestro/auth/login-oauth-buttons.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-011 | Password show/hide toggle | | | | Unit | `src/screens/auth/__tests__/LoginScreen.data-bridge.test.tsx | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-012 | Login empty submit validation | | | | Unit | `src/screens/auth/__tests__/LoginScreen.data-bridge.test.tsx | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-013 | Login invalid email validation | | | | Unit | `src/screens/auth/__tests__/LoginScreen.data-bridge.test.tsx | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-014 | Login wrong password error | | | | Unit | `src/screens/auth/__tests__/LoginScreen.data-bridge.test.tsx | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-015 | Email login success | | | | Unit, Maestro | `src/screens/auth/__tests__/LoginScreen.data-bridge.test.tsx | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-016 | Login persists session on relaunch | | | | Unit | `src/stores/__tests__/authStore.data-bridge.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-017 | Register screen load | | | | Maestro | `e2e/maestro/auth/register-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-018 | Register submit visible | | | | Maestro | `e2e/maestro/auth/register-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-019 | Register Google CTA visible | | | | Maestro | `e2e/maestro/auth/register-screen-controls.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-020 | Register empty validation | | | | Unit | `src/screens/auth/__tests__/RegisterScreen.data-bridge.test. | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-021 | Register weak password validation | | | | Unit | `src/screens/auth/__tests__/RegisterScreen.data-bridge.test. | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-022 | Register duplicate email | | | | Unit | `src/screens/auth/__tests__/RegisterScreen.data-bridge.test. | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-023 | Register new account success | | | | Unit | `src/screens/auth/__tests__/RegisterScreen.data-bridge.test. | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-024 | Forgot password screen load | | | | Unit | `src/screens/auth/__tests__/LoginScreen.data-bridge.test.tsx | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-025 | Forgot password empty email | | | | Unit | `src/screens/auth/__tests__/LoginScreen.data-bridge.test.tsx | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-026 | Forgot password submit success | | | | Unit | `src/screens/auth/__tests__/LoginScreen.data-bridge.test.tsx | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-027 | Reset password with valid token | | | | API | `src/features/language/api/__tests__/languageAuth.test.ts`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-028 | Reset password invalid token | | | | API | `src/features/language/api/__tests__/languageAuth.test.ts`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-029 | Verify email with token | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts`, `back | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-030 | Resend verification (authed) | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts`, `back | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-031 | Accept invite screen load | | | | Unit | `src/features/language/api/__tests__/languageAuth.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-032 | Accept invite login redirect | | | | Unit | `src/features/language/api/__tests__/languageAuth.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-033 | Accept invitation in-app | | | | API, Maestro | `e2e/maestro/platform/auth-accept-invite.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-034 | Decline invitation in-app | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts`, `back | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-035 | Apple sign-in success | | | | Unit, Live | `src/screens/auth/__tests__/LoginScreen.data-bridge.test.tsx | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-036 | Apple sign-in cancel | | | | Live | `e2e/maestro/auth/login-screen-controls.yaml`, `src/screens/ | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-037 | Google sign-in success | | | | Unit, Live | `src/screens/auth/__tests__/LoginScreen.data-bridge.test.tsx | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-038 | Google sign-in cancel | | | | Live | `e2e/maestro/auth/login-screen-controls.yaml`, `src/screens/ | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-039 | Biometric button visible when enrolled | | | | Maestro | `e2e/maestro/auth/biometric-remember-last-login.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-040 | Biometric login success | | | | Maestro, Unit | `e2e/maestro/auth/biometric-remember-last-login.yaml`, `src/ | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-041 | Biometric login failure | | | | Unit | `src/screens/auth/__tests__/LoginScreen.biometric.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-042 | Biometric auto-prompt on launch | | | | Maestro | `e2e/maestro/auth/biometric-remember-last-login.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-043 | Settings biometric row visible | | | | Maestro | `e2e/maestro/auth/biometric-settings-row.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-044 | Settings biometric toggle on | | | | Maestro | `e2e/maestro/auth/biometric-settings-row.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-045 | Settings biometric toggle off | | | | Maestro | `e2e/maestro/auth/biometric-settings-row.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-046 | Change password success | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts`, `back | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-047 | Change password wrong current | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts`, `back | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-048 | Accept terms (ChildWelcome) | | | | Unit | `src/screens/auth/__tests__/RegisterScreen.data-bridge.test. | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-049 | Logout from profile | | | | Unit | `e2e/maestro/auth/logout-profile.yaml`, `src/stores/__tests_ | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-050 | Logout cancel | | | | Maestro | `e2e/maestro/profile/profile-destructive-actions.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-051 | Delete account confirm sheet | | | | Maestro | `e2e/maestro/profile/profile-destructive-actions.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-052 | Delete account success | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts`, `back | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-053 | 401 triggers token refresh | | | | Unit | `src/stores/__tests__/authStore.data-bridge.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-054 | Refresh failure forces re-login | | | | Unit | `src/stores/__tests__/authStore.data-bridge.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-055 | Concurrent 401 single refresh | | | | Unit | `src/stores/__tests__/authStore.data-bridge.test.ts`, `src/a | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-056 | Language brand uses `/api/v1/auth/login` | | | | Unit | `src/features/language/api/__tests__/languageAuth.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-057 | Joined-platform child proxies login | | | | API | `backend/__tests__/data-bridge/child-auth-proxy.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-058 | Platform JWT token class routing | | | | API | `backend/__tests__/data-bridge/auth-middleware-token-class.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-059 | Child auth user mirror | | | | API | `backend/__tests__/data-bridge/user-mirror.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-060 | Platform `/me` shared user | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-061 | Companion token mint | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-062 | Revoke session by sid | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-063 | Rate limit on auth register | | | | API | `backend/__tests__/data-bridge/routes-gates.test.ts`, `src/f | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-064 | Rate limit on forgot password | | | | API | `src/features/language/api/__tests__/languageAuth.test.ts`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-065 | E2E autologin bypasses biometric | | | | Maestro | `e2e/maestro/subflows/launch-logged-in.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-066 | Invite token preserved through login | | | | Unit | `src/stores/__tests__/authStore.data-bridge.test.ts`, `src/a | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-067 | Offline login attempt | | | | Unit | `src/screens/auth/__tests__/LoginScreen.data-bridge.test.tsx | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-068 | Duplicate login submit guard | | | | Unit | `src/screens/auth/__tests__/LoginScreen.data-bridge.test.tsx | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-069 | Register cancel back to login | | | | Maestro | `e2e/maestro/auth/register-back-to-login.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-070 | Login tablet layout | | | | Unit | `src/screens/auth/__tests__/LoginScreen.data-bridge.test.tsx | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-071 | Platform deletion saga start | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts`, `back | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-072 | Platform deletion status poll | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts`, `back | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-073 | OAuth Google redirect completes session | | | | Live | `e2e/maestro/auth/login-screen-controls.yaml`, `src/screens/ | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-074 | Remember-last-login email display | | | | Maestro | `e2e/maestro/auth/biometric-remember-last-login.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-075 | Password field focus chain | | | | Unit | `src/screens/auth/__tests__/LoginScreen.data-bridge.test.tsx | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-076 | Register display name optional | | | | Unit | `src/screens/auth/__tests__/RegisterScreen.data-bridge.test. | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-077 | Joined-platform refresh path | | | | Unit | `src/api/__tests__/joined-platform-auth.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-078 | Language refresh path | | | | Unit | `src/features/language/api/__tests__/languageAuth.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-079 | Invitation token validation before auth | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts`, `back | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-080 | Invitation token validation rejects expired/unknown token | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts`, `back | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-081 | Invite-link token validation | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts`, `back | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-082 | Invite-link join request creation | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts`, `back | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-083 | Invite-link duplicate request guard | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts`, `back | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-084 | Owner pending-request list | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts`, `back | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-085 | Requester's own request list | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts`, `back | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-086 | Active session list | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts`, `back | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-087 | Revoke one session | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts`, `back | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-088 | Revoke all sessions | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts`, `back | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-089 | Public user lookup scoping | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts`, `back | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-090 | Shared-user alias parity | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-091 | Dev-only `/auth/test` not reachable in production | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts`, `back | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AUTH-092 | Accept-invite cancel leaves no membership | | | | Unit | `src/features/language/api/__tests__/languageAuth.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-001 | House welcome screen load | | | | Maestro | `e2e/maestro/onboarding/welcome.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-002 | Welcome funnel progression | | | | Maestro | `e2e/maestro/onboarding/funnel.yaml`, `e2e/maestro/onboardin | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-003 | Create household path entry | | | | Maestro | `e2e/maestro/onboarding/create-household.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-004 | Create household submit | | | | Maestro, API | `e2e/maestro/onboarding/create-household.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-005 | Create household empty name | | | | Unit | `src/features/kaizen/screens/__tests__/OnboardingScreen.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-006 | Join household via code | | | | Maestro | `e2e/maestro/onboarding/join-household.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-007 | Join invalid code | | | | Maestro | `e2e/maestro/onboarding/join-household.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-008 | Space setup load | | | | Maestro | `e2e/maestro/onboarding/space-setup.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-009 | Add first space | | | | Maestro | `e2e/maestro/onboarding/space-setup.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-010 | Floor plan step skip | | | | Maestro | `e2e/maestro/onboarding/floor-plan.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-011 | Floor plan upload fixture | | | | Maestro | `e2e/maestro/onboarding/floor-plan.yaml`, `e2e/maestro/subfl | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-012 | Initial report upload offer | | | | Maestro | `e2e/maestro/onboarding/upload-report.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-013 | Report upload pick PDF | | | | Maestro | `e2e/maestro/onboarding/upload-report.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-014 | Garbage setup step (House) | | | | Maestro | `e2e/maestro/onboarding/garbage-setup.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-015 | ChildWelcome load (Kaizen) | | | | Unit | `src/features/kaizen/screens/__tests__/OnboardingScreen.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-016 | ChildWelcome accept terms | | | | Unit | `src/features/kaizen/screens/__tests__/OnboardingScreen.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-017 | ChildWelcome error on terms fail | | | | Unit | `src/features/kaizen/screens/__tests__/OnboardingScreen.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-018 | Language onboarding load | | | | Maestro, Unit | `e2e/maestro/language/onboarding.yaml`, `src/features/langua | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-019 | Language onboarding progression | | | | Maestro | `e2e/maestro/language/onboarding.yaml`, `e2e/maestro/languag | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-020 | Onboarding back preserves draft | | | | Maestro | `e2e/maestro/onboarding/create-household.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-021 | Onboarding skip resume on relaunch | | | | Unit | `src/features/kaizen/screens/__tests__/OnboardingScreen.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-022 | House vs child onboarding gate | | | | Unit | `src/navigation/OnboardingNavigator.tsx` (no test) — `gap` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-023 | Onboarding progress read | | | | API | `backend/src/routes/__tests__/settings.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-024 | Onboarding step marked complete | | | | API | `backend/src/routes/__tests__/settings.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-025 | Onboarding step write failure is non-fatal | | | | Unit | `src/features/kaizen/screens/__tests__/OnboardingScreen.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-026 | Create-household cancel writes nothing | | | | Maestro | `e2e/maestro/onboarding/create-household.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-027 | Join-household empty code validation | | | | Maestro | `e2e/maestro/onboarding/join-household.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-028 | Already-onboarded user skips the funnel | | | | Maestro | `e2e/maestro/subflows/launch-logged-in.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ONB-029 | Onboarding funnel scroll sentinel | | | | Maestro | `e2e/maestro/onboarding/funnel.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-001 | Household settings entry visible | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-002 | Household management load (House) | | | | Maestro, API | `e2e/maestro/households/household-management.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-003 | Budget household screen load | | | | Maestro | `e2e/maestro/budget/budget-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-004 | List households empty state | | | | API | `backend/src/config/__tests__/budget-chat-gating.test.ts`, ` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-005 | Add property surface open | | | | Maestro | `e2e/maestro/households/household-management.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-006 | Create household from manager | | | | API, Maestro | `e2e/maestro/households/household-management.yaml`, `backend | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-007 | Household detail load | | | | API | `backend/src/routes/__tests__/households-purchase.test.ts`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-008 | Update household name | | | | API | `backend/src/routes/__tests__/households-purchase.test.ts`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-009 | Update household cancel | | | | Unit | `src/stores/__tests__/appStore.test.ts`, `src/stores/__tests | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-010 | Delete household confirm cancel | | | | Unit | `src/stores/__tests__/appStore.test.ts`, `src/stores/__tests | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-011 | Delete household success | | | | API | `backend/src/routes/__tests__/households-purchase.test.ts`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-012 | Leave household | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-013 | Owner cannot leave sole HH | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-014 | Members list load | | | | Maestro | `e2e/maestro/platform/household-members.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-015 | Invite member by email | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-016 | Invite invalid email | | | | Unit | `src/stores/__tests__/appStore.test.ts`, `src/stores/__tests | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-017 | Invite duplicate pending | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-018 | List pending invitations | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-019 | Revoke invitation | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-020 | Remove member (admin) | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-021 | Non-admin cannot remove member | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-022 | Change member role | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-023 | User search for invite | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-024 | Upload household photo | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-025 | Delete household photo | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-026 | Create invite link | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-027 | Accept invite link (new user) | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-028 | List join requests (admin) | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-029 | Approve join request | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-030 | Deny join request | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-031 | Accept invitation email flow | | | | API | `backend/src/routes/invitations.ts` (route only, no test) —  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-032 | Accept invitation wrong email | | | | API | `backend/src/routes/invitations.ts` (route only, no test) —  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-033 | Property mode toggle (House) | | | | Unit | `src/stores/__tests__/appStore.test.ts`, `src/stores/__tests | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-034 | Switch active household | | | | Unit | `src/stores/__tests__/appStore.test.ts`, `src/stores/__tests | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-035 | Household photo proxy GET | | | | API | `backend/src/routes/households.ts` (route only, no test) — ` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-036 | Invite non-admin blocked | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-037 | Join request notification cleanup | | | | API | `backend/src/routes/notifications.ts` (route only, no test)  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-038 | Household CRUD rate limit | | | | API | `backend/src/config/__tests__/budget-chat-gating.test.ts`, ` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-039 | Household photo upload-url handshake | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-040 | Household photo pick cancel | | | | Unit | `src/stores/__tests__/appStore.test.ts`, `src/stores/__tests | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-041 | Invite-link end-to-end join chain | | | | API | `backend/src/config/__tests__/budget-chat-gating.test.ts`, ` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-042 | Deny join request removes request and notification | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-043 | Household name empty validation | | | | Unit | `src/stores/__tests__/appStore.test.ts`, `src/stores/__tests | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-044 | Household detail not-found error | | | | API | `backend/src/routes/__tests__/households-purchase.test.ts`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-045 | Members roster scroll sentinel | | | | Maestro | `e2e/maestro/platform/household-members.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-046 | Property detail load (House) | | | | Maestro | `e2e/maestro/platform/property-detail.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-HH-047 | Member cannot escalate own role | | | | API | `backend/src/services/__tests__/household-invite-remove.test | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SUB-001 | Subscription status load | | | | API | `backend/src/routes/__tests__/webhooks-revenuecat.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SUB-002 | Plans list load | | | | API | `backend/src/routes/__tests__/webhooks-revenuecat.test.ts`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SUB-003 | Limits for current user | | | | API | `backend/src/routes/__tests__/webhooks-revenuecat.test.ts`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SUB-004 | Paywall UI load | | | | Unit | `deferred` — IAP not configured in shipping builds (see Flag | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SUB-005 | Paywall dismiss cancel | | | | Unit | `deferred` — IAP not configured in shipping builds (see Flag | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SUB-006 | Purchase flow sandbox | | | | Live | `deferred` — IAP not configured in shipping builds (see Flag | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SUB-007 | Restore purchases | | | | Live | `deferred` — IAP not configured in shipping builds (see Flag | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SUB-008 | Sync subscription after RC event | | | | API | `backend/src/routes/__tests__/webhooks-revenuecat.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SUB-009 | Free tier limits enforced | | | | Unit | `app/ai-access/__tests__/index.test.tsx`, `e2e/maestro/platf | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SUB-010 | Pro tier unlocks feature | | | | Unit, Maestro | `e2e/maestro/platform/subscription-pro-tier.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SUB-011 | Checkout endpoint deprecated stub | | | | API | `backend/src/routes/subscriptions.ts` (route only, no test)  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SUB-012 | Portal endpoint stub | | | | API | `backend/src/routes/subscriptions.ts` (route only, no test)  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SUB-013 | Cancel subscription API | | | | API | `backend/src/routes/__tests__/webhooks-revenuecat.test.ts`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SUB-014 | RevenueCat webhook entitlement | | | | API | `backend/src/routes/__tests__/webhooks-revenuecat.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SUB-015 | Reactivate a cancelled subscription | | | | API | `backend/src/routes/__tests__/webhooks-revenuecat.test.ts`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SUB-016 | Resume a paused subscription | | | | API | `backend/src/routes/__tests__/webhooks-revenuecat.test.ts`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SUB-017 | Paywall respects `subscriptionsEnabled` feature flag | | | | Unit | `deferred` — IAP not configured in shipping builds (see Flag | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SUB-018 | Subscribe double-tap guard | | | | Unit | `deferred` — IAP not configured in shipping builds (see Flag | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SUB-019 | Restore with nothing to restore | | | | Live | `deferred` — IAP not configured in shipping builds (see Flag | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SUB-020 | Manage-subscription external link | | | | Live | `deferred` — IAP not configured in shipping builds (see Flag | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SUB-021 | Purchase failure surfaces an error | | | | Live | `deferred` — IAP not configured in shipping builds (see Flag | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SUB-022 | Paywall for an already-entitled user | | | | Unit | `deferred` — IAP not configured in shipping builds (see Flag | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SUB-023 | Paywall dismiss preserves caller route | | | | Unit | `deferred` — IAP not configured in shipping builds (see Flag | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-001 | AI gate blocks free user | | | | Unit | `e2e/maestro/platform/ai-access-profile-entry.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-002 | AI gate allows entitled user | | | | Maestro | `e2e/maestro/mira/mira-chat-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-003 | AI access error navigation | | | | Unit | `e2e/maestro/platform/ai-access-profile-entry.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-004 | List AI credentials | | | | API | `backend/src/routes/ai-credentials.ts` (route only, no test) | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-005 | Connect AI provider | | | | API | `backend/src/routes/ai-credentials.ts` (route only, no test) | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-006 | Validate AI credential | | | | API | `backend/src/routes/ai-credentials.ts` (route only, no test) | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-007 | Delete AI credential | | | | API | `backend/src/routes/ai-credentials.ts` (route only, no test) | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-008 | AI usage read per HH | | | | API | `backend/src/routes/ai-usage.ts` (route only, no test) — `ga | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-009 | Platform bridge AI caller | | | | API | `backend/__tests__/data-bridge/platform-caller.test.ts`, `ba | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-010 | Settings AI providers row (House) | | | | Maestro | `e2e/maestro/platform/ai-access-profile-entry.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-011 | Connected accounts screen load | | | | Maestro | `e2e/maestro/aihousekeeper/connected-accounts.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-012 | AI Housekeeper settings load | | | | Maestro | `e2e/maestro/aihousekeeper/settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-013 | AI paywall on usage cap | | | | Unit | `e2e/maestro/platform/ai-access-profile-entry.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-014 | Require AI access hook | | | | Unit | `e2e/maestro/platform/ai-access-profile-entry.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-015 | Manage models picker | | | | Unit | `e2e/maestro/platform/ai-access-profile-entry.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-016 | Language platform AI access route | | | | API | `backend-language/src/routes/platformAiAccess.ts` (route onl | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-017 | AI access hub load | | | | Unit | `app/ai-access/__tests__/index.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-018 | Hub card visibility reflects connection state | | | | Unit | `app/ai-access/__tests__/index.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-019 | Hub → paywall navigation | | | | Unit | `app/ai-access/__tests__/index.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-020 | Hub → providers navigation | | | | Unit | `app/ai-access/__tests__/index.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-021 | Provider list rows | | | | Unit | `e2e/maestro/platform/ai-access-profile-entry.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-022 | Connect screen load per provider | | | | Unit | `app/ai-access/__tests__/connect.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-023 | Connect a provider key | | | | Unit, API | `app/ai-access/__tests__/connect.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-024 | Connect blocked until acknowledgement | | | | Unit | `app/ai-access/__tests__/connect.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-025 | Connect blocked on empty key | | | | Unit | `app/ai-access/__tests__/connect.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-026 | Connect rejects a malformed key | | | | Unit, API | `app/ai-access/__tests__/connect.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-027 | Connect cancel writes nothing | | | | Unit | `e2e/maestro/platform/ai-access-profile-entry.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-028 | Model picker load after connect | | | | Unit | `e2e/maestro/platform/ai-access-profile-entry.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-029 | Select a model | | | | Unit, API | `e2e/maestro/platform/ai-access-profile-entry.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-030 | Model picker back without Done | | | | Unit | `e2e/maestro/platform/ai-access-profile-entry.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-031 | Manage screen load | | | | Unit | `app/ai-access/__tests__/manage.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-032 | Activate a different provider | | | | Unit, API | `app/ai-access/__tests__/manage.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-033 | Re-validate a credential | | | | Unit, API | `app/ai-access/__tests__/manage.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-034 | Re-validate failure surfaces | | | | Unit | `app/ai-access/__tests__/manage.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-035 | Disconnect confirmation cancel | | | | Unit | `app/ai-access/__tests__/manage.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-036 | Disconnect a provider | | | | Unit, API | `app/ai-access/__tests__/manage.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-037 | Disconnect the last provider returns hub to empty state | | | | Unit | `e2e/maestro/platform/ai-access-profile-entry.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-038 | Edit an existing key | | | | Unit | `app/ai-access/__tests__/manage.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-039 | Manage → models per provider | | | | Unit | `e2e/maestro/platform/ai-access-profile-entry.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-040 | AI preferences read on `GET /ai-access` | | | | API | `e2e/maestro/platform/ai-access-profile-entry.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-041 | Profile → AI access entry point | | | | Maestro | `e2e/maestro/platform/ai-access-profile-entry.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-042 | AI access hub scroll sentinel | | | | Maestro | `e2e/maestro/platform/ai-access-scroll.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-AIACC-043 | Offline connect attempt | | | | Unit | `e2e/maestro/platform/ai-access-profile-entry.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-001 | Notifications screen load | | | | Maestro | `e2e/maestro/notifications/notifications-screen.yaml`, `e2e/ | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-002 | Empty notifications state | | | | Maestro | `e2e/maestro/notifications/notifications-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-003 | Unread badge on header | | | | Unit | `src/screens/settings/__tests__/NotificationSettingsScreen.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-004 | Notification row tap | | | | Maestro | `e2e/maestro/notifications/notifications-actions.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-005 | Mark all read | | | | Maestro | `e2e/maestro/notifications/notifications-actions.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-006 | Delete single notification | | | | API | `backend/src/services/__tests__/smart-notification-gateway.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-007 | Clear all notifications | | | | Maestro | `e2e/maestro/notifications/notifications-actions.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-008 | Deep link task_reminder | | | | Unit | `src/services/__tests__/notificationRouting.house-gating.tes | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-009 | Deep link report_ready | | | | Unit | `src/services/__tests__/notificationRouting.house-gating.tes | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-010 | House-gated notification types | | | | Unit | `src/services/__tests__/notificationRouting.house-gating.tes | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-011 | Register push token | | | | API | `backend/src/routes/notifications.ts` (route only, no test)  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-012 | Unregister push token | | | | API | `backend/src/routes/notifications.ts` (route only, no test)  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-013 | List registered tokens | | | | API | `backend/src/routes/notifications.ts` (route only, no test)  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-014 | Notification preferences load | | | | Unit, Maestro | `e2e/maestro/platform/notification-settings-load.yaml`, `src | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-015 | Update notification preference | | | | Unit | `src/screens/settings/__tests__/NotificationSettingsScreen.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-016 | Notification override by category | | | | API | `backend/src/routes/notifications.ts` (route only, no test)  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-017 | Notification override by space | | | | API | `backend/src/routes/notifications.ts` (route only, no test)  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-018 | Push permission first run | | | | Maestro | `e2e/maestro/platform/notifications-push-banner.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-019 | Focus mode indicator | | | | Unit | `src/utils/__tests__/notificationVisibility.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-020 | Notifications scroll sentinel | | | | Maestro | `e2e/maestro/notifications/notifications-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-021 | Join-request notification actions | | | | API | `backend/src/routes/notifications.ts` (route only, no test)  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-022 | Offline notifications list | | | | Unit | `src/screens/settings/__tests__/NotificationSettingsScreen.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-023 | Push-permission banner visible when undetermined | | | | Maestro | `e2e/maestro/platform/notifications-push-banner.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-024 | Enable push from the banner | | | | Live | `e2e/maestro/notifications/notifications-screen.yaml`, `src/ | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-025 | Dismiss push banner | | | | Maestro | `e2e/maestro/platform/notifications-push-banner.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-026 | List notification overrides | | | | API | `backend/src/services/__tests__/smart-notification-gateway.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-027 | Create a notification override | | | | API | `backend/src/services/__tests__/smart-notification-gateway.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-028 | Read a single override | | | | API | `backend/src/services/__tests__/smart-notification-gateway.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-029 | Update an override | | | | API | `backend/src/services/__tests__/smart-notification-gateway.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-030 | Delete an override | | | | API | `backend/src/services/__tests__/smart-notification-gateway.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-031 | Clear-all confirmation cancel | | | | Maestro | `e2e/maestro/notifications/notifications-actions.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-032 | Delete-notification failure surfaces | | | | Unit | `src/screens/settings/__tests__/NotificationSettingsScreen.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-033 | Mark-all-read failure surfaces | | | | Unit | `src/screens/settings/__tests__/NotificationSettingsScreen.t | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-NOTIF-034 | Unread badge decrements on read | | | | Maestro | `e2e/maestro/notifications/notifications-actions.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-001 | Settings hub load | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml`, `e2e/maestro/su | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-002 | Appearance row visible | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-003 | Appearance screen load | | | | Unit | `src/screens/settings/__tests__/AppearanceScreen.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-004 | Theme toggle light/dark/system | | | | Unit | `src/screens/settings/__tests__/AppearanceScreen.test.tsx` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-005 | Customization row visible | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-006 | Customization screen load | | | | Unit | `src/screens/settings/__tests__/CustomizationScreen.test.tsx | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-007 | Navigation customization | | | | Unit | `src/screens/settings/__tests__/CustomizationScreen.test.tsx | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-008 | Widget customization load | | | | Unit | `src/screens/settings/__tests__/CustomizationScreen.test.tsx | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-009 | Notification settings entry | | | | Maestro | `e2e/maestro/platform/notification-settings-load.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-010 | Calendar sync row (House) | | | | Maestro | `e2e/maestro/settings/settings-subscreens.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-011 | Spaces row (House) | | | | Maestro | `e2e/maestro/spaces/spaces-management.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-012 | Floor plans row (House) | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-013 | AI Housekeeper settings row | | | | Maestro | `e2e/maestro/aihousekeeper/settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-014 | AI insights dashboard entry | | | | Maestro | `e2e/maestro/settings/settings-subscreens.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-015 | Persona settings row | | | | Maestro | `e2e/maestro/settings/settings-subscreens.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-016 | Profile screen load | | | | Maestro | `e2e/maestro/profile/profile-screen.yaml`, `e2e/maestro/subf | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-017 | Profile edit display name | | | | Maestro | `e2e/maestro/profile/profile-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-018 | Profile edit cancel | | | | Maestro | `e2e/maestro/profile/profile-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-019 | Profile sign-out entry | | | | Maestro | `e2e/maestro/profile/profile-destructive-actions.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-020 | Terms of service screen | | | | Unit | `src/screens/settings/__tests__/AppearanceScreen.test.tsx`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-021 | Privacy policy screen | | | | Unit | `src/screens/settings/__tests__/AppearanceScreen.test.tsx`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-022 | Settings sync to server | | | | Unit | `backend/src/routes/__tests__/settings.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-023 | Settings persist after relaunch | | | | Unit | `src/screens/settings/__tests__/AppearanceScreen.test.tsx`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-024 | PDF cache settings (House) | | | | Unit | `src/screens/settings/__tests__/AppearanceScreen.test.tsx`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-025 | Budget settings variant | | | | Maestro | `e2e/maestro/budget/budget-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-026 | Kaizen settings variant | | | | Maestro, Unit | `e2e/maestro/kaizen/settings.yaml`, `src/features/kaizen/scr | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-027 | Health settings via More | | | | Maestro | `e2e/maestro/health/subflows/go-more.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-028 | Language more settings | | | | Maestro | `e2e/maestro/language/more-settings.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-029 | Settings deep link flush | | | | Unit | `src/screens/settings/__tests__/AppearanceScreen.test.tsx`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-030 | Property mode in settings (House) | | | | Unit | `src/screens/settings/__tests__/AppearanceScreen.test.tsx`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-031 | Settings scroll sentinel | | | | Maestro | `e2e/maestro/settings/settings-screen.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-032 | AI preferences screen | | | | Unit | `src/screens/settings/__tests__/AppearanceScreen.test.tsx`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-033 | Settings list read from server | | | | API | `backend/src/routes/__tests__/settings.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-034 | Write a single setting key | | | | API | `backend/src/routes/__tests__/settings.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-035 | Bulk settings write | | | | API | `backend/src/routes/__tests__/settings.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-036 | Delete a setting key | | | | API | `backend/src/routes/__tests__/settings.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-037 | Settings sync reconciliation | | | | API | `backend/src/routes/__tests__/settings.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-038 | Settings reset to defaults | | | | API | `backend/src/routes/__tests__/settings.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-039 | Calendar sync screen load (House) | | | | Unit | `src/screens/settings/__tests__/AppearanceScreen.test.tsx`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-040 | Tab customization screen | | | | Unit | `src/screens/settings/__tests__/CustomizationScreen.test.tsx | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-041 | Profile avatar upload | | | | Maestro, Unit | `e2e/maestro/platform/profile-avatar-upload.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-042 | Profile avatar picker cancel | | | | Unit | `src/screens/settings/__tests__/AppearanceScreen.test.tsx`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-043 | Profile avatar remove | | | | Unit | `src/screens/settings/__tests__/AppearanceScreen.test.tsx`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-044 | Avatar upload failure surfaces | | | | Unit | `src/screens/settings/__tests__/AppearanceScreen.test.tsx`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-045 | Display-name empty validation | | | | Unit | `src/screens/settings/__tests__/AppearanceScreen.test.tsx`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-046 | Profile save failure surfaces | | | | Unit | `src/screens/settings/__tests__/AppearanceScreen.test.tsx`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-SETT-047 | Terms / Privacy reachable and scrollable | | | | Unit | `src/screens/settings/__tests__/AppearanceScreen.test.tsx`,  | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-001 | Data sharing entry (Budget) | | | | Maestro, API | `e2e/maestro/budget/budget-data-sharing.yaml`, `backend/__te | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-002 | Connect Budget row (House) | | | | Maestro | `e2e/maestro/budget/budget-soft-transfer-export.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-003 | Soft Transfer connect screen load | | | | Maestro | `e2e/maestro/budget/budget-data-sharing.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-004 | List ST packages registry | | | | API | `backend/__tests__/data-bridge/registry.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-005 | List consents | | | | API | `backend/src/routes/smart-engine.ts` (route only, no test) — | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-006 | Grant consent | | | | API | `backend/src/routes/smart-engine.ts` (route only, no test) — | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-007 | Revoke consent | | | | API | `backend/src/routes/smart-engine.ts` (route only, no test) — | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-008 | Brand pair gate 403 | | | | API | `backend/__tests__/data-bridge/brand-and-gates.test.ts`, `ba | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-009 | Prepare transfer payload | | | | API | `backend/__tests__/data-bridge/soft-transfer.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-010 | Export payload shape | | | | API, Unit | `backend/__tests__/data-bridge/soft-transfer.test.ts`, `src/ | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-011 | Import applies payload | | | | API, Unit | `backend/__tests__/data-bridge/soft-transfer.test.ts`, `src/ | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-012 | Connect flow cancel | | | | Maestro | `e2e/maestro/budget/budget-data-sharing.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-013 | Export screen UI load | | | | Maestro, Unit | `e2e/maestro/budget/budget-soft-transfer-export.yaml`, `src/ | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-014 | Export confirm success toast | | | | Maestro, Unit | `e2e/maestro/budget/budget-soft-transfer-export.yaml`, `src/ | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-015 | Import screen list packages | | | | Maestro, Unit | `e2e/maestro/budget/budget-soft-transfer-import.yaml`, `src/ | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-016 | Import confirm success | | | | Maestro, Unit | `e2e/maestro/budget/budget-soft-transfer-import.yaml`, `src/ | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-017 | Health ST export row | | | | Maestro | `e2e/maestro/health/subflows/launch-health.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-018 | Language ST rows | | | | Maestro | `e2e/maestro/language/subflows/launch-language.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-019 | Inter-worker client contract | | | | API | `backend/__tests__/data-bridge/inter-worker-client.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-020 | Platform JWT for bridge | | | | API | `backend/__tests__/data-bridge/platform-jwt.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-021 | Export without consent blocked | | | | API | `backend/__tests__/data-bridge/routes-gates.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-022 | Import invalid payload | | | | API | `backend/__tests__/data-bridge/soft-transfer.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-023 | SoftTransferFlow route screen | | | | Unit | `e2e/maestro/budget/budget-soft-transfer-export.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-024 | Dual-app harness gap | | | | Live | `e2e/maestro/budget/budget-soft-transfer-export.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-025 | Grant-consent validation | | | | API | `backend/__tests__/data-bridge/registry.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-026 | Prepare failure surfaces | | | | API | `backend/__tests__/data-bridge/soft-transfer.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-027 | Export cancel writes nothing | | | | Maestro | `e2e/maestro/budget/budget-soft-transfer-export.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-028 | Revoke consent blocks subsequent export | | | | API | `backend/__tests__/data-bridge/routes-gates.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-029 | Import idempotency on replay | | | | API | `backend/__tests__/data-bridge/soft-transfer.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ST-030 | Data sharing screen scroll | | | | Maestro | `e2e/maestro/budget/budget-data-sharing.yaml` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-WIDGET-001 | Widget extension installs | | | | Live | `src/services/__tests__/widget-sync.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-WIDGET-002 | Widget customization settings | | | | Unit | `src/screens/settings/__tests__/CustomizationScreen.test.tsx | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-WIDGET-003 | Widget reflects task summary | | | | Live | `src/services/__tests__/widget-sync.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-WIDGET-004 | Widget tap deep link | | | | Live | `src/services/__tests__/widget-sync.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-WIDGET-005 | App Group hygiene on logout | | | | Unit | `src/services/__tests__/widget-sync-app-group.test.ts`, `src | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-WIDGET-006 | Companion token mint for widget | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-WIDGET-007 | Watch sync message (iOS) | | | | Live | `src/services/__tests__/widget-sync.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-WIDGET-008 | Health widget snapshot handoff | | | | Unit | `src/services/__tests__/widget-sync.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-WIDGET-009 | Companion tasks endpoint | | | | API | `backend/__tests__/data-bridge/routes-gates.test.ts`, `backe | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-WIDGET-010 | Companion home-insight endpoint | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts`, `back | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-WIDGET-011 | Companion routes reject a normal session JWT | | | | API | `backend/__tests__/data-bridge/routes-gates.test.ts`, `backe | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-WIDGET-012 | Companion token scope is honored | | | | API | `backend/__tests__/data-bridge/auth-platform.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-WIDGET-013 | Revoked companion token stops serving data | | | | API | `backend/__tests__/data-bridge/routes-gates.test.ts`, `backe | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ANALYTICS-001 | Analytics disabled in DEV default | | | | Unit | `src/services/__tests__/analytics.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ANALYTICS-002 | Analytics enabled when flag set | | | | Unit | `src/services/__tests__/analytics.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ANALYTICS-003 | Brand tag on events | | | | Unit | `src/services/__tests__/analytics.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ANALYTICS-004 | POSTHOG_DEV override | | | | Unit | `src/services/__tests__/analytics.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ANALYTICS-005 | Sensitive fields not logged | | | | Unit | `src/services/__tests__/analytics.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ANALYTICS-006 | Navigation screen tracking hook | | | | Unit | `src/services/__tests__/analytics.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ANALYTICS-007 | Analytics no-ops without a PostHog key | | | | Unit | `src/services/__tests__/analytics.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
| PLAT-ANALYTICS-008 | Analytics never forked per brand | | | | Unit | `src/services/__tests__/analytics.test.ts` | ☐ | ☐ | ☑ | Suite not run or log missing |
