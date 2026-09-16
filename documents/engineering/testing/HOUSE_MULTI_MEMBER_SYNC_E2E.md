# House V2 local-first — two-member sync E2E (stage H12)

**Scope:** Symply House (`com.symply.house`) V2 local-first household sync,
driven as **two real users on two real simulators**.
**Runner:** [`scripts/e2e/run-house-multi-member-sync.sh`](../../../scripts/e2e/run-house-multi-member-sync.sh)
**Flows:** `e2e/maestro/house-multi-member/` — 17 phase flows + 11 shared subflows
**Ported from:** [BUDGET_MULTI_MEMBER_SYNC_E2E.md](./BUDGET_MULTI_MEMBER_SYNC_E2E.md)
(green on Budget; read it first — this document only records what House does
*differently*)
**Plan:** [house-local-first-implementation-plan.md](../../requirements/House%20v2/house-local-first-implementation-plan.md) §12
**Matrix:** `HOUSE-MM-001` … `033` — **rows not yet added** to
[matrices/house.md](./matrices/house.md); the flow headers carry the ids so the
rows can be linked in one pass.

---

## 0. Read this before running: the suite is authored ahead of the UI

**House has no local-first UI.** `src/features/house/local/` ships the entire
sync client — control plane, orchestrator, checkpoints, blobs, reminders, widget
projection — and contains **zero `.tsx` files**. House Settings has no
device-sync row, there is no sync banner and no conflict indicator, and nothing
in the app tree calls `createLocalFirstInvite`, `joinLocalFirstHousehold` or
`approveLocalFirstInvite`. The invite / enrolment screen lands with **H3**
(plan §5.1: *"House needs a real screen"*). Budget's card is not a fallback:
`isBudgetLocalFirst()` gates on `brand.id === 'symply-budget'`, and forcing the
env flag would drive Budget's ledger and Budget's control plane.

So this suite is delivered in two halves, and the split is deliberate:

| Half | State |
|---|---|
| Everything House already has — sign-in, tasks CRUD, settings, household management, photo picker, task delete | Written against **real, in-source selectors**, most already proven in green House flows |
| The enrolment / sync chrome | Written against a **declared selector contract** the H3 screen must satisfy, injected from **one table** in the runner |

Not one selector was invented and left to look like a discovered value. Every
contract id is listed in §3 with the Budget id it mirrors, and every text-driven
control is listed in §4 with the component and line it was read from.

**Second blocker: there is only one test account.** `e2e/credentials.local`
declares `E2E_EMAIL_SECONDARY` and `E2E_PASSWORD_SECONDARY` but leaves them
**empty**. The runner refuses to start without them, and refuses if they equal
the primary — a "two-member" test signed in as one account twice asserts
nothing about a household. A second Symply account still has to be created.

---

## 1. Why this exists

House's single-device flows cover the app one member at a time. The central
promise of a **household** — that what one member records shows up for the
other — is asserted nowhere, and under local-first it is not a server property
any more: the Worker's D1 holds ciphertext, so nothing outside the two devices
can confirm they agree.

Budget's suite proved the merge core. H1 promoted that core into
`@symply/local-first`, so Budget's convergence tests now cover *the same code
House runs* — which is exactly why this port is not "copy the CRDT tests". What
it must prove is what the **House descriptor and House screens** add on top:

| Behaviour | Covered by Budget's suite | Why House re-runs it |
|---|---|---|
| Create / edit / delete propagate | yes | House's projection, registry and query-key map are new code (plan §5.2) |
| Two edits to one row converge | yes | same core, but House's rows are 58 columns wide and its facades are new |
| Invite can actually be accepted | yes | House's enrolment UI does not exist yet — this is its acceptance test |
| **Property switch mid-sync** | no — Budget has one household | H5 made the engine `Map<householdId, EngineState>` |
| **Attachment round trip** | no — documented Budget *gap* | H6 exists precisely to close it |
| **Reminder from the local scheduler** | no | H7 moved reminders off the server cron |
| **Widget projection after a peer's write** | no | H7/N4 — the widget cannot read the ledger |

---

## 2. Topology

