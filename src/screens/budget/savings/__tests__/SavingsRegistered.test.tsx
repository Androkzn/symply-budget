/**
 * SavingsRegistered — Registered Accounts (TFSA / RRSP / FHSA) UI, end-to-end.
 *
 * THIN CLIENT: every room figure (roomRemaining, annualLimit, used, usedByKind,
 * warnings) is computed by `savingsApi.getRoom(...)` and only rendered — there
 * is no client-side room math. This suite stubs the heavy `@components/common`
 * barrel (its real `SafeAreaView` transitively pulls the SidebarTabBar → nav
 * chain that crashes under the mocked navigator), the savings API, and the
 * stores — then exercises: mount + load (listAccounts + getRoom, BE room
 * figures + regular/manual split render), over-contribution warning badge,
 * add-account → createAccount (dollars → cents) + markDirty, log-contribution →
 * addTransaction (+ markDirty), and apply-regular → applyRegularContribution
 * (+ markDirty).
 */

// SafeAreaView passthrough so the heavy @components/common barrel never loads.
jest.mock('@components/common', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    // Mirrors `OverlaySheetHeader`: the sheet's glass ✕ (carrying `closeTestID`)
    // and an optional trailing commit — the "Cancel"/"Done" these sheets used
    // to end in is now the ✕, so a flow driving that id still finds it here.
    OverlaySheetHeader: ({ title, onClose, closeTestID, action }: Record<string, any>) =>
      React.createElement(
        View,
        null,
        title ? React.createElement(Text, null, title) : null,
        React.createElement(TouchableOpacity, { onPress: onClose, testID: closeTestID }),
        action
          ? React.createElement(
              TouchableOpacity,
              { onPress: action.onPress, testID: action.testID },
              React.createElement(Text, null, action.label)
            )
          : null
      ),
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    BackButton: ({ onPress, testID }: { onPress?: () => void; testID?: string }) =>
      React.createElement(View, { testID, onPress }),
    HeaderActionButton: ({
      onPress,
      testID,
      children,
      label,
    }: {
      onPress?: () => void;
      testID?: string;
      children?: React.ReactNode;
      label?: string;
    }) => React.createElement(View, { testID, onPress }, children ?? label ?? null),
    ScreenHeader: ({
      title,
      showBackButton,
      onBackPress,
      backButtonTestID,
      rightElement,
    }: {
      title?: string;
      showBackButton?: boolean;
      onBackPress?: () => void;
      backButtonTestID?: string;
      rightElement?: React.ReactNode;
    }) =>
      React.createElement(
        View,
        null,
        showBackButton
          ? React.createElement(TouchableOpacity, {
              onPress: onBackPress,
              testID: backButtonTestID ?? 'nav-back-button',
            })
          : null,
        title ? React.createElement(Text, null, title) : null,
        rightElement ?? null
      ),
  };
});

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, navigate: jest.fn() }),
}));

jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid' }));

const mockListAccounts = jest.fn();
const mockGetRoom = jest.fn();
const mockCreateAccount = jest.fn();
const mockUpdateAccount = jest.fn();
const mockDeleteAccount = jest.fn();
const mockAddTransaction = jest.fn();
const mockApplyRegularContribution = jest.fn();

jest.mock('@api/savings', () => ({
  savingsApi: {
    listAccounts: (...args: unknown[]) => mockListAccounts(...args),
    getRoom: (...args: unknown[]) => mockGetRoom(...args),
    createAccount: (...args: unknown[]) => mockCreateAccount(...args),
    updateAccount: (...args: unknown[]) => mockUpdateAccount(...args),
    deleteAccount: (...args: unknown[]) => mockDeleteAccount(...args),
    addTransaction: (...args: unknown[]) => mockAddTransaction(...args),
    applyRegularContribution: (...args: unknown[]) => mockApplyRegularContribution(...args),
  },
}));

const mockMarkDirty = jest.fn();

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: () => ({
    currentHousehold: { id: 'hh-test' },
    currentHouseholdMembers: [{ id: 'm1', user_id: 'u1', display_name: 'Andrei' }],
  }),
}));

