/**
 * HealthOtherDeviceScreen — second-device enrolment for the personal ledger
 * (plan §6, He5).
 *
 * Renders the REAL screen against a mocked `apiClient` and a mocked engine, so
 * `controlPlaneClient` itself is exercised rather than stubbed: the `/v2` URLs,
 * the `X-Health-Local-First` header, the `simplehealth://` link scheme and the
 * 403 → `HealthSecondUserRefusedError` translation are all the real code paths.
 *
 * What is asserted here is the part that has no other guard:
 *
 *  - every state renders (off → opening → set up → claimable → pending →
 *    awaiting approval → refused), because the two-device Maestro suite drives
 *    each of them by testID and a missing panel fails there on a booted
 *    simulator after a full build;
 *  - the copy is `HEALTH_ENROLMENT_COPY` VERBATIM, and split into the exact
 *    elements the flows assert on — Maestro matches an element's whole text, so
 *    where a sentence break falls is a contract, not a layout choice;
 *  - no member / invite / partner / household vocabulary in ANY state. Health is
 *    one user with N devices (plan §1.2); the local-first stack was ported from
 *    Budget and House where "invite a member" is correct copy, and this is what
 *    stops it coming back with the next port;
 *  - approval sends the INDEX of the phrase tapped, and hands the household key
 *    over afterwards. A screen that always sent 0 would still look like it
 *    worked, and one that skipped the handover would approve a device that can
 *    never read an op;
 *  - REVOKE goes through `revokeHealthLocalFirstDeviceAndRotateKey`, is
 *    confirmed first, and reports partial key delivery as its own state. The
 *    rotation itself is `hdkRotation.*.test.ts`'s subject and is mocked here —
 *    what has no other guard is that a caller exists at all, that it cannot be
 *    fired without a confirmation, and that a peer still owed the new key is not
 *    reported as "done".
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import { forgetInviteSecret, rememberInviteSecret } from '@services/enrolment/inviteSecretStore';
import { deriveEnrolmentSas, formatEnrolmentSas } from '@symply/local-first';

import { HEALTH_ENROLMENT_COPY } from '../../local/controlPlaneClient';
import { HealthOtherDeviceScreen } from '../HealthOtherDeviceScreen';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), push: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    // The title is real text, not an accessibility label: `td-02` asserts
    // 'Add your other device' as a visible string.
    ScreenHeader: ({ title }: { title?: string }) =>
      ReactMock.createElement(Text, { testID: 'screen-header' }, title ?? ''),
    ScreenScrollEnd: ({ testID }: { testID?: string }) => ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

jest.mock('expo-clipboard', () => ({
  __esModule: true,
  setStringAsync: jest.fn(async () => true),
}));

jest.mock('@stores/authStore', () => ({
  __esModule: true,
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { id: 'user-1' } }),
}));

let mockLocalFirst = true;
jest.mock('../../local/flag', () => ({
  __esModule: true,
  isHealthLocalFirst: () => mockLocalFirst,
  isHealthP2PEnabled: () => false,
}));

// The engine is a seam: this screen owns WHICH state it shows for a given
// session, not how a ledger is opened or rebound (`engine.test.ts` owns that).
jest.mock('../../local/engine', () => {
  const state = {
    sessionOpen: true,
    awaiting: false,
    ledger: { deviceId: 'dev-self', household: { id: 'hh-1' } } as Record<string, unknown>,
  };
  return {
    __esModule: true,
    __state: state,
    getLocalHealthLedger: () => state.ledger,
    isLocalHealthSessionOpen: () => state.sessionOpen,
    isAwaitingHealthEnrolment: () => state.awaiting,
    subscribeToHealthLedgerChanges: () => () => {},
    getLocalHealthIdentity: () => ({
      deviceId: 'dev-self',
      signingPublicKey: new Uint8Array([1, 2, 3]),
      agreementPublicKey: new Uint8Array([4, 5, 6]),
    }),
    resetLocalHealthSession: jest.fn(async () => {}),
    // Passing a householdId is the JOIN path, and joining is exactly what puts
    // this device into `awaitingKeys` (engine.ts `mintPersonalHousehold`).
    openLocalHealthSession: jest.fn(async (input: { householdId?: string }) => {
      state.awaiting = Boolean(input?.householdId);
      if (input?.householdId) state.ledger.household = { id: input.householdId };
      return state.ledger;
    }),
  };
});

jest.mock('@api/client', () => ({
  __esModule: true,
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

jest.mock('../../local/sync/hdkTransfer', () => ({
  __esModule: true,
  depositHealthHdkForDevice: jest.fn(async () => {}),
}));

jest.mock('../../local/sync/orchestrator', () => ({
  __esModule: true,
  runHealthLocalSync: jest.fn(async () => {}),
}));

// The rotation is a seam: `hdkRotation.revoke.test.ts` /
// `hdkRotation.delivery.test.ts` own what it does to the key ring and the
// mailbox. This file owns whether the screen calls it, with what, and what it
// then tells the user.
jest.mock('../../local/sync/hdkRotation', () => ({
  __esModule: true,
  revokeHealthLocalFirstDeviceAndRotateKey: jest.fn(),
}));

const { apiClient } = require('@api/client') as {
  apiClient: { get: jest.Mock; post: jest.Mock; delete: jest.Mock };
};
const { __state: engine } = require('../../local/engine') as {
  __state: { sessionOpen: boolean; awaiting: boolean; ledger: Record<string, unknown> };
};
const { depositHealthHdkForDevice } = require('../../local/sync/hdkTransfer') as {
  depositHealthHdkForDevice: jest.Mock;
};
const { runHealthLocalSync } = require('../../local/sync/orchestrator') as {
  runHealthLocalSync: jest.Mock;
};
const { revokeHealthLocalFirstDeviceAndRotateKey } = require('../../local/sync/hdkRotation') as {
  revokeHealthLocalFirstDeviceAndRotateKey: jest.Mock;
};

/* ------------------------------------------------------------------ */
/* Tree helpers — host nodes only, so a composite and the view it       */
/* renders do not each contribute the same sentence twice.              */
/* ------------------------------------------------------------------ */