| | Device | Simulator | Account | Role |
|---|---|---|---|---|
| Member A | A | `House-A` | `E2E_EMAIL` | household owner |
| Member B | B | `House-B` | `E2E_EMAIL_SECONDARY` | invitee |

Device names are resolved from the one registry,
[`scripts/e2e/maestro-fleet-brand.sh`](../../../scripts/e2e/maestro-fleet-brand.sh)
(`house` → `device` / `device_b`), never hardcoded in the runner. Override per
run with `E2E_DEVICE_A` / `E2E_DEVICE_B`. A missing device is **created**, not
reported as an error — a runner that fails on a name the registry knows is how
the registry and the machine drift apart.

**One pair per app.** These are the same two simulators every House multi-user
suite uses, which is the accepted trade: House suites cannot run concurrently
with each other, and multiple clones of this repo cannot run House's pair at the
same time. Run a *different app's* pair in parallel instead.

**Dedicated Metro.** The registry's House port `8083` belongs to the
single-device suite; this one runs its own on **`8093`**
(`HOUSE_MM_METRO_PORT`), with its own log at `/tmp/metro-house-mm.log`, and
takes no Maestro global lock. `connect-mm-metro.yaml` and
`mm-dismiss-dev-chrome.yaml` exist only so the dev-client server picker cannot
attach these devices to another session's bundler.

### Disk, before anything else

Two consecutive House runs were lost to disk on 2026-08-13 — one to a mid-suite
`sim_guard` erase that destroyed the installed app (131 of 134 failures were
that single event), one to a run that started with 33 GB and ate all of it
(47 failures, all dying at `Open ${E2E_METRO_DEVCLIENT_URL}`). Neither was
gradeable and both looked like product failures. This runner therefore:

- calls `disk_floor_preflight` **before any work** — refuses to start under 15 GB;
- calls `disk_floor_check` **between phases** — stops the run with one honest
  line the moment free space drops under 5 GB;
- trims the Metro log and both step logs between phases (`tee` has no rotation);
- calls `sim_guard_pair` **before boot**, and only then — `sim_guard` refuses to
  erase while `maestro test` is in flight, so it can never remove the app from
  under a running suite.

### Concurrency

Phases 2–9 drive **both devices at once**, one Maestro process per simulator. No
coordination channel is needed because the flows rendezvous on the data: each
does its own half, then polls sync until the peer's change appears.

Two exceptions, both inherited from Budget's hard-won experience:

- **`mm-01` sign-in is serial.** It is each device's first Maestro invocation and
  where the XCUITest driver cold-starts; launching both at once made the drivers
  kill each other. Sign-in asserts nothing about sync, so serialising is free.
- **The second device's launch is staggered** by `MM_STAGGER_SECONDS` (25s) in
  every parallel phase. The flows rendezvous on data, not clock time, so the head
  start does not reduce overlap.

`MM_PARALLEL=0` falls back to one device at a time.

---

## 3. The selector contract — ✅ **RESOLVED 2026-08-14, every id is now REAL**

Injected into every flow by the runner from a single table; change them **there**,
never in the YAML.

**What happened.** These began as a contract to be satisfied by the H3 §5.1
screen. That screen landed in `f60558b0` — under its own `lf-*` vocabulary,
while this table still held the `house-settings-*` names invented before the
screen existed. **Ten of the fifteen pointed at nothing**, and nobody found out,
because finding out required booting two simulators and clearing phase 1 — which
was gated on a second account that still does not exist (§8). The table was
repointed on 2026-08-14 and every value below is now read out of shipped source.

The four sync ids never moved: `HouseDeviceSyncScreen` was deliberately written
to spell them exactly as contracted.

**2026-08-26 — the enrolment surface gained a hub, and every id survived it.**
The owner's half moved out of `HouseInviteScreen` into `HouseInviteCreateScreen`
(and `HouseInviteBody`), the invitee's half was rewritten around a QR scanner and
an additive confirm dialog, and `HouseInviteScreen` became the hub that pushes to
both. The `lf-*` values below were carried across deliberately rather than
renamed — they are a contract with the runner, and the combined Device sync
surface still composes the same two bodies, so `mm-02` … `mm-05` reach every
control exactly where they did before. The shared `HouseJoinRequestsPanel` takes
its panel and approve ids as props for that reason: one component, two surfaces,
and the runner's names kept on the one it drives.

