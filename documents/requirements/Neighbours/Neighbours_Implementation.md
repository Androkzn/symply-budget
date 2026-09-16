# Neighbours — as-built

**Migration** `0165_neighbours.sql` · **Brand** Symply House only · **Tier** A (device-authoritative)

The homes around this property, and the people who live in them, on a map.

---

## Why this shape

A pin on a map is a **building**. The people inside it are a **list**. Modelling a
neighbour as a person — the obvious first design — means the second occupant
either overwrites the first or becomes a second pin on the same roof. Both are
wrong and both appear on day two of real use. So:

| Table | Is | Notes |
|---|---|---|
| `neighbours` | one HOME | `latitude`/`longitude` are `NOT NULL` — a row that cannot be drawn is a note, not a neighbour |
| `neighbour_people` | one occupant | cascades from the home; `household_id` denormalised so the ledger can scope without a join |
| `neighbourhoods` | a named AREA | optional everywhere; `ON DELETE SET NULL`, so deleting an area unfiles its homes rather than removing them |

`place_source` records how a pin got where it is (`map_tap`, `geocoded`,
`manual`, `contact_import`). It is not decoration: a tapped pin is exact and its
address is a guess, a geocoded pin is the reverse, and the detail card says
which so a member can fix the half that is wrong instead of distrusting both.

---

## Privacy — the premise, not a property

Every row describes a **third party who never installed this app**, never saw a
consent screen and cannot withdraw. Three consequences are load-bearing:

1. **All three tables are in `HOUSE_AI_EGRESS_FORBIDDEN_TABLES`.** Being absent
   from the allowlist would already fail closed; they are named explicitly so a
   future "just the labels, for context" has to delete a commented line rather
   than add one.
2. **Geocoding goes through the OS**, never a Symply endpoint.
   `expo-location`'s `geocodeAsync` / `reverseGeocodeAsync` call CLGeocoder or
   Android's `Geocoder` — no API key in the bundle, and no neighbour's address
   crossing a boundary the member has not already accepted with their phone.
3. **`useNeighbours` uses plain `useQuery`, not `usePersistedQuery`.** MMKV would
   be a second, unencrypted copy of exactly this data, and on a local-first
   household the "fetch" it optimises is already a synchronous ledger read.

Contacts import offers two doors and describes what each costs **before** either
opens: the OS picker (out of process, no permission, returns only the chosen
person) is listed first; full address-book access is the second and is only
requested when the member picks it.

---

## Local-first

| Concern | Answer |
|---|---|
| Registry | 75 → **78** live tables (`HOUSE_WAVE_A_TABLE_COUNT`) |
| Window | **None** on all three. A neighbour outside a read window is a hole in a map — the pins around it render, the street looks fully surveyed, and a map has no empty row to say otherwise |
| S3b | `neighbourhoods` only, keyed `(household_id, name)` normalised. `neighbours` and `neighbour_people` take random ids on purpose: deriving one from a label would merge two different families the first time a street repeated a surname |
| Cascades | `remove` drops the occupants in the SAME op; `deleteNeighbourhood` unfiles its homes in the same op. A ledger has no foreign keys and a tombstone is absorbing |
| Bulk | `importContacts` writes one op per chunk via `writeLocalBulk` — thirty contacts is ~1 op, not 30 |
| Refresh | `['neighbours', householdId]` for all three tables; the people share the home's key because `getAll` embeds them and the map bubble's count comes from it |

`localNeighboursApi` implements **all 14** remote methods — no `remoteMethods`,
no local throws. Nothing in this family needs a server, a model or a file
upload; photos ride the H6 blob channel through `HouseAttachmentField`, so the
api never touches the bytes.

---

## The map

| Decision | Why |
|---|---|
| **Long-press to add, tap to inspect** | a member panning a map taps it constantly by accident; a tap-to-add would open a create form over their place on the map |
| **Fixed crosshair, moving map** (`NeighbourPickOnMapScreen`) | a draggable marker is covered by the thumb aiming at it, is bounded by finger size rather than zoom, and can be dragged off-screen |
| **Grid clustering, then a merge pass** | grid is O(n) and order-independent; the second pass merges clusters within half a cell so two houses straddling a boundary do not render as two bubbles. `CLUSTER_MERGE_FRACTION` |
| **Peek card, not a push** | a pin tap is orientation — the answer is only useful while the surrounding pins are visible |
| **Count badge only above 1** | a "1" on every pin trains the eye to stop reading the badge |
| **Selection changes SIZE** | a colour-only selected state is invisible against satellite imagery |
| **Existing pins shown, muted, in the picker** | the duplicate guard, at the cost of a glance rather than a dialog |

The property's own coordinates are geocoded once from its address and cached in
the setting `house.property_coordinates` — the map opens there and every
`distance_meters` is measured from it. Three states, not two: resolved,
resolving, and **unresolvable** (a rural route or new subdivision still gets the
whole feature; the map opens on the device's position instead).

---

## Surfaces

`app/neighbours.tsx` → `NeighboursNavigator` (top-level route, House-only,
`/neighbours?neighbourId=…` deep-links to one home). Entry point: the
**Neighbours** row on My Home.

`NeighboursMap` · `NeighbourPickOnMap` · `AddEditNeighbour` ·
`NeighbourDetail` · `Neighbourhoods` · `NeighbourImportContacts`

---

## Coverage

| Suite | What it locks |
|---|---|
| `src/utils/__tests__/neighbourGeo.test.ts` | haversine, region framing, clustering (incl. order-independence and the boundary merge), relation suggestion, distance formatting |
| `src/features/house/local/__tests__/localNeighboursApi.test.ts` | CRUD, one-op writes, both cascades, S3b convergence, bulk import, always-resident bucketing |
| `src/services/__tests__/neighbourContacts.test.ts` | contact → neighbour mapping, export shape, all three permission outcomes |
| `src/components/neighbours/__tests__/NeighbourMarkers.test.tsx` | badge rules, photo precedence, avatar stack overflow |
| `src/screens/neighbours/__tests__/NeighboursMapScreen.test.tsx` | long-press vs tap, clustering at zoom, peek card, list toggle, client-side filters |
| `backend/src/routes/__tests__/neighbours.test.ts` | auth + membership, **route order**, validation, cascades, one-primary invariant |
| `e2e/maestro/neighbours/` | `nbr-001`–`nbr-009`; `npm run test:e2e:neighbours` |

Three copies of haversine exist (client util, ledger facade, Worker) because
each computes over rows the others cannot see. All three assert the **same
fixtures**, which is what stops them drifting.

---

## Deploy

Backend changes land from the `main` checkout only. Apply `0165` to staging AND
production for every fleet brand before `deploy:fleet` — `migrations_dir` is
shared, so the three tables arrive on Budget/Kaizen/Health D1s as unused tables
on brands that never mount the router (`gateHomeApiPaths`).

Two new native deps: `expo-location` and `expo-contacts`. **A dev client must be
rebuilt** before the E2E suite will run.
