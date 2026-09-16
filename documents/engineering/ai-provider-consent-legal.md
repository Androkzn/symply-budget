# AI Provider Connect — Legal Consent & Per-Provider Disclaimer

**Status:** Research + implementation spec · **Date:** 2026-07-21 · **Scope:** BYOK connect flow (`app/ai-access/connect.tsx`, `manage.tsx`, `providerMeta.ts`)

> **Not legal advice.** This is engineering research to implement industry-standard, defensible practices. Final ToS/Privacy wording tied to a legal entity should be reviewed by a lawyer before store submission. What follows is grounded in the providers' own published policies and Apple's current App Review Guidelines.

---

## 1. Why this matters (the actual legal driver)

Two independent pressures make a per-provider consent gate on **Connect** non-optional:

### 1a. Apple App Review Guideline 5.1.2(i) — the hard gate
Apple's App Review Guidelines (updated **Nov 2025** and again **June 8 2026**) now state that an app must **clearly disclose** where personal data will be shared with third parties **— including third‑party AI —** and obtain the user's **explicit permission before doing so**. Enforcement notes that matter for us:

- Consent must appear **before the first data transmission** to the provider.
- **Each category** of AI data sharing needs its own acknowledgment (so a per‑provider gate is the correct granularity — the user is choosing a *specific* third party each time).
- The user must be able to **decline without losing core app functionality** (our managed-key / non-AI paths already satisfy this).

A BYOK app that pipes household/financial data to OpenAI/Anthropic/Google without an explicit, logged consent step is now a concrete **App Store rejection risk**, not just a liability nicety.

### 1b. Owner liability (your stated goal — "no claim against me as owner")
The defensible posture is: **the user, not the app owner, chooses to send their data to a third party they have their own account/contract with.** BYOK helps here — requests run under *the user's own* provider account and *the user's own* agreement with that provider. Our job is to make that choice **informed, explicit, per-provider, and recorded.** Three elements do the legal work:

1. **Disclosure** — plain-language statement of what leaves the device and to whom.
2. **Delegation** — "your data is governed by *your* agreement with <Provider>; here are the official links."
3. **Limitation** — "we don't store your prompts/personal data; deciding what to submit is your responsibility."

---

## 2. Per-provider facts (verified against the providers' own policies, July 2026)

| | Trains on API data by default? | Default retention | Free tier? | The trap |
|---|---|---|---|---|
| **Anthropic (Claude)** | **No** (Commercial/API terms) | **7 days** (since 2025‑09‑14; 30 via DPA opt‑in; ZDR for enterprise) | No | None major — strongest default retention in market |
| **OpenAI** | **No** by default (since 2023‑03‑01; abuse logs ≤30d) | **Up to 30 days**, then deleted unless legally required | No | — |
| **Google Gemini** | **Paid: No. FREE/unpaid: YES** — content used to improve Google products **and human‑reviewed** | Paid follows DPA; free tier retained/used | **Yes (unpaid quota)** | ⚠️ **On the free tier Google says: "Do not submit sensitive, confidential, or personal information."** EEA/CH/UK get paid‑tier protection on all tiers. |

**The Gemini free-tier trap is the single most important finding.** A user who connects a Gemini key on the free tier and then feeds it household budget/financial/health data is submitting personal data to a service that *by its own terms* trains on it and may have humans review it. Our disclaimer for Gemini must call this out explicitly, and we should consider warning against submitting sensitive data on an unpaid Gemini key.

### Official links to surface per provider (deep-link from the disclaimer)

**Anthropic**
- Usage Policy — https://www.anthropic.com/legal/aup
- Commercial Terms of Service — https://www.anthropic.com/legal/commercial-terms
- Privacy Policy — https://www.anthropic.com/legal/privacy

**OpenAI**
- How your data is used / data controls — https://developers.openai.com/api/docs/guides/your-data
- Usage Policies — https://openai.com/policies/usage-policies/
- Privacy Policy — https://openai.com/policies/privacy-policy/
- Enterprise/API privacy — https://openai.com/enterprise-privacy/

**Google Gemini**
- Gemini API Additional Terms of Service — https://ai.google.dev/gemini-api/terms
- Prohibited Use Policy — https://policies.google.com/terms/generative-ai/use-policy
- Privacy Policy — https://policies.google.com/privacy

---

## 3. Consent UX pattern (recommended)

**Where:** the existing acknowledgement gate in `connect.tsx` is the right place. Upgrade it from one generic checkbox to a **per-provider disclaimer block + explicit consent**, shown every time a key is connected.

