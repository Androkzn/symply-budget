# Material extraction across three providers

Home Projects turns a shop link or a photographed shelf tag into a material card
the member budgets against. The member picks the provider — Anthropic, OpenAI or
Gemini — in Settings → AI Providers, and the product promise is that the pick
does not change the answer.

The three do not honour a structured-output schema equally. This document is
what differs, which normaliser absorbs it, what is *not* absorbed, and how to
find out which provider actually reads a given tag correctly.

> **Two halves, and they must not be confused.** Fixture tests prove the
> **parsing**: whatever shape a provider writes a reading down in, one material
> comes out. They cannot prove the **extraction**: whether Gemini reads "Trade
> Price $4.28" off a glary label and correctly declines to call it a sale is not
> a question any offline test can answer. The first half is
> [materialExtractionProviderParity.test.ts](../../backend/src/ai/prompts/__tests__/materialExtractionProviderParity.test.ts);
> the second is [verify-material-extraction.mjs](../../scripts/ai/verify-material-extraction.mjs),
> run by hand, on real keys, for real money.

---

## Files

| File | Role |
|------|------|
| [packages/contracts/src/material-listing-prompt.ts](../../packages/contracts/src/material-listing-prompt.ts) | The link path's schema + system prompt. `RawMaterialListing` — the one shape both paths answer in |
| [backend/src/ai/prompts/extract-shelf-tag.ts](../../backend/src/ai/prompts/extract-shelf-tag.ts) | The photo path's schema + system prompt. Answers in the same `RawMaterialListing` |
| [packages/contracts/src/home-project-material.ts](../../packages/contracts/src/home-project-material.ts) | `normalizeMaterialListingExtras` / `…Appearance` / `…SaleOffer` — where a provider's shape stops mattering |
| [packages/contracts/src/material-listing-merge.ts](../../packages/contracts/src/material-listing-merge.ts) | `mergeListingIntoDraft` — price × coverage, the number that reaches the budget |
| [packages/contracts/src/link-extraction.ts](../../packages/contracts/src/link-extraction.ts) | `parsePriceToCents` and the page readers |
| [src/utils/geminiSchema.ts](../../src/utils/geminiSchema.ts) | JSON Schema → Gemini `responseSchema`. The one divergence with hard, dated evidence |
| [src/features/house/local/ai/houseByokClient.ts](../../src/features/house/local/ai/houseByokClient.ts) | The device's three-provider transport — the only place all three are actually called |
| [scripts/ai/verify-material-extraction.mjs](../../scripts/ai/verify-material-extraction.mjs) | The live check |

---

## Where extraction actually runs

Two paths and two runtimes, and they do not have the same provider coverage
today. This is worth knowing before reading a green test as "all three work".

| | Worker | Device (local-first / BYOK) |
|---|---|---|
| **Link** | [home-projects-service.ts:1840](../../backend/src/services/home-projects-service.ts) — gated on `hasUsableProviderKey(env, userId, 'anthropic')`, so **Anthropic only** | [localHomeProjectsApi.ts](../../src/features/house/local/localHomeProjectsApi.ts) via `byok.generate` — **all three** |
| **Shelf tag** | prompt exists; wiring is the camera feature's | as above, all three |

The Worker's Gemini adapter cannot do structured output at all:
[gemini-provider.ts:333](../../backend/src/ai/gemini-provider.ts) is a `throw`
with "Use ClaudeProvider". So the three-provider story lives on the **device**,
through `houseByokClient.ts`, and that is the code the live script mirrors —
same three hosts, same headers, same bodies
([houseByokClient.ts:277-380](../../src/features/house/local/ai/houseByokClient.ts)).

Measuring a request the app does not send would verify nothing.

---

## What differs, and what absorbs it

Every row below is a real class of shape divergence. None of them is a *reading*
difference: the provider read the tag correctly and wrote it down differently.
That is exactly why they are dangerous — the request succeeded, nothing logged an
error, and the member gets a card with a hole in it.