jest.mock('@stores/savingsStore', () => ({
  useSavingsStore: () => ({
    selectedYear: 2026,
    dataRevision: 0,
    markDirty: mockMarkDirty,
  }),
}));

// The account add/edit save flows through useUnsavedChanges, which surfaces a
// failed save via showToast('error', …) (not Alert.alert). Mock it so the
// save-failure assertion can observe the error toast. Delete / log-contribution
// / apply-regular still use Alert.alert directly.
jest.mock('@services/toastManager', () => ({ showToast: jest.fn() }));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import { showToast } from '@services/toastManager';

import { SavingsRegistered } from '../SavingsRegistered';

// --- Fixtures -------------------------------------------------------------

const RRSP_ACCOUNT = {
  id: 'acc-1',
  household_id: 'hh-test',
  account_type: 'rrsp' as const,
  // member_id is the membership id (HouseholdMember.id), the backend's canonical key.
  member_id: 'm1',
  institution: 'Bank',
  balance_cents: 500000,
  starting_room_cents: 1000000,
  annual_limit_override_cents: null,
  regular_contribution_cents: 20000,
  prior_earned_income_cents: null,
  pension_adjustment_cents: null,
  created_at: '',
  updated_at: '',
};

function roomFor(warnings: string[] = []) {
  return {
    accountId: 'acc-1',
    accountType: 'rrsp',
    year: 2026,
    roomRemaining: 800000,
    annualLimit: 3381000,
    used: 200000,
    usedByKind: { regular: 120000, manual: 80000 },
    warnings,
  };
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <SavingsRegistered />
      </ThemeProvider>
    );
  });
  return tree;
}

/** Collect every string child rendered anywhere in the tree. */
function allText(root: ReactTestRenderer.ReactTestInstance): string {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const inst = node as ReactTestRenderer.ReactTestInstance;
    if (inst && inst.children) walk(inst.children as unknown);
  };
  walk(root.children as unknown);
  return out.join(' ');
}

/** Auto-press the first non-cancel button of any Alert (confirm dialogs). */
function autoConfirmAlerts() {
  return jest
    .spyOn(Alert, 'alert')
    .mockImplementation((_title, _msg, buttons?: unknown) => {
      const list = (buttons as { text?: string; style?: string; onPress?: () => void }[]) ?? [];
      const confirm = list.find((b) => b.style !== 'cancel' && b.text !== 'Cancel');
      confirm?.onPress?.();
    });
}

