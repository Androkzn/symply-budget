# Sharing a BYOK AI key with your household

**Status:** implemented (Budget) · **Migration:** `0169_lf_ai_key_shares.sql` ·
**Companion:** [ai-provider-consent-legal.md](./ai-provider-consent-legal.md)

One member connects their own OpenAI / Anthropic / Gemini developer key, taps
**Share**, and everyone in the household can run AI in the app on it. The sharer's
provider account pays.

## The custody decision

The obvious implementation — POST the key, store it, hand it out — was rejected.
A BYOK key fanned out to a family is exactly the secret a server-side vault
should not be able to open, and `user_ai_credentials` (the personal vault) is
deliberately server-readable so the Worker can probe and lease it.

So sharing rides the **Household Data Key** instead. The HDK is a 32-byte
per-household symmetric key that every enrolled device already holds, delivered
at enrolment over X25519 + HKDF and rotated when a device is revoked. The sharer's
device seals the API key under a subkey of it:

```
HKDF-SHA256(hdk, info = "lf-ai-key-share:v1:<householdId>:<keyEpoch>:<provider>")
AAD          = "lf-ai-key-share:v1:<hh>:<epoch>:<provider>:<ownerUserId>:A256GCM"
envelope     = AES-256-GCM → base64(nonce ‖ ciphertext ‖ tag)
```

The Worker stores that envelope and **cannot read it**. `AI_CREDENTIAL_KEK_V1`
is not involved. This is the same posture as `lf_blobs` (0157): the relay holds
ciphertext and nothing else.

`ownerUserId` is in the AAD, not just the derivation, so whoever controls the
database cannot re-point Ann's row at Bob — the envelope only opens against the
owner the row claims, which is what stops a recipient billing the wrong member.

`keyEpoch` travels with the row. The HDK rotates on device revocation, and a
reader picks the matching retired key from its ring; without the epoch a rotation
would silently orphan every share.

## Why recipients never keep the key

`aiKeyVault` (device Keychain) is the durable home for a key you **typed**. A
borrowed key is different: the lender has to be able to take it back, and they
cannot if every member's Keychain holds a permanent copy.

So a borrowed key is fetched at inference time and cached **in memory only** —
5-minute TTL, gone when the app is killed, never written to disk. `Stop sharing`
deletes the row, the next fetch 404s, and `getBorrowedAiKey` returns null.

This costs nothing offline: a BYOK call goes to `api.openai.com`, so the network
is already required.

**The honest limit, which the UI states at both ends:** a member who has already
used the key could have copied it out of the app by other means. Revocation ends
access *through this app*. The only complete revocation is rotating the key in
the provider's console.

## Billing order

`resolveLocalByokProvider` tries, in order: the member's chosen provider (own
key) → the fixed provider order (own keys) → shared keys. A borrowed key spends
someone else's money, so it is the last resort, never a peer of the member's own
key. `source: 'own' | 'shared'` is on the resolved credential.

## Consent

Two acknowledgements, because there are two parties:

| Who | Where recorded | What they accept |
|---|---|---|
| Sharer | `user_ai_credentials.consent_*` (existing) + the Share dialog | Their account is billed for other members' usage |
| Recipient | `lf_ai_key_share_consents` | Their prompts reach a third party under someone else's account and billing |

The server refuses to hand over the envelope until the recipient's row exists
(Apple 5.1.2(i)). The owner reading their own share needs no consent.

Replacing a shared key keeps existing consents: the acceptance said "I accept
sending my data to Ann's OpenAI account", which is still true, and re-prompting
on every key rotation trains members to tap through the disclosure.

## Surface

| Piece | Path |
|---|---|
| Envelope crypto | `packages/local-first/src/crypto/ai-key-share.ts` |
| Device client | `src/services/aiKeyShare.ts` |
| UI section | `src/components/ai/HouseholdKeySharing.tsx` (in `app/ai-access/manage.tsx`) |
| BYOK fallback | `src/features/budget/local/ai/localByokClient.ts` |
| Control plane | `backend/src/services/ai-key-share-service.ts`, routes in `local-first-v2.ts` |
| Schema | `backend/migrations/0169_lf_ai_key_shares.sql` |

Routes, all under `/v2/households/:householdId/ai-key-shares` and authorized
against `lf_memberships` (**not** `household_members` — the HDK belongs to the
local-first household graph):

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Metadata + your consent state + the current key epoch. Never the envelope. |
| `PUT` | `/:provider` | Publish/replace your share. Rejects a stale epoch. |
| `POST` | `/:shareId/consent` | Record the recipient acknowledgement. |
| `POST` | `/:shareId/envelope` | Hand back the sealed blob. Consent-gated. |
| `DELETE` | `/:provider` | Stop sharing. Owner only. |

On publish, every other active member gets a push + in-app notification of type
`ai_key_shared`, routed to `/ai-access/manage`. On revoke, the same type goes out
with `data.event: 'revoked'` — but only to the members who had **accepted** the
key, since they are the ones whose AI is about to stop and everyone else never
touched it. The payload carries the provider and who shared it, never key
material.

## Scope

Budget only today. `householdCrypto()` in `src/services/aiKeyShare.ts` is
brand-keyed; House gets it by adding a branch that returns its engine's HDK and
its local-first header. Everything below that line is already brand-neutral, and
the section renders nothing on a brand with no local-first household.