| Flow variable | Value (REAL) | Ships in | Used by |
|---|---|---|---|
| `LF_SCREEN` | `profile-screen` | `ProfileScreen.tsx` | navigation |
| `LF_SETTINGS_ROW` | `settings-row-device-sync` | `HouseSyncSharingSection.tsx` | `mm-open-lf-settings` |
| `LF_SYNC_CARD` | `house-local-first-sync-card` | `HouseDeviceSyncScreen.tsx` | 02, 03, 04, 05 |
| `LF_SYNC_NOW` | `house-settings-sync-now` | `HouseDeviceSyncScreen.tsx` | 02, 04, 05, `mm-sync-pulse` |
| `LF_SYNC_STATUS` | `house-sync-status` | `HouseDeviceSyncScreen.tsx` | `mm-sync-pulse` |
| `LF_SYNC_CONFLICTS` | `house-sync-conflicts` | `HouseDeviceSyncScreen.tsx` | runner (BR-044) |
| `LF_CREATE_INVITE` | `lf-invite-create` | `HouseInviteCreateScreen.tsx` | 02 |
| `LF_JOIN_PANEL` | `lf-join-panel` | `HouseJoinScreen.tsx` | 03 |
| `LF_JOIN_LINK` | `lf-join-link` | `HouseJoinScreen.tsx` | 03 |
| `LF_JOIN_HOUSEHOLD` | `lf-join-submit` | `HouseJoinScreen.tsx` | 03, 05 |
| `LF_JOIN_CONFIRM_PANEL` | `lf-join-confirm-panel` | `HouseJoinScreen.tsx` | 03 |
| `LF_JOIN_CONFIRM` | `lf-join-confirm` | `HouseJoinScreen.tsx` | 03 |
| `LF_JOIN_STATUS` | `lf-join-status` | `HouseJoinScreen.tsx` | 03 |
| `LF_JOIN_REQUESTS` | `lf-invite-requests-refresh` | `HouseInviteCreateScreen.tsx` | 04 |
| `LF_JOIN_REQUESTS_PANEL` | `lf-invite-requests-panel` | `HouseInviteCreateScreen.tsx` | 04 |

**This table is now guarded.** `e2e/__tests__/houseMultiMemberSelectorContract.test.ts`
parses the runner's defaults and greps `src/` + `app/` for each one, so the next
rename breaks a 200 ms unit test instead of a 40-minute device run. It is proven
capable of failing: the four old `house-settings-*` defaults are absent from the
tree, and the suite asserts a parse floor so a change in the assignment shape
cannot make it silently vacuous.

Three further requirements on the H3 screen, all learned from Budget. **All three
are now settled** — the first two by the shipped screen, the third by changing
the test rather than the product:

1. ✅ **The dev-only invite marker.** Budget logs, at
   `src/screens/budget/BudgetSettingsScreen.tsx:422` inside `if (__DEV__)`:
   `[E2E-INVITE] code=<shortCode> secret=<secret> oob=<correct phrase>`.
   House must log the same, **plus one field**:
   `[E2E-INVITE] code=… secret=… oob=… household=<display name>`.
   `household=` must be last (names contain spaces). Without the marker the code
   cannot reach device B and the run stops in phase 1; without `household=` the
   H5 phase auto-skips (§5).
   **As-built:** `HouseInviteCreateScreen.tsx` emits exactly this, `household=`
   last. The H5 phase therefore no longer auto-skips.
2. ✅ **The join confirm must be an in-app view, not `Alert.alert`.** iOS renders
   `UIAlertController` in its own window and XCUITest snapshots the app window,
   so Maestro is blind to it — proven side by side with `idb` on Budget, where
   every tap aimed at the alert hit the button behind it. This is a constraint on
   the product code, not on the test.
   **As-built:** `HouseJoinScreen` uses an in-app confirm panel
   (`lf-join-confirm-panel`), and says so in its own header.
