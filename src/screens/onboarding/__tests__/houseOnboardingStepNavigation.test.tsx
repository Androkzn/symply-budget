/**
 * House's household wizard has to be walkable in BOTH directions.
 *
 * Every step from "Set Up Your Home" onward used to render a bare progress bar
 * and nothing else: no back arrow, no forward arrow, no header at all. A member
 * who mistyped the name of their home, or picked the wrong home type, or simply
 * wanted to see what they had already answered, had exactly two ways out of the
 * screen they were on — finish the wizard, or kill the app. The progress bar
 * counted steps it gave them no way to move between.
 *
 * So this file asserts the arrows exist and are wired to the right thing, per
 * step, because "there is a chevron" and "the chevron goes somewhere sensible"
 * are different claims and only the second one is worth anything:
 *
 *  - **back** always pops one step (`goBack`), never re-navigates. A `navigate`
 *    to the previous route would push a SECOND copy of it and leave the member
 *    walking forward through their own history.
 *  - **forward** is the step's own "Skip" — same destination, same side effects
 *    — so using the chevron can never reach a state the visible button cannot.
 *  - a step with nothing to skip forward TO (the flow's last screen; a required
 *    answer that is still missing) renders NO forward chevron rather than one
 *    that finishes onboarding out from under the member.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockReplace = jest.fn();
const mockCompleteOnboarding = jest.fn();

const HOUSEHOLD = { id: 'hh_1', name: 'Beach Property' };

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

// `expo-router/react-navigation` is mapped onto this package by the jest config
// (see its moduleNameMapper note), so the screens' `useNavigation` import lands
// HERE — mocking the expo-router path instead has no effect at all.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    replace: mockReplace,
  }),
  // The AI step refetches entitlement on focus; there is no navigator here to
  // focus it, and firing the callback during render would refetch mid-paint.
  useFocusEffect: jest.fn(),
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      currentHousehold: HOUSEHOLD,
      addHousehold: jest.fn(),
      setCurrentHousehold: jest.fn(),
      updateHousehold: jest.fn(),
    }),
}));

jest.mock('@stores/spaceStore', () => ({
  useSpaceStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ setSpaces: jest.fn(), spaces: [] }),
}));

jest.mock('@stores/authStore', () => ({
  useAuthStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        hasHydrated: true,
        completeOnboarding: mockCompleteOnboarding,
        logout: jest.fn(),
      }),
    { getState: () => ({ logout: jest.fn() }) },
  ),
}));

jest.mock('@api/user', () => ({
  userApi: { updateOnboardingStep: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('@api/household-spaces', () => ({
  householdSpacesApi: { bulkCreate: jest.fn(), list: jest.fn(), update: jest.fn() },
}));

jest.mock('@api/garbage-collection', () => ({
  garbageCollectionApi: { createSchedule: jest.fn().mockResolvedValue({}) },
}));

jest.mock('@api/reports', () => ({
  reportsApi: { getUploadUrl: jest.fn(), uploadFile: jest.fn(), confirmUpload: jest.fn() },
}));

jest.mock('@api/floor-plans', () => ({
  floorPlansApi: { getUploadUrl: jest.fn(), uploadFile: jest.fn(), confirmUpload: jest.fn() },
}));

jest.mock('@features/house/local/useMemberFacingAlert', () => ({
  useMemberFacingAlert: () => jest.fn(),
}));

let mockEntitlement = {
  canUseAI: false,
  isPaid: false,
  isLoading: false,
  aiFeaturesEnabled: true,
  subscriptionsEnabled: true,
  bringYourOwnAIEnabled: true,
  refetch: jest.fn(),
};
jest.mock('@hooks/useAIEntitlement', () => ({
  useAIEntitlement: () => mockEntitlement,
}));

import { ThemeProvider } from '@contexts/ThemeContext';
import {
  markHouseOnboardingAiAvailable,
  markHouseOnboardingAiSkipped,
} from '@features/house/onboarding/aiSteps';

import { AIProviderScreen } from '../AIProviderScreen';
import { FloorPlanScreen } from '../FloorPlanScreen';
import { GarbageSetupScreen } from '../GarbageSetupScreen';
import { SpaceSetupScreen } from '../SpaceSetupScreen';
import { UploadReportScreen } from '../UploadReportScreen';

async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  return tree;
}

function control(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.findAll(
    (node) => node.props?.testID === testID && typeof node.props?.onPress === 'function',
  )[0];
}

async function press(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = control(tree, testID);
  expect(node).toBeDefined();
  await act(async () => {
    node!.props.onPress();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  markHouseOnboardingAiAvailable();
  mockEntitlement = {
    canUseAI: false,
    isPaid: false,
    isLoading: false,
    aiFeaturesEnabled: true,
    subscriptionsEnabled: true,
    bringYourOwnAIEnabled: true,
    refetch: jest.fn(),
  };
});

describe('SpaceSetup', () => {
  it('pops back to the home the member just named', async () => {
    const tree = await render(<SpaceSetupScreen />);
    await press(tree, 'onboarding-space-setup-back');
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('sends the forward chevron exactly where "Skip for Now" goes', async () => {
    const tree = await render(<SpaceSetupScreen />);
    await press(tree, 'onboarding-space-setup-forward');
    // The AI ask, not the report upload — the question that decides whether the
    // two AI-dependent steps happen at all has to be asked before the first.
    expect(mockNavigate).toHaveBeenCalledWith('AIProvider');
  });

  it('keeps its header out of the scroll view, so the arrows survive scrolling', async () => {
    const tree = await render(<SpaceSetupScreen />);
    const scroll = tree.root.findAll(
      (node) => typeof node.type !== 'string' && node.props?.contentContainerStyle,
    )[0];
    expect(scroll).toBeDefined();
    expect(
      scroll!.findAll((node) => node.props?.testID === 'onboarding-space-setup-back'),
    ).toHaveLength(0);
  });
});

describe('AIProvider', () => {
  it('pops back to the spaces step', async () => {
    const tree = await render(<AIProviderScreen />);
    await press(tree, 'onboarding-ai-provider-back');
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('forward records the skip, exactly as the Skip button does', async () => {
    const tree = await render(<AIProviderScreen />);
    await press(tree, 'onboarding-ai-provider-forward');
    // Recording it is the point: the two AI-dependent steps drop out of the
    // flow, so the member is not walked through an upload nothing can read.
    expect(mockNavigate).toHaveBeenCalledWith('GarbageSetup');
  });

  it('shows no arrows on the redirect flash an entitled member sees', async () => {
    mockEntitlement = { ...mockEntitlement, canUseAI: true };
    const tree = await render(<AIProviderScreen />);
    // This render replaces itself; a back arrow would be unhittable and a
    // forward one would race the redirect it duplicates.
    expect(control(tree, 'onboarding-ai-provider-back')).toBeUndefined();
    expect(mockReplace).toHaveBeenCalledWith('UploadReport');
  });
});

describe('UploadReport', () => {
  it('pops back rather than re-navigating', async () => {
    const tree = await render(<UploadReportScreen />);
    await press(tree, 'onboarding-upload-report-back');
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('forwards to the garbage step, same as its Skip button', async () => {
    const tree = await render(<UploadReportScreen />);
    await press(tree, 'onboarding-upload-report-forward');
    expect(mockNavigate).toHaveBeenCalledWith('GarbageSetup');
  });
});

describe('GarbageSetup', () => {
  it('pops back to whichever step preceded it', async () => {
    const tree = await render(<GarbageSetupScreen />);
    await press(tree, 'onboarding-garbage-setup-back');
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('offers a forward chevron to the floor plan when the AI steps are in the flow', async () => {
    markHouseOnboardingAiAvailable();
    const tree = await render(<GarbageSetupScreen />);
    await press(tree, 'onboarding-garbage-setup-forward');
    expect(mockNavigate).toHaveBeenCalledWith('FloorPlan');
  });

  it('offers NO forward chevron when it is the last step', async () => {
    // A member who skipped the AI ask finishes onboarding here. A header
    // chevron that drops them into the app is not a "next step" — "Skip for
    // Now" says what it does in words, and the chevron cannot.
    markHouseOnboardingAiSkipped();
    const tree = await render(<GarbageSetupScreen />);
    expect(control(tree, 'onboarding-garbage-setup-forward')).toBeUndefined();
    expect(control(tree, 'onboarding-garbage-setup-back')).toBeDefined();
    expect(mockCompleteOnboarding).not.toHaveBeenCalled();
  });
});

describe('FloorPlan', () => {
  it('pops back to the garbage step', async () => {
    const tree = await render(<FloorPlanScreen />);
    await press(tree, 'onboarding-floor-plan-back');
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('offers no forward chevron — "Skip & Finish Setup" is the only way on', async () => {
    const tree = await render(<FloorPlanScreen />);
    expect(control(tree, 'onboarding-floor-plan-forward')).toBeUndefined();
    expect(mockCompleteOnboarding).not.toHaveBeenCalled();
  });
});
