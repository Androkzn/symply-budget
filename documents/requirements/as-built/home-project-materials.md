# Home Project Materials — Capture, Offer and Preview

**Status:** Schema, contract, prompts and fixtures **landed**. The card, the selection →
finish bridge and the shelf-tag reader are **on disk and green, but unreachable**: no route
mounts the shelf-tag service, no caller invokes the bridge, and **neither backend persists a
single one of the eight columns migration 0164 added**. Treat this as a shipped foundation
with an unwired middle.
**Date:** 2026-08-28
**Snapshot:** branch `house-v2`, committed state `b56d63f50`, **plus six uncommitted files**
that landed while this was being written.
**Related:** [HomeProjects_TRD.md](../HomeProjects/HomeProjects_TRD.md) ·
[HomeProjects_BRD.md](../HomeProjects/HomeProjects_BRD.md)

> **On line numbers.** Five agents were writing in this area throughout. Every claim below
> was checked against the file on disk, and every claim about something *missing* was
> re-checked at the end. Three files that this document originally recorded as absent
> **landed mid-write** and are described here in their real state. The files marked
> **uncommitted** below will drift; their symbol names are the durable citation, not their
> line numbers.

---

## What a material is

A material is a row in `home_project_selections` — a candidate finish a member is
considering, not a thing they have bought. Materials competing for the same surface share
an `option_group_id`, and one is the group's `preferred_selection_id`
(`backend/src/db/schema-home-projects.ts:167`). That is why price and sale legibility
matter: the member is looking at four floors side by side and deciding, and in their own
words a sale badge "will help to faster decision".

Two facts a shop listing states and `home_project_selections` had never held block two
different features:

| Missing fact | Blocks | Failure when guessed |
|---|---|---|
| Colour (`#rrggbb`) | The surface preview | `materialSchema.colorHex` is **required**; a finish with no colour renders as a hole in the room, which reads as a bug |
| Repeat size (mm) | The surface preview | A visualiser stretches the tile photo to the wall — a room the member cannot build |
| List / sale price | Side-by-side comparison | A floor discounted 40% this week looks identical to one at full price |

---

## Migration 0164 — the columns, exactly

`backend/migrations/0164_home_project_material_appearance_sale.sql`. Eight columns, every
one **nullable with no default**, because every existing row predates the migration and
must read back byte for byte.

| Column | Type | Line | Rule |
|---|---|---|---|
| `color_hex` | `TEXT` | `:53` | `'#rrggbb'`, lowercase. The dominant product colour, and the fallback the renderer draws before a texture downloads, offline, and at thumbnail size |
| `grout_color_hex` | `TEXT` | `:57` | Tile only, and only when the listing **actually shows** grouted tile. Guessing recolours every joint in the preview on no evidence |
| `unit_w_mm` | `REAL` | `:62` | Real-world size of **one repeat** |
| `unit_h_mm` | `REAL` | `:63` | Both `NULL` for paint, and both `NULL` when the page stated no size |
| `list_price_cents` | `INTEGER` | `:69` | The "was" price. Set **only** when the page showed it struck through beside a lower price |
| `sale_price_cents` | `INTEGER` | `:73` | Today's discounted price. **Mirrors** `unit_price_cents` while a sale is on |
| `discount_pct` | `INTEGER` | `:78` | 0–100, rounded. **Derived from the two prices**, never copied off the badge |
| `sale_ends_at` | `TEXT` | `:82` | ISO date, only when the vendor states one. `NULL` means "no end date published", never "no sale" — `sale_price_cents` answers that |

Two decisions there are load-bearing, and both are the kind a later refactor undoes on
tidiness grounds:

**The repeat size is `REAL`, not `INTEGER`.** A 12 in tile is 304.8 mm; rounding it to 305
accumulates into a visibly wrong joint line across a twenty-course wall (`:18-20`).

**`unit_price_cents` remains the only money.** The three offer columns *describe* the offer
and are never read by an estimate. A sale price written into `unit_price_cents` would be
right until the sale ended and then wrong in a stored number nobody re-reads (`:29-35`).

The migration carries a fleet warning: `migrations_dir` is shared, so 0164 lands on Budget,
Kaizen and Health D1s too, as unread columns on a table they do not use. Apply to staging
**and** production for every fleet brand before `deploy:fleet` (`:42-44`). The Drizzle
schema mirrors all eight with the same reasoning inline
(`backend/src/db/schema-home-projects.ts:186-201`).

---

## The contract: the model reads, the code decides

`packages/contracts/src/home-project-material.ts` is where a listing becomes facts:

