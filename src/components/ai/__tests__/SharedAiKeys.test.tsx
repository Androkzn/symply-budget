/**
 * "Shared with you" — the block the provider picker leads with.
 *
 * What matters here is that Use is not just a consent checkbox: a member who has
 * been lent a key taps it and AI in this app has to actually run on that key.
 * So the tests assert both halves — the disclosure is recorded AND the device is
 * pointed at that provider.
 *
 * The other half of the contract is what happens when a member is lent ALL
 * THREE providers. There is no "set as default or just save?" prompt; the label
 * carries it. Accepting the second and third keys must NOT take over from the
 * first (or the last key tapped wins by accident) — those rows then offer
 * "Set default", and that tap is the one that switches. And with a key of the
 * member's own on the device, their own key is spent first
 * (`resolveLocalByokProvider`), so the preference must be left alone entirely.
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

type Share = {
  id: string;
  householdId: string;
  householdName: string;
  provider: 'anthropic' | 'openai' | 'gemini';
  ownerUserId: string;
  ownerName: string | null;
  keyHint: string;
  keyEpoch: number;
  envelopeVersion: string;
  createdAt: string;
  isMine: boolean;
  consented: boolean;
};

const ANN_SHARE = (over: Partial<Share> = {}): Share => ({
  id: 'share-1',
  householdId: 'hh-1',
  householdName: 'Sweet Home',
  provider: 'anthropic',
  ownerUserId: 'u-ann',
  ownerName: 'Ann',
  keyHint: 'PQAA',
  keyEpoch: 1,
  envelopeVersion: 'v1',
  createdAt: '2026-08-01T00:00:00.000Z',
  isMine: false,
  consented: false,
  ...over,
});

let mockHouseholds: Array<{ householdId: string; displayName: string }> = [];
let mockShares: Share[] = [];
const mockAccept = jest.fn().mockResolvedValue(undefined);
const mockForget = jest.fn();
jest.mock('@services/aiKeyShare', () => ({
  __esModule: true,
  acceptSharedAiKey: (...args: unknown[]) => mockAccept(...args),
  aiKeyShareErrorMessage: (_err: unknown, fallback: string) => fallback,
  forgetBorrowedAiKey: (...args: unknown[]) => mockForget(...args),
  householdCryptos: async () => mockHouseholds,
  listSharedAiKeys: async () => ({ shares: mockShares }),
}));

const mockHasKey = jest.fn(async () => false);
jest.mock('@services/aiKeyVault', () => ({
  __esModule: true,
  aiKeyVault: { hasKey: (...args: unknown[]) => mockHasKey(...(args as [])) },
}));

let mockPreferred: string | null = null;
const mockSetPreferred = jest.fn().mockResolvedValue(undefined);
jest.mock('@services/aiModelPreference', () => ({
  __esModule: true,
  getPreferredProvider: async () => mockPreferred,
  setPreferredProvider: (...args: unknown[]) => mockSetPreferred(...args),
}));

const mockToast = jest.fn();
jest.mock('@services/toastManager', () => ({
  __esModule: true,
  showToast: (...args: unknown[]) => mockToast(...args),
}));

import React from 'react';
import { Alert } from 'react-native';
import { act } from 'react-test-renderer';
import type { ReactTestRenderer, ReactTestInstance } from 'react-test-renderer';

import { renderOnDevice, treeText, pressables } from '../../../test-utils/deviceRender';
import { CONSENT_VERSION } from '../providerMeta';
import { SharedAiKeyOffers } from '../SharedAiKeys';

// The disclosure alert is the gate before a first use — auto-accept it so the
// tests exercise what happens after, and assert separately that it was asked.
const alertSpy = jest
  .spyOn(Alert, 'alert')
  .mockImplementation((_title, _message, buttons) => {
    const confirm = (buttons ?? []).find((b) => b.style !== 'cancel');
    confirm?.onPress?.();
  });

const byTestID = (r: ReactTestRenderer, id: string): ReactTestInstance | undefined =>
  r.root.findAll((n) => n.props?.testID === id)[0];

/** Render and flush the hook's household + share reads. */
async function renderOffers(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = renderOnDevice('iPhone 14 Pro', <SharedAiKeyOffers />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return r;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHouseholds = [{ householdId: 'hh-1', displayName: 'Sweet Home' }];
  mockShares = [ANN_SHARE()];
  mockPreferred = null;
  mockHasKey.mockResolvedValue(false);
});

