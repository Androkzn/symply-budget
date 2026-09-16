/**
 * The address gate must not wall an INVITEE out of the app.
 *
 * Accepting an invite adopts a placeholder household — every address field null,
 * session `awaitingKeys` — and makes it active. The gate reads only
 * `country`/`state_province`, so without this rule it fires on that placeholder
 * and raises `CreateHouseholdScreen` full-screen, with no back button, asking a
 * member for the address of a home they do not own and cannot know. The address
 * is not missing; it replays in as ops once the owner approves the device.
 *
 * `useHouseRecoveryGate` does NOT cover this: it only suppresses the gate when
 * every property awaits enrolment, and joining always adds a pending property
 * beside an open one. That is the case asserted first below.
 */
import { isHouseAddressCaptureEligible } from '../addressCaptureEligibility';

jest.mock('../engine', () => ({
  isLocalHouseSessionOpen: jest.fn(),
  listLocalHouseProperties: jest.fn(),
}));

const { isLocalHouseSessionOpen, listLocalHouseProperties } =
  jest.requireMock('../engine');

type Property = {
  householdId: string;
  role: string;
  awaitingEnrolment: boolean;
};

function withProperties(properties: Property[]): void {
  (isLocalHouseSessionOpen as jest.Mock).mockReturnValue(true);
  (listLocalHouseProperties as jest.Mock).mockReturnValue(
    properties.map((p) => ({
      householdId: p.householdId,
      deviceId: 'device-1',
      name: 'Home',
      role: p.role,
      isActive: true,
      hydrated: true,
      awaitingEnrolment: p.awaitingEnrolment,
    }))
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('isHouseAddressCaptureEligible', () => {
  it('refuses the gate on a joined home still awaiting the owner approval', () => {
    // The reported case: the invitee accepted, holds a placeholder beside their
    // own minted home, so the recovery gate is `open` and does not save them.
    withProperties([
      { householdId: 'mine', role: 'owner', awaitingEnrolment: false },
      { householdId: 'joined', role: 'member', awaitingEnrolment: true },
    ]);

    expect(isHouseAddressCaptureEligible('joined')).toBe(false);
  });

  it('still refuses once enrolment completes while the member is not an owner', () => {
    // A member is never the right person to ask: if the home genuinely has no
    // region, the gate belongs on the OWNER's device.
    withProperties([{ householdId: 'joined', role: 'member', awaitingEnrolment: false }]);

    expect(isHouseAddressCaptureEligible('joined')).toBe(false);
  });

  it('allows the gate on a home this device owns', () => {
    // The case the gate was built for — a locally minted, address-less home.
    withProperties([{ householdId: 'mine', role: 'owner', awaitingEnrolment: false }]);

    expect(isHouseAddressCaptureEligible('mine')).toBe(true);
  });

  it('allows the gate again once an invitee is promoted to owner', () => {
    withProperties([{ householdId: 'joined', role: 'OWNER', awaitingEnrolment: false }]);

    expect(isHouseAddressCaptureEligible('joined')).toBe(true);
  });

  it('fails open when there is no local session — the server-backed path', () => {
    (isLocalHouseSessionOpen as jest.Mock).mockReturnValue(false);

    expect(isHouseAddressCaptureEligible('anything')).toBe(true);
    expect(listLocalHouseProperties).not.toHaveBeenCalled();
  });

  it('fails open for a household the engine does not hold', () => {
    withProperties([{ householdId: 'mine', role: 'owner', awaitingEnrolment: false }]);

    expect(isHouseAddressCaptureEligible('unknown')).toBe(true);
  });

  it('fails open with no household id', () => {
    withProperties([{ householdId: 'mine', role: 'owner', awaitingEnrolment: false }]);

    expect(isHouseAddressCaptureEligible(null)).toBe(true);
    expect(isHouseAddressCaptureEligible(undefined)).toBe(true);
  });
});
