# House Local-First — Household Identity on an Empty Device

**Status:** Engine + bootstrap fix landed. Member-facing recovery screen and the
address-capture mount are **in the working tree, uncommitted** at the time of writing — see
[Where the wiring actually stands](#where-the-wiring-actually-stands).
**Date:** 2026-08-27
**Related:** [property-jurisdictions.md](./property-jurisdictions.md) ·
[house-local-first-implementation-plan.md](../House%20v2/house-local-first-implementation-plan.md)

---

## What a member saw

They reinstalled Symply House, signed back in, and their home was gone. In its place, in
"My Properties", sat one empty home named after them. No error, no explanation, and no
screen anywhere in the app that could account for it — because there was no *state* saying
anything had happened.

On staging, one account accumulated **17 orphan households**, every one named after the
member, every one with a null address.

---

## The bug

Three ordinary mechanisms composed into a data-loss-shaped outcome. None of them is wrong
on its own.

### 1. An empty device minted a household, unconditionally

`openLocalHouseSessionInner` reached `mintNewHousehold` whenever `sessions.size === 0` —
that is, whenever the device held no local ledger — and minted a fresh random id:

```ts
// src/features/house/local/engine.ts:1614
const householdId = `hh_local_${bytesToHex(randomBytes(8))}`;
```

That is correct for exactly one situation: a genuinely new account. **"No ledger on disk"
is not that situation.** It is also the reinstall, the new phone, the device restore, and
the sign-in after a wipe — and on all of those the account's real home is sitting on the
control plane one `GET` away. The engine never asked.

### 2. The mint was then published to the server as an owner-create

`ensureHouseLocalSession` runs on **every sign-in** (`src/stores/authStore.ts:212`) and
**every auth rehydrate** (`src/stores/authStore.ts:445`), plus once from
`DataContext.tsx:232`. After opening the session it fire-and-forgets
`syncAllLocalHouseholdsToControlPlane()` (`ensureSession.ts:433-442`), which for a
household whose `my_role` is `owner` issues:

```
POST /v2/households  { householdId, displayName: <this device's ledger name>, device }
```

(`controlPlaneClient.ts:537-546`). A **create**, not a discovery. Every reinstall therefore
added one more row to the account.

### 3. The local list then overwrote the real one on screen

`syncHouseholdStoreFromLocalLedger` (`ensureSession.ts:112-162`) publishes the engine's
property set **over** `householdStore.households` with a `setState`, not a merge. The
device held exactly one property — the one just minted — so the store was left holding
exactly that. The member's real home was not hidden by a filter; it was replaced.

That step is not a bug. It is what makes House work offline: the whole of House V2 reads
the local ledger, so the store must reflect it. It is the reason step 1's mistake was
invisible rather than merely wrong.

**Local-first is on by default for `symply-house`** — `isHouseLocalFirst()` returns true
for that brand with no env var set (`src/features/house/local/flag.ts:12-38`) — so this was
the default path, not an opt-in one.

---

## Why this is not the S3b hazard

The local-first plan enumerates **S3b**: a table with a surrogate primary key and a
business `uniqueIndex`, where two offline devices minting random ids for the *same logical
row* produce two rows that survive the merge (`house-local-first-implementation-plan.md:367`).
Eleven House tables are in that class, and the fix is a **deterministic id hashed from the
natural key** (`src/features/house/local/ids.ts`, guarded by `registryGuard.test.ts` and
proved by `deterministicIds.test.ts`).

That fix cannot be applied here, and reaching for it would be actively wrong:

> **A household has no natural key.** Two genuinely different properties must get two ids.
> A deterministic builder keyed on anything a device knows — the user id, the display name,
> the country — would collide a landlord's three homes into one.

So this is a **sibling hazard the plan never enumerated**: a *random id minted per device
for an account-scoped entity, with no adoption path*. S3b is about two devices disagreeing
about the id of one row. This is about a device inventing an entity that already exists
somewhere it never looked.

The distinction is the entire reason the fix is **reconciliation, not derivation** — ask
who owns what, adopt what is there — and it is stated at the top of the type that carries
the decision (`engine.ts:1105-1106`) and at the top of its test file
(`__tests__/householdAdoption.test.ts:19-24`), so nobody re-derives it as an id scheme.

---

## The fix

### The decision moved out of the engine

The engine **cannot** answer "does this account already own a home?" — the fact lives on
the control plane, one network round trip away, and the engine is the layer that has to
work with no network at all. So the caller decides and the engine executes:

```ts
// src/features/house/local/engine.ts:1108
export type HouseEmptyDeviceDecision =
  | { allowMint: true }
  | { allowMint: false; adopt?: Array<{ householdId: string; displayName?: string | null }> };
```

Two entry points, so that only the one caller who needs to reason about the control plane
has to:

| Entry point | Empty-device behaviour | Callers |
|---|---|---|
| `openLocalHouseSession` (`:1138`) | Mints, exactly as before | Tests, `index.ts`, `startNewHouseholdOnThisDevice` |
| `openLocalHouseSessionWithMintDecision` (`:1169`) | Asks the caller | `ensureHouseLocalSession` — the launch bootstrap |

`decideEmptyDevice` is invoked **only** when `sessions.size === 0` (`:1305-1307`), which is
what keeps this off the hot path: a device that already holds a home returns from disk
having touched no network, and this runs on every rehydrate.

The decision is taken **inside** `queueSessionWork` (`:1174`), so a second bootstrap
arriving while the first is still asking the control plane queues behind it and then finds
the session already open. Two rehydrates cannot mint two homes. The cost accepted is that
session work blocks for the length of one `GET`, on the one launch in a device's life
where there is nothing else to do anyway.

### A `GET` before any `POST`

```ts
// src/features/house/local/ensureSession.ts:304
async function decideWhatAnEmptyDeviceMayDo(): Promise<HouseEmptyDeviceDecision> {
  let remote: ControlPlaneHousehold[];
  try {
    const controlPlane = require('./controlPlaneClient') as …;
    remote = await controlPlane.listControlPlaneHouseholds();   // GET /v2/households
  } catch (error) {
    console.warn('[HouseLocal] control plane unreachable — not minting a home', error);
    return { allowMint: false };                                 // "I do not know"
  }
  if (remote.length === 0) return { allowMint: true };            // genuine first run
  return { allowMint: false, adopt: remote.map(…) };              // adopt, do not mint
}
```

`GET /v2/households` reads `lf_households JOIN lf_memberships` for the calling user
(`backend/src/services/local-first-control-service.ts:708-721`), which is the authoritative
answer to the question the old code guessed at.

Two implementation details are load-bearing:

- **A lazy `require`, not `await import(...)`.** A static import is impossible —
  `controlPlaneClient` imports `syncHouseholdStoreFromLocalLedger` from this file, so they
  are a cycle. `await import(...)` throws under Jest without `--experimental-vm-modules`,
  which is harmless for the floated calls that swallow it and *not* harmless here: swallowed,
  it reads as "control plane unreachable" and turns every test of this decision into the
  offline branch (`ensureSession.ts:308-319`).
- **Any failure means "I do not know", never "this account owns nothing."** An expired
  token and a dead network both throw at the same place, and reading either as "first run"
  is precisely what minted the orphans.

### Adopted homes take their real id, their real name, and no keys

`openEmptyDevice` (`engine.ts:1324-1374`) executes the decision. For the adopt branch it
generates **one** device identity for all the homes (`:1352`) — a per-property keypair
would make each of the member's own homes see the others as a different device — and calls
`adoptHouseholdSession` per home (`:1875-1958`).

The adopted session is the **pending-enrolment shape** a joined home already has between
claiming an invite and the household key arriving:

| Field | Value | Why |
|---|---|---|
| `household.id` | the **real** control-plane id | Nothing is invented; the row already exists |
| `household.name` | the real `display_name` | The member is told which home they are looking at |
| `my_role` | **`'member'`**, even though the account owns it | `registerHouseholdOnce` branches on this: `owner` sends it down `POST /v2/households`, which is the exact call the orphan bug was made of. A member registers its **device** against the existing home instead — the call that lets a peer wrap the key to it (`engine.ts:1894-1903`, `controlPlaneClient.ts:507-535`) |
| `pendingEnrolment` / `awaitingKeys` | `true` | Refuses every authored write until the real key wrap arrives |
| `householdKeys` | a **throwaway** HDK | Never used to seal anything. Copying another property's key bytes in would be the cross-property key smear the session registry exists to prevent (`engine.ts:1905-1913`) |

So **no household CREATE is issued from a recovering device**, by construction rather than
by care at the call site. The real role arrives later with the roster, exactly as it
already does for an owner's second device.

### Nothing decided means nothing opened

If the control plane could not be reached, `adopt` is empty, `openEmptyDevice` closes the
store and returns `{ status: 'no-local-ledger' }` (`engine.ts:1339-1346`).
`ensureHouseLocalSession` then sets `{ status: 'undecided-offline' }` and returns before
any of the sync, push-token, reminder or roster work (`ensureSession.ts:401-408`):

> Deferring costs a relaunch. Minting costs an orphan that is then pushed to the server.

### `HouseLocalBootstrapState` — the state that did not exist

The old code had nowhere to say any of this, which is why the member found out by noticing.

```ts
// src/features/house/local/ensureSession.ts:219
export type HouseLocalBootstrapState =
  | { status: 'idle' }
  | { status: 'open'; householdId: string }
  | { status: 'recover-this-home'; households: Array<{ id: string; name: string }> }
  | { status: 'undecided-offline' };
```

Observable via `getHouseLocalBootstrapState` / `subscribeToHouseLocalBootstrapState`
(`:239-250`), compared **by value** before notifying (`:256`) because it is republished on
every ledger change and waking every subscriber for an unchanged state would put a
re-render on a path that runs on every screen focus.

It is **derived from the engine's property set, never remembered from the bootstrap**
(`publishBootstrapStateFromEngine`, `:275-290`). That matters at exactly one moment:
enrolment completing. `installHouseholdKeys` clears `awaitingKeys` and emits a ledger
change, and because the state is recomputed the member's screen leaves
"recover-this-home" by itself — nothing has to remember to clear a flag. The recompute is
called **before** the in-step early return in `startPropertySetWatch` (`:193-196`), because
enrolment completing changes no name and no count, so the one event that ends the recovery
state is precisely the one the store check would dismiss as nothing to do.

`'recover-this-home'` fires only when **every** property is awaiting enrolment. Joining a
home *adds* a pending property beside a real one and cannot do otherwise —
`adoptJoinedHousehold` needs an open session to adopt beside — so "all pending" is the
recovery case and only the recovery case.

### Minting is still possible — but only a person may ask for it

```ts
// src/features/house/local/ensureSession.ts:353
export async function startNewHouseholdOnThisDevice(displayName?: string | null): Promise<void>
```

The escape hatch the automatic path deliberately does not take: a member who is offline, or
who holds only key-less placeholders they can never enrol (the other phone is gone, the
invite can never be approved), would otherwise have nowhere to go. It creates the new home
**beside** the placeholders, never instead of them (`:358-363`) — those may still be
recovered later from another device, and dropping them here would take that away.

"Mint quietly and hope" is the behaviour removed. Minting itself is not.

---

## The second defect: the household had no address, and no way to get one

The auto-minted household was not merely extra. It was **unusable for the property
surface**, permanently.

`buildHousehold` seeds one address field and leaves the rest null:

```ts
// src/features/house/local/engine.ts:1027
function buildHousehold(id: string, name: string): LocalHousehold {
  return {
    id, name,
    address_line1: null, address_line2: null,
    city: null, state_province: null, postal_code: null,
    country: 'CA',                       // ← the only one seeded
    …
  };
}
```

`isPropertyAssessmentSupported` resolves the jurisdiction from **country + state_province**
(`src/utils/region-gating.ts:100-106`), so a home with `state_province: null` can never
resolve one. The whole property assessment and tax surface stays shut behind
*"Add your province or state to your property address…"*.

And the member could not act on that sentence on the path they were on:
`CreateHouseholdScreen` is the address form on the **onboarding** stack, and onboarding is
gated on `hasCompletedOnboarding` — an **account-level server flag**, restored on sign-in.
A member re-signing in on a fresh install is already onboarded, so no onboarding step ever
runs again while an address-less home is created underneath them.

> **Correction to the in-code comments.** `RootNavigator.tsx:24` and
> `region-gating.ts:215-216` both describe `CreateHouseholdScreen` as "the only screen in
> the app that collects those fields". That is **not accurate**.
> `HouseholdManagementScreen` (Settings → household row, and "Edit details" from
> `PropertyDetailScreen:172`) carries a full country / province / city editor in its
> `AddEditModal` and saves through `householdsApi.update`
> (`HouseholdManagementScreen.tsx:188-352`, `:777-792`), and it is registered for House at
> `SettingsNavigator.tsx:214`. The accurate statement is narrower and still damning: the
> gate copy names a fix and offers **no route to it** from where it is shown, so the member
> is told to add an address by a screen that does not know where one is entered.

### The gate, made actionable

`getPropertyAssessmentGate` (`region-gating.ts:181-207`) splits "we do not have enough
information" from "we do not cover your region", because on screen those read identically
and only one of them is fixable by typing:

| Reason | Meaning | `fixableByAddress` |
|---|---|---|
| `no-household` | Store not loaded, or a brand with no household domain | false |
| `no-country` | A home exists with no country | true |
| `no-region` | A country but no province/state | true |
| `unsupported-region` | A complete address in a region we have not seeded (`US/WA`) | **false** |

`householdNeedsAddressCapture` (`:225-229`) is the predicate built on it. It excludes
`no-household` deliberately: a null household is the store not loaded yet, or a brand
without households at all, and treating it as "needs capture" would flash an address form
at every member on every cold start — worse than the bug.

---

## Where the wiring actually stands

The tree is being worked on concurrently. As verified at the time of writing:

| Piece | File | State |
|---|---|---|
| Adopt-before-mint decision + adoption shape | `src/features/house/local/engine.ts`, `ensureSession.ts` | **Committed** |
| `getPropertyAssessmentGate` / `householdNeedsAddressCapture` | `src/utils/region-gating.ts` | **Committed** |
| `usePropertyAddressCaptureGate` + routing `Onboarding → CreateHousehold` | `src/navigation/RootNavigator.tsx:58-71`, `:118-124` | **Committed** (`dad5983de`, `e65a6b573`) |
| The **mount decision** that makes that gate reachable | `app/_layout.tsx:213`, `:619` | **Uncommitted working-tree change** |
| `HouseRecoverHomeScreen` + `useHouseRecoveryGate` | `src/screens/house-v2/enrolment/HouseRecoverHomeScreen.tsx` | **Untracked — not committed** |
| Backup restore into a pending (`awaitingKeys`) property | `engine.ts` (`rekeySessionHousehold`, `applyLocalHouseRestore`) | **Uncommitted working-tree change** |

So: **the address-capture path is live in the working tree but not yet on the branch.**
`RootNavigator` alone does nothing — it only chooses which of its own routes to open once
mounted, and the mount decision (`!isAuthenticated || !hasCompletedOnboarding ||
needsAddressCapture`) is the uncommitted half. Until that lands, an already-onboarded
member with an address-less home still never sees the form.

Two details of the working-tree wiring worth keeping if it is revised:

- `needsAddressCapture = usePropertyAddressCaptureGate() && !houseRecovery`
  (`app/_layout.tsx:213`). The two gates disagree about exactly one member: one whose home
  is on another phone has no address to capture and no way to save one, and
  `CreateHousehold` would **make** a home — the outcome the recovery screen exists to
  prevent.
- `HouseRecoverHomeScreen` is drawn **on top of** the authenticated `<Stack />`
  (`app/_layout.tsx:646`), not instead of it, because both ways out (`/device-sync`,
  `/house-backup`) are ordinary expo-router routes and a route cannot render without the
  navigator that hosts it. It steps aside while the member is on one of them
  (`RECOVERY_ROUTES`).

---

## Cleaning up the orphans that already exist

The fix stops new orphans. It does not remove the ones on staging, and the obvious action
does not either.

### `DELETE /households/:id` does **not** remove one

`households.delete('/:id')` (`backend/src/routes/households.ts:81-89`) calls
`HouseholdService.deleteHousehold`, which soft-deletes the **legacy mirror** and nothing
else:

```ts
// backend/src/services/household-service.ts:258-283
await this.db.update(schema.households).set({ deleted_at, … });        // legacy table
await this.db.update(schema.householdMembers).set({ deleted_at, … });  // legacy table
```

`GET /v2/households` reads a different pair of tables entirely —
`lf_households JOIN lf_memberships … WHERE m.user_id = ? AND m.status = 'active'`
(`local-first-control-service.ts:711-717`). Nothing `deleteHousehold` touches appears in
that query. A member deleting an orphan sees it stay exactly where it was.

### Leaving does

`POST /v2/households/:id/leave` → `LocalFirstControlService.leaveHousehold`
(`:640-656`) → the coordinator's `handleLeaveHousehold`
(`backend/src/durable-objects/household-coordinator.ts:601-627`) → `mirrorEndedMembership`
(`:673-694`), which sets `lf_memberships.status = 'revoked'` — the exact column
`listHouseholdsForUser` filters on. The row leaves the list.

The coordinator's refusal is narrow, and that is what makes it work for orphans:

```ts
// backend/src/durable-objects/household-coordinator.ts:619
if (actor.role === 'OWNER' && others.length > 0 && !others.some((m) => m.role === 'OWNER')) {
  return Response.json({ error: 'last_owner_cannot_leave' }, { status: 409 });
}
```

All three conditions must hold. A sole-member orphan has `others.length === 0`, so the
first clause is never reached — **the last person in a household may always leave, owner or
not.** There is nobody left to strand, and refusing would trap the member in a household
that exists only on the server: the exact debris the rule refuses to create.

### The surface that offers it

`HouseOtherHouseholdsCard` (`src/screens/house-v2/enrolment/HouseOtherHouseholdsCard.tsx`)
lists homes the **account** holds that this **device** has no ledger for — the drift made
visible. Reached at Settings → *Invite & home* → *Homes*
(`SettingsScreen.tsx:850` → `HouseInviteScreen.tsx:249` → `HousePropertiesScreen.tsx:766`).

- It deliberately does **not** offer `DELETE /households/:id`, for the reason above — the
  file says so in its header comment.
- It mirrors the coordinator's rule client-side off the roster, so the button is "Remove"
  when the member is alone and "Leave" when they are not, and it does not offer to leave a
  home where the member is the only owner and others remain.
- The confirmation says the one thing that is both true and irreversible — nothing local is
  deleted, because this device holds nothing for that home — rather than promising a
  deletion that is not happening.
- 404 is treated as success (already out, removed while offline); 409 gets the
  make-someone-else-an-owner message.
- It renders **nothing** when the account holds no home this device is missing, so a
  healthy member never sees it.

---

## Tests

| Suite | Covers |
|---|---|
| `src/features/house/local/__tests__/householdAdoption.test.ts` | The whole decision. An account that already owns homes: no second home minted, **no household CREATE issued**, the real id and name carried in, `recover-this-home` published, held key-less, *every* home adopted not just one. A genuinely new account: still mints with no extra taps, still seeded. Unreachable control plane: mints nothing, says so, retries next launch, and **does not read an expired token as an empty account**. A device that already holds a ledger: never asks. Two bootstraps racing: one home, not two, concurrent *and* consecutive |
| `src/features/house/local/__tests__/deterministicIds.test.ts`, `registryGuard.test.ts` | The S3b hazard this is **not** — kept adjacent so the two are not conflated |
| `src/utils/__tests__/regionGatingAddress.test.ts` | The four gate reasons; `householdNeedsAddressCapture` matching the auto-minted home (`country: 'CA'`, everything else null) and **not** matching a null household or an unseeded region |
| `src/screens/house-v2/enrolment/__tests__/HouseOtherHouseholdsCard.test.tsx` | Renders nothing when there is no drift; lists a home the device is missing; refuses to offer leave to a sole owner with others present; offers remove when nobody else is in it; confirms before acting; survives an unreadable account list and a failed roster read |

---

## Known gaps

- **The member-facing half is not committed.** The recovery screen and the `app/_layout.tsx`
  mount decision are working-tree only. On the branch as committed, an empty device now
  correctly declines to mint — which means a reinstalling member gets `undecided-offline`
  or `recover-this-home` **with no screen rendering either state**. That is a better
  failure than the orphan, but it is not a finished one, and it should not ship half-landed.
- **The existing orphans are cleaned up by hand, one at a time.** There is no bulk action
  and no server-side sweep. Seventeen rows is seventeen confirmations.
- **`DELETE /households/:id` remains misleading.** It still soft-deletes only the legacy
  mirror while every local-first surface reads `lf_households`. Nothing in the endpoint
  itself warns a caller about that; the knowledge lives in a card's header comment.
- **The address gate's copy still names a fix it does not route to.** Even with the mount
  decision landed, the message shown *inside* the property surface
  (`getPropertyAssessmentGateMessage`) has no button, and `getPropertyAssessmentGate`'s
  `fixableByAddress` field has no production consumer yet — only `householdNeedsAddressCapture`
  reads the gate at all.
- **An adopted home is a dead end without a second device or a recovery phrase.** Both
  routes out require something the member may not have. `startNewHouseholdOnThisDevice` is
  the only other exit, and it is a new home, not their old one.
- **`country: 'CA'` is still seeded blind.** `buildHousehold` hardcodes it for every mint,
  including `startNewHouseholdOnThisDevice`, so a US member's explicitly-created home
  starts in the wrong country until they edit it. The address form corrects it; nothing
  else does.
