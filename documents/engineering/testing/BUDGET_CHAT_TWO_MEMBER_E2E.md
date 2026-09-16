# Budget V2 household chat — two-member E2E

**Scope:** Symply Budget V2 (local-first) household chat, driven as **two real
users on two real simulators**.
**Runner:** [`scripts/e2e/run-budget-chat-two-members.sh`](../../../scripts/e2e/run-budget-chat-two-members.sh)
**Flows:** `e2e/maestro/budget/budget-chat-pair-*.yaml`

---

## 1. Why this exists

Budget already had chat coverage — `budget-chat-rooms`, `budget-chat-message`,
`budget-chat-extended`, `budget-chat-assistant`. Every one of them signs in as the
**same single account** and talks to itself or to the AI assistant.

That leaves the central promise of *household* chat unverified. When one account
sends a message and then asserts the body text is on screen, the assertion is
satisfied by the sender's own optimistic echo. It passes identically whether the
message reached the other household member or never left the device. The same
blind spot covers everything that is inherently per-recipient:

| Behaviour | Single-account flow | Two-member run |
|---|---|---|
| Room created by A is visible to B | not exercised | asserted |
| Unread badge raised for the *other* member | not exercised | asserted |
| Message renders as **incoming** for the recipient | indistinguishable from own echo | asserted via `chat-msg-theirs-*` |
| Sender attribution (name on bubble + list preview) | always "self" | asserted as the other member's name |
| Reply travels back to the original sender | not exercised | asserted |

It also turned out to be the only way to catch §5 below: chat was **completely
non-functional in V2** and no single-account flow noticed, because those flows
run against a legacy server household that V2 no longer uses.

## 2. Topology

Two simulators, two accounts, **serial** hand-off — only one device is under
Maestro at any moment.

| | Device | Simulator | Account |
|---|---|---|---|
| Member A | A | `Budget-A` | `E2E_EMAIL` (owner, "Andrei") |
| Member B | B | `Budget-B` | `E2E_EMAIL_SECONDARY` ("E2E Secondary") |

Serial rather than concurrent is deliberate. iOS 26 Maestro drivers drop out
under load (see `maestro-ios26-reduced-load`), and two simultaneously driven
simulators would also need a rendezvous primitive Maestro does not have. A serial
hand-off models the real timing anyway: one person sends, the other answers
later. Both simulators stay booted across the whole run so neither cold-starts
mid-sequence, and both dial the same Metro instance on `:8082`.

The runner creates `Budget-B` and installs the **same app bundle** already
on device A if it is missing — a two-member comparison across two different
builds would prove nothing. It also refuses to reuse a Metro that answers
`/status` but cannot actually serve a bundle (a stale long-lived instance from an
earlier session breaks every launch with "Failed to load app from 127.0.0.1:8082").

## 3. How two members come to exist in V2

Budget V2 is local-first: each device owns an encrypted ledger bound to **one**
household (`hh_local_…`) registered with the `/v2` control plane. There is no
server-side household list and no legacy invite — two people share a budget by
**enrolling a second device**:

| Stage | Device | Flow | What it establishes |
|---|---|---|---|
| A1 | A | `budget-chat-pair-a1-invite` | A mints an invite code (backend-verified `POST …/invites` → 201) |
| B1 | B | `budget-chat-pair-b1-join` | B types the code + secret and claims it — **replacing B's own ledger** with the household's |
| A2 | A | `budget-chat-pair-a2-approve` | A taps the out-of-band phrase B is showing → device approved, **household is now two-member** |
| A3 | A | `budget-chat-pair-a3-send` | A creates the run's room, sends the first message, sees it as an **outgoing** bubble |
| B2 | B | `budget-chat-pair-b2-receive-reply` | B syncs, then sees the room, the unread badge, A's **incoming** bubble under A's name, and replies |
| A4 | A | `budget-chat-pair-a4-verify-reply` | B's reply reaches A as an **incoming** bubble → bidirectional |

Stages form a chain (A cannot approve a claim B never made), so the runner stops
at the first failure rather than burying the cause under dependent failures.
Override with `PAIR_CONTINUE_ON_FAIL=1`; re-run a subset with
`PAIR_STAGES="a3 b2 a4"`. When the two accounts are already enrolled together,
the runner skips A1/B1/A2 automatically — re-running a destructive
ledger-replacing join for nothing helps no one.

