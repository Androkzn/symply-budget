import { fetchControlPlaneState, type ControlPlaneState } from '../../controlPlaneClient';
import { getLocalBudgetSession, isHouseholdBootstrapPending } from '../../engine';
import { maybePublishCheckpoint } from '../checkpoints';
import { depositHdkForDevice } from '../hdkTransfer';
import { recoverExistingMemberDevices } from '../peerRecovery';

jest.mock('../../controlPlaneClient', () => ({ fetchControlPlaneState: jest.fn() }));
jest.mock('../../engine', () => ({ getLocalBudgetSession: jest.fn(), isHouseholdBootstrapPending: jest.fn() }));
jest.mock('../checkpoints', () => ({ maybePublishCheckpoint: jest.fn() }));
jest.mock('../hdkTransfer', () => ({ depositHdkForDevice: jest.fn() }));

const publicKey = 'ab'.repeat(32);
const state: ControlPlaneState = {
  householdId: 'household-b', keyEpoch: 12, securityRevision: 1,
  members: [{ userId: 'owner', role: 'owner', status: 'active' }, { userId: 'member', role: 'member', status: 'active' }],
  devices: [
    { deviceId: 'sender', userId: 'owner', status: 'active', signingPublicKey: publicKey, agreementPublicKey: publicKey },
    { deviceId: 'new-install', userId: 'member', lastSeenAt: new Date().toISOString(), status: 'active', signingPublicKey: publicKey, agreementPublicKey: publicKey },
  ],
};
let metadata: Map<string, string>;
let session: { identity: { deviceId: string }; householdKeys: { keyEpoch: number }; awaitingEnrolment: boolean; store: { getSyncPeerState: jest.Mock; getMeta: jest.Mock; setMeta: jest.Mock } };

beforeEach(() => {
  jest.clearAllMocks();
  metadata = new Map();
  jest.mocked(fetchControlPlaneState).mockImplementation(async () => structuredClone(state));
  session = {
    identity: { deviceId: 'sender' }, householdKeys: { keyEpoch: 12 }, awaitingEnrolment: false,
    store: {
      getSyncPeerState: jest.fn(async () => null),
      getMeta: jest.fn(async (key: string) => metadata.get(key) ?? null),
      setMeta: jest.fn(async (key: string, value: string) => { metadata.set(key, value); }),
    },
  };
  jest.mocked(getLocalBudgetSession).mockResolvedValue(session as unknown as Awaited<ReturnType<typeof getLocalBudgetSession>>);
  jest.mocked(isHouseholdBootstrapPending).mockResolvedValue(false);
  jest.mocked(maybePublishCheckpoint).mockResolvedValue(true);
  jest.mocked(depositHdkForDevice).mockResolvedValue(undefined);
});

it('publishes complete history before sending the key to an existing member’s fresh device', async () => {
  expect(await recoverExistingMemberDevices(state)).toBe(1);
  expect(maybePublishCheckpoint).toHaveBeenCalledWith('household-b', { force: true });
  expect(depositHdkForDevice).toHaveBeenCalledWith({ householdId: 'household-b', recipientDeviceId: 'new-install', recipientAgreementPublicKeyHex: publicKey });
  expect(jest.mocked(maybePublishCheckpoint).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(depositHdkForDevice).mock.invocationCallOrder[0]!);
  expect(await recoverExistingMemberDevices(state)).toBe(0);
});

it.each(['revoked-device', 'removed-member', 'unknown-member', 'revoked-sender', 'stale-key', 'awaiting-key', 'partial-history'])('does not share household keys for %s', async condition => {
  const input = structuredClone(state);
  if (condition === 'revoked-device') input.devices[1]!.status = 'revoked';
  if (condition === 'removed-member') input.members[1]!.status = 'removed';
  if (condition === 'unknown-member') input.devices[1]!.userId = 'stranger';
  if (condition === 'revoked-sender') input.devices[0]!.status = 'revoked';
  if (condition === 'stale-key') session.householdKeys.keyEpoch = 11;
  if (condition === 'awaiting-key') session.awaitingEnrolment = true;
  if (condition === 'partial-history') jest.mocked(isHouseholdBootstrapPending).mockResolvedValue(true);
  expect(await recoverExistingMemberDevices(input)).toBe(0);
  expect(depositHdkForDevice).not.toHaveBeenCalled();
});

it('retries a failed upload or delivery without falsely recording success', async () => {
  jest.mocked(maybePublishCheckpoint).mockRejectedValueOnce(new Error('offline'));
  await expect(recoverExistingMemberDevices(state)).rejects.toThrow('offline');
  expect(depositHdkForDevice).not.toHaveBeenCalled();
  jest.mocked(depositHdkForDevice).mockRejectedValueOnce(new Error('network'));
  expect(await recoverExistingMemberDevices(state)).toBe(0);
  expect(metadata.size).toBe(0);
  expect(await recoverExistingMemberDevices(state)).toBe(1);
});

it('resends for a changed recipient key or household epoch', async () => {
  expect(await recoverExistingMemberDevices(state)).toBe(1);
  const changed = structuredClone(state);
  changed.devices[1]!.agreementPublicKey = 'cd'.repeat(32);
  jest.mocked(fetchControlPlaneState).mockImplementation(async () => structuredClone(changed));
  expect(await recoverExistingMemberDevices(changed)).toBe(1);
  session.householdKeys.keyEpoch = changed.keyEpoch = 13;
  expect(await recoverExistingMemberDevices(changed)).toBe(1);
});


it('does not deliver a key after membership changes during snapshot upload', async () => {
  jest.mocked(fetchControlPlaneState).mockResolvedValue({ ...state, securityRevision: 2 });
  expect(await recoverExistingMemberDevices(state)).toBe(0);
  expect(depositHdkForDevice).not.toHaveBeenCalled();
});