> - **Unit conversion is arithmetic, not extraction.** The prompt asks for "12x24" and "in"
>   and does the ×25.4 here … an extraction task with a multiplication bolted on gets the
>   multiplication wrong occasionally and silently, and nothing downstream can tell a
>   converted 304.8 from a hallucinated one.
> - **A discount is arithmetic too, and the page's own badge is not evidence.** "50% OFF"
>   outliving its sale is one of the commonest stale facts in retail HTML.
>
> — `home-project-material.ts:6-16`

Shared rather than reimplemented for the same reason `material-listing-merge` is: the
Worker reads pages and **so does the device** — a private-mode household has no Worker — and
two implementations of "is this on sale" are two answers to a question the member is about
to spend money on (`:19-21`). Pure: no `fetch`, no D1, no ledger.

| Function | Line | What it refuses to do |
|---|---|---|
| `normalizeHexColor` | `:112` | Widens `#fff` and bare hexes; **drops everything else**. A `colorHex` that fails `materialSchema`'s regex takes the whole room document down — `parseRoomSurfaceModel` returns null and the member sees an empty editor instead of one wrong swatch |
| `toMillimetres` | `:133` | Rounds to 2 dp so 12 in is `304.8`, not `304.80000000000007` — float noise in a stored dimension shows up as a spurious "changed" on every sync. Caps at `MAX_UNIT_MM = 10_000` (`:94`), matching `materialSchema`'s own `.max(10_000)` |
| `normalizeMaterialListingExtras` | `:154` | Absent → `null`. See below |
| `normalizeMaterialAppearance` | `:194` | **Discards a half-stated size.** A page printing "12" wide and nothing else gives a width with no height; squaring it would invent a 12x12 tile nobody sells. Both or neither |
| `colorSpecFor` | `:225` | Puts the vendor's colour name in a spec chip — there is no colour-name column, and "SW 7015" is the only string the member can take to a paint counter |
| `normalizeMaterialSaleOffer` | `:256` | Four rules, below |
| `hasSaleOffer` | `:299` | `discountPct != null` — one predicate, so no surface invents its own definition of "on sale" |

### Why `normalizeMaterialListingExtras` is not boilerplate

> The schema marks every new field `required`, but the three providers behind
> `ai/provider.ts` honour that to three different degrees, and a device using a member's
> own key may be talking to a fourth. Normalising absent → null here means exactly one
> shape reaches the rest of the code, so `=== null` is a usable test and no caller has to
> write `?? null` at every read.
>
> — `home-project-material.ts:147-152`

The same divergence is attacked from two other directions. In the prompt contract, every
new field is **optional in TypeScript and required in the JSON Schema** — `required` is what
makes all three providers emit the key with an explicit `null` rather than dropping it,
while `?` is what lets the dozen existing `RawMaterialListing` fixtures keep compiling
(`packages/contracts/src/material-listing-prompt.ts:54-62`). And in
`src/utils/geminiSchema.ts`, which translates the schema into Gemini's proto-backed OpenAPI
subset: `additionalProperties: false` and `type: ['string','null']` are hard errors there,
and a `null` member inside an `enum` cannot be represented at all. `unit_size_unit` is a
nullable enum (`material-listing-prompt.ts:265-270`) and would have hit exactly that. The
translator exists because every Budget receipt scan on a Gemini BYOK key failed with HTTP
400 before the model saw the photo, on 2026-08-14 (`geminiSchema.ts:21-23`).

### The four sale rules

`normalizeMaterialSaleOffer` (`:232-255` prose, `:256-296` code):

1. **Two prices, the second lower** — the only shape that proves a discount.
   `discountPct = round((1 − sale/list) × 100)`.
2. **The badge is cross-checked, never trusted.** If the page also claims a percentage and
   it differs from the arithmetic by more than one point, the arithmetic wins and
   `discountPctDisputed` is set. One point absorbs honest rounding.
3. **A stated percentage with no "was" price still counts** — plenty of pages advertise
   "25% off everything" and print only the new price. `listPriceCents` stays `null`,
   because deriving a "was" price from a percentage prints a number the vendor never
   published beside a strike-through.
4. **Everything else is not a sale.** "From $3.99", a range, a bulk break, a members-price
   teaser: all null. *A fabricated discount rushes a real decision, which is the failure
   this strictness exists to prevent.*

`discountPctDisputed` is surfaced rather than swallowed so the caller can lower the
extraction's confidence: a page whose banner contradicts its own prices is a page whose
prices might also be stale (`:57-64`). `isoDateOrNull` (`:323`) rejects `2026-02-31`, which
`Date` would silently roll forward to 3 March — the column is read back as "sale ends in 3
days", and a garbage date is a countdown to nothing.

---

## The shelf tags — real photographs, not fixtures