type Tree = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

function byTestId(tree: Tree, id: string): Instance[] {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

function hasTestId(tree: Tree, id: string): boolean {
  return byTestId(tree, id).length > 0;
}

function instanceText(inst: Instance): string {
  return inst
    .findAll((n) => typeof n.type === 'string')
    .flatMap((n) => {
      const c = n.props?.children;
      return Array.isArray(c) ? c : [c];
    })
    .filter((c) => typeof c === 'string' || typeof c === 'number')
    .map(String)
    .join('');
}

function textOf(tree: Tree, id: string): string {
  const nodes = byTestId(tree, id);
  return nodes.length > 0 ? instanceText(nodes[0]!) : '';
}

function allText(tree: Tree): string {
  return instanceText(tree.root);
}

/**
 * Every distinct string rendered on a HOST text node.
 *
 * This is the granularity Maestro matches at: it compares an element's whole
 * text against the pattern, so an assertion on one sentence can only pass if
 * that sentence is somebody's entire text.
 */
function renderedStrings(tree: Tree): string[] {
  const out = new Set<string>();
  for (const node of tree.root.findAll((n) => typeof n.type === 'string')) {
    const children = node.props?.children;
    const list = Array.isArray(children) ? children : [children];
    const joined = list
      .filter((c) => typeof c === 'string' || typeof c === 'number')
      .map(String)
      .join('');
    if (joined) out.add(joined);
  }
  return [...out];
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function control(tree: Tree, id: string): Instance {
  const match = tree.root.findAll(
    (n) => n.props?.testID === id && typeof n.props?.onPress === 'function',
  )[0];
  if (!match) throw new Error(`No element with testID "${id}" and an onPress handler`);
  return match;
}

async function press(tree: Tree, id: string): Promise<void> {
  await act(async () => {
    control(tree, id).props.onPress();
    await flush();
  });
}

/** Title of a `GradientButton` by testID — the button's own label prop. */
function buttonTitle(tree: Tree, id: string): string | undefined {
  const match = tree.root.findAll(
    (n) => n.props?.testID === id && typeof n.props?.title === 'string',
  )[0];
  return match?.props.title as string | undefined;
}

/** The axios envelope `toUserFacingError` / the 403 translation read. */
function axiosError(status: number, code: string, message: string): unknown {
  return { response: { status, data: { error: { code, message } } } };
}

/* ------------------------------------------------------------------ */

const EXPIRES = new Date(Date.now() + 3600 * 1000).toISOString();

const CREATED = {
  inviteId: 'inv_1',
  shortCode: 'AB12CD',
  secret: 'sekret-value-0123456789',
  expiresAt: EXPIRES,
  qrPayload: 'symply-budget://lf-invite?id=inv_1&secret=sekret-value-0123456789&code=AB12CD',
};

/** The claiming device's real keys, as the pending endpoint reports them. */
const PEER_SIGNING_KEY = 'aa'.repeat(32);
const PEER_AGREEMENT_KEY = 'bb'.repeat(32);

const CLAIMED = {
  inviteId: 'inv_1',
  shortCode: 'AB12CD',
  role: 'OWNER',
  expiresAt: EXPIRES,
  claimedByUserId: 'user-1',
  claimedByEmail: null,
  claimedByDisplayName: null,
  claimedDeviceId: 'dev-peer',
  claimedDeviceLabel: 'iPad',
  claimedSigningPublicKey: PEER_SIGNING_KEY,
  claimedAgreementPublicKey: PEER_AGREEMENT_KEY,
};

/**
 * The digits the screen must show — derived with the same function the screen
 * uses, so this pins the WIRING (right keys, right secret) rather than
 * restating a hash the derivation's own test already owns.
 */
function expectedSas() {
  return deriveEnrolmentSas({
    inviteId: CREATED.inviteId,
    inviteSecret: CREATED.secret,
    signingPublicKeyHex: PEER_SIGNING_KEY,
    agreementPublicKeyHex: PEER_AGREEMENT_KEY,
  });
}

/**
 * The roster the control plane reports. `dev-self` is the device the mocked
 * engine says this is, so the screen has to mark it and must not offer to remove
 * it; `dev-peer-9f3c2a` is the one it may.
 */
const SELF_DEVICE = {
  deviceId: 'dev-self',
  userId: 'user-1',
  signingPublicKey: 'aa00',
  agreementPublicKey: 'bb00',
  status: 'active',
};
const PEER_DEVICE = {
  deviceId: 'dev-peer-9f3c2a',
  userId: 'user-1',
  signingPublicKey: 'cc00',
  agreementPublicKey: 'dd00',
  status: 'active',
};

function stateResponse(invites: unknown[], devices: unknown[] = [SELF_DEVICE, PEER_DEVICE]) {
  return {
    data: {
      state: {
        householdId: 'hh-1',
        keyEpoch: 1,
        securityRevision: 1,
        members: [{ userId: 'user-1', role: 'OWNER', status: 'active' }],
        devices,
        invites,
      },
    },
  };
}

function getRouter(invites: unknown[] = [], devices?: unknown[]) {
  return (url: string) => {
    if (url.includes('/invites/lookup')) {
      return Promise.resolve({
        data: {
          invite: {
            inviteId: 'inv_1',
            householdId: 'hh-peer',
            status: 'active',
            expiresAt: EXPIRES,
          },
        },
      });
    }
    // The screen now reads the roster and the pending queue from two different
    // routes: coordinator state cannot carry the claimant's keys or label.
    if (url.includes('/invites/pending')) {
      return Promise.resolve({ data: { pending: invites } });
    }
    return Promise.resolve(stateResponse([], devices));
  };
}

/** The rotation's own return shape (`HealthKeyRotation`), post-revoke. */
function rotationResult(overrides: {
  delivered?: string[];
  undelivered?: string[];
  devices?: unknown[];
}) {
  return {
    state: stateResponse([], overrides.devices ?? [SELF_DEVICE, { ...PEER_DEVICE, status: 'revoked' }])
      .data.state,
    rotated: true,
    keyEpoch: 2,
    delivered: overrides.delivered ?? [],
    undelivered: overrides.undelivered ?? [],
  };
}

async function renderScreen(): Promise<Tree> {
  let tree!: Tree;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthOtherDeviceScreen />
      </ThemeProvider>,
    );
    await flush();
  });
  return tree;
}

