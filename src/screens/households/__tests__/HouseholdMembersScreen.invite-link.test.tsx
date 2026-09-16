/**
 * HouseholdMembersScreen — "Invite via link" handler.
 *
 * The old handler wrapped link creation AND the share sheet in one try/catch
 * that always showed "Failed to create invite link" and logged nothing — so a
 * cancelled/failed share reported a fake creation failure, and a real creation
 * failure was undiagnosable. This suite locks in the hardened behavior:
 *   - creation failure  -> friendly (mapped) alert + captureException, no share
 *   - creation success + share failure -> NO error alert, share failure logged
 *   - happy path         -> share sheet gets the invite URL, no error alert
 *
 * Presentational leaves are stubbed; the member/household/auth stores and the
 * members hook are mocked so the owner-gated button renders and the handler's
 * dependencies can be driven. getApiErrorMessage runs for real so the
 * error-to-copy mapping is exercised end to end.
 */

type MockChildren = { children?: unknown };

jest.mock('@components/ui/Icon', () => ({ __esModule: true, Icon: () => null }));

jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: MockChildren) => React.createElement(View, null, children ?? null),
    SafeAreaView: ({ children }: MockChildren) => React.createElement(View, null, children ?? null),
    ScreenHeader: () => null,
    ScreenScrollEnd: () => null,
    screenScrollEndTestId: (id: string) => `${id}-end`,
    screenScrollViewStyle: { scroll: { flex: 1 } },
  };
});

jest.mock('@components/ui', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    Typography: ({ children }: MockChildren) => React.createElement(Text, null, children ?? null),
    EmptyState: () => null,
    SkeletonLoader: () => null,
  };
});

jest.mock('@components/household/InvitationsList', () => ({ __esModule: true, InvitationsList: () => null }));
jest.mock('@components/household/InviteBottomSheet', () => ({ __esModule: true, InviteBottomSheet: () => null }));
jest.mock('@components/household/JoinRequestsList', () => ({ __esModule: true, JoinRequestsList: () => null }));
jest.mock('@components/household/MemberCard', () => ({ __esModule: true, MemberCard: () => null }));

jest.mock('expo-router/react-navigation', () => ({
  __esModule: true,
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
}));

jest.mock('expo-haptics', () => ({
  __esModule: true,
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));

jest.mock('@brand', () => ({
  __esModule: true,
  brand: { displayName: 'Symply Budget' },
  isHouseBrand: () => false,
}));

jest.mock('@theme', () => ({
  __esModule: true,
  useAppColors: () => ({ primary: 'rgb(10,119,85)', textSecondary: 'rgb(136,136,136)' }),
}));

const OWNER = { user_id: 'u1', role: 'owner' };
jest.mock('@hooks/useHouseholdMembers', () => ({
  __esModule: true,
  useHouseholdMembers: () => ({ data: [OWNER], isLoading: false, refetch: jest.fn(), error: null }),
  useInvalidateHouseholdMembers: () => jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@stores/authStore', () => ({
  __esModule: true,
  useAuthStore: () => ({ user: { id: 'u1' } }),
}));

jest.mock('@stores/householdStore', () => ({
  __esModule: true,
  useHouseholdStore: () => ({ currentHousehold: { id: 'hh1', name: 'Sweet Home' }, households: [] }),
}));

const mockCreateInviteLink = jest.fn();
jest.mock('@stores/memberStore', () => ({
  __esModule: true,
  useMemberStore: () => ({
    pendingInvitations: [],
    joinRequests: [],
    isLoading: false,
    error: null,
    fetchJoinRequests: jest.fn().mockResolvedValue(undefined),
    createInviteLink: (...a: unknown[]) => mockCreateInviteLink(...a),
    approveJoinRequest: jest.fn(),
    denyJoinRequest: jest.fn(),
    refreshOwnerJoinRequests: jest.fn().mockResolvedValue(undefined),
    inviteMember: jest.fn(),
    resendInvitation: jest.fn(),
    revokeInvitation: jest.fn(),
    removeMember: jest.fn(),
    updateMemberRole: jest.fn(),
  }),
}));

const mockCapture = jest.fn();
jest.mock('@services/monitoring', () => ({
  __esModule: true,
  captureException: (...a: unknown[]) => mockCapture(...a),
}));

import { AxiosError } from 'axios';
import React from 'react';
import { Alert, Share } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { HouseholdMembersScreen } from '../HouseholdMembersScreen';

type ScreenProps = React.ComponentProps<typeof HouseholdMembersScreen>;
const route = { params: { householdId: 'hh1' } } as unknown as ScreenProps['route'];

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
  return out.join('');
}

async function pressInviteViaLink(root: ReactTestRenderer.ReactTestInstance) {
  const pressables = root.findAll(
    (n) => typeof (n.props as { onPress?: unknown })?.onPress === 'function'
  );
  const btn = pressables.find((n) => allText(n).includes('Invite via link'));
  if (!btn) throw new Error('"Invite via link" button not found (owner gating?)');
  await act(async () => {
    await (btn.props as { onPress: () => unknown }).onPress();
  });
}

function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      React.createElement(HouseholdMembersScreen, { route } as ScreenProps)
    );
  });
  return tree;
}

describe('HouseholdMembersScreen — Invite via link', () => {
  let alertSpy: jest.SpyInstance;
  let shareSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    shareSpy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' } as never);
  });

  afterEach(() => {
    alertSpy.mockRestore();
    shareSpy.mockRestore();
  });

  it('happy path: shares the created invite URL and shows no error alert', async () => {
    mockCreateInviteLink.mockResolvedValue('https://x.test/j/abc');
    const tree = render();

    await pressInviteViaLink(tree.root);

    expect(mockCreateInviteLink).toHaveBeenCalledWith('hh1');
    expect(shareSpy).toHaveBeenCalledTimes(1);
    expect((shareSpy.mock.calls[0][0] as { message: string }).message).toContain(
      'https://x.test/j/abc'
    );
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('creation failure: shows a friendly alert, logs the cause, never opens the share sheet', async () => {
    mockCreateInviteLink.mockRejectedValue(new Error('boom network'));
    const tree = render();

    await pressInviteViaLink(tree.root);

    expect(shareSpy).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Error', 'Failed to create invite link');
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture.mock.calls[0][1]).toMatchObject({
      source: 'household_members.create_invite_link',
      householdId: 'hh1',
    });
  });

  it('creation failure: surfaces the backend user-facing message when present', async () => {
    const axiosErr = new AxiosError('Request failed', 'ERR_BAD_REQUEST');
    // A user-facing forbidden error (owners-only gate) — mapped by getApiErrorMessage.
    axiosErr.response = {
      status: 403,
      data: { error: { code: 'forbidden', message: 'Only owners can invite members' } },
    } as never;
    mockCreateInviteLink.mockRejectedValue(axiosErr);
    const tree = render();

    await pressInviteViaLink(tree.root);

    expect(alertSpy).toHaveBeenCalledWith('Error', 'Only owners can invite members');
    expect(shareSpy).not.toHaveBeenCalled();
  });

  it('share failure after successful creation: no error alert, share failure is logged', async () => {
    mockCreateInviteLink.mockResolvedValue('https://x.test/j/abc');
    shareSpy.mockRejectedValue(new Error('share sheet blew up'));
    const tree = render();

    await pressInviteViaLink(tree.root);

    // The link WAS created — the user must not see a "failed to create" error.
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture.mock.calls[0][1]).toMatchObject({
      source: 'household_members.share_invite_link',
      householdId: 'hh1',
    });
  });
});