describe('SharedAiKeyOffers', () => {
  it('leads with the key a member was lent, named by its owner and provider', async () => {
    const r = await renderOffers();
    const text = treeText(r);
    expect(text).toContain("Ann's Anthropic Claude key");
    expect(text).toContain('accept to use it');
    expect(byTestID(r, 'ai-shared-accept-anthropic')).toBeTruthy();
  });

  it('renders nothing at all when nobody has shared a key', async () => {
    mockShares = [];
    const r = await renderOffers();
    expect(r.toJSON()).toBeNull();
  });

  it('ignores the member’s own shares — this block is what OTHERS lent them', async () => {
    mockShares = [ANN_SHARE({ id: 'mine', isMine: true, ownerName: 'Me' })];
    const r = await renderOffers();
    expect(r.toJSON()).toBeNull();
  });

  it('Use records the disclosure and points this device at that provider', async () => {
    const r = await renderOffers();
    await act(async () => {
      byTestID(r, 'ai-shared-accept-anthropic')!.props.onPress();
    });

    expect(alertSpy).toHaveBeenCalled();
    expect(mockAccept).toHaveBeenCalledWith({
      householdId: 'hh-1',
      shareId: 'share-1',
      provider: 'anthropic',
      consentVersion: CONSENT_VERSION,
    });
    // The half that makes the button mean what it says: without this the tap
    // only recorded consent and the next scan still walked the fixed order.
    expect(mockSetPreferred).toHaveBeenCalledWith('anthropic');
    // Drops the "nobody is sharing anthropic" back-off so the next call sees it.
    expect(mockForget).toHaveBeenCalledWith('anthropic');
    expect(mockToast).toHaveBeenCalledWith('success', expect.stringContaining("Ann's Anthropic Claude key"));
  });

  it('offers Set default — not Use — for a key already accepted', async () => {
    mockShares = [ANN_SHARE({ consented: true })];
    const r = await renderOffers();
    expect(treeText(r)).toContain('Set default');

    await act(async () => {
      byTestID(r, 'ai-shared-default-anthropic')!.props.onPress();
    });

    // Already disclosed — switching must not re-ask a question they answered.
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockAccept).not.toHaveBeenCalled();
    expect(mockSetPreferred).toHaveBeenCalledWith('anthropic');
  });

  it('accepting a second lent key does not steal the default from the first', async () => {
    // A member lent all three accepts all three. If each acceptance took over,
    // whichever they tapped last would win by accident.
    mockShares = [
      ANN_SHARE({ consented: true }),
      ANN_SHARE({ id: 'share-2', provider: 'openai', ownerName: 'Bob', keyHint: '9Z2X' }),
    ];
    mockPreferred = 'anthropic';
    const r = await renderOffers();

    await act(async () => {
      byTestID(r, 'ai-shared-accept-openai')!.props.onPress();
    });

    expect(mockAccept).toHaveBeenCalledWith(expect.objectContaining({ provider: 'openai' }));
    expect(mockSetPreferred).not.toHaveBeenCalled();
    // Nothing visibly changed on the row, so the toast has to say what still
    // runs and where the switch lives.
    expect(mockToast).toHaveBeenCalledWith(
      'success',
      expect.stringContaining("Ann's Anthropic Claude key still runs AI"),
    );
  });

  it('Set default on the second key is the tap that switches', async () => {
    mockShares = [
      ANN_SHARE({ consented: true }),
      ANN_SHARE({
        id: 'share-2',
        provider: 'openai',
        ownerName: 'Bob',
        keyHint: '9Z2X',
        consented: true,
      }),
    ];
    mockPreferred = 'anthropic';
    const r = await renderOffers();

    await act(async () => {
      byTestID(r, 'ai-shared-default-openai')!.props.onPress();
    });

    expect(mockSetPreferred).toHaveBeenCalledWith('openai');
    expect(mockToast).toHaveBeenCalledWith(
      'success',
      expect.stringContaining("Bob's OpenAI key"),
    );
    // The one already running shows state, not a competing button.
    expect(byTestID(r, 'ai-shared-default-anthropic')).toBeUndefined();
  });

  it('leaves the member’s own default alone when they have a key of their own', async () => {
    // Own keys are spent before anyone else's, so writing the preference here
    // could not change which key runs — it would only stomp their own default.
    mockHasKey.mockResolvedValue(true);
    const r = await renderOffers();
    await act(async () => {
      byTestID(r, 'ai-shared-accept-anthropic')!.props.onPress();
    });

    expect(mockAccept).toHaveBeenCalled();
    expect(mockSetPreferred).not.toHaveBeenCalled();
  });

  it('says which key actually runs when the member has one of their own', async () => {
    // Otherwise "Ready to use" reads as a promise the billing rule does not keep.
    mockShares = [ANN_SHARE({ consented: true })];
    mockHasKey.mockResolvedValue(true);
    const r = await renderOffers();

    expect(treeText(r)).toContain('your own Anthropic Claude key is spent first');
    expect(byTestID(r, 'ai-shared-accept-anthropic')).toBeUndefined();
    expect(byTestID(r, 'ai-shared-default-anthropic')).toBeUndefined();
  });

  it('shows state, not a button, once the lent key is the one that runs', async () => {
    mockShares = [ANN_SHARE({ consented: true })];
    mockPreferred = 'anthropic';
    const r = await renderOffers();

    expect(treeText(r)).toContain('In use');
    expect(byTestID(r, 'ai-shared-accept-anthropic')).toBeUndefined();
    expect(pressables(r)).toHaveLength(0);
  });

  it('names the household when this device holds more than one', async () => {
    mockHouseholds = [
      { householdId: 'hh-1', displayName: 'Sweet Home' },
      { householdId: 'hh-2', displayName: 'Cabin' },
    ];
    const r = await renderOffers();
    expect(treeText(r)).toContain('Sweet Home · ');
  });
});