let trees: Tree[] = [];
async function render(): Promise<Tree> {
  const tree = await renderScreen();
  trees.push(tree);
  return tree;
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockLocalFirst = true;
  mockParams = {};
  engine.sessionOpen = true;
  engine.awaiting = false;
  engine.ledger = { deviceId: 'dev-self', household: { id: 'hh-1' } };
  apiClient.get.mockImplementation(getRouter());
  apiClient.post.mockResolvedValue({ data: { invite: CREATED } });
  // The secret store is MMKV-backed and survives between tests in a file, so it
  // is cleared here: whether a test can derive the digits must be something the
  // test states, not something it inherits from whichever test ran before it.
  await forgetInviteSecret(CREATED.inviteId);
  revokeHealthLocalFirstDeviceAndRotateKey.mockResolvedValue(rotationResult({}));
});

afterEach(() => {
  // The screen polls the control plane while it is mounted; leaving trees
  // mounted would leak an interval into the next file.
  act(() => {
    trees.forEach((t) => t.unmount());
  });
  trees = [];
});

/* ------------------------------------------------------------------ */

describe('HealthOtherDeviceScreen — gating', () => {
  it('says the build has nothing to pair rather than showing a dead button', async () => {
    mockLocalFirst = false;
    const tree = await render();

    expect(hasTestId(tree, 'health-other-device-screen')).toBe(true);
    expect(hasTestId(tree, 'health-other-device-create')).toBe(false);
    expect(hasTestId(tree, 'health-other-device-enrolled')).toBe(false);
    expect(textOf(tree, 'health-other-device-gate-notice')).toContain('Device sync is off');
    // Nothing is asked of the control plane when there is no ledger to ask about.
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('says the ledger is still opening, in the shared Health voice', async () => {
    engine.sessionOpen = false;
    const tree = await render();

    expect(hasTestId(tree, 'health-other-device-create')).toBe(false);
    // `toUserFacingError(HealthLocalNotReadyError)` — the same sentence the rest
    // of Health shows while the session is still hydrating, not a local one.
    expect(textOf(tree, 'health-other-device-gate-notice')).toContain(
      'Still opening your health data',
    );
    expect(apiClient.get).not.toHaveBeenCalled();
  });
});

describe('HealthOtherDeviceScreen — the settled state', () => {
  it('renders the title and body copy split into the sentences the flows assert', async () => {
    const tree = await render();
    const strings = renderedStrings(tree);

    // `td-02` asserts each of these as a whole element's text.
    expect(strings).toContain('Add your other device');
    expect(strings).toContain('Scan this code on your other device to keep both in sync.');
    // …and the second half of the same constant is its own element, so neither
    // assertion can be satisfied by a paragraph that merely contains it.
    expect(strings).toContain('Your health data stays encrypted on your devices.');
    expect(HEALTH_ENROLMENT_COPY.body).toBe(
      'Scan this code on your other device to keep both in sync. Your health data stays encrypted on your devices.',
    );
  });

  it('shows this device as set up, with the create affordance', async () => {
    const tree = await render();

    expect(hasTestId(tree, 'health-other-device-enrolled')).toBe(true);
    expect(hasTestId(tree, 'health-other-device-pending')).toBe(false);
    expect(hasTestId(tree, 'health-other-device-create')).toBe(true);
    expect(hasTestId(tree, 'health-other-device-code')).toBe(false);
    expect(hasTestId(tree, 'health-other-device-claim')).toBe(false);
  });
});

describe('HealthOtherDeviceScreen — minting a code', () => {
  it('emits the E2E marker, and shows the link and code', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const tree = await render();

    await press(tree, 'health-other-device-create');

    expect(apiClient.post).toHaveBeenCalledWith(
      '/v2/households/hh-1/invites',
      { role: 'OWNER' },
      expect.objectContaining({ headers: { 'X-Health-Local-First': '1' } }),
    );

    // The two-device runner scrapes this line off the Metro log. No digits here:
    // they do not exist until the other device claims, and the runner reads them
    // off both screens — which is exactly what a person does.
    const marker = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes('[E2E-INVITE]'));
    expect(marker).toBe('[E2E-INVITE] code=AB12CD secret=sekret-value-0123456789');

    expect(hasTestId(tree, 'health-other-device-code')).toBe(true);
    // `td-02` asserts the scan CTA verbatim once the code panel is up.
    expect(renderedStrings(tree)).toContain('Scan on your other device');
    expect(textOf(tree, 'health-other-device-code-short')).toBe('AB12CD');
    expect(textOf(tree, 'health-other-device-code-expiry')).toContain('Expires in');
    // Built by the REAL `buildHealthEnrolmentLink`, so this pins the brand
    // scheme — the Worker's own payload says `symply-budget://` and is ignored.
    const link = textOf(tree, 'health-other-device-code-link');
    expect(link.startsWith('simplehealth://lf-invite?')).toBe(true);
    expect(link).toContain('code=AB12CD');
    expect(allText(tree)).not.toContain('symply-budget://');

    log.mockRestore();
  });

  it('renders the server sentence, never a raw error, when minting fails', async () => {
    apiClient.post.mockRejectedValueOnce(axiosError(503, 'unavailable', 'Try again shortly.'));
    const tree = await render();

    await press(tree, 'health-other-device-create');

    expect(textOf(tree, 'health-other-device-create-error')).toContain('Try again shortly.');
    expect(hasTestId(tree, 'health-other-device-code')).toBe(false);
  });

  it('falls back to offline copy when the failure carries nothing readable', async () => {
    apiClient.post.mockRejectedValueOnce(new Error('Network Error'));
    const tree = await render();

    await press(tree, 'health-other-device-create');

    const shown = textOf(tree, 'health-other-device-create-error');
    expect(shown).toContain('needs a connection');
    expect(shown).not.toContain('Network Error');
  });
});