## 3a. Live sync — what the serial stages do NOT prove

The serial run hands off between devices: A sends, *then* B's app is launched and
asserts the message is there. B fetched the thread on room open, so that proves
storage and cross-member fan-out but says **nothing about real-time delivery** —
a completely dead WebSocket would still pass it.

[`run-budget-chat-live-sync.sh`](../../../scripts/e2e/run-budget-chat-live-sync.sh)
closes that gap. Device B enters the room and:

1. hard-asserts the message is **not** there — a clean baseline, so a run where
   the sender got ahead fails loudly instead of passing on a message that was
   already in the thread;
2. then sits still — no taps, scrolls, refresh or relaunch — until the text
   appears, which can only happen over the live `ChatRoomDO` socket;
3. and checks it rendered as `chat-msg-theirs-*` under the sender's name.

**Rendezvous is the hard part.** A fixed delay does not work: the watcher's
launch+navigate ranges from ~2 to ~5 minutes with machine load, and a send that
lands first wastes the run (observed at both 60s and 180s). The runner instead
waits for the watcher's own Maestro progress log to report **that specific
baseline assertion** COMPLETED, then sends. Keying off any `is not visible`
step is wrong — the launch subflow performs several, and matching one of those
fired the send at 125s while the watcher was still navigating.

**Two modes**, because two concurrent XCUITest drivers are not viable on every
machine:

| Mode | Sender | When |
|---|---|---|
| `PAIR_LIVE_SENDER=ui` (default) | second simulator, driven by Maestro | a machine that can take two drivers |
| `PAIR_LIVE_SENDER=api` | member A posts over the chat API | anything else |

Both put a real second member's message onto B's open room over the socket; only
A's input method differs. On this machine the `ui` mode consistently killed both
drivers — they dropped with `Connection refused` on *different* XCUITest ports
(so not a port clash) at load >50, matching the existing "run one sim, serial"
guidance. `api` mode is the reliable path here.

**Both directions are verified.** `PAIR_LIVE_DIRECTION=a-to-b` (default) has B
watch while A sends; `b-to-a` mirrors it so the REVERSE path — a reply travelling
back to the original sender — is proven too. The watcher flow takes the expected
sender's name from `PAIR_PEER_NAME`, so one flow serves both.

| Direction | Run | Watcher |
|---|---|---|
| A → B | `2026-08-10 18:40:44` | `Budget-B` |
| B → A | `2026-08-11 23:19:24` | `Budget-A` |

Each produced the same chain (this is the B→A run):

```
[live] device B is watching the room (after 215s)
[live] sending as member B…
Assert that ".*${PAIR_LIVE_MSG}.*" is not visible... COMPLETED   ← clean baseline
Assert that ".*${PAIR_LIVE_MSG}.*" is visible... COMPLETED       ← arrived live
Assert that id: chat-msg-theirs-.* is visible... COMPLETED       ← incoming bubble
Assert that ".*${PAIR_PEER_NAME}.*" is visible... COMPLETED      ← attributed to the sender
```

Note `run-budget-chat-live-sync.sh` must stay bash-3.2 clean — macOS ships 3.2,
where `${VAR^^}` is a "bad substitution" that kills the run just after Metro
comes up, with the failure buried under an unrelated `unbound variable`.

## 4. The one thing that is not UI

The invite **code, secret and OOB phrase** live only on device A's screen, its
clipboard and the native share sheet — none of which a driver on device B can
read. `BudgetSettingsScreen` logs them once in `__DEV__` as `[E2E-INVITE] …`, and
the orchestrator scrapes that line and types the values into device B's Join
panel. That plays the human who reads the code out over the phone; the UI path
under test stays the real one on both devices. It requires a **dev build**.

Everything else — creating the invite, redeeming it, approving the phrase,
creating the room, sending, receiving, replying — is real UI on real devices.

Per-run tokens (`PAIR_ROOM_NAME`, `PAIR_MSG_A`, `PAIR_MSG_B`) all carry the run
timestamp, so no assertion can be satisfied by a room or message left behind by
an earlier run on the shared staging account.

## 5. Bug found and fixed: V2 chat was 403 for everyone