3. ⚠️ **WITHDRAWN 2026-08-14 — the runner now asserts the element, not the prose.**
   This originally required the conflict count to render text containing
   `merge conflict`, because the runner grepped the hierarchy for that literal.
   House deliberately refuses that vocabulary: `HouseSyncStatusCard.tsx:5-11`
   calls "5 merge conflicts" engine language that is "meaningless to a member",
   and `houseConflictCopy.ts` renders *"N changes were overwritten when two of
   you edited the same thing"* instead.

   Keeping the requirement would have forced House to degrade better copy to
   satisfy a grep. Instead the runner now checks for `house-sync-conflicts`,
   which `HouseDeviceSyncScreen.tsx:106-113` renders **only** under
   `conflicts > 0` — so the id's presence is exactly the proof BR-044 wants, and
   it survives a rewording. `HouseConflictList` renders beneath it, naming each
   discarded edit rather than only counting them.

### Real selectors this suite uses (no contract involved)

`login-screen` · `auth-sign-in-email` · `auth-email-input` · `auth-sign-in-submit` ·
`home-screen` · `settings-screen` · `settings-row-household-members` ·
`household-management-screen` · `household-add-property` · `nav-back-button` ·
`tasks-screen` · `tasks-add-fab` · `task-filter-clear` · `add-task-sheet` ·
`add-task-input` · `add-task-submit` · `add-task-personal-toggle` ·
`bottom-sheet-close` · `bottom-sheet-overlay` · `task-detail-screen` ·
`task-detail-edit` · `task-detail-delete` · `task-detail-close` ·
`task-form-title` · `schedule-task-save` · `schedule-task-save-header`

---

## 4. Controls with NO testID — driven by text, and where that text came from

These are real, discovered strings, not guesses. They are also the most brittle
part of the suite, and giving these three components testIDs is the single
cheapest hardening available.

| Control | Driven by | Source |
|---|---|---|
| Property switcher trigger | the active property's **name** | `src/components/common/PropertySwitcher.tsx:106-108` (no testID or accessibilityLabel anywhere in the file) |
| Property switcher modal | `YOUR PROPERTIES`, then the property name | `PropertySwitcher.tsx:310` |
| Add-property sheet | title `Add Property`, placeholder `e.g., Main Home, Beach House`, confirm `Add` | `HouseholdManagementScreen.tsx:342, :393, :349` |
| Attach a photo | accessibilityLabel `Add photo` | `TaskFormPhotos.tsx:136` |
| Photo source sheet | `Choose a source` → `Choose from Library` | `TaskFormPhotos.tsx:74-78` |
| Photo present | counter `1/5` and accessibilityLabel `Task cover photo` | `TaskFormPhotos.tsx:88, :105` (`MAX_TASK_PHOTOS = 5`) |
| Task delete confirm | body `Are you sure you want to delete this task…`, then `Delete` | `TaskDetailScreen.tsx:293-300` |
| Shared-vs-personal | label `Personal (only me)` / `Shared with household` | `AddTaskSheet.tsx:437` |

**Superseded 2026-08-14.** This paragraph used to read *"No House testID exists
for: a device-sync settings row, a sync-now control, a sync banner, a conflict
indicator, an invite/join/approve surface…"*. All of those now ship — see the
§3 table, and `settings-row-device-sync` in `SettingsScreen.tsx`.

**Still genuinely absent:** a widget surface (there is no in-app widget UI at
all — phase 9 reads the App Group from the host instead, see §6.4) and reminder
settings (`TaskReminderSettings.tsx` has no testID; this suite does not touch
it, see §6.3).

`PropertySwitcher` and `TaskFormPhotos` have also gained testIDs since this
section was written (`property-switcher-trigger`, `property-switcher-sheet`,
`property-switcher-item-<id>`; `task-photo-add`, `task-photo-counter`,
`task-photo-item-<i>`, `task-photo-remove-<i>`, `task-photo-blob-<i>`). The
flows still drive them by text/label, which works — repointing them at the ids
is free hardening, not a fix.

---

## 5. What House changes about the Budget flows