`src/screens/home-projects/__tests__/shelfTagFixtures.test.ts` transcribes **two labels
photographed at Capital Tile + Stone**. Same retailer, nearly the same layout, and they
establish rules no synthetic fixture would have produced.

| | Tag A | Tag B |
|---|---|---|
| Product | `DANIEL BLANC 12X24 MATTE` | `LONDON SOHO 8X8 MT` |
| First price | Retail **$7.13 / SF** | RETAIL **$14.42 Sq. Ft.** |
| Second price | Trade **$4.28 / SF** | NOW **$5.98 Sq. Ft.** (in red) |
| A sale? | **No** — a trade rate is a professional price | **Yes** — a genuine 59% |
| Size lives in | the product **name** | the product **name** |
| Priced by | the square foot; no box price, no coverage | the square foot; no box price, no coverage |

### Why the pair is the point

Both tags show a lower second price and **only one is a discount**. A model that treats
"lower second number" as "sale" gets one right and one wrong **and looks correct either way
in isolation** (`:16-18`). That is the entire argument for pinning them together in one
file rather than as two cases.

Misreading Tag A misleads the member twice: a 40%-off badge on a full-price tile, and an
estimate built from $4.28 — a price they cannot transact at (`:57-61`).

The suite makes the cost explicit rather than only asserting the happy path. `:68-78` feeds
the misread deliberately and shows it produces a perfectly well-formed 40% offer.
**The normaliser cannot catch this.** Arithmetically the misread *is* a valid sale, so the
classification has to happen at extraction time — which is why the rule is carried in the
link prompt (`material-listing-prompt.ts:275`, `:316`) and, at much greater length, in the
shelf-tag prompt described below.

### Tag B: derived, not claimed

$14.42 → $5.98 is 58.5%, which rounds to **59** (`:96-101`). Retailers round promotional
percentages generously and inconsistently; the arithmetic is what the member can check
against the shelf. `:103-113` asserts that a tag shouting "65% OFF" over those prices still
reports 59 and raises `discountPctDisputed`.

### Size lives in the name

Neither tag has a dimensions field — `12X24` and `8X8` are inside the product name. A
parser that only looks for a labelled size returns null on **the commonest layout in a tile
shop**, and the preview then has no repeat size, the one number that stops a visualiser
drawing a room that cannot be built (`:80-88`). A bare `12x24` on a North American tile
page means **inches**; a bare `600x600` means **millimetres**
(`material-listing-prompt.ts:269`).

### Both price by the square foot

`:141-156`. Neither tag states a box price or a coverage figure. A 12x24 tile is **2 sq
ft**, so reading "$7.13 / SF" as the price of one tile puts the estimate out by half — that
tile really costs $14.26. Coverage stays null rather than being assumed.

---

## The Add material flow

Adding a material is a **floating button**, not a row in the list
(`HomeProjectHubScreen.tsx:2462-2470`, `testID="materials-add-fab"`), disabled while a write
is in flight so a second tap cannot open the menu over a picker about to present. It opens
a `BottomSheet` of five flat options (`:2478-2503`, rows `testID="materials-add-${id}"`).

`MATERIAL_ADD_OPTIONS` (`:124-134`) is exported and pure so the option **set** can be
asserted without standing up a 2,500-line screen:

| id | Label | Icon |
|---|---|---|
| `manual` | Add manually | `create-outline` |
| `link` | Add from link | `link-outline` |
| `library` | Add from library | `images-outline` |
| `files` | Add from Files | `folder-outline` |
| `camera` | Add from camera | `camera-outline` |

**Flat rather than nested on purpose.** The three photo sources are the obvious candidates
for an "Add with photo →" submenu, but that buys one shorter menu at the cost of a second
tap on the three entries a member reaches for most, and hides the camera behind a label
that does not say "camera". Five rows fit on one sheet on the smallest phone shipped
(`:110-116`).

It **replaced an always-open inline form** — name / price / URL under the list, with its own
"Add selection", "Add with photo" and "Add from link" buttons — and is now the only route in
(`:119-123`). That is what `HomeProjectMaterialsAdd.test.tsx` protects: an entry that
silently stops being built is a way of adding materials that silently stops existing, and
neither a type error nor a lint rule would say so. The suite pins order, labels verbatim,
id uniqueness (the `testID` derives from the id, so a collision makes one row unreachable
from an E2E flow), and that all three photo sources survive.

The Files picker offers **images only** (`:145-151`): a material's attachment is a photo of
the thing and the uploader re-encodes it as JPEG, so a PDF spec sheet would hand the
uploader bytes it cannot render. HEIC is listed because it is what an iPhone saves.

---

## The preview — the renderer already existed

This is the part most often overstated. **No renderer was built.** `SurfaceCanvas.tsx` and
`SwatchPreview.tsx` already drew tile patterns, grout and texture fills at true scale, and
`room-surface-model.ts` already required a colour and already carried the repeat size.

