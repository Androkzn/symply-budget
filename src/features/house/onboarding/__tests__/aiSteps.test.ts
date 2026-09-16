/**
 * The onboarding step plan — the thing that decides a member never meets a
 * step that cannot work.
 *
 * The bug this replaces was reported from a device: on the floor-plan step the
 * primary button raised `Upload Failed`, and under that heading sat a sentence
 * explaining the feature is not built yet. Two separate faults — a refusal
 * wearing a crash's title, and a step being offered at all to a member for whom
 * it could not succeed. This suite covers the second: `UploadReport` and
 * `FloorPlan` both feed a model, so they are IN the flow or OUT of it, never
 * shown-then-refused.
 *
 * `p4ScreensRenderCopy.test.ts` covers the first.
 */
import {
  HOUSE_AI_DEPENDENT_STEPS,
  HOUSE_ONBOARDING_STEPS,
  clearHouseOnboardingAiDecision,
  houseOnboardingAiStepsIncluded,
  houseOnboardingPlan,
  houseOnboardingProgress,
  markHouseOnboardingAiAvailable,
  markHouseOnboardingAiSkipped,
} from '../aiSteps';

beforeEach(() => {
  clearHouseOnboardingAiDecision();
});

describe('the default is the long flow', () => {
  it('includes the AI-dependent steps before anyone has answered', () => {
    // The flag records a REFUSAL. A member who has not reached the AI step has
    // not refused anything, and sizing the bar for the short flow would make it
    // grow mid-onboarding — which reads as the app adding work.
    expect(houseOnboardingAiStepsIncluded()).toBe(true);
    expect(houseOnboardingPlan()).toEqual(HOUSE_ONBOARDING_STEPS);
  });
});

describe('skipping the AI step drops the steps that needed it', () => {
  beforeEach(() => {
    markHouseOnboardingAiSkipped();
  });

  it('removes exactly UploadReport and FloorPlan', () => {
    const plan = houseOnboardingPlan();
    for (const step of HOUSE_AI_DEPENDENT_STEPS) {
      expect(plan).not.toContain(step);
    }
    expect(plan).toEqual(
      HOUSE_ONBOARDING_STEPS.filter(
        step => !HOUSE_AI_DEPENDENT_STEPS.includes(step),
      ),
    );
  });

  it('keeps GarbageSetup, which works by hand', () => {
    // Reading a photo of the bins needs a provider; picking a weekday does not,
    // and that is the step's actual job. Dropping it would remove a feature the
    // member can fully use.
    expect(houseOnboardingPlan()).toContain('GarbageSetup');
  });

  it('leaves GarbageSetup as the last step', () => {
    const plan = houseOnboardingPlan();
    expect(plan[plan.length - 1]).toBe('GarbageSetup');
  });

  it('is remembered, so a relaunch does not re-offer the steps', () => {
    expect(houseOnboardingAiStepsIncluded()).toBe(false);
  });
});

describe('entitlement puts the steps back', () => {
  it('undoes an earlier skip', () => {
    // A member who skips, then buys Pro, must not be held to the older answer.
    markHouseOnboardingAiSkipped();
    markHouseOnboardingAiAvailable();

    expect(houseOnboardingAiStepsIncluded()).toBe(true);
    expect(houseOnboardingPlan()).toContain('UploadReport');
    expect(houseOnboardingPlan()).toContain('FloorPlan');
  });
});

describe('the progress bar counts the flow actually being walked', () => {
  it('sizes itself to the plan, not to a constant', () => {
    const long = houseOnboardingProgress('GarbageSetup');
    markHouseOnboardingAiSkipped();
    const short = houseOnboardingProgress('GarbageSetup');

    expect(long.totalSteps).toBe(HOUSE_ONBOARDING_STEPS.length);
    expect(short.totalSteps).toBe(
      HOUSE_ONBOARDING_STEPS.length - HOUSE_AI_DEPENDENT_STEPS.length,
    );
    // And the member is FURTHER along the short flow at the same screen, which
    // is the point: they have less left to do, and the bar should say so.
    expect(short.currentStep).toBeLessThan(long.currentStep);
  });

  it('never gives a step an index before the one before it', () => {
    const plan = houseOnboardingPlan();
    const indices = plan.map(step => houseOnboardingProgress(step).currentStep);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it('gives every step a distinct index, so the bar never stalls', () => {
    // `EssentialPermissions` and `CreateHousehold` both passed
    // `currentStep={1}` before the plan existed: the bar sat still for a screen
    // and then jumped two.
    const plan = houseOnboardingPlan();
    const indices = plan.map(step => houseOnboardingProgress(step).currentStep);
    expect(new Set(indices).size).toBe(plan.length);
  });

  it('reports a sane position for a step that is no longer planned', () => {
    // Reachable: a member on FloorPlan when the decision flips underneath them.
    // -1 would draw an empty bar on a screen they are demonstrably standing on.
    markHouseOnboardingAiSkipped();
    const { currentStep, totalSteps } = houseOnboardingProgress('FloorPlan');

    expect(currentStep).toBeGreaterThanOrEqual(0);
    expect(currentStep).toBeLessThan(totalSteps);
  });
});
