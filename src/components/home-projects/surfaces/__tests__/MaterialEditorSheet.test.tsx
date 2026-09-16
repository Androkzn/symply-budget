/**
 * The finish sheet — one page for choosing and adjusting.
 *
 * It used to be two sheets: a picker, then an editor behind it. That cost a hop
 * on the commonest action in the feature (reuse a finish you already added) and
 * it stacked two `<Modal>`s, which on iOS meant the second frequently never
 * presented and dismissing either left an invisible overlay that froze the app.
 *
 * So the palette lives at the top of this sheet, the form below it, and the
 * assertions here are about the two staying distinct: picking an existing
 * finish must not be confused with editing one, and both must be reachable
 * without leaving the page.
 */
// `renderOnDevice` drives the theme through a mocked useWindowDimensions.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

import React from 'react';
import { act } from 'react-test-renderer';

import { createMaterial } from '@features/house/surfaces';
import type { Material } from '@symply/contracts';

import { renderOnDevice, treeText } from '../../../../test-utils/deviceRender';
import { MaterialEditorSheet } from '../MaterialEditorSheet';

const paint: Material = {
  ...createMaterial({ name: 'Wall paint', kind: 'paint' }),
};
const tile: Material = {
  ...createMaterial({ name: 'Floor tile', kind: 'tile' }),
};

function renderSheet(overrides?: {
  material?: Material | null;
  selectedMaterialId?: string | null;
  onSelectMaterial?: jest.Mock;
  onStartNew?: jest.Mock;
  onSave?: jest.Mock;
  onDelete?: jest.Mock;
  applyTargets?: Array<{
    id: string;
    label: string;
    selected: boolean;
    locked?: boolean;
  }>;
  onToggleApplyTarget?: jest.Mock;
}) {
  const onSelectMaterial = overrides?.onSelectMaterial ?? jest.fn();
  const onStartNew = overrides?.onStartNew ?? jest.fn();
  const onSave = overrides?.onSave ?? jest.fn();
  const onToggleApplyTarget = overrides?.onToggleApplyTarget ?? jest.fn();
  const renderer = renderOnDevice(
    'iPad Pro 11 (portrait)',
    <MaterialEditorSheet
      visible
      subtitle="Floor · 50 sq ft"
      material={overrides?.material === undefined ? tile : overrides.material}
      materials={[paint, tile]}
      selectedMaterialId={
        overrides?.selectedMaterialId === undefined
          ? tile.id
          : overrides.selectedMaterialId
      }
      onSelectMaterial={onSelectMaterial}
      onStartNew={onStartNew}
      suggestedKinds={['flooring', 'tile']}
      applyTargets={overrides?.applyTargets}
      onToggleApplyTarget={onToggleApplyTarget}
      onSave={onSave}
      onDelete={overrides?.onDelete}
      onClose={jest.fn()}
    />,
  );
  const find = (testID: string) =>
    renderer.root.findAll(n => n.props?.testID === testID);
  const press = (testID: string) => act(() => find(testID)[0].props.onPress());
  return {
    renderer,
    onSelectMaterial,
    onStartNew,
    onSave,
    onToggleApplyTarget,
    find,
    press,
  };
}