`materialSchema` (`packages/contracts/src/room-surface-model.ts:197-249`) requires
`colorHex` with a strict `/^#[0-9a-fA-F]{6}$/` (`:202-204`) — required even for a material
that has a photo, because it is what the renderer draws while the texture has not
downloaded, when the member is offline and the blob is not cached, and at thumbnail size
where a texture would be noise. `unit_w_mm` / `unit_h_mm` are optional, capped at 10 000
(`:215-216`). The comment above it is the whole case for capturing a repeat size:

> **`unit_w_mm` / `unit_h_mm` are the real-world size of one repeat**, and they are what
> makes the preview honest: a 600×600 porcelain tile and a 75×300 subway tile are the same
> photograph scaled differently, and a visualiser that stretches the image to the wall —
> which is what "apply this texture" usually means — shows the member a room that cannot be
> built. Every quantity in `takeoff.ts` and every pattern cell in the renderer is derived
> from these two numbers.
>
> — `room-surface-model.ts:189-195`

`SurfaceCanvas`'s contract is one sentence — **nothing is ever scaled to fit** — and it
argues explicitly against the image-model approach every consumer visualiser uses:
"something that looks right and is not to scale, because the model has no idea the tile is
300 mm and the wall is 3.4 m. A member cannot count courses on it, cannot see where the cut
lands at the ceiling, and cannot order from it" (`SurfaceCanvas.tsx:11-18`). An SVG
`<Pattern>` whose cell is `(face + joint) × pxPerMetre` is exact, costs nothing, works with
no signal, and is *the same arithmetic the takeoff divides by* (`:20-24`). `SwatchPreview`
renders every material across a fixed **1.2 m** of real wall (`SWATCH_REFERENCE_M`,
`SwatchPreview.tsx:29`), stated in the caption for the same reason a map has a scale bar.

### What was missing was the bridge

`packages/contracts/src/material-to-finish.ts` — **uncommitted, landed mid-write, 20 tests
pass, no production caller.**

`materialFromSelection(selection, options)` returns a discriminated result rather than a
`Material`, which is the design decision worth keeping:

```ts
// material-to-finish.ts:104-107
export type MaterialFromSelectionResult =
  | { ok: true; material: Material }
  | { ok: false; reason: 'missing_color'; message: string }
  | { ok: false; reason: 'invalid_finish'; message: string; issues: string[] };
```

`result.material` does not exist unless `result.ok`, "so there is no shape of this API in
which a made-up colour reaches the renderer by omission" (`:99-102`). Two refusals, both
because the output is a picture a member makes a purchase against (`:18-38`):

- **No colour, no finish.** A neutral placeholder would satisfy the schema and put a grey
  rectangle on the wall indistinguishable from a finish the member chose — silent, and it
  survives into a preview. So it fails with `reason: 'missing_color'` and the caller
  prompts. `MaterialEditorSheet`'s colour picker already is that prompt.
- **No stated size, no repeat.** `MATERIAL_KIND_DEFAULTS.tile` holds a 300×300 default that
  is right in the editor — where the member sees the number and can change it — and wrong
  here, where nothing on screen would say the size was assumed. *"A tile drawn at 300 mm
  that is really 600 mm shows twice as many joints and orders four times the tiles, with
  total confidence."*

`carryableDefaults` (`:208-238`) draws a line worth restating: **dimensionless defaults ride
along, anything measured in the vendor's own units does not.** `wastePct` and `coats` mean
the same thing whatever the product is. `coverageM2PerUnit` does not — it is m² per
*purchase* unit, and the purchase unit came from the vendor (a box, a gallon, a roll), not
from our category guess. Defaulting 11 m²/L onto a product sold by the gallon under-orders
the paint for a whole room. `pattern`, `groutMm` and `groutColorHex` are gated on a stated
repeat, since with no repeat there is nothing to lay out and `unitFootprintM2` would fold a
phantom joint into the count.

`finishIdForSelection` (`:117`) is deterministic — `mt_sel_${selectionId}` — so applying the
same imported tile to a second wall upserts one palette entry instead of stacking
near-identical duplicates the takeoff would price separately. The candidate is validated
with `materialSchema.safeParse` **before** it is returned, because
`parseRoomSurfaceModel` returns null for a document with one bad material: "an invalid
finish does not cost the member a swatch — it costs them the whole room" (`:272-279`).

Today the member still eyedrops the hex by hand in `MaterialEditorSheet`
(`:411-439` swatch grid plus free-text hex; `:481-482` manual `unit_w_mm`), because nothing
calls `materialFromSelection`.

---

## The shelf-tag reader