describe('HealthOtherDeviceScreen — claiming on the second device', () => {
  it('offers the claim only once a usable code AND secret have arrived', async () => {
    const bare = await render();
    expect(hasTestId(bare, 'health-other-device-claim')).toBe(false);

    mockParams = { id: 'inv_1', code: 'AB12CD', secret: 'sekret-value-0123456789' };
    const tree = await render();

    expect(hasTestId(tree, 'health-other-device-claim')).toBe(true);
    expect(textOf(tree, 'health-other-device-claim-code')).toBe('AB12CD');
  });

  it('warns that this replaces the device before it does, then claims', async () => {
    mockParams = { id: 'inv_1', code: 'AB12CD', secret: 'sekret-value-0123456789' };
    const tree = await render();

    await press(tree, 'health-other-device-claim');

    // The confirm is an in-app panel, never an Alert: iOS renders
    // UIAlertController in its own window, invisible to an app-window snapshot.
    expect(hasTestId(tree, 'health-other-device-claim-confirm-panel')).toBe(true);
    expect(allText(tree)).toContain('This replaces what is on this device');
    // `td-03` taps `^(Continue|Replace|OK)$` — the label is part of the contract.
    expect(buttonTitle(tree, 'health-other-device-claim-confirm')).toBe('Continue');
    expect(apiClient.post).not.toHaveBeenCalled();

    await press(tree, 'health-other-device-claim-confirm');

    expect(apiClient.get).toHaveBeenCalledWith(
      '/v2/invites/lookup',
      expect.objectContaining({ params: { code: 'AB12CD' } }),
    );
    // Rebind BEFORE the claim: rebinding mints a fresh device identity, so
    // claiming first would register a key that no longer exists.
    expect(apiClient.post).toHaveBeenCalledWith(
      '/v2/households/hh-peer/invites/inv_1/claim',
      expect.objectContaining({ secret: 'sekret-value-0123456789' }),
      expect.objectContaining({ headers: { 'X-Health-Local-First': '1' } }),
    );
  });

  it('shows the paused-writes promise, whole, once the claim lands', async () => {
    mockParams = { id: 'inv_1', code: 'AB12CD', secret: 'sekret-value-0123456789' };
    const tree = await render();

    await press(tree, 'health-other-device-claim');
    await press(tree, 'health-other-device-claim-confirm');

    expect(hasTestId(tree, 'health-other-device-pending')).toBe(true);
    expect(hasTestId(tree, 'health-other-device-enrolled')).toBe(false);
    // ONE element, both sentences: `td-03` asserts the whole string, because
    // "changes are paused" is not a separable promise from "waiting".
    expect(renderedStrings(tree)).toContain(
      'Waiting for your other device to approve this one. Changes are paused until then.',
    );
    expect(HEALTH_ENROLMENT_COPY.pendingWrites).toBe(
      'Waiting for your other device to approve this one. Changes are paused until then.',
    );
  });

  it('settles into the enrolled state once the household key has landed', async () => {
    // What `td-05` polls for: approval is not enrolment, and the pending panel
    // is rendered for exactly as long as writes are parked.
    engine.awaiting = true;
    const pending = await render();
    expect(hasTestId(pending, 'health-other-device-pending')).toBe(true);
    expect(hasTestId(pending, 'health-other-device-enrolled')).toBe(false);

    engine.awaiting = false;
    const settled = await render();
    expect(hasTestId(settled, 'health-other-device-pending')).toBe(false);
    expect(hasTestId(settled, 'health-other-device-enrolled')).toBe(true);
  });

  it('refuses rather than replaces when this device already holds entries', async () => {
    engine.ledger = {
      deviceId: 'dev-self',
      household: { id: 'hh-1' },
      weightEntries: [{ id: 'w1' }],
    };
    mockParams = { id: 'inv_1', code: 'AB12CD', secret: 'sekret-value-0123456789' };
    const tree = await render();

    await press(tree, 'health-other-device-claim');
    await press(tree, 'health-other-device-claim-confirm');

    expect(textOf(tree, 'health-other-device-claim-error')).toContain(
      'already has Symply Health entries',
    );
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(hasTestId(tree, 'health-other-device-pending')).toBe(false);
  });
});