| Budget | House | Why |
|---|---|---|
| Two entity types (Spending + Planning) | One (`tasks`) | Wave A's other tables have no two-member-visible screen yet; the second entity's job — proving the projection is not hard-wired to one table — is better served by the property phase |
| Edits an **amount** | Edits the **title** | House tasks have no numeric field at all. Titles are `<anchor> <token>`: the anchor identifies the row across phases 2→5, the token is what changes |
| Amounts render rounded, so assertions pass digits only | n/a | no `$` and no rounding to work around |
| Delete = idb swipe tray + idb native-alert confirm | Delete = Maestro, start to finish | House tasks have **no swipe tray** (`NativeSwipeable` is imported only by three Budget views) and their confirm **is** in the hierarchy — the green `tasks/task-detail-mutations.yaml` taps its `Cancel`. The one hazard is that the button *behind* the alert is also labelled `Delete`, so `mm-22a` waits on the alert's unique body text and re-taps in a loop that exits on the modal closing |
| Delete is the last phase | Delete runs **after** the House additions | Phase 7 attaches a photo to the owner's task; deleting it first would attach to nothing |
| Notification prompt: `Don't Allow` | **`Allow`** | `mm-32` needs the scheduler to be able to enqueue. A denied prompt is remembered for the life of the simulator, so one stray deny makes that phase unfixable without erasing the device |
| `budget-sync-pulse.yaml` deep link | `mm-sync-pulse.yaml` subflow | House's sync control does not exist yet and may end up as a banner *or* a settings button; the subflow tries both, optionally, and never asserts — so "this screen has no sync control" cannot be charged to whichever phase was running. Budget settled the question for itself in 2026-08-16 by deleting its banner and forcing syncs through `{scheme}://e2e-budget-sync` instead — no chrome to tap, nothing to navigate away from |
| — | `mm-go-tasks.yaml` clears filters first | `Mine` / `Personal` are sticky chips, and a task created by the *other* member is by definition not "mine". A filtered-off peer row looks exactly like the projection bug this suite hunts |

---

## 6. Sequence

`═` marks a phase where both devices run at the same time.

```
phase 1 — enrolment (ordered; a claim must exist before it can be approved)
  A  mm-01-signin                  owner signs in        (serial: driver warm-up)
  B  mm-01-signin                  invitee signs in      (serial: driver warm-up)
  A  mm-13-owner-pre-invite-task   a task written BEFORE anyone is invited
     ↑ ORDERING IS THE TEST: B does not exist in the home yet, so this row can
       only ever reach it as HISTORY. Below mm-02 it would be a live op and
       mm-12 would silently become a slower copy of mm-20.
  A  mm-02-owner-create-invite     device-sync card → Sync now → Create invite
     ↓ runner scrapes code/secret/household off the Metro log
  B  mm-03-member-join             paste link → confirm, then read out the digits
  A  mm-04-owner-approve           Join requests → compare six digits → approve
  B  mm-05-member-enrol-sync       sync until the home key lands (HDK)
  B  mm-12-member-backfill         WAITS — taps no sync — for the pre-invite task
     ↑ the absence of a pulse is the assertion: it proves joining FETCHES the
       checkpoint, not merely that the data could be fetched

phase 2 ═ create            mm-20-add-and-await-peer
  A  adds task "MM Owner …  v1"  ┐ each then polls until the OTHER
  B  adds task "MM Member … v1"  ┘ member's task appears

phase 3 ═ modify            mm-21-modify-and-await-peer
  A  renames its own → "… v2"    ┐ each then polls until the peer's NEW
  B  renames its own → "… v2"    ┘ title appears

phase 4 ═ conflict          mm-23-conflict-parallel
  A  offline, renames the SHARED row → "… A88" ┐ neither has seen the other's
  B  offline, renames the SHARED row → "… B94" ┘ write when it makes its own
     ↓ both unblock and sync
     runner reads BOTH devices (idb) and requires agreement + a conflict badge

phase 6 ═ property switch (H5)   mm-30a → mm-30
  A  mm-30a ensures a second property exists (created once, stable name)
  A  switcher: switch to property B  ┐ while B is writing into the SHARED
  B  writer:  create + keep pushing  ┘ household
     A asserts the peer's row is ABSENT inside property B (no bleed),
     switches back, and asserts it ARRIVED

phase 7 — attachment (H6)        mm-31a → mm-31b
  A  attaches a real photo to its task through the picker, syncs
  B  opens the same task: 1/5 + a cover thumbnail
     runner: B's Library/Caches/lf-blobs/ GREW — the bytes moved, not just a row

phase 7b — property photo (H6)   mm-34a → mm-34b
  A  puts a photo on the SHARED PROPERTY itself (swipe card → Edit → picker), syncs
  B  opens the same property's edit sheet: household-form-photo-blob-view —
     the DECRYPTED image, not the bare prefix, which would also match an
     un-fetched `-download` placeholder
     runner: B's lf-blobs/ GREW again. Distinct from phase 7: the descriptor
     rides in the `households` ledger row (photo_blob + synthetic lf-blob/ key),
     and `uploadPhoto` once threw "Home photos sync in a later update" on this
     exact path long after task attachments worked.
     SKIPPED when the shared household's name was not scraped (same reason as H5).

phase 8 ═ reminder (H7)          mm-32
  A  writer: creates a task with a parsed due date, syncs
  B  reader: receives it, soft-relaunches to force a scheduler pass
     runner: a notification request carrying the title exists on B

phase 9 — widget (H7/N4)         mm-33
  B  settles on Home with the peer's task in the ledger
     runner: group.com.symply.house → widget_tasks contains the title,
             and carries NO field outside HOUSE_WIDGET_TASK_FIELDS

phase 5 ═ delete            mm-22a → mm-22b
  A  deletes its task ┐ each then polls until the peer's task
  B  deletes its task ┘ has disappeared here

cleanup ═ mm-11-cleanup on both devices for all four anchors
```