**Uncommitted, landed mid-write. Prompt and service exist; no route mounts them.**

`backend/src/ai/prompts/extract-shelf-tag.ts` (344 lines) returns **the same flat
`RawMaterialListing` the link path returns, field for field**:

> Two shapes would be two kinds of material card, two merge functions and eventually two
> answers to "what does this floor cost" — and the member cannot tell which path a card came
> from, so the card must not be able to tell either.
>
> — `extract-shelf-tag.ts:10-13`

Its header is explicit that everything in it was learned from the two real tags, and that
the trade/sale classification is unrecoverable downstream: "$7.13 → $4.28 is arithmetically
a perfectly good offer, and `normalizeMaterialSaleOffer` will compute a confident 40% from
it and be right to. By the time the two numbers are in `list_price_amount` and
`sale_price_amount` the mistake is unrecoverable, because the only evidence that
distinguished them — the word 'Trade' — was thrown away when the model chose the fields"
(`:27-34`).

The system prompt (`:269`) is organised around six failure modes, each of which maps to
something the tags taught:

| Section | Rule |
|---|---|
| **A lower second price is not a sale** | Trade, PRO, contractor, member, account, dealer, bulk, "10+ boxes", a per-SF rate beside a per-box price, a competitor comparison — all null. Record the second price as a **spec** (`{"label": "Trade price", …}`) so the fact survives without being read as a discount |
| **The size is usually in the name** | `DANIEL BLANC 12X24 MATTE` *is* the size statement. Fractions to decimals (7-1/2 → 7.5), unit left exactly as printed |
| **Price per area, no box, no coverage** | "That is a complete answer, not a gap." `coverage_per_unit` and `pieces_per_unit` stay null. "Getting the basis wrong is the costliest error available" |
| **Colour only when there is one** | **Return `color_hex` null for patterned goods** — encaustic, terrazzo, marble-look, wood-look — because "a single confident hex draws the member's preview as a flat field of one colour that looks nothing like the sample they are holding" |
| **Glare, angle, obstruction** | Report only readable characters, confidence `low`. "NEVER complete a half-covered word into a plausible one: a name that is wrong by one word is a different product, and it looks exactly as trustworthy on the card as a correct one" |
| **More than one tag in frame** | Extract the one most central and in focus; never combine a name from one label with a price from another. "Merging two tags produces a coherent, entirely fictional product — the worst failure available here, because nothing looks broken" |

The user-turn builder (`:321`) is deliberately short and example-free: restating the two
real tags "would give the model specific product names and prices to fall back on when the
photo is hard to read, which is precisely the hallucination this feature cannot survive".
The member's optional `hint` is clamped to 280 chars and fenced as a hint about *which* tag
to read, never as an instruction that could add a field. The photograph itself is fenced as
member-supplied content.

`backend/src/services/home-projects/shelf-tag-extraction-service.ts` exports
`ShelfTagExtractionService`, `sizeFromName`, `ShelfTagNotice` and a
`ShelfTagSelectionDraft` that is `Omit<SelectionDraft, 'productUrl'>` — a photographed tag
has no URL. **Nothing imports it and no route references `from-photo`.**

The client half exists and is honest about that. `extractMaterialFromPhoto`
(`src/api/home-projects.ts`) carries a `TODO(house-v2)` saying the path and body are "this
client's INTENT, not a confirmed contract", short-circuits on `isHouseLocalFirst()`, and
**returns `null` rather than throwing** so that a 404 from a Worker that has not shipped the
route, a model that could not read a blurry label, and a local-first household are one
outcome: no extra fields, and a material the member can still open and type into. It sits
**outside** the `homeProjectsApi` facade on purpose, "so that parity keeps failing loudly
for methods that really are missing a local half, instead of being taught to tolerate one".

The camera flow in `HomeProjectHubScreen.addSelectionPhoto` writes **the row and the
attachment first**, then reads the label on top:

> The member is standing in a shop with a shelf tag in front of them. What has to survive is
> their photo, attached to a material they can find again … This is the bargain `addFromLink`
> already makes — degrade rather than fail, and SAY so — with the two halves in the opposite
> order, because a link can be pasted again from the sofa and a shop floor cannot be
> re-visited.

If the photo upload fails the selection is deleted again, so a household with no byte
transport is not left with an empty "New material" it never asked for. Three distinct
outcomes get three distinct alerts — nothing read, no AI provider (with a route to
Settings), and `confidence === 'low'` ("Check the price and the size before you order").
It also fixes a real defect: since `MATERIAL_ADD_OPTIONS` became the only way in, the old
code's "otherwise attach the photo to the *project*" branch had become **every** use of the
three photo sources — a member tapping "Add from camera" under "Add material" got a project
photo and no material.

---

