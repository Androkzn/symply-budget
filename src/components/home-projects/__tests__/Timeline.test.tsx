/**
 * The Timeline and the Blockers list, which are the same component wearing two
 * hats: a short list the member wrote, each line editable, the whole list
 * draggable.
 *
 * What is covered here is what the SCREEN cannot get wrong twice: the positional
 * numbering (a drop must renumber before the write returns), the status
 * vocabulary a stored value maps onto, and the view-only path — a member with
 * read access must get no grips, no pencils and no live tap targets, because
 * the backend would refuse the write and the affordance would be a lie.
 *
 * The drag itself is not driven here. `react-native-sortables` runs on the
 * reanimated worklet runtime, which is mocked in this environment, so a
 * simulated drop would prove the mock reorders an array rather than proving the
 * list does. It is exercised on device.
 */
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

import React from 'react';

import type { HomeProjectBlocker, HomeProjectPhase } from '@api/home-projects';

import { renderOnDevice, treeText } from '../../../test-utils/deviceRender';
import { BlockerList } from '../BlockerList';
import { Timeline } from '../Timeline';

function phase(overrides: Partial<HomeProjectPhase> = {}): HomeProjectPhase {
  return {
    id: 'hpph_1',
    project_id: 'hp_1',
    title: 'Insulate walls and ceiling',
    status: 'pending',
    starts_on: null,
    ends_on: null,
    sort_order: 0,
    ...overrides,
  };
}

function blocker(
  overrides: Partial<HomeProjectBlocker> = {},
): HomeProjectBlocker {
  return {
    id: 'hpblk_1',
    project_id: 'hp_1',
    title: 'Permits for change of use',
    severity: 'medium',
    status: 'open',
    notes: null,
    sort_order: 0,
    ...overrides,
  };
}

describe('Timeline', () => {
  it('numbers phases by POSITION, not by sort_order', () => {
    // `sort_order` is deliberately not 0,1,2 here: after a drag the screen shows
    // the new order immediately and the renumbered rows only come back from the
    // write. Numbering off the column would leave "3. 1. 2." on screen until the
    // refetch landed.
    const tree = treeText(
      renderOnDevice(
        'iPhone 14 Pro',
        <Timeline
          phases={[
            phase({ id: 'a', title: 'Remediation', sort_order: 7 }),
            phase({ id: 'b', title: 'Windows', sort_order: 2 }),
          ]}
        />,
      ),
    );
    expect(tree).toContain('1. Remediation');
    expect(tree).toContain('2. Windows');
  });

  it('reads the stored status into the vocabulary the sheet offers', () => {
    const tree = treeText(
      renderOnDevice(
        'iPhone 14 Pro',
        <Timeline
          phases={[
            phase({ id: 'a', title: 'Strip out', status: 'done' }),
            // Written by an older path — `smart-project.ts` counts it as
            // finished, so the badge must too.
            phase({ id: 'b', title: 'Frame', status: 'completed' }),
            phase({ id: 'c', title: 'Wire', status: 'in_progress' }),
            phase({ id: 'd', title: 'Paint', status: 'pending' }),
          ]}
        />,
      ),
    );
    expect(tree).toContain('Done');
    expect(tree).toContain('In progress');
    expect(tree).toContain('Not started');
    // The raw slug never reaches the member.
    expect(tree).not.toContain('in_progress');
  });

  it('says so plainly when there are no phases', () => {
    const tree = treeText(
      renderOnDevice('iPhone 14 Pro', <Timeline phases={[]} />),
    );
    expect(tree).toContain('No phases yet');
  });

  it('offers no edit affordance to a view-only member', () => {
    const onEditPhase = jest.fn();
    const renderer = renderOnDevice(
      'iPhone 14 Pro',
      <Timeline
        phases={[phase({ id: 'a' }), phase({ id: 'b', title: 'Paint' })]}
        canEdit={false}
        onEditPhase={onEditPhase}
        onReorder={jest.fn()}
      />,
    );

    // No grip: `ReorderableList` is not mounted at all on the view-only path.
    expect(
      renderer.root.findAllByProps({ testID: 'home-project-timeline-grip' }),
    ).toHaveLength(0);
    // And the row itself is inert rather than a button that 403s.
    const row = renderer.root.findByProps({ testID: 'home-project-phase-a' });
    expect(row.props.disabled).toBe(true);
    expect(onEditPhase).not.toHaveBeenCalled();
  });

  it('opens the editor for the phase that was tapped', () => {
    const onEditPhase = jest.fn();
    const target = phase({ id: 'b', title: 'Lay floor covering' });
    const renderer = renderOnDevice(
      'iPhone 14 Pro',
      <Timeline
        phases={[phase({ id: 'a' }), target]}
        canEdit
        onEditPhase={onEditPhase}
        onReorder={jest.fn()}
      />,
    );

    renderer.root
      .findByProps({ testID: 'home-project-phase-b' })
      .props.onPress();
    expect(onEditPhase).toHaveBeenCalledWith(target);
  });
});

describe('BlockerList', () => {
  it('keeps a resolved blocker in the list, labelled', () => {
    // Resolving is not deleting: "we checked, it is not load-bearing" is the
    // answer to a question the household asked, and it belongs where the
    // question was.
    const tree = treeText(
      renderOnDevice(
        'iPhone 14 Pro',
        <BlockerList
          blockers={[
            blocker({ id: 'a', title: 'Load-bearing?', status: 'resolved' }),
            blocker({ id: 'b', title: 'Damp', severity: 'high' }),
          ]}
        />,
      ),
    );
    expect(tree).toContain('Load-bearing?');
    expect(tree).toContain('Resolved');
    expect(tree).toContain('High · Open');
  });

  it('shows the note the member wrote under the blocker', () => {
    const tree = treeText(
      renderOnDevice(
        'iPhone 14 Pro',
        <BlockerList
          blockers={[blocker({ notes: 'Council says a permit is needed' })]}
        />,
      ),
    );
    expect(tree).toContain('Council says a permit is needed');
  });

  it('opens the editor for the blocker that was tapped', () => {
    const onEditBlocker = jest.fn();
    const target = blocker({ id: 'b', title: 'Rodent entry points' });
    const renderer = renderOnDevice(
      'iPhone 14 Pro',
      <BlockerList
        blockers={[blocker({ id: 'a' }), target]}
        canEdit
        onEditBlocker={onEditBlocker}
        onReorder={jest.fn()}
      />,
    );

    renderer.root
      .findByProps({ testID: 'home-project-blocker-b' })
      .props.onPress();
    expect(onEditBlocker).toHaveBeenCalledWith(target);
  });
});
