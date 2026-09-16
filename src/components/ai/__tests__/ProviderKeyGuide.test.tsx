/**
 * ProviderKeyGuide — the illustrated "how to get a key" card shown on the BYOK
 * Connect screen. Exercises the pieces that connect.test.tsx can't (it pins the
 * provider to 'anthropic'), across every provider:
 *
 *   • the card is titled with the provider's REAL logo (official vector path)
 *     plus its name — not the old monogram letter;
 *   • step 1 is a link into the provider console, with the console address shown
 *     right beneath it (the moved browser bar);
 *   • every step has an ⓘ that opens an annotated example of that console screen
 *     (an in-app mock with an accent comment), and nothing leaks before it opens.
 *
 * Also covers ProviderBrandMark, which now renders the same official logo on its
 * accent tile across all five AI surfaces.
 */

// deviceRender drives useDeviceType via a mocked useWindowDimensions.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

import React from 'react';
import { Linking } from 'react-native';
import { act } from 'react-test-renderer';
import type { ReactTestRenderer, ReactTestInstance } from 'react-test-renderer';

import { renderOnDevice, treeText, pressables } from '../../../test-utils/deviceRender';
import { ProviderBrandMark } from '../ProviderBrandMark';
import { ProviderKeyGuide } from '../ProviderKeyGuide';
import { PROVIDER_LOGO_PATH } from '../ProviderLogo';
import { PROVIDER_META, PROVIDER_ORDER } from '../providerMeta';

const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);

beforeEach(() => {
  openURL.mockClear();
});

const links = (r: ReactTestRenderer): ReactTestInstance[] =>
  pressables(r).filter((p) => p.props.accessibilityRole === 'link');

const infoButtons = (r: ReactTestRenderer): ReactTestInstance[] =>
  pressables(r).filter(
    (p) =>
      typeof p.props.accessibilityLabel === 'string' &&
      p.props.accessibilityLabel.startsWith('See an example')
  );

/** A distinctive slice of the official logo path — proves the real mark rendered. */
const logoMark = (provider: (typeof PROVIDER_ORDER)[number]) =>
  PROVIDER_LOGO_PATH[provider].slice(0, 16);

describe.each(PROVIDER_ORDER)('ProviderKeyGuide — %s', (provider) => {
  const meta = PROVIDER_META[provider];

  it('titles the card with the real provider logo + name', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ProviderKeyGuide provider={provider} />);
    const text = treeText(r);
    expect(text).toContain(meta.label); // provider name
    expect(text).toContain(logoMark(provider)); // official logo path, not a monogram tile
  });

  it('makes step 1 a link into the console with the address shown beneath', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ProviderKeyGuide provider={provider} />);
    const linkList = links(r);
    // The step-1 title link AND the console address bar under it both link out.
    expect(linkList.length).toBeGreaterThanOrEqual(2);

    linkList[0].props.onPress();
    expect(openURL).toHaveBeenCalledWith(meta.consoleUrl);
    expect(treeText(r)).toContain(meta.consoleName);
  });

  it('shows exactly one ⓘ per step', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ProviderKeyGuide provider={provider} />);
    expect(infoButtons(r)).toHaveLength(meta.steps.length);
  });

  it.each(meta.steps.map((step, i) => [i, step] as const))(
    'step %i ⓘ opens that step’s annotated example',
    (index, step) => {
      const r = renderOnDevice('iPhone 14 Pro', <ProviderKeyGuide provider={provider} />);

      // Example content is not in the tree until the ⓘ is tapped.
      expect(treeText(r)).not.toContain(step.example.comment);

      act(() => infoButtons(r)[index].props.onPress());

      const text = treeText(r);
      expect(text).toContain(step.example.comment); // the accent comment callout
      expect(text).toContain('Illustrative example'); // the modal's own chrome
    }
  );

  it('renders the provider’s own "create key" button label in the create example', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ProviderKeyGuide provider={provider} />);
    const createIndex = meta.steps.findIndex((s) => s.visual === 'create');

    act(() => infoButtons(r)[createIndex].props.onPress());
    // The mocked console screen shows the real button label (e.g. "Create new secret key").
    expect(treeText(r)).toContain(meta.createButtonLabel);
  });
});

describe.each(PROVIDER_ORDER)('ProviderBrandMark — %s', (provider) => {
  it('renders the official logo glyph, not a monogram letter', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ProviderBrandMark provider={provider} size={40} />);
    const text = treeText(r);
    expect(text).toContain(logoMark(provider));
    expect(text).not.toContain(`"${PROVIDER_META[provider].monogram}"`); // no bare monogram text node
  });
});