## Wiring — connected, and not

Snapshot as described at the top. **Uncommitted** marks work that landed during writing.

| Layer | File | State |
|---|---|---|
| D1 columns | `backend/migrations/0164…sql` | **Landed.** All eight |
| Drizzle schema | `backend/src/db/schema-home-projects.ts:186-201` | **Landed** |
| Normalisers | `packages/contracts/src/home-project-material.ts` | **Landed**, exported at `index.ts:217-223` |
| Link extraction schema + prompt | `packages/contracts/src/material-listing-prompt.ts` | **Landed.** All ten new fields in `required`; trade/bulk teaser rule at `:275`, `:316` |
| Gemini translation | `src/utils/geminiSchema.ts` | **Landed**, tested against the real material schema |
| Worker link-prompt module | `backend/src/ai/prompts/extract-material-listing.ts` | **Pure re-export**, 35 lines — a reader who finds the prompt finds the code that decides what its answer means |
| Add-material menu | `HomeProjectHubScreen.tsx:124-134`, `:2462-2503` | **Landed** |
| Selection → finish bridge | `packages/contracts/src/material-to-finish.ts` | **Uncommitted.** Green. **No production caller** |
| Shelf-tag prompt | `backend/src/ai/prompts/extract-shelf-tag.ts` | **Uncommitted. No call site** |
| Shelf-tag service | `backend/src/services/home-projects/shelf-tag-extraction-service.ts` | **Uncommitted. No route mounts it** |
| Card / detail helpers | `src/api/home-projects.ts` — `describeMaterialVisual`, `describeMaterialSale`, `describeMaterialCard`, `describeMaterialShopLink` | **Uncommitted.** Wired into the hub card and detail screen |
| Material card (hub) | `HomeProjectHubScreen.tsx` — `MaterialCard` | **Uncommitted.** Renders swatch, sale badge, strike-through |
| Material detail | `MaterialDetailScreen.tsx:371` | **Uncommitted.** Reads `describeMaterialCard` |
| Photo → extraction client | `src/api/home-projects.ts` — `extractMaterialFromPhoto` | **Uncommitted.** Calls a route that **does not exist**; returns null |
| **Worker selection API** | `backend/src/routes/home-projects.ts:86-118` | **Not wired.** `selectionSchema` / `patchSelectionSchema` accept **none** of the eight columns. No `/from-photo` route |
| **Worker service** | `backend/src/services/home-projects-service.ts:1119-1122` | **Not wired.** `createSelection` maps `image_url`, `coverage_per_unit`, `specs_json` and stops |
| **Server link import** | `home-projects-service.ts:1866-1900` | **Not wired.** `mergeListingIntoDraft` carries no 0164 field |
| **Device link import** | `src/features/house/local/localHomeProjectsApi.ts:2030-2050` | **Not wired.** The file contains **zero** references to any 0164 column, and has no local shelf-tag path |
| **Option-group card** | `src/components/home-projects/MaterialOptionCard.tsx` | **Not wired.** Zero references. The side-by-side comparison card — the surface the sale badge was built for — still shows no sale |
| Client row type | `src/api/home-projects.ts` — `HomeProjectSelection` | **Partial.** Declares `color_hex` and the four sale fields; **omits** `grout_color_hex`, `unit_w_mm`, `unit_h_mm` |

**The single sentence that matters:** the extraction asks for ten new fields, two prompts
know how to read them, the normalisers know what they mean, the bridge knows how to draw
them and the card knows how to render them — and **there is still no code path that writes
any of them to a row.** All eight columns are currently write-dead in both backends.

### `describeMaterialSale`, and a second gate on one question

`describeMaterialSale` reduces a row to what may honestly be drawn, under three rules:

1. A sale needs **both** prices, sale below list. A percentage alone never earns a badge.
2. **An expired `sale_ends_at` is not a sale** — expiry drops the badge, the strike-through
   and the stated percentage together. "A stale '20% off' on a full-price item is the
   single most damaging thing this feature could render."
3. The percentage is derived, never copied.

`now` is a parameter rather than a `Date.now()` inside, "because 'is this expired' is the
behaviour most worth testing and a clock you cannot set is a behaviour you cannot test".
Under 1% is rounding, not an offer. The badge uses U+2212, not a hyphen: a hyphen renders
as a word-break opportunity and VoiceOver reads it as "dash".

`describeMaterialVisual` returns picture → swatch → placeholder and **never "nothing"** — a
card with an empty box reads as a row that failed to load rather than a material with no
photo. The R2 attachment beats `image_url` because a vendor URL rots when the listing is
pulled. It re-tests the hex before handing it to `backgroundColor`; the column is written
normalised, but one malformed hex from an importer is a red-box.