Phase 4 deliberately asserts **no fixed winner**. Both edits land in the same
instant, so the winner is whichever HLC is higher; hard-coding one would assert
this machine's timing rather than the merge rule. The runner reads the rendered
token off both devices and requires them to agree on exactly one of the two
candidates, **plus** a merge-conflict indicator on a device. That is the property
TRD §8.4 promises, and it is stronger than an expected value.

Phases 3 and 5 exist because propagation is three different guarantees: a create
inserts a whole row, an edit ships only changed fields onto a row the peer must
already hold, and a delete has to *remove* peer state — the case a broken
projection hides best, because nothing looks wrong locally.

### 6.1 Phase 6 (H5) — what it actually proves

H5's own as-built notes call out the decision the design did not anticipate: the
OpLog projection handler is created **per property**, because a shared handler
reading a module-level engine would merge a background property's incoming ops
into whichever ledger happened to be active — *"the exact cross-household bleed
this stage exists to prevent, and invisible until two properties diverged"*
(plan §7.1). Unit tests cover the write path. What they cannot cover is a
**remote** op arriving while the member is looking at a different property. This
phase arranges exactly that, and fails at the bleed assertion — not at the end —
if the projection ignores the active household.

It also closes the H5 DoD's open bullet in part: *"sync fan-out … needs the
relay, so it lands with H12."*

**Precondition:** the switcher renders only when the account holds more than one
property (`PropertySwitcher.tsx:41`), and it is driven by the property's
displayed **name**. The runner learns the shared household's name from the
invite marker's `household=` field; if that is absent it **skips the phase with
a printed reason** rather than passing silently. Override with
`MM_PROPERTY_A='<name>'`. The second property (`MM_PROPERTY_B`, default
`MM Second Property`) is created once with a stable name and reused; cleanup
never deletes a property.

### 6.2 Phase 7 (H6) — why a rendered thumbnail is not the assertion

The plan states Budget's gap plainly (§8): the row syncs, **the bytes do not**,
and the peer ends up holding a `localUri` that points at a file on someone
else's device. An `<Image>` whose source resolves to nothing still occupies the
view hierarchy, so a thumbnail on B would pass while H6 was completely broken.

The runner therefore snapshots B's decrypted-blob cache
(`cacheDirectory/lf-blobs/`, `houseBlobStore.ts:24-25, :154`) **before** the
attach and requires it to have **grown** afterwards. Counting non-empty files
rather than checking non-emptiness matters: a blob cached by an earlier run
would make the weaker form pass without a byte moving.

