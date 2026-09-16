/**
 * House's view of household AI key sharing.
 *
 * The mechanism is brand-neutral and lives in `@services/aiKeyShare` — the AI
 * Providers screen is shared across the fleet, so it cannot import this
 * feature's engine. This file exists so the House BYOK client has a local name
 * for the one function it needs, and so the coupling is visible from here.
 *
 * Mirrors `src/features/budget/local/ai/sharedAiKeys.ts`; House and Budget lend
 * keys through the same envelope, the same `/v2` routes and the same UI.
 */

export { forgetBorrowedAiKey, forgetBorrowedAiKeys, getBorrowedAiKey } from '@services/aiKeyShare';
