# Budget V2 local-first — two-member sync E2E

**Scope:** Symply Budget (`com.symply.budget`) V2 local-first household sync,
driven as **two real users on two real simulators**.
**Runner:** [`scripts/e2e/run-budget-multi-member-sync.sh`](../../../scripts/e2e/run-budget-multi-member-sync.sh)
**Flows:** `e2e/maestro/budget-multi-member/mm-*.yaml`
**Matrix:** `BUDGET-MM-001` … `011` and `020` … `023` in [matrices/budget.md](./matrices/budget.md)

---

## 1. Why this exists

The existing `BUDGET-LF-*` flows cover the local-first stack from one device:
sync chrome, offline CRUD, "no financial write reaches D1", backup, AI ladders.
Every one of them signs in as a single account, so the central promise of a
**household** ledger — that what one member records shows up for the other —
was never asserted anywhere.

It was also not true. Authoring these flows surfaced that Phase 3 converged the
op log and stopped there: `OpLog` accepts a `ProjectionHandler`, the engine
passed none, and `noteRemoteOpsApplied` only appended to `ledger.ops`. A peer's
op was verified, decrypted, stored — and never applied to the tables the screens
read. The package's convergence tests asserted `listOperationsByHlc(...).length`,
which passes whether or not anything is visible to a human. There was no
conflict-resolution code at all, despite TRD §8.4 specifying LWW-by-HLC.

Two more gaps blocked a real run: no screen could *accept* an invite
(`claimLocalFirstInvite` / `approveLocalFirstInvite` were exported but unwired),
and a device that joined a household kept its own household id, so it polled its
own empty mailbox forever. Those are fixed alongside — see Phase 3b in
[Symply_Budget_V2_Implementation.md](../../requirements/Buget%20v2/Symply_Budget_V2_Implementation.md).

| Behaviour | Single-account LF flow | Two-member run |
|---|---|---|
| Row created by A is visible to B | not exercised | asserted (`MM-020`) |
| Row created by B is visible to A | not exercised | asserted (`MM-020`, both directions at once) |
| An **edit** to an existing row reaches the peer | not exercised | asserted (`MM-021`) |
| A **delete** removes the row on the peer | not exercised | asserted (`MM-022`) |
| More than one entity type projects (Spending + Planning) | not exercised | asserted (`MM-020`) |
| Invite can actually be accepted | not exercised | asserted (`MM-003`/`004`/`005`) |
| Two simultaneous edits to one row converge | not exercised | asserted on both devices (`MM-023`) |
| A discarded edit is surfaced | not exercised | asserted (`MM-023`) |

## 2. Topology

| | Device | Simulator | Account | Role |
|---|---|---|---|---|
| Member A | A | `Budget-A` | `E2E_EMAIL` | household owner |
| Member B | B | `Budget-B` | `E2E_EMAIL_SECONDARY` | invitee |

**Dedicated resources.** This suite owns nothing another Budget run uses: its
own two simulators (created on first run), its own Metro on `:8092`, its own
log. It never takes the Maestro global lock, never touches `Budget-A` /
`Budget-B` (the single-device suite and
[`BUDGET_CHAT_TWO_MEMBER_E2E.md`](./BUDGET_CHAT_TWO_MEMBER_E2E.md) drive those),
and refuses to start if the checkout's generated brand files are not
`symply-budget` — it reports that and exits rather than regenerating them and
clobbering a concurrent build.

`mm-01` signs out before signing in, because the local ledger is device-scoped
and a device still signed in as the other member would reuse that session.

### Concurrency

Phases 2–5 drive **both devices at once** — one Maestro process per simulator.
No coordination channel is needed because the flows rendezvous on the data:
each does its own half, then polls sync until the peer's change appears, so
whichever device finishes first simply waits inside its own poll loop.

Two exceptions, both learned the hard way:

- **`mm-01` sign-in is serial.** It is each device's first Maestro invocation,
  so it is where the XCUITest driver cold-starts. Launching both at once made
  the two drivers kill each other — `Failed to connect to 127.0.0.1:<port> /
  Connection refused`, then `xcTestDriverStatusCheck: [Failed]`. Serial there
  leaves both drivers warm for the parallel phases and costs nothing, because
  sign-in asserts nothing about sync.
- **The second device's launch is staggered** by `MM_STAGGER_SECONDS` (25s) in
  every parallel phase, for the same reason. The flows rendezvous on data, not
  clock time, so the head start does not reduce overlap.

**Machine capacity is the real limit.** Two concurrently driven iOS-26
simulators is already the condition this repo flags for driver drops; running
this suite at the same time as another two-device suite means four booted
simulators and four XCUITest drivers, at which point CoreSimulator stops
compositing and screens render blank while the app underneath is healthy. That
symptom is environmental — check `uptime` before treating it as an app bug.
`MM_PARALLEL=0` falls back to one device at a time.

## 3. The one thing the harness fakes

The owner's invite code has to reach the other member. In life a person reads it
out or texts it. Here the runner scrapes a dev-only
`[E2E-INVITE] code=… secret=… oob=…` line off the Metro log and passes it to
device B as flow env, which B then **types into the real Join panel**. The
approval word is passed the same way and tapped by its real label.

Nothing else is shortcut: the invite is created through the button, claimed
through the form, approved through the OOB word check (a wrong word is rejected
by the Worker), spendings are entered through the item form, and every sync is a
banner tap.