/**
 * Put the invite secret on this device, as minting a code would.
 *
 * Seeded rather than driven through the create button because these tests are
 * about the approval half: pressing create would also open the code panel and
 * put a second surface in every `allText` assertion below.
 */
async function seedInviteSecret() {
  await rememberInviteSecret({
    inviteId: CREATED.inviteId,
    secret: CREATED.secret,
    expiresAt: EXPIRES,
  });
}

describe('HealthOtherDeviceScreen — approving the other device', () => {
  it('shows the digits, approves with the verified keys, and hands the key over', async () => {
    await seedInviteSecret();
    apiClient.get.mockImplementation(getRouter([CLAIMED]));
    apiClient.post.mockResolvedValue({
      data: { approved: { userId: 'user-1', deviceId: 'dev-peer', agreementPublicKey: 'ff00' } },
    });
    const tree = await render();

    expect(hasTestId(tree, 'health-other-device-approvals')).toBe(true);
    const strings = renderedStrings(tree);
    // `td-04` asserts both of these verbatim.
    expect(strings).toContain('Approve your other device');
    expect(strings).toContain(
      'Check that the number matches the one shown on your other device, then approve it.',
    );
    // The digits, derived from the claiming device's keys and this device's
    // invite secret. A screen showing anything else is checking nothing.
    expect(textOf(tree, 'health-other-device-sas-inv_1')).toBe(formatEnrolmentSas(expectedSas()));

    await press(tree, 'health-other-device-approve-request');

    expect(apiClient.post).toHaveBeenCalledWith(
      '/v2/households/hh-1/invites/inv_1/approve',
      {
        confirmedSigningPublicKey: PEER_SIGNING_KEY,
        confirmedAgreementPublicKey: PEER_AGREEMENT_KEY,
      },
      expect.objectContaining({ headers: { 'X-Health-Local-First': '1' } }),
    );
    // THE assertion the whole change exists for: the household key is wrapped to
    // the key the person VERIFIED, not to the `ff00` the approve response just
    // handed back. Wrapping to the response would let the control plane show an
    // honest key during the comparison and substitute its own straight after.
    expect(depositHealthHdkForDevice).toHaveBeenCalledWith({
      recipientDeviceId: 'dev-peer',
      recipientAgreementPublicKeyHex: PEER_AGREEMENT_KEY,
    });
    // Approved claims leave the queue — `td-04` waits for the panel to go.
    expect(hasTestId(tree, 'health-other-device-approvals')).toBe(false);
    expect(textOf(tree, 'health-other-device-approve-note')).toContain('Approved');
  });

  it('keeps the claim in the queue when the claim changed under the owner', async () => {
    await seedInviteSecret();
    apiClient.get.mockImplementation(getRouter([CLAIMED]));
    apiClient.post.mockRejectedValueOnce(
      axiosError(409, 'claim_changed', 'That request changed — check the number again.'),
    );
    const tree = await render();

    await press(tree, 'health-other-device-approve-request');

    expect(apiClient.post).toHaveBeenCalledWith(
      '/v2/households/hh-1/invites/inv_1/approve',
      {
        confirmedSigningPublicKey: PEER_SIGNING_KEY,
        confirmedAgreementPublicKey: PEER_AGREEMENT_KEY,
      },
      expect.anything(),
    );
    // A changed claim is retryable, not terminal — and it is NOT the
    // single-account refusal, which the error translation must not confuse it for.
    expect(hasTestId(tree, 'health-other-device-approvals')).toBe(true);
    expect(hasTestId(tree, 'health-other-device-refused')).toBe(false);
    expect(textOf(tree, 'health-other-device-approve-error')).toBeTruthy();
    expect(depositHealthHdkForDevice).not.toHaveBeenCalled();
  });
});