describe('choosing from what is already there', () => {
  /**
   * The whole reason the two sheets were merged: reuse is the commonest action
   * and it used to sit behind an extra hop.
   */
  it('offers every material in the project, on the same page as the form', () => {
    const { find } = renderSheet();
    expect(find(`finish-option-${paint.id}`).length).toBeGreaterThan(0);
    expect(find(`finish-option-${tile.id}`).length).toBeGreaterThan(0);
    // …and the form is right there too.
    expect(find('material-name').length).toBeGreaterThan(0);
  });

  it('assigns the one that is tapped', () => {
    const { onSelectMaterial, press } = renderSheet();
    press(`finish-option-${paint.id}`);
    expect(onSelectMaterial).toHaveBeenCalledWith(paint.id);
  });

  it('keeps "no finish yet" reachable as a real choice', () => {
    const { onSelectMaterial, press } = renderSheet();
    press('finish-option-none');
    expect(onSelectMaterial).toHaveBeenCalledWith(null);
  });

  it('marks what the area currently uses', () => {
    const { find } = renderSheet({ selectedMaterialId: paint.id });
    // `findAll` matches the composite and the host nodes it renders; only the
    // composite carries the props as written.
    const states = (id: string) =>
      find(id)
        .map(node => node.props?.accessibilityState)
        .filter(Boolean);
    expect(states(`finish-option-${paint.id}`)).toContainEqual({
      selected: true,
    });
    expect(states(`finish-option-${tile.id}`)).toContainEqual({
      selected: false,
    });
  });

  /** Adding manually is offered beside reuse, not instead of it. */
  it('can start a new material without leaving the sheet', () => {
    const { onStartNew, press } = renderSheet();
    press('finish-new-flooring');
    expect(onStartNew).toHaveBeenCalledWith('flooring');
  });

  it('only offers the kinds that suit the surface', () => {
    const { find } = renderSheet();
    expect(find('finish-new-flooring').length).toBeGreaterThan(0);
    expect(find('finish-new-wallpaper')).toHaveLength(0);
  });
});

describe('adjusting the one in hand', () => {
  it('loads the material into the form', () => {
    const { renderer } = renderSheet();
    expect(treeText(renderer)).toContain('Floor tile');
  });

  it('saves the edited material rather than a fresh one', () => {
    const { onSave, press } = renderSheet();
    press('material-save');
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].id).toBe(tile.id);
  });

  /**
   * Selecting and editing are different intents and must stay different
   * callbacks — conflating them is what made "Edit" assign a material instead
   * of opening it.
   */
  it('does not assign anything just by saving the form', () => {
    const { onSelectMaterial, press } = renderSheet();
    press('material-save');
    expect(onSelectMaterial).not.toHaveBeenCalled();
  });

  it('offers delete only for a material that exists', () => {
    const onDelete = jest.fn();
    expect(
      renderSheet({ onDelete }).find('material-delete').length,
    ).toBeGreaterThan(0);
    expect(
      renderSheet({ material: null, onDelete }).find('material-delete'),
    ).toHaveLength(0);
  });

  it('opens blank for a brand-new finish, with the palette still above it', () => {
    const { find, renderer } = renderSheet({
      material: null,
      selectedMaterialId: null,
    });
    expect(find('material-name').length).toBeGreaterThan(0);
    expect(treeText(renderer)).toContain('New finish');
    expect(find(`finish-option-${tile.id}`).length).toBeGreaterThan(0);
  });
});

describe('applying one finish to several surfaces', () => {
  const walls = [
    { id: 'sf_s', label: 'S wall', selected: true, locked: true },
    { id: 'sf_e', label: 'E wall', selected: false },
    { id: 'sf_n', label: 'N wall', selected: false },
  ];

  /**
   * One paint normally covers every wall. Without this the member reopens the
   * sheet once per wall and makes the same choice four times.
   */
  it('offers the other surfaces alongside the one being edited', () => {
    const { find } = renderSheet({ applyTargets: walls });
    for (const wall of walls) {
      expect(find(`apply-to-${wall.id}`).length).toBeGreaterThan(0);
    }
  });

  it('toggles one on', () => {
    const { onToggleApplyTarget, press } = renderSheet({ applyTargets: walls });
    press('apply-to-sf_e');
    expect(onToggleApplyTarget).toHaveBeenCalledWith('sf_e');
  });

  /** The surface the sheet was opened from cannot be unticked out of its own edit. */
  it('will not untick the surface being edited', () => {
    const { onToggleApplyTarget, press } = renderSheet({ applyTargets: walls });
    press('apply-to-sf_s');
    expect(onToggleApplyTarget).not.toHaveBeenCalled();
  });

  /** Nothing to choose between when the room has one surface of this kind. */
  it('stays out of the way when there is only one candidate', () => {
    const { find } = renderSheet({
      applyTargets: [
        { id: 'sf_floor', label: 'Floor', selected: true, locked: true },
      ],
    });
    expect(find('apply-to-sf_floor')).toHaveLength(0);
  });
});
