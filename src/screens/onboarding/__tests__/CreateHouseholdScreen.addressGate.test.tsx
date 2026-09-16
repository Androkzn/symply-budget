/**
 * The address-capture gate must FIX the home it is complaining about, never
 * make a second one.
 *
 * This screen has been the duplicate-home factory twice now, and both times the
 * fix closed the symptom rather than the hole:
 *
 *  1. The gate re-fired forever because Create Home was enabled on the name
 *    alone, so submitting never set the region the gate was waiting for. Fixed
 *    by making the region required — the member stopped looping.
 *  2. …but the screen still only knew how to CREATE. Satisfying the gate
 *    therefore minted a second household, one WITH an address, beside the
 *    address-less home the gate opened for. The loop stopped because
 *    `currentHousehold` became the new home; the original stayed broken and the
 *    member was one home richer each time.
 *
 * (2) is the same outcome `HouseRecoverHomeScreen` exists to prevent — its
 * header counts 17 empty homes on staging — reached by a different road. It was
 * found on a real device by restoring a backup: the member recovers their home,
 * the restored row carries no region, this form opens, and the only button on it
 * offers to create a home they already have.
 *
 * So the assertion that matters is not "the gate closes". It is **which api was
 * called**: `update` on the existing id, and `create` not at all. Everything
 * else here is the first-run path, asserted in the same file so a change that
 * fixes one by breaking the other cannot pass.
 */
 
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockGateOpen = false;
let mockCurrentHousehold: Record<string, unknown> | null = null;
const mockAddHousehold = jest.fn();
const mockSetCurrentHousehold = jest.fn();
const mockUpdateHouseholdInStore = jest.fn();

jest.mock('@navigation/RootNavigator', () => ({
  usePropertyAddressCaptureGate: () => mockGateOpen,
}));

jest.mock('@api/households', () => ({
  householdsApi: {
    create: (...args: unknown[]) => mockCreate(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

jest.mock('@api/user', () => ({
  userApi: { updateOnboardingStep: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('expo-router/react-navigation', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
}));

/**
 * The store is a zustand selector hook, so the mock has to honour the selector
 * rather than return a fixed object — every read in the screen is
 * `useHouseholdStore(state => state.thing)`.
 */
jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      currentHousehold: mockCurrentHousehold,
      addHousehold: mockAddHousehold,
      setCurrentHousehold: mockSetCurrentHousehold,
      updateHousehold: mockUpdateHouseholdInStore,
    }),
}));

// The Places autocomplete reaches the network and needs a key; neither is this
// suite's subject.
jest.mock('react-native-google-places-autocomplete', () => ({
  GooglePlacesAutocomplete: () => null,
}));

import { ThemeProvider } from '@contexts/ThemeContext';

import { CreateHouseholdScreen } from '../CreateHouseholdScreen';

const RESTORED_HOME = {
  id: 'hh_local_restored',
  name: 'My home',
  address_line1: null,
  city: null,
  state_province: null,
  postal_code: null,
  country: 'CA',
  unit_system: 'imperial',
};

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <CreateHouseholdScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

/** The submit button, found by the title it is currently wearing. */
function submitButton(tree: ReactTestRenderer.ReactTestRenderer, title: string) {
  return tree.root.findAll(
    (node) => node.props?.title === title && typeof node.props?.onPress === 'function',
  )[0];
}

function textOf(tree: ReactTestRenderer.ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGateOpen = false;
  mockCurrentHousehold = null;
  mockCreate.mockResolvedValue({ household: { id: 'hh_new', name: 'New' } });
  mockUpdate.mockResolvedValue({
    household: { ...RESTORED_HOME, state_province: 'BC', city: 'Vancouver' },
  });
});

describe('opened by the address gate over an existing home', () => {
  beforeEach(() => {
    mockGateOpen = true;
    mockCurrentHousehold = RESTORED_HOME;
  });

  it('prefills from the home it is fixing rather than opening blank', async () => {
    const tree = await render();
    // Retyping the name of a home you already have is the tell that the form is
    // about to make a different one.
    expect(textOf(tree)).toContain('My home');
  });

  it('is worded as an address capture, not as first-run setup', async () => {
    const tree = await render();
    const text = textOf(tree);
    expect(text).toContain('Add Your Address');
    expect(text).not.toContain('Set Up Your Home');
    // Naming the home is what tells the member which one is being fixed.
    expect(text).toContain('Add the address of My home');
    // The reason given must be the actual rule — you need a home set up — not
    // the assessment lookup, which is one feature downstream of the address.
    expect(text).not.toContain('assessment');
  });

  it('drops the onboarding step chrome', async () => {
    const tree = await render();
    // "Step 1 of 6" to someone who onboarded months ago reads as starting over,
    // which is exactly the impression this screen must stop giving.
    expect(textOf(tree)).not.toContain('Create Home');
  });

  it('UPDATES the existing home and never creates a second one', async () => {
    const tree = await render();
    const button = submitButton(tree, 'Save Address');
    expect(button).toBeDefined();

    await act(async () => {
      button!.props.onPress();
    });

    // The whole point of the file.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0]![0]).toBe('hh_local_restored');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('writes the saved home back into the store so the gate can close', async () => {
    const tree = await render();
    await act(async () => {
      submitButton(tree, 'Save Address')!.props.onPress();
    });

    // The gate is derived from `currentHousehold`, so a save that does not reach
    // the store leaves the member on this screen with their work applied and no
    // sign of it.
    expect(mockUpdateHouseholdInStore).toHaveBeenCalledWith(
      'hh_local_restored',
      expect.objectContaining({ state_province: 'BC' }),
    );
    expect(mockSetCurrentHousehold).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'hh_local_restored' }),
    );
  });

  it('does not push the member into the first-run wizard afterwards', async () => {
    const tree = await render();
    await act(async () => {
      submitButton(tree, 'Save Address')!.props.onPress();
    });
    // They finished onboarding long ago; SpaceSetup would restart it.
    expect(mockNavigate).not.toHaveBeenCalledWith('SpaceSetup');
    expect(mockAddHousehold).not.toHaveBeenCalled();
  });
});