describe('HealthOtherDeviceScreen — a second ACCOUNT is refused', () => {
  it('renders the single-account copy, never the error message with its phase', async () => {
    await seedInviteSecret();
    apiClient.get.mockImplementation(getRouter([CLAIMED]));
    apiClient.post.mockRejectedValueOnce(
      axiosError(403, 'personal_household_single_user', 'forbidden'),
    );
    const tree = await render();

    await press(tree, 'health-other-device-approve-request');

    expect(hasTestId(tree, 'health-other-device-refused')).toBe(true);
    // `td-04` asserts the ABSENCE of exactly this sentence after a legitimate
    // approval, so it has to be its own element when it is shown at all.
    expect(renderedStrings(tree)).toContain('Symply Health keeps your data to a single account.');
    expect(renderedStrings(tree)).toContain('Only your own devices can be added.');
    expect(HEALTH_ENROLMENT_COPY.refused).toBe(
      'Symply Health keeps your data to a single account. Only your own devices can be added.',
    );
    // `HealthSecondUserRefusedError.message` carries the phase — `… (approve)` —
    // and this screen never puts an identifier in front of anyone.
    expect(allText(tree)).not.toContain('(approve)');
  });

  it('is absent on the happy path', async () => {
    await seedInviteSecret();
    apiClient.get.mockImplementation(getRouter([CLAIMED]));
    apiClient.post.mockResolvedValue({
      data: { approved: { userId: 'user-1', deviceId: 'dev-peer', agreementPublicKey: 'ff00' } },
    });
    const tree = await render();

    await press(tree, 'health-other-device-approve-request');

    expect(hasTestId(tree, 'health-other-device-refused')).toBe(false);
    expect(allText(tree)).not.toContain('Symply Health keeps your data to a single account.');
  });
});

/* ------------------------------------------------------------------ *
 * Removing a device. Until this landed,                                *
 * `revokeHealthLocalFirstDeviceAndRotateKey` had no caller anywhere in  *
 * the app: a lost phone kept a working key and there was no surface     *
 * that could take it away.                                             *
 * ------------------------------------------------------------------ */

const REVOKE_PEER = 'health-other-device-revoke-dev-peer-9f3c2a';

