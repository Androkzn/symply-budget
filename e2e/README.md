# Symply Ecosystem E2E UI tests (Maestro)

End-to-end UI tests run on the **iOS Simulator** with [Maestro](https://maestro.mobile.dev/).

**Fleet acceptance matrices:** [documents/engineering/testing/matrices/](../documents/engineering/testing/matrices/)  
**Strategy / plan:** [FLEET_TEST_STRATEGY.md](../documents/engineering/testing/FLEET_TEST_STRATEGY.md) · [FLEET_TEST_IMPLEMENTATION_PLAN.md](../documents/engineering/testing/FLEET_TEST_IMPLEMENTATION_PLAN.md)

**Kaizen:** tagging and matrix TC rows are **deferred** (active development). Use `npm run test:e2e:kaizen:suite` for existing Kaizen flows. `npm run test:e2e:feature -- kaizen …` exits with code **2** and prints a deferral message.

## Prerequisites

1. **Maestro CLI** — installed to `~/.maestro/bin` (or on your `PATH`).
2. **Simulator** — default: `Kaizen-iPad` (override with `E2E_DEVICE`).
3. **Credentials** — `e2e/credentials.local` (`E2E_EMAIL` / `E2E_PASSWORD`). Debug builds may use autologin deep links; Release must type creds.
4. **Fresh native build** after adding `testID`s when selectors change.

## Fleet run modes

```sh
# Feature slice (House / Budget / Language / Health — not Kaizen yet)
npm run test:e2e:feature -- budget savings
npm run test:e2e:feature -- house tasks
npm run test:e2e:feature -- language learn

# Full app suite
npm run test:e2e:house:suite
npm run test:e2e:budget:suite
npm run test:e2e:language:suite
npm run test:e2e:health:suite
npm run test:e2e:kaizen:suite   # existing Kaizen suite (untagged)

# Fleet (serial — one brand at a time)
npm run test:e2e:all:suites

# Re-apply Maestro tags (skips kaizen/ unless INCLUDE_KAIZEN=1)
npm run test:e2e:tags
```

Tag filter note: Maestro `--include-tags=a,b` is **OR**. Scope by directory + one `feature:*` tag, or use a composite `slice:*` tag.

### Disk / flaky recovery

Run one brand at a time on a shared simulator. If disk pressure blocks runs: erase unused sims (`xcrun simctl delete unavailable`), quarantine with `tags: [flaky]` + `excludeTags: [flaky]`. Mark RESULTS rows N/A when blocked.

## House area run (legacy)

```sh
# All tab + surface flows (House-oriented runner)
npm run test:e2e

# Per area
npm run test:e2e:home
npm run test:e2e:mira
npm run test:e2e:chat
npm run test:e2e:settings
npm run test:e2e:tasks
npm run test:e2e:budget
npm run test:e2e:reports
npm run test:e2e:contractors
npm run test:e2e:gardening
npm run test:e2e:notifications
npm run test:e2e:profile
npm run test:e2e:my-home
npm run test:e2e:utilities
```

## Flows

### Home (`e2e/maestro/home/`)

| Flow | Coverage |
|------|----------|
| `home-screen-controls.yaml` | Dashboard, Mira brief, Up Next, FAB, header notifications/profile, Mira brief navigation |

### Mira / AI Housekeeper (`e2e/maestro/mira/`)

| Flow | Coverage |
|------|----------|
| `mira-chat-screen.yaml` | Chat input, attach, voice, send, overflow menu, persona settings entry |

### Chat (`e2e/maestro/chat/`)

| Flow | Coverage |
|------|----------|
| `chat-rooms-screen.yaml` | Room list, new conversation sheet, cancel |

### Settings / More (`e2e/maestro/settings/`)

| Flow | Coverage |
|------|----------|
| `settings-screen.yaml` | Account rows, Appearance drill-down, Floor Plans, Garden navigation |

### Tasks (`e2e/maestro/tasks/`)

| Flow | Coverage |
|------|----------|
| `task-detail-ui.yaml` | Open task detail → Mark Complete / Pause / Delete visible → close |
| `task-detail-sections.yaml` | Edit, assignee, subtasks, blocker, add subtask, find contractors (when shown) |
| `add-task-smart-capture.yaml` | Home FAB → smart capture input → submit |
| `add-task-manual-form.yaml` | Tasks FAB → manual form expand → copy/templates buttons → dismiss |
| `tasks-screen-controls.yaml` | Filters (mine/personal/hide done), group tabs, list/board toggle, search, summary chips |

### Budget (`e2e/maestro/budget/`)

| Flow | Coverage |
|------|----------|
| `budget-tabs.yaml` | Dashboard ↔ Spendings tabs, add CTAs on spendings |
| `budget-dashboard-controls.yaml` | Month prev/next, insights refresh, dashboard add buttons |
| `budget-item-form.yaml` | Manual add form → all fields/priority/schedule → validation → cancel |
| `budget-settings.yaml` | Settings gear → monthly budget field → timeline link → back |
| `budget-ai-screen.yaml` | Add with AI screen → input → generate button → cancel |

### Reports (`e2e/maestro/reports/`)

| Flow | Coverage |
|------|----------|
| `reports-screen-controls.yaml` | Report list, upload FAB, upload source modal dismiss |

### Contractors / Labor Hub (`e2e/maestro/contractors/`)

| Flow | Coverage |
|------|----------|
| `contractors-dashboard.yaml` | Quick action tabs: Schedule, Quotes, Contractors, Projects |

### Gardening (`e2e/maestro/gardening/`)

| Flow | Coverage |
|------|----------|
| `gardening-screen.yaml` | Garden plans list, add plan CTA |

### Notifications (`e2e/maestro/notifications/`)

| Flow | Coverage |
|------|----------|
| `notifications-screen.yaml` | Notifications list screen (via deep link and from Home header) |

### Auth / biometrics — Symply Kaizen (`e2e/maestro/kaizen/`)

| Flow | Coverage |
|------|----------|
| `login-screen-controls.yaml` | Kaizen Login chrome (email form, Sign Up) |
| `biometric-settings-row.yaml` | Settings Face ID / Touch ID row + toggle |
| `biometric-remember-last-login.yaml` | Enable Face ID → Log out → biometric CTA → Face ID → Today |

```sh
# Kaizen-A + com.symply.kaizen (Face ID enroll + auto-match loop)
npm run test:e2e:biometric
```

House auth chrome (separate): `e2e/maestro/auth/` via `npm run test:e2e:auth`.

### Profile (`e2e/maestro/profile/`)

| Flow | Coverage |
|------|----------|
| `profile-screen.yaml` | Display name field, profile shell |

### My Home (`e2e/maestro/my-home/`)

| Flow | Coverage |
|------|----------|
| `my-home-screen.yaml` | Floor plan cards grid / empty state |

### Utilities (`e2e/maestro/utilities/`)

| Flow | Coverage |
|------|----------|
| `utilities-screen.yaml` | Quick actions (scan, bills, tax, analytics) or region gate message |

### Subflows (`e2e/maestro/subflows/`)

Suite runners pass **`E2E_APP_SCHEME`** (brand URL scheme) so observability deep links resolve correctly:

| Brand | `E2E_APP_SCHEME` |
|-------|------------------|
| Symply House | `simplehouse` |
| Symply Budget | `simplebudget` |
| Symply Kaizen | `kaizen` |
| Symply Language | `simplelanguage` |
| Symply Health | `simplehealth` |

| Subflow | Purpose |
|---------|---------|
| `e2e-clear-log.yaml` | Clear E2E network/persist/UI ring buffers (`{scheme}://e2e-clear-log`) |
| `e2e-dump-log.yaml` | Dump observability snapshot to Metro (`{scheme}://e2e-dump-log`) |
| `e2e-tag-matrix.yaml` | Tag console lines with matrix row (`E2E_MATRIX_ROW` → `e2e-tag-matrix?row=…`) |
| `e2e-verify-network.yaml` | Assert network log matches Console verify spec (`E2E_VERIFY_METHOD` / `E2E_VERIFY_PATH` / optional `E2E_VERIFY_STATUS`) |
| `e2e-matrix-before.yaml` | Composite: `e2e-clear-log` + `e2e-tag-matrix` (start of a matrix row) |
| `e2e-matrix-after.yaml` | Composite: `e2e-dump-log` + optional `e2e-verify-network` when `E2E_VERIFY_PATH` is set |
| `launch-logged-in.yaml` | Launch app, assert Home (no auth gate) |
| `go-home-tab.yaml` | Tab tap → Home |
| `go-mira-tab.yaml` | Tab tap + `simplehouse://mira` fallback |
| `go-chat-tab.yaml` | Tab tap + `simplehouse://chat` fallback |
| `go-settings-tab.yaml` | Tab tap + `simplehouse://settings` fallback |
| `go-tasks-tab.yaml` | Tab tap + `simplehouse://tasks` fallback |
| `go-budget-tab.yaml` | Tab tap + `simplehouse://budget` fallback |
| `open-reports.yaml` | Deep link → Reports |
| `open-contractors.yaml` | Deep link → Contractors / Labor Hub |
| `open-gardening.yaml` | Deep link → Gardening |
| `open-notifications.yaml` | Deep link → Notifications |
| `open-profile.yaml` | Deep link → Profile |
| `open-my-home.yaml` | Deep link → My Home |
| `open-utilities.yaml` | Deep link → Utilities |
| `open-task-detail.yaml` | Home task card or Tasks list → task detail |
| `open-add-task-from-tasks.yaml` | Tasks tab → FAB → add sheet |

## Tab coverage matrix

| Surface | Tab bar | Deep link | E2E flow |
|---------|---------|-----------|----------|
| Home | `tab-index` | — | `home/` |
| Mira | `tab-mira` | `simplehouse://mira` | `mira/` |
| Budget | `tab-budget` | `simplehouse://budget` | `budget/` |
| Chat | `tab-chat` | `simplehouse://chat` | `chat/` |
| More / Settings | `tab-settings` | `simplehouse://settings` | `settings/` |
| Tasks | `tab-tasks`* | `simplehouse://tasks` | `tasks/` |
| Reports | — | `simplehouse://reports` | `reports/` |
| Contractors | — | `simplehouse://contractors` | `contractors/` |
| Gardening | — | `simplehouse://gardening` | `gardening/` |
| Notifications | — | `simplehouse://notifications` | `notifications/` |
| Profile | — | `simplehouse://profile` | `profile/` |
| My Home | — | `simplehouse://my-home` | `my-home/` |
| Utilities | — | `simplehouse://utilities` | `utilities/` |

\*Tasks tab appears only when the `smartTaskAssistant` feature flag is enabled; flows fall back to `simplehouse://tasks`.

## Coverage notes

These flows exercise **every primary interactive control** on each main tab and deep-link surface (filters, search, tabs, forms, settings, AI entry points, FABs, headers). They intentionally **do not** mutate production data except where a flow validates an empty-form alert or submits a smart-capture task.

### Real document uploads (seeded fixtures)

Upload flows now perform **real** picks of real documents instead of
asserting-and-cancelling the native pickers. Before each run, the runners seed
`resourses/testing/` documents onto the simulator (Photos via `simctl addmedia`,
Files via the FileProvider LocalStorage) and the flows drive the native pickers
via `subflows/pick-document-from-files.yaml` / `subflows/pick-photo-from-library.yaml`.

See **[documents/engineering/e2e-fixtures.md](../documents/engineering/e2e-fixtures.md)**
for the manifest, seed script (`scripts/e2e/seed-fixtures.sh`), picker `testID`s,
and known limitations. Real-upload flows: reports upload, Kaizen book / resume /
question import, Mira attach (photo + document), Budget savings-import / receipt-scan
/ chat photo, and the onboarding upload/floor-plan steps (guarded, with Skip as
fallback). Opt out of seeding with `E2E_SEED_FIXTURES=0`.

**Still not covered by E2E** (requires seeded data, permissions, or multi-step workflows):

- Auth / invite acceptance
- Task completion modal submit, pause/delete confirmations, assignee picker sheet
- Contractor detail screens (quotes, schedule work, visit mode)
- Task templates / copy existing / drafts / maintenance setup navigators
- Budget swipe-to-delete, AI generate → save, year setup / long-term timeline drill-down
- Mira voice mode session, approval actions
- Chat room WebSocket-backed typing indicators
- Reports processing pipeline (post-upload AI), PDF viewer
- Garden plan creation wizard, map editor
- Profile avatar change, sign out, delete account
- iPhone-specific layout matrix (default device is iPad)

## Troubleshooting

- **`Welcome Back` visible** — sign in on the simulator first.
- **`id: …` not found** — rebuild the app so new `testID`s are in the bundle (the picker-source `testID`s especially).
- **Upload flow can't find the document in Files** — the FileProvider store may not exist on a brand-new sim; open the Files app once (or re-run — the second run seeds it), or run `scripts/e2e/seed-fixtures.sh <UDID> <app>` manually.
- **Flaky network** — budget dashboard waits up to 30s for loading to finish.
- **Tab tap didn't navigate** — subflows fall back to deep links (`simplehouse://…`).
- **Utilities region gate** — household outside Greater Vancouver shows `utilities-region-gate` instead of the dashboard; the utilities flow accepts either state.