> ~~**Expected to fail today.** Nothing in `src/screens` or `src/components`
> imports `houseBlobStore` — H6 is a complete data layer with no UI wired to it,
> and `TaskFormPhotos` still stores plain local URIs. This phase is the
> acceptance test for that wiring, and it should stay red until it exists.~~
>
> **Wired 2026-08-14.** `TaskFormPhotos.tsx` now stages and uploads through the
> blob channel when `isHouseLocalFirst()` is on: `newBlobId()` →
> `stageHouseBlobOrigin` → `uploadHouseBlob`, with the descriptor carried on
> `TaskPhoto.blob` and therefore synced on the ledger row. Blob-backed photos
> render through `HouseBlobImage`; the legacy R2 path is untouched when the flag
> is off. The UI contract this phase drives — the `Photos` header, the `1/5`
> counter, `Add photo`, `Choose a source` → `Choose from Library`, and
> `Task cover photo` — was deliberately preserved and is now asserted by unit
> tests, so a copy edit fails cheaply rather than on a device.
>
> **Still unproven on a device.** The runner's byte-level check (device B's
> `lf-blobs` cache must grow) has never executed, because the suite has never
> run at all — see §8. Wiring is not evidence; this phase remains the
> acceptance test.

### 6.3 Phase 8 (H7) — what "firing" means here, and what it does not

Under local-first the Worker's D1 holds no plaintext, so `scheduled.ts`'s
task-reminder pass has nothing to read. Q6–Q10 put reminders on **P1 — on-device
compute**: `houseLocalReminders.ts` reads the ledger and calls
`Notifications.scheduleNotificationAsync` directly, with identifiers prefixed
`house.reminder.`, and its only caller is `ensureSession.ts:94`.

So the property under test is: **a task authored by the OTHER member causes THIS
device to schedule a local notification.** The relay cannot read the title, so a
notification request on B carrying A's title can only have been created by B's
own scheduler acting on a synced op. The runner greps the simulator's own
notification stores (`data/Library/UserNotifications`, `.../BulletinBoard`) for
the anchor.

**Not asserted: delivery at fire time.** That needs the device clock moved
forward, and moving one device's clock in a two-device HLC test corrupts the
ordering every other phase depends on. Pending-request existence is the
strongest assertion available without breaking the rest of the suite.

The due date comes from **smart capture**, not from a date picker:
`buildTaskDueReminders` skips any task without `next_due_date`, the manual form's
date control has no testID, and the already-green
`tasks/add-task-smart-capture.yaml` proves the quick-capture parser handles a
natural-language date. The flow appends `MM_DUE_PHRASE` (default `tomorrow`) to
the title and lets the real parser set the field; `reminder_enabled` defaults
true on House tasks.

### 6.4 Phase 9 (H7/N4) — the widget has no UI to assert on

There is no House widget surface in the app: no settings screen, no preview, no
testID in `src` matching "widget" for this brand. `widgetProjection.ts` hands a
minimal task slice to `widgetSync.setTasks`, which writes the `widget_tasks` key
into the App Group (`WidgetSyncModule.swift:70`). The extension is a separate
process with no DEK, so that file is the **only** place the projection is
observable — the flow's job is to establish the precondition, and the runner
reads `group.com.symply.house` out of the simulator container.

The runner asserts **two** things, because the projection is also a privacy
boundary. `HOUSE_WIDGET_TASK_FIELDS` is an 8-field allowlist over a 58-column
row, and the fields it excludes are the ones a household would least like
sitting in plaintext outside the encrypted store: `description`, `ai_rationale`,
`blocker_reason`, `clarification_question`, assignee identity, photo keys. Any
key beyond the allowlist appearing in the App Group fails the phase.

---

## 7. The one thing the harness fakes

The owner's invite code has to reach the other member. In life a person reads it
out or texts it. Here the runner scrapes the dev-only `[E2E-INVITE]` line off the
Metro log and passes it to device B as flow env, which B then **types into the
real join field**. The approval word travels the same way and is tapped by its
real label.

Nothing else is shortcut: the invite is created through the button, claimed
through the form, approved through the OOB check (a wrong word is rejected by the
Worker), tasks are entered through the real add sheet, the photo comes out of the
real picker, and every sync is a real tap.