describe('HealthOtherDeviceScreen — the device roster', () => {
  it('marks this device, and offers removal only for the others', async () => {
    const tree = await render();

    expect(hasTestId(tree, 'health-other-device-devices')).toBe(true);
    // The one row that must never be mistaken: the device in your hand.
    expect(textOf(tree, 'health-other-device-this-device')).toBe('This device');
    expect(textOf(tree, 'health-other-device-name-dev-peer-9f3c2a')).toBe('Device 9f3c2a');

    expect(hasTestId(tree, REVOKE_PEER)).toBe(true);
    // Revoking THIS device would mint a key only it holds and then deposit it
    // from an identity the relay has just stopped trusting — `hdkRotation`
    // declines to rotate for it, so the screen must not offer the button.
    expect(hasTestId(tree, 'health-other-device-revoke-dev-self')).toBe(false);
    expect(hasTestId(tree, 'health-other-device-devices-empty')).toBe(false);
  });

  it('says so plainly when this is the only device set up', async () => {
    apiClient.get.mockImplementation(getRouter([], [SELF_DEVICE]));
    const tree = await render();

    expect(textOf(tree, 'health-other-device-devices-empty')).toBe(
      'This is the only device set up so far.',
    );
    expect(hasTestId(tree, 'health-other-device-this-device')).toBe(true);
    expect(hasTestId(tree, REVOKE_PEER)).toBe(false);
  });

  it('is absent while this device is itself still waiting for the key', async () => {
    // A device that does not hold the current household key cannot mint the
    // next one or hand it to anybody, so the whole panel is withheld rather
    // than shown with a button that would fail.
    engine.awaiting = true;
    const tree = await render();

    expect(hasTestId(tree, 'health-other-device-pending')).toBe(true);
    expect(hasTestId(tree, 'health-other-device-devices')).toBe(false);
    expect(hasTestId(tree, REVOKE_PEER)).toBe(false);
  });

  it('explains the failure only when it has no list to fall back on', async () => {
    apiClient.get.mockRejectedValue(axiosError(503, 'unavailable', 'Try again shortly.'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const tree = await render();

    // Nothing to show, so silence would read as "you have no other devices".
    expect(textOf(tree, 'health-other-device-devices-error')).toContain('Try again shortly.');
    expect(hasTestId(tree, 'health-other-device-devices-empty')).toBe(false);

    warn.mockRestore();
  });
});

describe('HealthOtherDeviceScreen — revoking a device', () => {
  it('confirms first, and says what removal actually does', async () => {
    const tree = await render();

    await press(tree, REVOKE_PEER);

    // The confirm is an in-app panel, never an Alert: iOS renders
    // UIAlertController in its own window, invisible to an app-window snapshot.
    expect(hasTestId(tree, 'health-other-device-revoke-panel')).toBe(true);
    const strings = renderedStrings(tree);
    expect(strings).toContain('Remove this device?');
    // The two things that actually happen to it, in one sentence, before any
    // mention of keys.
    expect(strings).toContain(
      'It stops getting anything you log from now on, and it leaves sync straight away.',
    );
    expect(allText(tree)).toContain('locked with a new key that it never receives');
    expect(buttonTitle(tree, 'health-other-device-revoke-confirm')).toBe('Remove and lock it out');
    expect(buttonTitle(tree, 'health-other-device-revoke-cancel')).toBe('Keep this device');

    // Nothing has been revoked by opening the confirmation.
    expect(revokeHealthLocalFirstDeviceAndRotateKey).not.toHaveBeenCalled();
  });

  it('leaves the device alone when the confirmation is declined', async () => {
    const tree = await render();

    await press(tree, REVOKE_PEER);
    await press(tree, 'health-other-device-revoke-cancel');

    expect(hasTestId(tree, 'health-other-device-revoke-panel')).toBe(false);
    expect(revokeHealthLocalFirstDeviceAndRotateKey).not.toHaveBeenCalled();
    expect(hasTestId(tree, REVOKE_PEER)).toBe(true);
  });

  it('rotates the key away from the device it was told to remove', async () => {
    const tree = await render();

    await press(tree, REVOKE_PEER);
    await press(tree, 'health-other-device-revoke-confirm');

    // The ROTATING call, not the bare DELETE: `revokeHealthLocalFirstDevice`
    // alone leaves the removed device holding a key that opens everything
    // written afterwards.
    expect(revokeHealthLocalFirstDeviceAndRotateKey).toHaveBeenCalledTimes(1);
    expect(revokeHealthLocalFirstDeviceAndRotateKey).toHaveBeenCalledWith('dev-peer-9f3c2a');
    // Repainted from the DELETE's own post-revoke state, not from the next poll.
    expect(textOf(tree, 'health-other-device-row-dev-peer-9f3c2a')).toContain('Removed');
    expect(hasTestId(tree, REVOKE_PEER)).toBe(false);
    expect(hasTestId(tree, 'health-other-device-revoke-panel')).toBe(false);
  });

  it('reports the settled outcome when every remaining device has the new key', async () => {
    revokeHealthLocalFirstDeviceAndRotateKey.mockResolvedValue(
      rotationResult({ delivered: ['dev-tablet'], undelivered: [] }),
    );
    const tree = await render();

    await press(tree, REVOKE_PEER);
    await press(tree, 'health-other-device-revoke-confirm');

    expect(hasTestId(tree, 'health-other-device-revoke-note')).toBe(true);
    expect(hasTestId(tree, 'health-other-device-revoke-partial')).toBe(false);
    const strings = renderedStrings(tree);
    expect(strings).toContain('That device can no longer read anything you log from now on.');
    expect(strings).toContain('Your other device already has the new key.');
    // Nothing is owed, so there is nothing to chase.
    expect(runHealthLocalSync).not.toHaveBeenCalled();
  });

  it('does not report a flat success while a device is still owed the key', async () => {
    revokeHealthLocalFirstDeviceAndRotateKey.mockResolvedValue(
      rotationResult({ delivered: ['dev-tablet'], undelivered: ['dev-watch'] }),
    );
    const tree = await render();

    await press(tree, REVOKE_PEER);
    await press(tree, 'health-other-device-revoke-confirm');

    // Its own state, not the success one — this is the half of the flow that is
    // still outstanding, and a shared "Done" would hide it.
    expect(hasTestId(tree, 'health-other-device-revoke-partial')).toBe(true);
    expect(hasTestId(tree, 'health-other-device-revoke-note')).toBe(false);

    const strings = renderedStrings(tree);
    // The removed device is locked out either way; that half is not in doubt.
    expect(strings).toContain('That device can no longer read anything you log from now on.');
    expect(strings).toContain('One of your other devices has not picked the new key up yet.');
    // …and no alarm: recovery is `redeliverHealthHouseholdKey()` on the next
    // sync, which needs nothing from the person reading this.
    expect(strings).toContain(
      'It catches up on its own the next time it syncs, and nothing is lost in the meantime.',
    );
    expect(allText(tree)).not.toContain('Your other devices already have the new key.');
    // And that next sync is kicked now rather than waited for.
    expect(runHealthLocalSync).toHaveBeenCalled();
  });

  it('counts the devices still owed the key rather than saying "one"', async () => {
    revokeHealthLocalFirstDeviceAndRotateKey.mockResolvedValue(
      rotationResult({ delivered: [], undelivered: ['dev-watch', 'dev-tablet'] }),
    );
    const tree = await render();

    await press(tree, REVOKE_PEER);
    await press(tree, 'health-other-device-revoke-confirm');

    expect(renderedStrings(tree)).toContain(
      '2 of your other devices have not picked the new key up yet.',
    );
  });

  it('never claims success when the revoke itself fails', async () => {
    revokeHealthLocalFirstDeviceAndRotateKey.mockRejectedValue(
      axiosError(503, 'unavailable', 'Try again shortly.'),
    );
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const tree = await render();

    await press(tree, REVOKE_PEER);
    await press(tree, 'health-other-device-revoke-confirm');

    expect(textOf(tree, 'health-other-device-revoke-error')).toContain('Try again shortly.');
    expect(hasTestId(tree, 'health-other-device-revoke-note')).toBe(false);
    expect(hasTestId(tree, 'health-other-device-revoke-partial')).toBe(false);
    // Nothing was removed, so this is a retry and not a dead end: the
    // confirmation stays up and the device is still listed as in sync.
    expect(hasTestId(tree, 'health-other-device-revoke-panel')).toBe(true);
    expect(allText(tree)).not.toContain('Removed —');

    warn.mockRestore();
  });

  it('falls back to Health voice when the failure carries nothing readable', async () => {
    revokeHealthLocalFirstDeviceAndRotateKey.mockRejectedValue(new Error('Network Error'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const tree = await render();

    await press(tree, REVOKE_PEER);
    await press(tree, 'health-other-device-revoke-confirm');

    const shown = textOf(tree, 'health-other-device-revoke-error');
    expect(shown).toContain('needs a connection');
    expect(shown).not.toContain('Network Error');

    warn.mockRestore();
  });
});

/* ------------------------------------------------------------------ *
 * The product assertion. A Health household is one user with N devices
 * (plan §1.2) — there is nobody to invite, and on a health record an
 * offer to share is a promise the app cannot keep.
 * ------------------------------------------------------------------ */

describe('HealthOtherDeviceScreen — single-user voice', () => {
  /** The patterns `td-02` / `td-40` assert the absence of, plus the vocabulary. */
  const FORBIDDEN = [
    /invite (a )?(member|partner|someone)/i,
    /household member/i,
    /add member/i,
    /join household/i,
    /\bpartner\b/i,
    /\bhousehold\b/i,
    /\bmembers?\b/i,
    /someone else/i,
  ];

  async function textInEveryState(): Promise<string> {
    const chunks: string[] = [];

    // Off, and still opening.
    mockLocalFirst = false;
    chunks.push(allText(await render()));
    mockLocalFirst = true;
    engine.sessionOpen = false;
    chunks.push(allText(await render()));
    engine.sessionOpen = true;

    // Set up, with a code minted and a claim waiting to be approved. The secret
    // is seeded BEFORE the render because the digits are derived on the poll:
    // minting after mount would leave this pass's queue underived until the next
    // tick, and this test wants the approval surface in its text sweep.
    await seedInviteSecret();
    apiClient.get.mockImplementation(getRouter([CLAIMED]));
    const owner = await render();
    await press(owner, 'health-other-device-create');
    chunks.push(allText(owner));

    // Refused.
    apiClient.post.mockRejectedValueOnce(
      axiosError(403, 'personal_household_single_user', 'forbidden'),
    );
    await press(owner, 'health-other-device-approve-request');
    chunks.push(allText(owner));

    // The roster, its confirmation, and both revoke outcomes. This is the
    // newest surface and therefore the likeliest to arrive with House's
    // vocabulary attached — House's own equivalent says "invite", "member" and
    // "this home" in four places.
    const roster = await render();
    chunks.push(allText(roster));
    await press(roster, REVOKE_PEER);
    chunks.push(allText(roster));
    await press(roster, 'health-other-device-revoke-confirm');
    chunks.push(allText(roster));

    revokeHealthLocalFirstDeviceAndRotateKey.mockResolvedValue(
      rotationResult({ delivered: ['dev-tablet'], undelivered: ['dev-watch'] }),
    );
    const partial = await render();
    await press(partial, REVOKE_PEER);
    await press(partial, 'health-other-device-revoke-confirm');
    chunks.push(allText(partial));

    revokeHealthLocalFirstDeviceAndRotateKey.mockRejectedValue(new Error('Network Error'));
    const failed = await render();
    await press(failed, REVOKE_PEER);
    await press(failed, 'health-other-device-revoke-confirm');
    chunks.push(allText(failed));

    // Nothing to list, and unable to list.
    apiClient.get.mockImplementation(getRouter([], [SELF_DEVICE]));
    chunks.push(allText(await render()));
    apiClient.get.mockRejectedValue(new Error('Network Error'));
    chunks.push(allText(await render()));
    apiClient.get.mockImplementation(getRouter([CLAIMED]));

    // Claimable, mid-confirm, and pending.
    mockParams = { id: 'inv_1', code: 'AB12CD', secret: 'sekret-value-0123456789' };
    apiClient.post.mockResolvedValue({ data: {} });
    const joiner = await render();
    chunks.push(allText(joiner));
    await press(joiner, 'health-other-device-claim');
    chunks.push(allText(joiner));
    await press(joiner, 'health-other-device-claim-confirm');
    chunks.push(allText(joiner));

    return chunks.join('\n');
  }

  it('says nothing about members, partners or households in ANY state', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    // The sweep walks failure states on purpose, and each one warns.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const text = await textInEveryState();

    for (const pattern of FORBIDDEN) {
      expect([pattern.source, pattern.test(text)]).toEqual([pattern.source, false]);
    }
    // …and the positive counterpart: absence alone would also be satisfied by a
    // screen that says nothing at all (`td-02` asserts this side).
    expect(text).toContain('Add your other device');
    expect(text).toContain('your other device');
    // …and the roster really was part of the sweep, rather than the sweep
    // passing because it never reached the newest surface.
    expect(text).toContain('This device');
    expect(text).toContain('Remove this device?');

    log.mockRestore();
    warn.mockRestore();
  });
});