Note that `describeMaterialSale` and `normalizeMaterialSaleOffer` are **two gates on the
same question**, one at import and one at render. That is defensible — an offer can expire
between them — but it is a second definition of "on sale". They already disagree on one
case: the importer accepts a stated-percentage-with-no-list-price as a sale (rule 3), while
`describeMaterialSale` demotes it to `claimedDiscountPct` and draws no badge. That is
probably the right split, but it is undocumented in either file and should be.

---

## Tests

| Suite | Covers | Result |
|---|---|---|
| `src/screens/home-projects/__tests__/shelfTagFixtures.test.ts` | Two real tags; trade-vs-sale; the cost of the misread; 59% derived; disputed badge; size from the name; per-SF vs per-tile | 13 pass |
| `src/screens/home-projects/__tests__/HomeProjectMaterialsAdd.test.tsx` | The five add sources: order, labels verbatim, icons, id uniqueness, all three photo paths | 5 pass |
| `src/utils/__tests__/geminiSchema.test.ts` | The real `EXTRACT_MATERIAL_LISTING_SCHEMA` through the translator: no `null` in any enum, nullability preserved via `nullable`, strict-mode keyword stripped | pass |
| `src/features/house/local/logic/__tests__/capitaltilesLinkImport.test.ts` | The link ladder over a **captured real page** from capitaltiles.ca: `og:image` served over http with the https copy in `og:image:secure_url`; no price meta tag at all, the figure living in a `ProductGroup`'s `hasVariant[].offers.price` beside a cheaper "Sample" variant. Splits assertions into deterministic (name, picture, store) and model-dependent (proved to *reach* the prompt) | pass |
| `src/utils/__tests__/materialToFinish.test.ts` **(uncommitted)** | The bridge: colour refusal, both-or-neither repeat, no invented coverage, out-of-range repeat dropped, texture id passthrough, grout fallback, category mapping | 20 pass |
| `backend/src/ai/prompts/__tests__/materialExtractionProviderParity.test.ts` **(uncommitted)** | **Nine JSON dialects × three providers** over both real tags: omitted keys, `""` for null, quoted numbers. See below | 97 pass |
| `src/components/home-projects/__tests__/MaterialOptionCard.test.tsx` | The option-group card as it stands — area total, provenance, price precision. **No sale or swatch coverage** | pass |
| `backend/src/routes/__tests__/home-projects.test.ts` | Route behaviour; test schema mirrors all eight 0164 columns (`:90-92`) | 6 pass |
| `backend/src/services/__tests__/home-projects-access.test.ts` | Same mirroring (`:98-100`) | pass |
| `packages/contracts` (vitest) | 8 files, 160 tests — **none touches `home-project-material.ts`** | pass |

The provider-parity suite is precise about its own limits, and the distinction is the most
useful thing in this document's test section:

> It CANNOT prove that Gemini reads a glary shelf tag correctly. No offline test can: that
> needs the real photo, the real model and real money … What it CAN prove is the other half,
> and it is the half that breaks silently: the three vendors write the SAME reading down in
> different JSON. One omits a key it has no value for, one sends `""` where the schema said
> `["string","null"]`, one quotes a number. Every one of those is a shape difference, not a
> reading difference, and each one is capable of turning a correct extraction into a blank
> card — with no error anywhere, because the request succeeded.
>
> — `materialExtractionProviderParity.test.ts:11-22`

Run: `npx jest src/screens/home-projects src/utils/__tests__`, `cd packages/contracts &&
npx vitest run`, `cd backend && npx vitest run`.

---

## Known gaps

- **The columns still have no writer.** Neither `selectionSchema` nor `patchSelectionSchema`
  (`backend/src/routes/home-projects.ts:86-118`) accepts any 0164 field; `createSelection`
  does not map them; `mergeListingIntoDraft` does not carry them; and
  `localHomeProjectsApi.ts` — the private-mode mirror — contains **zero** references to them.
  This is the largest gap. Until it closes, the prompts, the normalisers, the bridge and
  the card cannot be exercised end to end by anything but a unit test, and a link import
  that reads a colour perfectly will still produce a row with `color_hex` null.

- **Fixture tests prove the PARSING, not the EXTRACTION.** Every assertion starts from a
  hand-transcribed object. Whether Gemini, Claude or GPT reads a **glary, angled
  photograph** of a shelf tag and classifies "Trade Price" correctly is **unproven**. The
  parity suite names the script that would settle it —
  `scripts/ai/verify-material-extraction.mjs` — and **that script does not exist**; there is
  no `scripts/ai/` directory at all. Until someone runs it against a real photo and a real
  key, "the extraction handles trade prices" is a claim about a prompt sentence, not a
  measured result.

