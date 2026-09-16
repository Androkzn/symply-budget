/**
 * Render + interaction coverage for the shared interactive UI library on BOTH
 * iPhone and iPad. Every control is rendered at each device size (so a
 * tablet-only layout regression surfaces here) and its callback is exercised.
 */
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

import { BlurView } from 'expo-blur';
import React from 'react';
import { StyleSheet } from 'react-native';
import { act } from 'react-test-renderer';

import { Button } from '@components/ui/Button';
import { Card } from '@components/ui/Card';
import { Chip } from '@components/ui/Chip';
import { EmptyState } from '@components/ui/EmptyState';
import { FilterTabs } from '@components/ui/FilterTabs';
import { FloatingActionButton } from '@components/ui/FloatingActionButton';
import { GradientButton } from '@components/ui/GradientButton';
import { SearchBar } from '@components/ui/SearchBar';
import { StatusBadge } from '@components/ui/StatusBadge';
import { Typography } from '@components/ui/Typography';

import {
  ALL_DEVICES,
  IPADS,
  PHONES,
  renderOnDevice,
  treeText,
  pressables,
  type DeviceName,
} from '../../../test-utils/deviceRender';

const EVERY_DEVICE = ALL_DEVICES.map((d) => [d] as [DeviceName]);

describe('Button — every device', () => {
  it.each(EVERY_DEVICE)('renders its title and fires onPress on %s', (device) => {
    const onPress = jest.fn();
    const r = renderOnDevice(device, <Button title="Save changes" onPress={onPress} />);
    expect(treeText(r)).toContain('Save changes');
    act(() => pressables(r)[0].props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders a loading state without a crash', () => {
    const r = renderOnDevice('iPhone 14 Pro', <Button title="Save" loading onPress={() => {}} />);
    expect(r.toJSON()).toBeTruthy();
  });
});

describe('GradientButton — every device', () => {
  it.each(EVERY_DEVICE)('shows label + fires onPress on %s', (device) => {
    const onPress = jest.fn();
    const r = renderOnDevice(device, <GradientButton title="Continue" onPress={onPress} />);
    expect(treeText(r)).toContain('Continue');
    act(() => pressables(r)[0].props.onPress());
    expect(onPress).toHaveBeenCalled();
  });
});

describe('FloatingActionButton — phone + iPad', () => {
  it.each(EVERY_DEVICE)('renders + fires on %s', (device) => {
    const onPress = jest.fn();
    const r = renderOnDevice(device, <FloatingActionButton title="+ New Task" onPress={onPress} />);
    expect(treeText(r)).toContain('New Task');
    act(() => pressables(r)[0].props.onPress());
    expect(onPress).toHaveBeenCalled();
  });

  // Every call site used to pick its own horizontal inset (8/16/28, hand
  // hardcoded) — now they all share the same "main padding horizontal" every
  // screen already uses for its own content (`useLayoutPadding`), so a
  // floating CTA's edges line up with the screen behind it on every device.
  // `testID` lands on both the FAB's own composite props and its inner host
  // `View` — grab the host instance (the one carrying a `style`) so we read
  // the actual rendered padding, not the composite's prop bag.
  const containerOf = (r: ReturnType<typeof renderOnDevice>, testID: string) =>
    r.root.findAllByProps({ testID }).find((n) => n.props.style)!;

  it('defaults its horizontal inset to the shared layout-padding scale, not a fixed value', () => {
    const phone = renderOnDevice(
      'iPhone 14 Pro',
      <FloatingActionButton title="Add" onPress={() => {}} testID="fab" />
    );
    const ipad = renderOnDevice(
      'iPad Pro 11 (landscape)',
      <FloatingActionButton title="Add" onPress={() => {}} testID="fab" />
    );

    expect(StyleSheet.flatten(containerOf(phone, 'fab').props.style).paddingHorizontal).toBe(8);
    expect(StyleSheet.flatten(containerOf(ipad, 'fab').props.style).paddingHorizontal).toBe(28);
  });

  it('lets a caller override the shared inset for a screen with its own layout', () => {
    const r = renderOnDevice(
      'iPhone 14 Pro',
      <FloatingActionButton title="Add" onPress={() => {}} testID="fab" horizontalPadding={40} />
    );

    expect(StyleSheet.flatten(containerOf(r, 'fab').props.style).paddingHorizontal).toBe(40);
  });

  // One source of truth (`ScreenFooterGlass`) for the blur behind every
  // floating CTA — see ScreenFooterGlass.test.tsx for the recipe itself.
  it('renders the shared blur backdrop behind the pill', () => {
    const r = renderOnDevice('iPhone 14 Pro', <FloatingActionButton title="Add" onPress={() => {}} />);
    expect(r.root.findAllByType(BlurView).length).toBeGreaterThan(0);
  });
});

describe('FilterTabs — selection + counts', () => {
  const tabs = [
    { id: 'all', label: 'All' },
    { id: 'open', label: 'Open', count: 3 },
    { id: 'done', label: 'Done' },
  ];

  it.each(EVERY_DEVICE)('renders all tab labels on %s', (device) => {
    const r = renderOnDevice(
      device,
      <FilterTabs tabs={tabs} activeTab="all" onTabChange={() => {}} />
    );
    const text = treeText(r);
    ['All', 'Open', 'Done', '3'].forEach((t) => expect(text).toContain(t));
  });

  it('fires onTabChange with the tapped id', () => {
    const onTabChange = jest.fn();
    const r = renderOnDevice(
      'iPad Pro 11 (landscape)',
      <FilterTabs tabs={tabs} activeTab="all" onTabChange={onTabChange} />
    );
    // Tap the last tab ("Done").
    const btns = pressables(r);
    act(() => btns[btns.length - 1].props.onPress());
    expect(onTabChange).toHaveBeenCalledWith('done');
  });
});

describe('Chip — variants + remove', () => {
  it.each(EVERY_DEVICE)('renders label on %s', (device) => {
    const r = renderOnDevice(device, <Chip label="Kitchen" onPress={() => {}} />);
    expect(treeText(r)).toContain('Kitchen');
  });

  it('fires onRemove when the remove affordance is tapped', () => {
    const onRemove = jest.fn();
    const r = renderOnDevice('iPhone 14 Pro', <Chip label="Urgent" onRemove={onRemove} />);
    const btns = pressables(r);
    act(() => btns[btns.length - 1].props.onPress());
    expect(onRemove).toHaveBeenCalled();
  });

  // Suggestion chips (receipt review) must read as CHOICES, not as status
  // badges. A filled chip next to the filled Tax/fee pills was indistinguishable
  // from them, so the outlined form is load-bearing, not decorative.
  describe('outlined', () => {
    // The chip container is the only node styled `alignSelf: 'flex-start'`;
    // indexing into findAll() picks up the Touchable wrapper instead.
    const flatStyle = (r: ReturnType<typeof renderOnDevice>) => {
      const hit = r.root
        .findAll((n) => !!n.props?.style)
        .map((n) => StyleSheet.flatten(n.props.style) as Record<string, unknown>)
        .find((s) => s && s.alignSelf === 'flex-start');
      if (!hit) throw new Error('chip container style not found');
      return hit;
    };

    it('renders transparent with a border instead of a tinted fill', () => {
      const r = renderOnDevice('iPhone 14 Pro', <Chip label="Dessert" outlined onPress={() => {}} />);
      const s = flatStyle(r);
      expect(s.backgroundColor).toBe('transparent');
      expect(s.borderWidth).toBeGreaterThan(0);
      expect(s.borderColor).toBeTruthy();
    });

    it('is a full capsule, rounder than the default chip', () => {
      const outlined = flatStyle(
        renderOnDevice('iPhone 14 Pro', <Chip label="Dessert" outlined onPress={() => {}} />)
      );
      const filled = flatStyle(
        renderOnDevice('iPhone 14 Pro', <Chip label="Dessert" onPress={() => {}} />)
      );
      expect(Number(outlined.borderRadius)).toBeGreaterThan(Number(filled.borderRadius));
    });

    it('keeps a tinted fill and no border when not outlined', () => {
      const s = flatStyle(renderOnDevice('iPhone 14 Pro', <Chip label="Tax" variant="warning" />));
      expect(s.backgroundColor).not.toBe('transparent');
      expect(s.borderWidth ?? 0).toBe(0);
    });

    it('still fires onPress so a suggestion can be applied', () => {
      const onPress = jest.fn();
      const r = renderOnDevice('iPhone 14 Pro', <Chip label="Candy" outlined onPress={onPress} />);
      act(() => pressables(r)[0].props.onPress());
      expect(onPress).toHaveBeenCalled();
    });
  });
});

describe('StatusBadge — variants', () => {
  it.each(['overdue', 'today', 'soon', 'complete'] as const)('renders %s badge', (variant) => {
    const r = renderOnDevice('iPad mini (landscape)', <StatusBadge variant={variant} count={2} />);
    expect(r.toJSON()).toBeTruthy();
  });
});

describe('SearchBar — input', () => {
  it.each(EVERY_DEVICE)('shows placeholder + fires onChangeText on %s', (device) => {
    const onChangeText = jest.fn();
    const r = renderOnDevice(
      device,
      <SearchBar value="" onChangeText={onChangeText} placeholder="Search tasks..." />
    );
    expect(treeText(r)).toContain('Search tasks...');
    const input = r.root.findAll(
      (n) => typeof (n.props as { onChangeText?: unknown })?.onChangeText === 'function'
    )[0];
    act(() => input.props.onChangeText('hvac'));
    expect(onChangeText).toHaveBeenCalledWith('hvac');
  });
});

describe('EmptyState — CTA', () => {
  it.each(EVERY_DEVICE)('renders title/description + fires the action on %s', (device) => {
    const onPress = jest.fn();
    const r = renderOnDevice(
      device,
      <EmptyState
        icon="📋"
        title="No tasks yet"
        description="Add your first task to get started."
        action={{ label: 'Add task', onPress }}
      />
    );
    const text = treeText(r);
    expect(text).toContain('No tasks yet');
    expect(text).toContain('Add task');
    act(() => pressables(r)[0].props.onPress());
    expect(onPress).toHaveBeenCalled();
  });
});

describe('Card — pressable container', () => {
  it.each(EVERY_DEVICE)('renders children + fires onPress on %s', (device) => {
    const onPress = jest.fn();
    const r = renderOnDevice(
      device,
      <Card onPress={onPress}>
        <Typography>Card body</Typography>
      </Card>
    );
    expect(treeText(r)).toContain('Card body');
    act(() => pressables(r)[0].props.onPress());
    expect(onPress).toHaveBeenCalled();
  });
});

describe('Coverage sanity', () => {
  it('exercises 3 phones and 5 iPad configurations', () => {
    expect(PHONES).toHaveLength(3);
    expect(IPADS).toHaveLength(5);
  });
});