The delete gesture in phase 5 is a real gesture but a *differently driven* one —
`idb` rather than Maestro (`scripts/e2e/lib/idb-row.sh`), for two reasons found
the hard way:

- **The tray.** Maestro's element-swipe is too short to uncover a row's
  Edit / Copy / Delete, and a fixed `92%,50% → 8%,50%` swipe only lands on the
  row when `scrollUntilVisible: centerElement` actually centred it — which it
  cannot when the list is barely taller than the screen. The row then sits at
  ~54% and the gesture passes above it, so the tray never opens. idb reads the
  row's real frame and drags across it.
- **The confirm.** Deleting a row raises a native `UIAlertController`, which iOS
  renders in its own window; XCUITest snapshots of the *app* window miss it
  entirely. Maestro is blind to it, so `tapOn: '^Delete$'` silently re-tapped the
  tray's own Delete behind the alert — every step reported COMPLETED and the row
  stayed. `idb ui describe-all` lists the alert (and, while it is up, nothing
  else), which is what makes "the Delete in the confirm" unambiguous against
  "the Delete in the tray".

Both halves are still real touches on a real device; only the driver differs.

## 4. Sequence

`═` marks a phase where both devices run at the same time.

```
phase 1 — enrolment (ordered; a claim must exist before it can be approved)
  A  mm-01-signin                  owner signs in          (serial: driver warm-up)
  B  mm-01-signin                  invitee signs in        (serial: driver warm-up)
  A  mm-02-owner-create-invite     Settings → Sync now → Create invite code
     ↓ runner scrapes code/secret/oob off the Metro log
  B  mm-03-member-join             Join household → confirm ledger replacement
  A  mm-04-owner-approve           Join requests → tap the OOB word
  B  mm-05-member-enrol-sync       sync until the household key lands

phase 2 ═ create            mm-20-add-and-await-peer
  A  adds a SPENDING  "MM Owner …"  41.17 ┐ each then polls until the
  B  adds a PLANNING  "MM Member …" 58.93 ┘ OTHER member's row appears

phase 3 ═ modify            mm-21-modify-and-await-peer
  A  edits its row → 63.21 ┐ each then polls until the peer's NEW
  B  edits its row → 77.45 ┘ value appears

phase 4 ═ conflict          mm-23-conflict-parallel
  A  offline, edits the SHARED row → 88.12 ┐ neither has seen the other's
  B  offline, edits the SHARED row → 94.36 ┘ write when it makes its own
     ↓ both unblock and sync
     runner reads BOTH devices (maestro hierarchy) and requires agreement

phase 5 ═ delete            mm-22a → runner (idb) → mm-22b
  A  deletes its row ┐ each then polls until the peer's row
  B  deletes its row ┘ has disappeared here
     mm-22a parks each device on its row; the runner performs the swipe and
     the native confirm through idb; mm-22b asserts both removals

cleanup ═ mm-11-cleanup on both devices for both titles
```

Phase 4 deliberately asserts **no fixed winner**. Both edits land in the same
instant, so the winner is whichever HLC is higher — hard-coding one would be
asserting this machine's timing rather than the merge rule. Instead the runner
reads the rendered amount off both devices and requires them to agree on exactly
one of the two candidates, plus a merge-conflict indicator on a device. That is
the property TRD §8.4 actually promises, and it is a stronger check than an
expected number.

Phases 3 and 5 exist because propagation is three different guarantees, not one:
a create inserts a whole row, an edit ships only changed fields onto a row the
peer must already hold, and a delete has to *remove* peer state — the case a
broken projection hides best, because nothing looks wrong locally.

## 5. Running it

```sh
# e2e/credentials.local must hold two DIFFERENT accounts:
#   E2E_EMAIL / E2E_PASSWORD  and  E2E_EMAIL_SECONDARY / E2E_PASSWORD_SECONDARY
./scripts/e2e/run-budget-multi-member-sync.sh          # parallel (default)
MM_PARALLEL=0 ./scripts/e2e/run-budget-multi-member-sync.sh   # one device at a time
```

The script creates `Budget-B` and installs device A's Budget bundle on it
if the simulator does not exist yet, turns off Password AutoFill on both devices,
starts Metro if nothing is serving `:8082`, and writes an HTML report to
`documents/engineering/testing/reports/budget-multi-member/<ts>/index.html`
(`latest` symlink alongside). Per-step Maestro output goes to `steps.log` in the
same directory.

Enrolment is a chain — `mm-04` cannot approve a claim `mm-03` never made — so
the runner stops the sequence at the first failure rather than reporting a
cascade of unrelated ones.

## 6. Known limitations

1. **Conflicts are flagged on one replica.** The device that receives an op
   older than its own value knows a write was discarded; the device whose value
   was superseded adopts the winner silently. Flagging both sides needs real
   causality — V2 writes `parents: []` on every op. `MM-010` therefore asserts
   the badge on the winning device.
2. **Joining replaces the invitee's local ledger.** The engine holds one
   household snapshot; merging two ledgers is undefined in the BRD/TRD. The UI
   confirms before discarding, and `mm-03` taps through that confirm.
3. **Both simulators share one Metro.** Their console output interleaves in
   `/tmp/metro-budget.log`; the invite scrape is bounded to lines written after
   the run started so a previous run's (expired) invite cannot be picked up.