**Lifecycle (matches the user's spec):**
- **One-time per connect** — the consent gate is presented on each pass through `connect.tsx`; `acknowledged` starts `false`, so it is a fresh, deliberate act each time.
- **Every connection must be confirmed** — Connect button stays disabled until the provider-specific box is acknowledged.
- **Reset on disconnect** — disconnecting removes the connection; reconnecting re-enters `connect.tsx` and re-requires consent. If we persist a consent record server-side (§5, recommended), `deleteConnection` clears it so the flag genuinely resets.

**Granularity:** per **provider** (Apple's "each category" → each distinct third party the user picks). Switching the active provider between two already-consented keys does **not** need re-consent; connecting a *new* key does.

**Decline path:** closing the connect screen without consenting = no key saved, no data sent, core app still works on managed key or non-AI features. ✔ satisfies 5.1.2(i).

---

## 4. Disclaimer copy (per provider, drop-in)

Brand-neutral (interpolate `brand.displayName`). Structure per provider: **(a) what happens · (b) your data / their terms · (c) your responsibility · (d) links.**

### Shared preamble (all providers)
> Connecting **<Provider>** lets **{brand.displayName}** send the content of your AI requests — which can include your household, task, budget, or note data — directly to **<Provider>** using **your own** API key and account. **{brand.displayName} does not store your prompts or the personal data you choose to submit**, and cannot see or control your provider spending. What you send is up to you.

### Anthropic (Claude)
> Your requests run under **your** Anthropic account and are governed by Anthropic's terms. Anthropic states it **does not use API data to train its models** by default and deletes API inputs/outputs on a short retention window. You are responsible for what you submit.
> • Usage Policy · Commercial Terms · Privacy Policy *(official links)*

### OpenAI
> Your requests run under **your** OpenAI account and are governed by OpenAI's terms. OpenAI states API data is **not used to train models by default** and is retained for up to 30 days for abuse monitoring, then deleted. You are responsible for what you submit.
> • Data usage · Usage Policies · Privacy Policy *(official links)*

### Google Gemini — **must carry the free-tier warning**
> Your requests run under **your** Google account and are governed by Google's Gemini API terms. **On Google's free (unpaid) tier, Google may use your content to improve its products and human reviewers may read it — Google advises *not* submitting sensitive, confidential, or personal information on the free tier.** Paid Gemini API usage is excluded from training. Choose your tier accordingly; you are responsible for what you submit.
> • Gemini API Terms · Prohibited Use · Privacy Policy *(official links)*

### Explicit consent line (replaces current generic checkbox label)
> ☑ I understand my requests are sent to **<Provider>** under my own account and terms, that **{brand.displayName} does not store the personal data I submit**, that provider charges are billed to me directly, and I agree to proceed.

---

## 5. Implementation mapping

Current state (already in repo):
- `connect.tsx` has a generic disclosures list + one acknowledgement checkbox (`acknowledged`), gating the Connect button. Good foundation.
- `providerMeta.ts` is the single source of truth per provider — **add the legal fields here** (no per-brand fork).
- `aiAccess` API currently has **no** consent field; acknowledgement is client-only local state.

Changes:
1. **`providerMeta.ts`** — extend `ProviderMeta` with:
   - `dataDisclaimer: string` (provider-specific paragraph above),
   - `legalLinks: { label: string; url: string }[]` (official docs),
   - `freeTierWarning?: string` (Gemini only).
2. **`connect.tsx`** — replace the static `disclosures` array with the shared preamble + `meta.dataDisclaimer`; render `meta.legalLinks` as tappable `Linking.openURL` rows; if `meta.freeTierWarning`, render it as a prominent warning card (warning colour, alert icon). Update the checkbox label to the explicit consent line.
3. **Consent record (recommended for Apple evidence + true flag reset):** on `POST /ai-credentials/:provider`, include `consent: { version, provider, accepted_at }`; store `ai_consent_version` + `ai_consent_at` on the credential row. `deleteConnection` clears it. This gives an auditable "explicit permission before first transmission" trail and makes the reset-on-disconnect literal, not just implied by UI state. Add a `CONSENT_VERSION` constant so future terms changes force re-consent.
4. **`manage.tsx`** — no consent change needed (re-connect routes through `connect.tsx`). Optionally show a small "Consented <date>" line under a connected key.

Test coverage: extend `app/ai-access/__tests__` — Connect button disabled until consent; Gemini renders the free-tier warning; each provider renders its own links; (if server record) POST body carries `consent`.

---

## 6. Ongoing maintenance (do not skip)

Provider terms change often (Anthropic dropped retention 30→7 days in Sept 2025; Apple changed the rules twice in ~7 months). Practices to keep this defensible:
- Keep the summarized claims in copy **soft/qualified** ("Anthropic states…", "by default") — never assert an absolute you'd be liable for if they change it.
- Prefer **linking to the live official page** over reproducing their terms verbatim (which can go stale and become misleading).
- Bump `CONSENT_VERSION` when the disclaimer materially changes → existing users re-consent on next connect.
- Re-review provider policies + Apple guidelines quarterly.

---

## Sources
- Apple App Review Guidelines 5.1.2(i) (Nov 2025 / Jun 8 2026 updates) — https://developer.apple.com/app-store/review/guidelines/ · https://developer.apple.com/news/?id=ey6d8onl
- Anthropic Usage Policy / Commercial Terms / Privacy — https://www.anthropic.com/legal/aup · https://www.anthropic.com/legal/commercial-terms · https://www.anthropic.com/legal/privacy
- OpenAI data controls / usage / privacy — https://developers.openai.com/api/docs/guides/your-data · https://openai.com/policies/usage-policies/ · https://openai.com/enterprise-privacy/
- Google Gemini API Additional Terms of Service — https://ai.google.dev/gemini-api/terms · https://policies.google.com/terms/generative-ai/use-policy
