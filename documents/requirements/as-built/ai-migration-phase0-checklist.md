# AI Migration — Phase 0 External Checklist

External configuration and decisions required before / alongside the V1 binary.

**Status (2026-07-10):** Feature flags are ON in staging + production. `aiRequiresAccess` is temporarily **false** so managed AI works without IAP while RevenueCat / App Store products are configured. Flip `aiRequiresAccess` back to `true` before public launch.

## App Store Connect

- [ ] Paid Apps agreement accepted; banking/tax complete
- [ ] Auto-renewable monthly subscription product created
- [ ] Product attached to the V1 app version submission (with RevenueCat SDK + paywall binary)
- [ ] Product kept unavailable for sale until AI-access rollout
- [ ] Terms of Use + Privacy Policy URLs finalized (Apple IAP, RevenueCat, BYOK, provider processing)

## RevenueCat

- [ ] Entitlement `pro` created
- [ ] Offering `default` with the App Store product attached
- [ ] Restore behavior set (default recommendation: Transfer to new App User ID) — see plan §23 #3
- [ ] Staging/sandbox and production webhook endpoints + distinct secrets configured
- [ ] `REVENUECAT_SECRET_API_KEY`, `REVENUECAT_WEBHOOK_AUTH`, project/app IDs set via wrangler secrets per env
- [ ] Expo public keys in `.env.local` / EAS: `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` (see `.env.example`)
- [ ] After keys are set: rebuild app; set `aiRequiresAccess: true` in defaults + KV

## Security (do immediately)

- [ ] Rotate committed Lambda Anthropic key referenced in plan §7.1; scrub from repo/history per policy
- [ ] Confirm `LAMBDA_CALLBACK_API_KEY` (or dedicated callback secret) is set; no `JWT_SECRET` fallback for Lambda callbacks

## Product / Legal (§23)

- [ ] #1 BYOK under Apple 3.1.1 — storefront strategy approved or deferred (`bringYourOwnAIEnabled=false`)
- [ ] #2 Grace-period AI policy (plan default: strict / `{normal}` only)
- [ ] #3 RevenueCat restore behavior confirmed
- [ ] #4 Cross-member BYOK consent model
- [ ] #5 Managed Mira voice funding
- [ ] #6 Gemini auth-key disclosure copy
- [ ] #7 Managed-plan model ceiling (default: economy/balanced; frontier BYOK/opt-in)
- [ ] #8–#10 Model-access UX, snapshot-vs-alias, sticky per-provider selection

## Fallback if BYOK rejected

Ship Apple subscription only; keep `bringYourOwnAIEnabled=false`.