| Divergence | Absorbed by | Why it exists |
|---|---|---|
| Key **omitted** vs present-but-`null` | `normalizeMaterialListingExtras` ([home-project-material.ts:154](../../packages/contracts/src/home-project-material.ts)) | The three "honour `required` to three different degrees". Every extras key is listed `required` precisely to force an explicit `null` ([material-listing-prompt.ts:124-137](../../packages/contracts/src/material-listing-prompt.ts)) — the mitigation, not a guarantee |
| `""` for an absent string | `normalizeHexColor` (empty → `null`), the `.trim()` guard on `color_name`, `isoDateOrNull` | A `["string","null"]` union invites a model that decided the field is "empty" to send the empty string. A `color_hex` of `""` fails `materialSchema`'s `#[0-9a-fA-F]{6}` and takes down the **whole room document**, not one field |
| `"7.13"` quoted instead of `7.13` | `parsePriceToCents` ([link-extraction.ts:231](../../packages/contracts/src/link-extraction.ts)) | The retailer's own JSON-LD states `schema.org/Offer.price` as a string, and JSON-LD is fed to the model as the most reliable part of the page. A model copying it verbatim is being faithful |
| `"$7.13"` with the symbol | same | A model reading rendered text sees glyph and digits as one token |
| `"7,13"` comma decimal | same — decides by digit count, so `"1,442"` is still one thousand four hundred | A European prior writes prices this way |
| Hex as `F2EFE9` or `#fff` | `normalizeHexColor` widens 3-digit and bare forms | Models emit them despite the instruction, and the intent is unambiguous. Rejecting costs the member the swatch they chose |
| A boolean as `true` **or** `"true"` | Nothing needs to: the schema has **no boolean field**, so this can only arrive as an unrequested key, and no unrequested key is read | `on_sale: "true"` looks like the answer to "is this discounted" and is not. The only evidence of a discount is two prices or a stated percentage |
| **Extra unrequested keys** | Ignored — every read is by name | `additionalProperties: false` is a request, and it is *stripped outright* on the way to Gemini ([geminiSchema.ts:26-34](../../src/utils/geminiSchema.ts)). An invented `discount_percentage` beside the real field is a shape we will receive |

All eight are pinned in the parity test, as nine dialects × three providers ×
three fixtures. The fixtures are the two shelf tags photographed at Capital Tile
+ Stone ([shelfTagFixtures.test.ts](../../src/screens/home-projects/__tests__/shelfTagFixtures.test.ts))
plus one synthesised link listing, because neither real tag prints a colour, a
grout colour, an end date or a percentage badge.

### Why the provider axis is a loop over identical assertions

Deliberately. We have no live evidence pinning each quirk to each vendor, so
writing "Gemini omits keys" into a test would be a guess dressed as a fact.
Every dialect therefore runs under every provider, and the claim the suite makes
is the stronger one: *whichever* provider the member picked, and *whichever* of
these shapes it emits, one identical `MaterialAppearance` and `MaterialSaleOffer`
comes out. Replacing that guess with measurement is the live script's job.

---

## The one divergence with hard evidence: Gemini's schema

Gemini's structured output is a proto-backed subset of OpenAPI 3.0, not JSON
Schema, and three things our schemas use are hard errors there
([geminiSchema.ts:1-23](../../src/utils/geminiSchema.ts)):

- `additionalProperties: false` — no such proto field. OpenAI strict mode
  *requires* it, so it cannot simply be removed from the schema.
- `type: ['string', 'null']` — `Schema.type` is a single enum. Becomes
  `type: 'string'` + `nullable: true`.
- `enum: ['box', …, null]` — `Schema.enum` is `repeated string`; a null member
  cannot be represented at all. The member is dropped and nullability is carried
  by `nullable` instead.

This is dated and observed, not theorised: on **2026-08-14** every Budget receipt
scan on a Gemini BYOK key failed with HTTP 400 *before the model saw the photo*,
surfacing to the member as "Could not read that receipt."

For material extraction the third bullet is the expensive one. It bites
`price_basis`, `coverage_unit` and `price_per_area_unit` — which between them
decide whether a tile is priced per box or per square foot, and a 12x24 tile is
two square feet, so getting it wrong halves or doubles the estimate for a whole
floor. The translation is tested against this exact schema in
[src/utils/\_\_tests\_\_/geminiSchema.test.ts](../../src/utils/__tests__/geminiSchema.test.ts).

**The translation is device-only.** There is no equivalent in `backend/src/ai/`.
That is consistent today only because the Worker path is Anthropic-gated; the
day a Worker route offers Gemini structured output, it needs this function.

---

## What is NOT absorbed

Money is string-tolerant because `parsePriceToCents` was written for OpenGraph
and JSON-LD, which state prices as strings. **Every other number in the listing
is read with a bare `typeof === 'number'` test.** The same coercion that costs
nothing on a price silently deletes a size or a percentage.

| Case | What happens | Cost |
|---|---|---|
| `unit_size_w: "12"` | `toMillimetres` requires a real number ([home-project-material.ts:137](../../packages/contracts/src/home-project-material.ts)) → `null` | The repeat size is lost, the surface preview has nothing to draw, no error anywhere |
| `sale_discount_pct_stated: "25"` | `statedPctOrNull` takes numbers only ([home-project-material.ts:309](../../packages/contracts/src/home-project-material.ts)) → `null` | The badge cross-check never fires; a page whose banner contradicts its own prices is not flagged |
| `coverage_per_unit: "23.8"` | **Propagates.** `mergeListingIntoDraft` gates on `coverage_per_unit > 0` — both branches, [material-listing-merge.ts:161-169 and :175-183](../../packages/contracts/src/material-listing-merge.ts) — and in JavaScript `"23.8" > 0` is `true`. The string is assigned to `SelectionDraft.coveragePerUnit`, typed `number`, so `tsc` never sees it | A string reaches the takeoff arithmetic that turns "I need 40 sq ft" into a number of boxes |