The scrape is bounded to lines written after the run started, so a previous
run's expired invite cannot be picked up. Both simulators share one Metro, so
their console output interleaves in `/tmp/metro-house-mm.log`.

---

## 8. Running it

```sh
# e2e/credentials.local must hold two DIFFERENT accounts:
#   E2E_EMAIL / E2E_PASSWORD  and  E2E_EMAIL_SECONDARY / E2E_PASSWORD_SECONDARY
# (the *_SECONDARY pair is currently declared but EMPTY — create the account first)

./scripts/e2e/run-house-multi-member-sync.sh
```

Variations:

```sh
MM_PARALLEL=0        ./scripts/e2e/run-house-multi-member-sync.sh  # one device at a time
MM_FAIL_FAST=0       ./scripts/e2e/run-house-multi-member-sync.sh  # keep going past a failure
MM_PROPERTY_A='Main Home' ./scripts/e2e/run-house-multi-member-sync.sh  # enable H5 without the marker
E2E_DEVICE_A=House-A E2E_DEVICE_B=House-B ./scripts/e2e/run-house-multi-member-sync.sh
HOUSE_MM_METRO_PORT=8093  ./scripts/e2e/run-house-multi-member-sync.sh
LF_SYNC_NOW=whatever-h3-called-it ./scripts/e2e/run-house-multi-member-sync.sh
```

Preconditions the runner enforces or fixes for you:

- 15 GB free (preflight), 5 GB floor (between phases)
- both simulators size-capped before boot, created if missing
- `com.symply.house` installed on B — copied from A's bundle if absent
- generated brand files are `symply-house` (refuses to regenerate them mid-run,
  which would clobber a concurrent build)
- Password AutoFill off; notifications / Face ID / photos **granted**
- photo fixtures pushed into both Photos libraries (`seed-fixtures.sh`)
- its own Metro on `:8093`, and the bundle pre-built once before either device
  asks for it

It writes an HTML report to
`documents/engineering/testing/reports/house-multi-member/<ts>/index.html`
(`latest` symlink alongside), opens it early and refreshes it while the run
proceeds. Per-device Maestro output goes to `steps-A.log` / `steps-B.log` in the
same directory; verdicts to `summary.log`.

Enrolment is a chain — `mm-04` cannot approve a claim `mm-03` never made — so the
runner stops at the first failure rather than reporting a cascade of unrelated
ones. Cleanup runs only on a green run; rows are timestamped per run, so
leftovers never collide with the next attempt.

**Standing rule inherited from Budget §3.5.0:** the two-device E2E must run
against a Worker built from **the same commit** as the client. Confirm the
deployed Version ID postdates the newest `backend/src` commit before every run.

---

## 9. Known limitations

1. **The enrolment phase cannot pass until H3 ships the §5.1 screen.** That is
   the intended state: this suite is the screen's acceptance test, and every
   contract id it needs is listed in §3.
2. **Phase 7 cannot pass until an attachment UI is wired to `houseBlobStore`.**
   The data layer is complete; nothing imports it.
3. **Phase 6 auto-skips** unless the invite marker carries `household=` or
   `MM_PROPERTY_A` is set, because `PropertySwitcher` is driven by name.
4. **Conflicts are flagged on one replica.** The device that receives an op older
   than its own value knows a write was discarded; the device whose value was
   superseded adopts the winner silently. Flagging both sides needs real
   causality — V2 writes `parents: []` on every op — so the check accepts the
   badge on either device.
5. **Joining replaces the invitee's local ledger.** The engine holds one snapshot
   per property and merging two is undefined in the BRD/TRD. The UI must confirm
   before discarding; `mm-03` taps through that confirm.
6. **Three components are driven by text, not ids** (§4). Adding testIDs to
   `PropertySwitcher`, `TaskFormPhotos` and the add-property sheet is the
   cheapest hardening available to this suite.
7. **`HOUSE-MM-*` matrix rows are not yet in `matrices/house.md`.** The ids are in
   the flow headers, ready to link.
8. **Reminder *delivery* is not asserted** (§6.3), only that the local scheduler
   enqueued the request.
