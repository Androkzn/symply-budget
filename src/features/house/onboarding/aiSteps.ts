/**
 * Which House onboarding steps exist, and who decides.
 *
 * ## The problem this replaces
 *
 * Two of House's setup steps are only worth showing to a member who can run a
 * model: `UploadReport` exists so an inspection report can be READ, and
 * `FloorPlan` exists so a drawing can be turned into rooms, areas and pins.
 * Without AI access both collapse into an upload that produces a file nobody
 * looks at — and on a local-first build `FloorPlan` was worse than useless: the
 * primary button raised an `Upload Failed` alert carrying a "not on this build
 * yet" sentence, which reads as a crash rather than as a feature that is off.
 *
 * So the steps are no longer offered-then-refused. They are **planned**: a
 * member with AI access sees them, a member without them never does, and the
 * progress bar counts the flow they are actually walking rather than a fixed six.
 *
 * ## Who sets the flag
 *
 * `AIProviderScreen` and nothing else. It is the one step that knows the answer
 * — it reads `useAIEntitlement()`, and:
 *
 *  - **entitled** (a Pro subscription, or a BYOK key already connected) — it
 *    marks the steps in and forwards immediately, so a paying member never sees
 *    an ask for something their plan already includes;
 *  - **skipped** — it marks them out, and `SpaceSetup` → `GarbageSetup` →
 *    finish is the whole remaining flow.
 *
 * ## Why it is persisted rather than held in a store
 *
 * Onboarding survives a relaunch: `hasCompletedOnboarding` is client state and a
 * member who force-quits on `GarbageSetup` comes back to the wizard. An
 * in-memory decision would come back as "included" and drop them onto the two
 * steps they had just declined. MMKV is read synchronously here for the same
 * reason `readSetupQueue()` is in Kaizen's `setupFlow` — the value is needed
 * during render, to size the progress bar, before any effect could resolve it.
 */
import { mmkv } from '@services/storage';

/** MMKV key. Namespaced by app + flow, like `kaizen.setup.queue`. */
const AI_SKIPPED_KEY = 'house.onboarding.aiProviderSkipped';

/**
 * Session mirror of the stored answer.
 *
 * `mmkv` degrades to a no-op proxy when MMKV failed to initialise (see
 * `getMmkvInitError`), and a silently-dropped write here would put the member
 * back on the two steps they just declined the moment they moved forward a
 * screen. The mirror keeps the decision correct for THIS run; MMKV is what
 * makes it survive a relaunch. `undefined` means "not answered yet".
 */
let skippedThisSession: boolean | undefined;

/**
 * Every step of the House onboarding stack, in the order a member walks it.
 *
 * `EssentialPermissions` and `CreateHousehold` shared an index before this
 * list existed — both passed `currentStep={1}` — so the bar stalled for a
 * screen and then jumped two. Naming the steps once fixes that as a side
 * effect of having a single source of truth.
 */
export const HOUSE_ONBOARDING_STEPS = [
  'Welcome',
  'EssentialPermissions',
  'CreateHousehold',
  'SpaceSetup',
  'AIProvider',
  'UploadReport',
  'GarbageSetup',
  'FloorPlan',
] as const;

export type HouseOnboardingStep = (typeof HOUSE_ONBOARDING_STEPS)[number];

/**
 * The steps that need a model behind them, and are therefore dropped from the
 * flow when the member has no AI access.
 *
 * `GarbageSetup` is deliberately NOT here. Reading a photo of the bins needs a
 * provider, but setting the collection days by hand does not, and that is the
 * step's real job — see `garbage-collection.aiDetect` in `unsupportedCopy.ts`,
 * which offers the provider rather than blocking the screen.
 */
export const HOUSE_AI_DEPENDENT_STEPS: readonly HouseOnboardingStep[] = [
  'UploadReport',
  'FloorPlan',
];

/** The member declined to connect a provider — drop the AI-dependent steps. */
export function markHouseOnboardingAiSkipped(): void {
  skippedThisSession = true;
  mmkv.set(AI_SKIPPED_KEY, true);
}

/**
 * The member has AI access — keep the AI-dependent steps in.
 *
 * Called on entitlement as well as on connect, so a member who skips, buys Pro
 * and reinstalls is not held to the older answer.
 */
export function markHouseOnboardingAiAvailable(): void {
  skippedThisSession = false;
  mmkv.remove(AI_SKIPPED_KEY);
}

/**
 * Forget the decision. Called when onboarding starts over, so a second household
 * on the same device is planned fresh rather than inheriting the first answer.
 */
export function clearHouseOnboardingAiDecision(): void {
  skippedThisSession = undefined;
  mmkv.remove(AI_SKIPPED_KEY);
}

/**
 * True while `UploadReport` and `FloorPlan` are part of this member's flow.
 *
 * Defaults to TRUE: the flag records a refusal, and a member who has not
 * reached `AIProviderScreen` yet has not refused anything. Sizing the bar for
 * the longer flow and shortening it is honest; the reverse would grow the bar
 * mid-flow, which reads as the app adding work.
 */
export function houseOnboardingAiStepsIncluded(): boolean {
  if (skippedThisSession !== undefined) return !skippedThisSession;
  return mmkv.getBoolean(AI_SKIPPED_KEY) !== true;
}

/** The steps this member actually walks, in order. */
export function houseOnboardingPlan(): readonly HouseOnboardingStep[] {
  if (houseOnboardingAiStepsIncluded()) return HOUSE_ONBOARDING_STEPS;
  return HOUSE_ONBOARDING_STEPS.filter(
    step => !HOUSE_AI_DEPENDENT_STEPS.includes(step),
  );
}

/**
 * `currentStep` / `totalSteps` for `<OnboardingProgress>`, against the plan.
 *
 * A step that is not in the plan still has to render something sane — a member
 * can be standing on `FloorPlan` when the decision flips underneath them (they
 * connected a provider from the AI step, came back, then went forward again) —
 * so an unplanned step reports the end of the flow rather than `-1`, which
 * would draw an empty bar.
 */
export function houseOnboardingProgress(step: HouseOnboardingStep): {
  currentStep: number;
  totalSteps: number;
} {
  const plan = houseOnboardingPlan();
  const index = plan.indexOf(step);
  return {
    currentStep: index === -1 ? plan.length - 1 : index,
    totalSteps: plan.length,
  };
}