The third is a latent defect, not a hypothetical: the parity test asserts
`typeof draft.coveragePerUnit === 'string'` today, and it passes. It is **pinned
rather than fixed** so that fixing it is a deliberate change with the test
updated alongside — the fix belongs beside the gate in `material-listing-merge.ts`,
and it needs the owner of that file.

All three are why the live script exits **non-zero** when a provider states a
value the normalizers then drop. Nothing else surfaces it.

---

## Running the live check

It costs money, it is not in CI, and it will not send anything without `--live`.

```sh
# 1. The plan. Nothing is sent, nothing is spent.
node scripts/ai/verify-material-extraction.mjs \
  --url 'https://<retailer>/path/to/the/product/page' \
  --image ~/Desktop/shelf-tag-a.jpg \
  --provider all

# 2. The same command with --live. This is the one that spends.
node scripts/ai/verify-material-extraction.mjs \
  --url 'https://<retailer>/path/to/the/product/page' \
  --image ~/Desktop/shelf-tag-a.jpg \
  --provider all --live
```

The plan prints the models, where each key came from (never the key), and an
upper bound at list prices from
[model-pricing.ts](../../backend/src/ai/model-pricing.ts) — assuming every call
fills its output ceiling. Real token counts and the actual estimate are printed
after the run. A typical link + photo run across all three is a few cents.

| Flag | |
|---|---|
| `--provider anthropic\|openai\|gemini\|all` | default `all` |
| `--model <p>=<id>` | override one provider's model, e.g. `--model gemini=gemini-3.1-pro-preview` |
| `--hint "<text>"` | the member's note about *which* label to read — passed to `buildExtractShelfTagUserPrompt`. Photo only |
| `--max-tokens <n>` | output ceiling, default 2000 (what both real call sites use) |
| `--json` | machine-readable result. Never contains a key |
| `--live` | actually send |

### Exit codes

| | |
|---|---|
| `0` | every requested provider answered and nothing a provider stated was dropped |
| `1` | a provider returned something the normalizers reject — see "What is NOT absorbed" |
| `2` | usage error, no key for any requested provider, or nothing to read |

Disagreement between providers is **not** an error. It is marked `≠` in the
table and it is the finding you ran this for.

### Keys

`scripts/secrets/export-env.sh` does **not** emit AI provider keys — read it: it
covers Cloudflare, Sentry, Expo, Resend, AWS and the Data Bridge. The script
reads the environment first and falls back to the repo's own Keychain accessor,
`scripts/secrets/get.sh`, on the services the fleet already uses
([sync-child-worker-secrets.sh:63-67](../../scripts/secrets/sync-child-worker-secrets.sh)):

| Provider | Env | Keychain |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | `symply.test.anthropic` |
| OpenAI | `OPENAI_API_KEY` | `symply.test.openai` |
| Gemini | `GEMINI_API_KEY` | `symply.gemini.api_key`, then `symply.gemini.managed` |

Same names the Worker resolves at
[ai-credential-resolver.ts:55-66](../../backend/src/services/ai-credential-resolver.ts).
No key is printed, written to a file, or included in `--json`, and provider
errors are scrubbed before display.

### One thing that happens before `--live`

Sizing a prompt honestly needs the page, so `--url` **fetches the page** during
the plan. That calls no provider and spends nothing, but it is a request to a
third party and the plan says so on its own line.

---

## Not yet verified

Written down plainly, because a green parity suite reads like more than it is.

- **No live run has been made.** The harness has never called a provider. Every
  claim in "What differs" is either (a) mechanically provable from our own code —
  the Gemini schema translation, the `required` list, what each normaliser does
  with each shape — or (b) a *hypothesis about vendor behaviour*. Nothing in the
  second category has evidence attached.
- **Which vendor exhibits which quirk is unknown.** The parity test does not
  claim to know; that is why every dialect runs under every provider. Until a
  live run says otherwise, "OpenAI sends `""`" is folklore.
- **Nobody has checked whether any provider reads Tag A correctly.** The trap
  the whole feature turns on — Retail $7.13 / Trade $4.28 is *not* a 40%
  discount — is enforced only by prompt wording
  ([extract-shelf-tag.ts, "THE MOST IMPORTANT RULE"](../../backend/src/ai/prompts/extract-shelf-tag.ts)).
  Whether each model obeys it on a real photograph is exactly what the live
  script exists to answer and has not answered.
- **The three "not absorbed" coercions are untested against reality.** We know
  what our code does with `"12"`. We do not know whether any vendor ever sends
  it. The script flags it if one does.
- **The photo path has never been exercised end to end on all three.** The
  shelf-tag prompt is new; its own unit tests cover the prompt's rules, not a
  model's compliance with them.
- **Gemini's Worker path does not exist.** `generateStructured` throws
  ([gemini-provider.ts:333](../../backend/src/ai/gemini-provider.ts)). A member
  on Gemini gets three-provider material extraction on the device and Anthropic-
  or-nothing through the Worker. That asymmetry is invisible to them.

When a live run happens, replace the hypotheses above with the measured shape
report the script prints, and date it — the way the 2026-08-14 Gemini 400 is
dated.