describe('first-run onboarding is untouched', () => {
  it('still CREATES when no gate and no household', async () => {
    const tree = await render();
    const button = submitButton(tree, 'Create Home');
    expect(button).toBeDefined();

    // A brand-new account has to be able to name a home and go.
    const nameInput = tree.root.findAll(
      (node) => node.props?.label === 'Home Name' && typeof node.props?.onChangeText === 'function',
    )[0]!;
    await act(async () => {
      nameInput.props.onChangeText('Beach Property');
    });
    await act(async () => {
      submitButton(tree, 'Create Home')!.props.onPress();
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockAddHousehold).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('SpaceSetup');
  });

  it('keeps the first-run wording and step chrome', async () => {
    const tree = await render();
    const text = textOf(tree);
    expect(text).toContain('Set Up Your Home');
    expect(text).toContain('Add your home details to get started');
  });

  /**
   * The narrow race the `editingHousehold` guard exists for: the gate reports
   * open while the store has not settled. Creating is the safe answer — there is
   * no id to update — and it must not throw on `.id`.
   */
  it('falls back to create when the gate is open but no household is loaded', async () => {
    mockGateOpen = true;
    mockCurrentHousehold = null;
    const tree = await render();
    expect(submitButton(tree, 'Create Home')).toBeDefined();
    expect(textOf(tree)).toContain('Set Up Your Home');
  });
});

/**
 * The third road to a duplicate home, opened by the back button this wizard
 * now has.
 *
 * Every step from here on carries a back arrow, so "Set Up Your Home" is a
 * screen a first-run member can RETURN to — to fix a typo in the name, to add
 * the address they skipped, or just to look. The screen only ever knew how to
 * POST, and the gate branch above is guarded on the GATE, not on whether a home
 * exists. So a member who went back one step and pressed the button again got a
 * second home with the same name, from inside the very flow that was supposed
 * to give them their first one.
 *
 * The same fix covers the older version of the hazard, which needed no back
 * button at all: force-quitting mid-wizard restarts at Welcome with the home
 * still in the store, and walking through again created another.
 */
describe('walking back to this step mid-wizard', () => {
  beforeEach(() => {
    mockGateOpen = false;
    mockCurrentHousehold = { ...RESTORED_HOME, id: 'hh_created', name: 'Beach Property' };
    mockUpdate.mockResolvedValue({
      household: { ...RESTORED_HOME, id: 'hh_created', name: 'Beach House' },
    });
  });

  it('UPDATES the home the member already made instead of minting a second', async () => {
    const tree = await render();

    await act(async () => {
      submitButton(tree, 'Save & Continue')!.props.onPress();
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0]![0]).toBe('hh_created');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockAddHousehold).not.toHaveBeenCalled();
  });

  it('carries on into the wizard afterwards, unlike the gate path', async () => {
    const tree = await render();
    await act(async () => {
      submitButton(tree, 'Save & Continue')!.props.onPress();
    });
    // This member is still mid-onboarding — saving must not strand them on the
    // step they just finished.
    expect(mockNavigate).toHaveBeenCalledWith('SpaceSetup');
  });

  it('prefills what they already named, so the form is an edit and looks like one', async () => {
    const tree = await render();
    const text = textOf(tree);
    expect(text).toContain('Beach Property');
    // Still first-run wording: they have not finished onboarding.
    expect(text).toContain('Set Up Your Home');
  });

  it('pops one step back rather than re-navigating', async () => {
    const tree = await render();
    const back = tree.root.findAll(
      (node) =>
        node.props?.testID === 'onboarding-create-household-back' &&
        typeof node.props?.onPress === 'function',
    )[0];
    await act(async () => {
      back!.props.onPress();
    });
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('lets them go forward again without re-saving a form they did not change', async () => {
    const tree = await render();
    const forward = tree.root.findAll(
      (node) =>
        node.props?.testID === 'onboarding-create-household-forward' &&
        typeof node.props?.onPress === 'function',
    )[0];
    await act(async () => {
      forward!.props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('SpaceSetup');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('offers no forward chevron before a home exists — there is nothing to skip to', async () => {
    mockCurrentHousehold = null;
    const tree = await render();
    expect(
      tree.root.findAll(
        (node) => node.props?.testID === 'onboarding-create-household-forward',
      ),
    ).toHaveLength(0);
    // Back still works: Welcome and the notification step are behind this one.
    expect(
      tree.root.findAll(
        (node) => node.props?.testID === 'onboarding-create-household-back',
      ).length,
    ).toBeGreaterThan(0);
  });
});

/**
 * The second answer the gate has to have — and it is NOT a dismissal.
 *
 * The gate renders over the whole app with no back button, so it needs an exit
 * for the member who cannot supply an address. It used to be "Not now", which
 * hid the prompt for the session; that was the wrong promise, because holding at
 * least one home is what makes any of this app mean something. Dismissing let
 * the member into an app whose property surfaces were all shut, and the prompt
 * came back on the next cold start regardless.
 *
 * **Accept Invite** ends where the address ends: joining ADOPTS a home, which is
 * the same condition the gate is waiting on. So this suite asserts the exit
 * navigates to `HouseJoin` and — the half that used to be the whole point —
 * writes nothing on the way, because the member has not described a home here.
 */
describe('the Accept Invite exit', () => {
  beforeEach(() => {
    mockGateOpen = true;
    mockCurrentHousehold = RESTORED_HOME;
  });

  it('is offered when the gate opened this form', async () => {
    const tree = await render();
    expect(
      tree.root.findAll(
        (node) =>
          node.props?.testID === 'address-capture-accept-invite' &&
          typeof node.type === 'string',
      ),
    ).toHaveLength(1);
  });

  it('opens the join screen, without re-running onboarding', async () => {
    const tree = await render();
    const accept = tree.root.findAll(
      (node) =>
        node.props?.testID === 'address-capture-accept-invite' &&
        typeof node.props?.onPress === 'function',
    )[0]!;
    await act(async () => {
      accept.props.onPress();
    });
    // No `fromOnboarding`: this member finished onboarding long ago, and the
    // join alone is what closes the gate.
    expect(mockNavigate).toHaveBeenCalledWith('HouseJoin', {});
  });

  it('saves nothing — it is a different home, not this one', async () => {
    const tree = await render();
    await act(async () => {
      tree.root
        .findAll(
          (node) =>
            node.props?.testID === 'address-capture-accept-invite' &&
            typeof node.props?.onPress === 'function',
        )[0]!
        .props.onPress();
    });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('offers no way to dismiss the gate', async () => {
    const tree = await render();
    // The old "Not now". A member must end up holding a home; there is nothing
    // on the far side of a dismissal to let them into.
    expect(
      tree.root.findAll((node) => node.props?.testID === 'address-capture-skip'),
    ).toHaveLength(0);
  });

  it('wears the first-run id, not the gate id, during onboarding', async () => {
    mockGateOpen = false;
    mockCurrentHousehold = null;
    const tree = await render();
    // `address-capture-accept-invite` is how the Maestro subflows tell the gate
    // apart from the first-run wizard — both screens carry
    // `onboarding-create-home-name`, and guessing wrong types into a prefilled
    // field and renames a real home.
    expect(
      tree.root.findAll(
        (node) => node.props?.testID === 'address-capture-accept-invite',
      ),
    ).toHaveLength(0);
    expect(
      tree.root.findAll(
        (node) =>
          node.props?.testID === 'onboarding-join-with-invite' &&
          typeof node.type === 'string',
      ),
    ).toHaveLength(1);
  });
});

/**
 * The address field itself.
 *
 * Two failures that both look like "this screen has no address autocomplete",
 * and neither of which reports anything:
 *
 *  1. `GooglePlacesAutocomplete` with an empty `query.key` renders a normal
 *     input and then never suggests. `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` is
 *     gitignored (`.env.local`), so every clone without one gets that — a dead
 *     field, no error, nothing in the log.
 *  2. On the gate path the form opened on Home Name and Units, both already
 *     filled from the home being fixed, with the address below the fold and
 *     behind the keyboard — under a header that says "Add Your Address".
 *
 * Jest deliberately has no key (nothing loads `.env.local` here), so these
 * assert the keyless fallback, which is also the branch every CI run takes.
 */
describe('the street address field', () => {
  it('falls back to a plain typable field when there is no Places key', async () => {
    const tree = await render();
    const field = tree.root.findAll(
      (node) =>
        node.props?.testID === 'onboarding-create-home-address' &&
        typeof node.props?.onChangeText === 'function',
    )[0];
    // Same testID either way: an E2E flow must not have to know whether the
    // machine running it happened to have a key.
    expect(field).toBeDefined();

    await act(async () => {
      field!.props.onChangeText('742 Evergreen Terrace');
    });
    // The gate is the only thing between this member and the app. A typed
    // address has always been enough, and it must stay enough with no network.
    expect(textOf(tree)).toContain('742 Evergreen Terrace');
  });

  it('leads with the address when the gate asked for the address', async () => {
    mockGateOpen = true;
    mockCurrentHousehold = RESTORED_HOME;
    const tree = await render();
    const rendered = textOf(tree);
    expect(rendered.indexOf('onboarding-create-home-address')).toBeGreaterThan(-1);
    expect(rendered.indexOf('onboarding-create-home-address')).toBeLessThan(
      rendered.indexOf('onboarding-create-home-name'),
    );
  });

  it('still leads with the name during first-run setup', async () => {
    // There the home does not exist yet, naming it is the first decision, and
    // the address is captioned Optional.
    const tree = await render();
    const rendered = textOf(tree);
    expect(rendered.indexOf('onboarding-create-home-name')).toBeLessThan(
      rendered.indexOf('onboarding-create-home-address'),
    );
  });
});