- **The shelf-tag path is a prompt and a service with nothing calling them.** No route,
  no `/from-photo` handler, no local-first counterpart. `extractMaterialFromPhoto` is
  written against a path that is not on disk and degrades to `null`, so the camera flow
  currently saves a photo and a placeholder name and reads nothing. This is graceful, and
  it is also invisible: the member gets the "Photo saved — the details are yours to fill
  in" alert, which is indistinguishable from a model that tried and failed.

- **The parity test's own comment is already stale.** `materialExtractionProviderParity.test.ts:799`
  states "No `extract-shelf-tag` prompt exists on disk at the time of writing". It does now.
  The three-step wiring instruction immediately below it (`:808-813`) is the live to-do:
  import the shelf-tag schema, add it to the `required` assertion so its extras keys carry
  the same explicit-null guarantee, and add a second fixture list only if it ever answers in
  a different shape.

- **`extract-shelf-tag.ts:63-65` cites a test that does not exist.** It says
  `extractShelfTag.test.ts` "asserts the two lists are equal, which is what actually stops
  them drifting". There is no such file, and the parity suite does not import
  `EXTRACT_SHELF_TAG_REQUIRED_KEYS` or `LINK_LISTING_REQUIRED_KEYS`. The two required-key
  lists are currently hand-copied and unguarded — precisely the drift the comment describes.

- **Tag B's tile is a multi-colour encaustic pattern, and one `colorHex` renders it as a
  flat beige floor.** The shelf-tag prompt handles this **at the source** — "Return
  `color_hex` null for patterned goods, put the colourway or pattern name in `color_name`"
  — which means a patterned tile arrives with no colour, which means `materialFromSelection`
  correctly **refuses** it with `missing_color` and the member is prompted. That is the
  honest outcome, not a fix: the member still gets no preview of a patterned tile. The
  proper answer is the photo as a texture, and `materialSchema.textureAttachmentId` exists
  for it — but it is only ever set by hand in Surface Studio
  (`SurfaceStudioScreen.tsx:652`, `:665`). `materialFromSelection` accepts a
  `textureAttachmentId` option (`material-to-finish.ts:91`) and **nothing passes one**,
  because nothing calls it. The link prompt, meanwhile, still asks for a single hex on
  patterned goods (`material-listing-prompt.ts:243`) — the two prompts disagree, and the
  shelf-tag one is right.

- **The QR code on Tag A is not decoded**, and the shelf-tag prompt forbids it outright
  ("Do not decode barcodes or QR codes"), correctly — a vision model transcribing a QR
  payload is a hallucination risk with no upside. Decoding it **client-side** is the
  opportunity: it most likely encodes the product URL, which would supply `product_url` for
  free and let the link importer — the best-tested path in this feature — run on a shelf
  tag. Not built. The capability is already in the app: `expo-camera` is a dependency and
  Health ships a working scanner (`HealthBarcodeScanScreen.tsx:224-225`). Nothing in Home
  Projects references it.

- **`home-project-material.ts` has no test of its own.** Its coverage is indirect —
  `shelfTagFixtures.test.ts` and the parity suite. `normalizeHexColor` and `colorSpecFor`
  have no direct assertions, including the shorthand-hex widening, whose failure mode is a
  room document that will not parse at all.

- **The client row type is incomplete.** `HomeProjectSelection` declares `color_hex` and the
  four sale fields but omits `grout_color_hex`, `unit_w_mm` and `unit_h_mm` — exactly what
  the preview needs. `SelectionFinishInput` (`material-to-finish.ts:63-79`) works around
  this by declaring the four columns structurally and optionally, "because contracts may not
  reach into the app". That is right for the contract and leaves the DTO still needing to be
  widened before any screen can feed the bridge.

- **The option-group card has no sale badge.** `MaterialOptionCard.tsx` is the side-by-side
  comparison surface — the one the whole offer feature was justified by — and it has zero
  references to any of the new helpers. The badge currently exists only on the hub's flat
  material list and the detail screen.

- **No E2E flow covers any of this.** `e2e/maestro/home-projects/` has five flows
  (`-smoke`, `-hub`, `-hub-mutations`, `-photos`, `-deferred-readonly`); a grep for
  `materials-add` across `e2e/` returns nothing. Every `testID` in the new menu is asserted
  only by a unit test that never renders the screen.

- **0164's remote application is unverified.** The migration carries the fleet warning;
  whether it has run against staging **and** production D1 for House, Budget, Kaizen and
  Health was **not** checked for this document, and must be before `deploy:fleet`.

- **`shelfTagFixtures.test.ts:14` says "58% off" where `:99` asserts 59.** The assertion is
  right — 58.5% rounds up. A one-word slip in prose, not a defect, but it is the sort of
  line that gets quoted.
