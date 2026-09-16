/**
 * ProviderCard — the shared AI-provider card.
 *
 * Locks the two explicit product requirements: the most-capable model is tagged
 * "MOST CAPABLE" (flagship), and the currently-selected model is highlighted
 * (accent chip) in addition to the default toggle. Also checks connect vs.
 * connected affordances.
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

import React from 'react';
import { act } from 'react-test-renderer';
import type { ReactTestRenderer, ReactTestInstance } from 'react-test-renderer';

import { renderOnDevice, treeText, pressables } from '../../../test-utils/deviceRender';
import { ProviderCard } from '../ProviderCard';

const MODELS = [
  { id: 'anthropic.claude-fable-5', display_name: 'Claude Fable 5', profile_label: 'quality', capabilities: ['text'], is_default: false, flagship: true },
  { id: 'anthropic.claude-sonnet-5', display_name: 'Claude Sonnet 5', profile_label: 'balanced', capabilities: ['text'], is_default: true, flagship: false },
];

const CONN = {
  provider: 'anthropic' as const,
  status: 'valid',
  keyHint: '•••• PQAA',
  lastValidatedAt: '2026-07-01T00:00:00.000Z',
  capabilities: ['text'], leaseExpiresAt: null, consentAt: null,
  selectedModelId: 'anthropic.claude-fable-5',
};

const noop = () => {};
const baseProps = {
  provider: 'anthropic' as const,
  connection: CONN,
  isActive: true,
  showDefaultToggle: true,
  enabled: true,
  models: MODELS,
  selectedModelId: 'anthropic.claude-fable-5',
  onToggleDefault: noop,
  onSelectModel: noop,
  onConnect: noop,
  onRevalidate: noop,
  onChangeKey: noop,
  onDisconnect: noop,
};

const byTestID = (r: ReactTestRenderer, id: string): ReactTestInstance =>
  r.root.findAll((n) => n.props?.testID === id)[0];
const byLabel = (r: ReactTestRenderer, label: string): ReactTestInstance | undefined =>
  pressables(r).find((p) => p.props.accessibilityLabel === label);

describe('ProviderCard', () => {
  it('tags the flagship model "MOST CAPABLE" once expanded', async () => {
    const r = renderOnDevice('iPhone 14 Pro', <ProviderCard {...baseProps} />);
    await act(async () => {
      byTestID(r, 'ai-model-row-anthropic').props.onPress();
    });
    expect(treeText(r)).toContain('MOST CAPABLE');
  });

  it('highlights the selected model and reports selection', async () => {
    const onSelectModel = jest.fn();
    const r = renderOnDevice(
      'iPhone 14 Pro',
      <ProviderCard {...baseProps} onSelectModel={onSelectModel} />
    );
    await act(async () => {
      byTestID(r, 'ai-model-row-anthropic').props.onPress();
    });
    // Selected (flagship) row is marked selected via accessibilityState.
    const selected = byTestID(r, 'ai-model-option-anthropic-anthropic.claude-fable-5');
    expect(selected.props.accessibilityState.selected).toBe(true);
    // Picking a different model reports it up.
    await act(async () => {
      byTestID(r, 'ai-model-option-anthropic-anthropic.claude-sonnet-5').props.onPress();
    });
    expect(onSelectModel).toHaveBeenCalledWith('anthropic.claude-sonnet-5');
  });

  it('shows the default toggle reflecting active state', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ProviderCard {...baseProps} />);
    expect(byTestID(r, 'ai-default-toggle-anthropic').props.value).toBe(true);
    expect(treeText(r)).toContain('DEFAULT');
  });

  it('hides the toggle and DEFAULT pill when only one provider is connected', () => {
    // showDefaultToggle=false → the default control is an inert no-op with a
    // single key, so neither the toggle nor the DEFAULT pill should render.
    const r = renderOnDevice(
      'iPhone 14 Pro',
      <ProviderCard {...baseProps} showDefaultToggle={false} />
    );
    expect(r.root.findAll((n) => n.props?.testID === 'ai-default-toggle-anthropic')).toHaveLength(0);
    expect(treeText(r)).not.toContain('DEFAULT');
  });

  it('shows a Connect CTA (no toggle) when not connected', () => {
    const r = renderOnDevice(
      'iPhone 14 Pro',
      <ProviderCard {...baseProps} connection={null} isActive={false} selectedModelId={null} />
    );
    expect(byLabel(r, 'Connect Anthropic Claude')).toBeTruthy();
    expect(r.root.findAll((n) => n.props?.testID === 'ai-default-toggle-anthropic')).toHaveLength(0);
  });

  it('falls back to the flagship when the stored model was retired from the catalog', async () => {
    // Models get pulled from the catalog when they misbehave, but the stored
    // pick survives. It then matches no option: the row showed the "Most
    // capable" placeholder and NOTHING was ticked, so the card looked like it
    // had lost its model (observed on Gemini, `gemini.3.1-flash-lite`).
    const r = renderOnDevice(
      'iPhone 14 Pro',
      <ProviderCard {...baseProps} selectedModelId="anthropic.claude-retired-9" />
    );
    expect(treeText(r)).toContain('Claude Fable 5');
    expect(treeText(r)).not.toContain('Most capable');

    await act(async () => {
      byTestID(r, 'ai-model-row-anthropic').props.onPress();
    });
    expect(
      byTestID(r, 'ai-model-option-anthropic-anthropic.claude-fable-5').props.accessibilityState
        .selected
    ).toBe(true);
  });

  it('says the button tests the SAVED key, not "the connection"', async () => {
    // The action re-validates the key held on the server. It says nothing about
    // this device, which keeps its own copy in the Keychain. Called "Test
    // connection" it read as a verdict on the whole provider — so a green
    // result appeared directly beneath "Key not on this device" and made the
    // warning look stale. Both statements were true; only the label was wrong.
    const r = renderOnDevice('iPhone 14 Pro', <ProviderCard {...baseProps} />);
    expect(treeText(r)).toContain('Test saved key');
    expect(treeText(r)).not.toContain('Test connection');
  });

  it('warns that the key is absent HERE while still offering the saved-key test', async () => {
    // The two coexist on purpose: the saved key can be valid while this device
    // has none, and that is exactly the state a fresh install lands in. What
    // must never happen again is the pair reading as a contradiction, so pin
    // both being present together.
    const r = renderOnDevice(
      'iPhone 14 Pro',
      <ProviderCard {...baseProps} missingLocalKey />
    );
    const text = treeText(r);
    expect(text).toContain('Key not on this device');
    expect(text).toContain('Test saved key');
  });

  it('shows no missing-key warning once the key is on the device', async () => {
    const r = renderOnDevice('iPhone 14 Pro', <ProviderCard {...baseProps} missingLocalKey={false} />);
    expect(treeText(r)).not.toContain('Key not on this device');
  });
});