**Symptom.** Every household-chat call from a V2 build returned
`403 {"code":"forbidden","message":"Not a member of this household"}` — listing
rooms, creating a room, sending a message.

**Cause.** `ensureBudgetLocalSession()` rebinds `useHouseholdStore.currentHousehold`
to the local ledger household (`hh_local_…`) as soon as the encrypted session
opens. That household is registered only in the V2 coordinator tables
(`lf_households` / `lf_memberships`). Chat — like every other
`/households/:householdId/...` feature — authorises against the **legacy**
`households` / `household_members` tables, where no such row existed. So a V2
user was not a member of their own household.

**Fix.** `LocalFirstControlService` now mirrors an identity/ACL row into the
legacy tables whenever V2 membership becomes active:

- `createHousehold()` → mirrors the owner
- `approveInvite()` → mirrors the newly approved member
- `ensureLegacyMirror()` → called from the `POST /v2/households` **409** path, so
  households created before the mirror existed self-heal on the client's next
  session open instead of needing a backfill migration

The mirror carries **no financial data** — id, display name, and who may act —
which is exactly what those endpoints authorise on. Budget contents stay in the
encrypted ledger, so the "backend cannot read financial state" guarantee is
untouched; a unit test pins that (`local-first-legacy-mirror.test.ts`). The
mirror is best-effort: a failure logs and returns rather than taking down the
household creation or invite approval that triggered it.

**Note on scope.** The V2 TRD §20 lists "chat R1" under Non-Goals/Deferred, so
this was arguably intended-not-yet-wired rather than a regression. Enabling it was
an explicit decision on this branch.

## 6. testIDs added for this run

These assertions were not expressible against the previous markup:

| testID | Where | Why |
|---|---|---|
| `chat-msg-mine-<id>` / `chat-msg-theirs-<id>` | `ChatRoomScreen` message row | Direction is the whole point — body text alone cannot distinguish a received message from one's own echo. Matched as `chat-msg-theirs-.*`. |
| `chat-room-unread-<id>` | `ChatRoomsListScreen` unread badge | Proves the message raised the count on the recipient's **room row**, not just landed in the thread. |
| `join-request-approve-<id>` / `join-request-deny-<id>` | `JoinRequestsList` | Legacy household join requests; approving was text-only ("Approve"). |
| `household-invite-link` | `HouseholdMembersScreen` | The legacy invite affordance had no stable handle. |
| `join-request-submit`, `join-stage-requested`, `join-stage-already-member` | `JoinHouseholdScreen` | Deterministic branching between "requested" and "already a member". |

(The last three rows cover the **legacy** household pairing UI. V2 pairing uses
`budget-settings-*` testIDs, which already existed.)

## 6a. Do not run this alongside the multi-member sync suite

`scripts/e2e/run-budget-multi-member-sync.sh` (the ledger-sync suite, devices
`Budget-A` / `Budget-B`) deliberately uses different simulators from this
one, so the two look safe to run concurrently. **They are not.** Both suites are
bundle id `com.symply.budget`, and the shared Maestro helpers reap stray
`maestro.cli.AppKt` processes — so each run terminates the other's driver. The
symptom is an exit code of **143** (SIGTERM) with no failed assertion, usually
alongside `DeviceUnreachableException: Device became unreachable during
terminateApp`.

Run them one after the other. Four booted simulators plus two driver stacks also
push this machine past the load where CoreSimulator stays responsive.

There is real overlap between the two suites: both drive the V2 enrolment
handshake (invite → claim → OOB approve) to get two members into one household.
That half is worth converging on a single shared subflow rather than hardening
twice.

## 7. Suite isolation

The pair flows are tagged `pair`, and `pair` is in `excludeTags` in
`e2e/maestro/budget/config.yaml`. They are meaningless inside the single-device
Budget suite: each assumes the *other* member's device already ran the preceding
stage, and half of them must execute as the secondary account.

## 8. Running it

```sh
# both accounts must be in e2e/credentials.local
./scripts/e2e/run-budget-chat-two-members.sh

# re-run just the chat stages after a fix
PAIR_STAGES="a3 b2 a4" ./scripts/e2e/run-budget-chat-two-members.sh
```

A visual + backend HTML report is regenerated after every stage under
`documents/engineering/testing/reports/budget-chat-pair/<timestamp>/`, with
`latest` symlinked to the most recent run; it opens automatically.