describe('SavingsRegistered', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListAccounts.mockResolvedValue({ accounts: [RRSP_ACCOUNT] });
    mockGetRoom.mockResolvedValue(roomFor());
    mockCreateAccount.mockResolvedValue({});
    mockUpdateAccount.mockResolvedValue({});
    mockDeleteAccount.mockResolvedValue({});
    mockAddTransaction.mockResolvedValue({});
    mockApplyRegularContribution.mockResolvedValue({});
  });

  it('loads accounts + room and renders BE-computed room figures (no local math)', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    // Both API calls fired with household + selected year.
    expect(mockListAccounts).toHaveBeenCalledWith('hh-test');
    expect(mockGetRoom).toHaveBeenCalledWith('hh-test', 'acc-1', 2026);

    // The account card rendered.
    expect(root.findAllByProps({ testID: 'savings-account-card' }).length).toBeGreaterThan(0);

    // BE room figures render: $8,000 remaining, $2,000 used of $33,810, and the
    // regular / manual split ($1,200 / $800). These come straight from getRoom.
    const text = allText(root);
    expect(text).toContain('$8,000'); // roomRemaining 800000 -> $8,000 left
    expect(text).toContain('$2,000'); // used 200000 -> $2,000 used
    expect(text).toContain('Regular'); // usedByKind split label
    expect(text).toContain('Manual');
    expect(text).toContain('$1,200'); // regular 120000 -> $1,200
    expect(text).toContain('$800'); // manual 80000 -> $800

    // No over-contribution badge when warnings are empty.
    expect(root.findAllByProps({ testID: 'savings-over-contribution-badge' }).length).toBe(0);
  });

  it('shows the over-contribution warning badge when getRoom returns the warning', async () => {
    mockGetRoom.mockResolvedValue(roomFor(['ROOM_OVER_CONTRIBUTION']));

    const tree = await renderScreen();
    const root = tree.root;

    expect(
      root.findAllByProps({ testID: 'savings-over-contribution-badge' }).length
    ).toBeGreaterThan(0);
    expect(allText(root)).toContain('Over contribution room');
  });

  it('adds a new account with a client id, cents payload, and marks data dirty', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    // Open the add form.
    await act(async () => {
      root.findByProps({ testID: 'savings-registered-add' }).props.onPress();
    });

    // Choose account type = RRSP so the NOA-room field renders.
    await act(async () => {
      root.findByProps({ testID: 'savings-account-type-rrsp' }).props.onPress();
    });

    // Enter the NOA / room field ($10,000) + regular contribution ($200).
    await act(async () => {
      root.findByProps({ testID: 'savings-rrsp-noa-room' }).props.onChangeText('10000');
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-regular-contribution' }).props.onChangeText('200');
    });

    // Save.
    await act(async () => {
      await root.findByProps({ testID: 'savings-account-submit' }).props.onPress();
    });

    expect(mockCreateAccount).toHaveBeenCalledTimes(1);
    const [hid, payload] = mockCreateAccount.mock.calls[0];
    expect(hid).toBe('hh-test');
    // Dollars -> integer cents (*100). Client-generated id from expo-crypto.
    expect(payload).toMatchObject({
      id: 'test-uuid',
      account_type: 'rrsp',
      starting_room_cents: 1000000,
      regular_contribution_cents: 20000,
    });
    expect(mockMarkDirty).toHaveBeenCalled();
  });

  it('logs a contribution with amount + kind + type and marks dirty', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    // Open the log-contribution modal for the account.
    await act(async () => {
      root.findByProps({ testID: 'savings-account-log' }).props.onPress();
    });

    // Set amount, kind = regular, type = contribution.
    await act(async () => {
      root.findByProps({ testID: 'savings-log-amount' }).props.onChangeText('150');
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-log-kind-regular' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-log-type-contribution' }).props.onPress();
    });

    // Submit.
    await act(async () => {
      await root.findByProps({ testID: 'savings-log-submit' }).props.onPress();
    });

    expect(mockAddTransaction).toHaveBeenCalledTimes(1);
    const [hid, accId, payload] = mockAddTransaction.mock.calls[0];
    expect(hid).toBe('hh-test');
    expect(accId).toBe('acc-1');
    expect(payload).toMatchObject({
      id: 'test-uuid',
      type: 'contribution',
      kind: 'regular',
      amount_cents: 15000, // $150 -> 15000 cents
    });
    expect(typeof payload.transaction_date).toBe('string');
    expect(mockMarkDirty).toHaveBeenCalled();
  });

  it('applies this month’s regular contribution and marks dirty', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    const applyBtn = root.findByProps({ testID: 'savings-account-apply-regular' });
    await act(async () => {
      await applyBtn.props.onPress();
    });

    expect(mockApplyRegularContribution).toHaveBeenCalledTimes(1);
    const [hid, accId, payload] = mockApplyRegularContribution.mock.calls[0];
    expect(hid).toBe('hh-test');
    expect(accId).toBe('acc-1');
    expect(payload).toMatchObject({ year: 2026 });
    // Month is the current calendar month (1-12), computed on the client.
    expect(payload.month).toBeGreaterThanOrEqual(1);
    expect(payload.month).toBeLessThanOrEqual(12);
    expect(mockMarkDirty).toHaveBeenCalled();
  });

  it('disables the account submit button while a save is in flight (double-tap guard)', async () => {
    // Hold the first createAccount pending so the button stays disabled.
    let resolveCreate!: () => void;
    mockCreateAccount.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCreate = resolve;
        })
    );

    const tree = await renderScreen();
    const root = tree.root;

    await act(async () => {
      root.findByProps({ testID: 'savings-registered-add' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-tfsa-room' }).props.onChangeText('5000');
    });

    const submit = () => root.findByProps({ testID: 'savings-account-submit' });

    // Before submit the button is enabled.
    expect(submit().props.disabled).toBe(false);

    // First press starts the (pending) save.
    await act(async () => {
      submit().props.onPress();
    });

    // While in flight the button is disabled + loading — the UI guard that
    // prevents a second create from being dispatched.
    expect(submit().props.disabled).toBe(true);
    expect(submit().props.loading).toBe(true);
    expect(mockCreateAccount).toHaveBeenCalledTimes(1);

    // Let the in-flight save settle.
    await act(async () => {
      resolveCreate();
    });
  });

  it('confirms before deleting and calls deleteAccount + markDirty', async () => {
    const alertSpy = autoConfirmAlerts();
    // Seed the account into the form (edit) path via the edit control.
    const tree = await renderScreen();
    const root = tree.root;

    await act(async () => {
      root.findByProps({ testID: 'savings-account-edit' }).props.onPress();
    });

    // In edit mode a "Delete account" ghost button renders.
    const deleteBtn = root.findByProps({ title: 'Delete account' });
    await act(async () => {
      await deleteBtn.props.onPress();
    });

    expect(alertSpy).toHaveBeenCalled(); // confirm dialog shown (never silent)
    expect(mockDeleteAccount).toHaveBeenCalledWith('hh-test', 'acc-1');
    expect(mockMarkDirty).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('goes back from the header back button', async () => {
    const tree = await renderScreen();
    await act(async () => {
      tree.root.findByProps({ testID: 'savings-registered-back' }).props.onPress();
    });
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('still renders when getRoom fails for an account (room omitted)', async () => {
    mockGetRoom.mockRejectedValue(new Error('room boom'));
    const tree = await renderScreen();
    // Card still renders; room figures fall back to $0.
    expect(tree.root.findAllByProps({ testID: 'savings-account-card' }).length).toBeGreaterThan(0);
  });

  it('still renders (empty) when listing accounts fails', async () => {
    mockListAccounts.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();
    expect(allText(tree.root)).toContain('No registered accounts yet');
  });

  it('edits an existing account through updateAccount', async () => {
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-account-edit' }).props.onPress();
    });
    // Prefilled edit form → tweak the NOA room and save.
    await act(async () => {
      root.findByProps({ testID: 'savings-rrsp-noa-room' }).props.onChangeText('12000');
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-account-submit' }).props.onPress();
    });
    expect(mockUpdateAccount).toHaveBeenCalledTimes(1);
    const [hid, id, payload] = mockUpdateAccount.mock.calls[0];
    expect(hid).toBe('hh-test');
    expect(id).toBe('acc-1');
    expect(payload.starting_room_cents).toBe(1200000);
    expect(mockMarkDirty).toHaveBeenCalled();
  });

  it('surfaces an error toast when saving an account fails (form stays open)', async () => {
    mockCreateAccount.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => root.findByProps({ testID: 'savings-registered-add' }).props.onPress());
    await act(async () => root.findByProps({ testID: 'savings-tfsa-room' }).props.onChangeText('5000'));
    await act(async () => {
      await root.findByProps({ testID: 'savings-account-submit' }).props.onPress();
    });
    // The account save runs through useUnsavedChanges, which reports a failed
    // save via showToast('error', …) — the failure is never swallowed.
    expect(mockCreateAccount).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('error', expect.stringContaining('save'));
    // On failure the hook does not close the modal — the form remains mounted so
    // the user can retry (the account was not silently created/dismissed).
    expect(root.findAllByProps({ testID: 'savings-account-submit' }).length).toBeGreaterThan(0);
  });

  it('alerts when deleting an account fails', async () => {
    mockDeleteAccount.mockRejectedValue(new Error('boom'));
    const alertSpy = autoConfirmAlerts();
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => root.findByProps({ testID: 'savings-account-edit' }).props.onPress());
    await act(async () => {
      await root.findByProps({ title: 'Delete account' }).props.onPress();
    });
    expect(mockDeleteAccount).toHaveBeenCalled();
    expect(
      alertSpy.mock.calls.some((c) => c[0] === 'Error' && String(c[1]).includes('delete'))
    ).toBe(true);
    alertSpy.mockRestore();
  });

  it('blocks logging a contribution with no amount', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => root.findByProps({ testID: 'savings-account-log' }).props.onPress());
    await act(async () => {
      await root.findByProps({ testID: 'savings-log-submit' }).props.onPress();
    });
    expect(alertSpy).toHaveBeenCalledWith('Missing amount', expect.any(String));
    expect(mockAddTransaction).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('alerts when logging a contribution fails', async () => {
    mockAddTransaction.mockRejectedValue(new Error('boom'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => root.findByProps({ testID: 'savings-account-log' }).props.onPress());
    await act(async () => root.findByProps({ testID: 'savings-log-amount' }).props.onChangeText('50'));
    await act(async () => {
      await root.findByProps({ testID: 'savings-log-submit' }).props.onPress();
    });
    expect(alertSpy).toHaveBeenCalledWith('Error', expect.stringContaining('log'));
    alertSpy.mockRestore();
  });

  it('alerts when applying the regular contribution fails', async () => {
    mockApplyRegularContribution.mockRejectedValue(new Error('boom'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await renderScreen();
    await act(async () => {
      await tree.root.findByProps({ testID: 'savings-account-apply-regular' }).props.onPress();
    });
    expect(alertSpy).toHaveBeenCalledWith('Error', expect.stringContaining('regular'));
    alertSpy.mockRestore();
  });

  it('selects an account owner and reveals the RRSP advanced fields', async () => {
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => root.findByProps({ testID: 'savings-registered-add' }).props.onPress());
    // Owner chip for member m1 (membership id).
    await act(async () => root.findByProps({ testID: 'savings-account-member-m1' }).props.onPress());
    // RRSP → advanced toggle reveals prior income + pension fields.
    await act(async () => root.findByProps({ testID: 'savings-account-type-rrsp' }).props.onPress());
    await act(async () =>
      root.findByProps({ testID: 'savings-rrsp-advanced-toggle' }).props.onPress()
    );
    expect(allText(root)).toContain('Prior year earned income ($)');
    // The CRA-limit prefill shortcut fills the annual-limit override.
    await act(async () => root.findByProps({ testID: 'savings-rrsp-prefill-limit' }).props.onPress());
    expect(root.findByProps({ testID: 'savings-rrsp-annual-limit' }).props.value).toBe('33810');
  });

  it('renders the TFSA and FHSA type-specific fields', async () => {
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => root.findByProps({ testID: 'savings-registered-add' }).props.onPress());
    // Default type is TFSA → room + annual-limit fields.
    expect(root.findAllByProps({ testID: 'savings-tfsa-room' }).length).toBeGreaterThan(0);
    expect(root.findAllByProps({ testID: 'savings-tfsa-annual-limit' }).length).toBeGreaterThan(0);
    // Switch to FHSA → balance field.
    await act(async () => root.findByProps({ testID: 'savings-account-type-fhsa' }).props.onPress());
    expect(root.findAllByProps({ testID: 'savings-fhsa-balance' }).length).toBeGreaterThan(0);
  });

  it('edits every field for each account type via onChangeText', async () => {
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => root.findByProps({ testID: 'savings-registered-add' }).props.onPress());

    // Institution — searchable brand picker (open → search → pick a preset).
    await act(async () =>
      root.findByProps({ testID: 'institution-picker-field' }).props.onPress()
    );
    await act(async () =>
      root.findByProps({ testID: 'institution-picker-search' }).props.onChangeText('wealth')
    );
    await act(async () =>
      root.findByProps({ testID: 'institution-picker-option-Wealthsimple' }).props.onPress()
    );

    // TFSA fields.
    await act(async () => root.findByProps({ testID: 'savings-tfsa-room' }).props.onChangeText('7000'));
    await act(async () =>
      root.findByProps({ testID: 'savings-tfsa-annual-limit' }).props.onChangeText('7000')
    );

    // FHSA balance.
    await act(async () => root.findByProps({ testID: 'savings-account-type-fhsa' }).props.onPress());
    await act(async () =>
      root.findByProps({ testID: 'savings-fhsa-balance' }).props.onChangeText('4000')
    );

    // RRSP advanced fields.
    await act(async () => root.findByProps({ testID: 'savings-account-type-rrsp' }).props.onPress());
    await act(async () =>
      root.findByProps({ testID: 'savings-rrsp-advanced-toggle' }).props.onPress()
    );
    await act(async () =>
      root.findByProps({ label: 'Prior year earned income ($)' }).props.onChangeText('90000')
    );
    await act(async () =>
      root.findByProps({ label: 'Pension adjustment ($)' }).props.onChangeText('1200')
    );
    await act(async () =>
      root.findByProps({ testID: 'savings-rrsp-annual-limit' }).props.onChangeText('33000')
    );
    // Regular contribution (shared).
    await act(async () =>
      root.findByProps({ testID: 'savings-regular-contribution' }).props.onChangeText('300')
    );

    await act(async () => {
      await root.findByProps({ testID: 'savings-account-submit' }).props.onPress();
    });
    const payload = mockCreateAccount.mock.calls[0][1];
    expect(payload).toMatchObject({
      annual_limit_override_cents: 3300000,
      prior_earned_income_cents: 9000000,
      pension_adjustment_cents: 120000,
      regular_contribution_cents: 30000,
    });
  });

  it('ignores close requests while a save is in flight', async () => {
    let resolveCreate!: () => void;
    mockCreateAccount.mockImplementation(
      () => new Promise<void>((resolve) => (resolveCreate = resolve))
    );
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => root.findByProps({ testID: 'savings-registered-add' }).props.onPress());
    await act(async () => root.findByProps({ testID: 'savings-tfsa-room' }).props.onChangeText('5000'));
    await act(async () => {
      root.findByProps({ testID: 'savings-account-submit' }).props.onPress();
    });
    // Attempting to cancel while saving is a no-op (guarded) — form stays mounted.
    await act(async () => {
      root.findAllByProps({ accessibilityLabel: 'Close' })[0].props.onPress();
    });
    expect(root.findAllByProps({ testID: 'savings-account-submit' }).length).toBeGreaterThan(0);
    await act(async () => resolveCreate());
  });

  it('closes the account form and the log modal via their backdrops', async () => {
    const tree = await renderScreen();
    const root = tree.root;
    // Open + close the account form.
    await act(async () => root.findByProps({ testID: 'savings-registered-add' }).props.onPress());
    await act(async () => {
      root.findAllByProps({ accessibilityLabel: 'Close' })[0].props.onPress();
    });
    // Open + close the log modal.
    await act(async () => root.findByProps({ testID: 'savings-account-log' }).props.onPress());
    await act(async () => {
      root.findAllByProps({ accessibilityLabel: 'Close' })[0].props.onPress();
    });
    expect(mockCreateAccount).not.toHaveBeenCalled();
    expect(mockAddTransaction).not.toHaveBeenCalled();
  });

  it('ignores close requests while a contribution log is in flight', async () => {
    let resolveTx!: () => void;
    mockAddTransaction.mockImplementation(
      () => new Promise<void>((resolve) => (resolveTx = resolve))
    );
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => root.findByProps({ testID: 'savings-account-log' }).props.onPress());
    await act(async () => root.findByProps({ testID: 'savings-log-amount' }).props.onChangeText('50'));
    await act(async () => {
      root.findByProps({ testID: 'savings-log-submit' }).props.onPress();
    });
    await act(async () => {
      root.findAllByProps({ accessibilityLabel: 'Close' })[0].props.onPress();
    });
    expect(root.findAllByProps({ testID: 'savings-log-submit' }).length).toBeGreaterThan(0);
    await act(async () => resolveTx());
  });
});
