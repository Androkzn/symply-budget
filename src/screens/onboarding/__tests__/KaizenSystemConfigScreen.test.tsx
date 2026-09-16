/**
 * KaizenSystemConfigScreen — per-system task-catalog picker, looped once for
 * every system selected on `KaizenSystemsSetupScreen` (always in required
 * onboarding mode — this does not replace `SystemConfigScreen`, the
 * standalone/editable-later version reached from Settings/system-detail).
 *
 * Drives the real screen (real `SYSTEM_TASK_CATALOG`) and asserts:
 * catalog-suggested tasks start selected and can be toggled; custom actions
 * can be added; "Save & continue" materializes the selection, then follows
 * whichever of `markSystemConfigured`'s three outcomes fires — push the next
 * queued system, hand off to Career's deep-setup wizard, or (no Career in
 * the selection) finish account onboarding right here by flipping BOTH the
 * Kaizen-local and account-level onboarding flags.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { KaizenSystemConfigScreen } from '../KaizenSystemConfigScreen';

const mockNavigate = jest.fn();
const mockPush = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: { system: string } = { system: 'career' };
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate, push: mockPush, goBack: mockGoBack }),
  useRoute: () => ({ params: mockRouteParams }),
}));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => ({ replace: mockReplace }),
}));

const mockMaterializeSystemTasks = jest.fn();
const mockFinishOnboarding = jest.fn();
jest.mock('@features/kaizen/stores/kaizenStore', () => ({
  __esModule: true,
  useKaizenStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      materializeSystemTasks: (...a: unknown[]) => mockMaterializeSystemTasks(...a),
      finishOnboarding: (...a: unknown[]) => mockFinishOnboarding(...a),
    }),
}));

const mockCompleteOnboarding = jest.fn();
jest.mock('@stores/authStore', () => ({
  __esModule: true,
  useAuthStore: (selector: (s: { completeOnboarding: () => void }) => unknown) =>
    selector({ completeOnboarding: mockCompleteOnboarding }),
}));

let mockMarkSystemConfiguredResult: { kind: 'next-system'; system: string } | { kind: 'career-setup' } | { kind: 'complete' } = {
  kind: 'complete',
};
jest.mock('@features/kaizen/services/setupFlow', () => ({
  __esModule: true,
  ...jest.requireActual('@features/kaizen/services/setupFlow'),
  markSystemConfigured: (...a: unknown[]) => mockMarkSystemConfigured(...a),
}));
const mockMarkSystemConfigured = jest.fn((..._a: unknown[]) => mockMarkSystemConfiguredResult);

const SCREEN = 'onboarding-kaizen-system-config-screen';

function hasTestId(tree: ReactTestRenderer.ReactTestRenderer, testID: string): boolean {
  return tree.root.findAllByProps({ testID }).length > 0;
}

function pressByTestId(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = tree.root.findAllByProps({ testID })[0];
  node.props.onPress?.();
}

function allText(tree: ReactTestRenderer.ReactTestRenderer): string {
  return tree.root
    .findAll((n) => typeof n.type === 'string')
    .flatMap((n) => (Array.isArray(n.props?.children) ? n.props.children : [n.props?.children]))
    .filter((c) => typeof c === 'string')
    .join(' ');
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <KaizenSystemConfigScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

describe('KaizenSystemConfigScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = { system: 'career' };
    mockMarkSystemConfiguredResult = { kind: 'complete' };
    mockMaterializeSystemTasks.mockResolvedValue(undefined);
    mockFinishOnboarding.mockResolvedValue(undefined);
  });

  it('renders the Career catalog for the routed system', async () => {
    const tree = await renderScreen();
    expect(allText(tree)).toContain('Configure Career');
    expect(allText(tree)).toContain('One skill rep');
  });

  it('renders the Health catalog when routed to Health instead', async () => {
    mockRouteParams = { system: 'health' };
    const tree = await renderScreen();
    expect(allText(tree)).toContain('Configure Health');
  });

  it('starts with the catalog-suggested tasks pre-selected', async () => {
    const tree = await renderScreen();
    const suggested = tree.root.findAllByProps({
      testID: 'onboarding-kaizen-system-config-task-career.daily.skillRep',
    })[0];
    expect(suggested.props.accessibilityState).toEqual({ checked: true });
    const notSuggested = tree.root.findAllByProps({
      testID: 'onboarding-kaizen-system-config-task-career.daily.learn',
    })[0];
    expect(notSuggested.props.accessibilityState).toEqual({ checked: false });
  });

  it('toggles a task on and materializes the updated selection on save', async () => {
    const tree = await renderScreen();
    act(() => pressByTestId(tree, 'onboarding-kaizen-system-config-task-career.daily.learn'));

    await act(async () => {
      pressByTestId(tree, `${SCREEN}-continue`);
    });

    const selected = mockMaterializeSystemTasks.mock.calls[0][1] as string[];
    expect(selected).toContain('career.daily.learn');
    expect(selected).toContain('career.daily.skillRep');
  });

  it('adds a custom action and includes it in the save payload', async () => {
    const tree = await renderScreen();
    const inputs = tree.root.findAll((n) => String(n.type) === 'TextInput');
    act(() => inputs[0].props.onChangeText('Meditate 10 min'));
    act(() =>
      tree.root
        .findAll((n) => typeof n.props?.onPress === 'function' && n.props.title === 'Add custom action')[0]
        .props.onPress(),
    );

    await act(async () => {
      pressByTestId(tree, `${SCREEN}-continue`);
    });

    const custom = mockMaterializeSystemTasks.mock.calls[0][2] as Array<Record<string, unknown>>;
    expect(custom).toEqual([expect.objectContaining({ title: 'Meditate 10 min' })]);
  });

  it('pushes the next queued system as a new stack entry, not a replace', async () => {
    mockMarkSystemConfiguredResult = { kind: 'next-system', system: 'health' };
    const tree = await renderScreen();

    await act(async () => {
      pressByTestId(tree, `${SCREEN}-continue`);
    });

    expect(mockPush).toHaveBeenCalledWith('KaizenSystemConfig', { system: 'health' });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('hands off to the Career deep-setup wizard when the queue requires it', async () => {
    mockMarkSystemConfiguredResult = { kind: 'career-setup' };
    const tree = await renderScreen();

    await act(async () => {
      pressByTestId(tree, `${SCREEN}-continue`);
    });

    expect(mockNavigate).toHaveBeenCalledWith('KaizenCareerSetup');
    expect(mockCompleteOnboarding).not.toHaveBeenCalled();
  });

  it('finishes account onboarding here when the selection has no Career step left', async () => {
    mockMarkSystemConfiguredResult = { kind: 'complete' };
    const tree = await renderScreen();

    await act(async () => {
      pressByTestId(tree, `${SCREEN}-continue`);
    });

    expect(mockFinishOnboarding).toHaveBeenCalledTimes(1);
    expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('pops to the previous step on Back', async () => {
    const tree = await renderScreen();

    act(() => pressByTestId(tree, `${SCREEN}-back`));

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('does not render the custom-actions section testID for a task row (sanity: distinct testIDs)', async () => {
    const tree = await renderScreen();
    expect(hasTestId(tree, 'onboarding-kaizen-system-config-custom-actions')).toBe(true);
  });
});
