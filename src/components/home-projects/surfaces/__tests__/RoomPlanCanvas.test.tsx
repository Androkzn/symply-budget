/**
 * The plan drawing.
 *
 * Both groups here are regressions from looking at the thing on an iPad:
 *
 *  - **Labels ran across their edge**, so on a U-shape the two sides of the
 *    notch printed into each other and into the wall names beside them.
 *  - **The highlighted edge was drawn heavier than the rest**, which read as a
 *    different kind of line rather than the same wall picked out — and on a
 *    short edge the neighbours' round caps pinched it so it looked *thinner*.
 */
// `renderOnDevice` drives the theme through a mocked useWindowDimensions.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

import React from 'react';
import type { ReactTestInstance } from 'react-test-renderer';

import {
  buildShapeOutline,
  createRoomSurfaceModel,
  roomShapePreset,
  seedShapeParams,
} from '@features/house/surfaces';

import { renderOnDevice } from '../../../../test-utils/deviceRender';
import { RoomPlanCanvas } from '../RoomPlanCanvas';

const ACCENT = '#2f6df6';
const OUTLINE = '#2c3338';

const COLORS = {
  outline: OUTLINE,
  fill: '#f2f4f6',
  muted: '#8a939b',
  accent: ACCENT,
  background: '#ffffff',
  text: OUTLINE,
};

function lShapeModel() {
  const preset = roomShapePreset('l_shape');
  return createRoomSurfaceModel({
    outline: buildShapeOutline(preset, seedShapeParams(preset, 6, 4)),
    wallHeight_m: 2.4,
  });
}

function renderPlan(highlightEdges?: number[]) {
  return renderOnDevice(
    'iPad Pro 11 (portrait)',
    <RoomPlanCanvas
      model={lShapeModel()}
      width={320}
      height={240}
      selectedSurfaceId={null}
      highlightEdges={highlightEdges}
      colors={COLORS}
      testID="plan"
    />,
  );
}

/**
 * Every drawn wall segment, in paint order.
 *
 * Only the composite `Line` — react-native-svg renders a host child underneath
 * with its colours already resolved to integers, so matching both would compare
 * `'#2f6df6'` against `{ payload, type }`.
 */
function lines(
  renderer: ReturnType<typeof renderOnDevice>,
): ReactTestInstance[] {
  return renderer.root.findAll(
    node =>
      typeof node.props?.x1 === 'number' &&
      typeof node.props?.strokeWidth === 'number' &&
      typeof node.props?.stroke === 'string',
  );
}

/** Every text node that carries a rotation, with the angle it was given. */
function rotations(renderer: ReturnType<typeof renderOnDevice>): number[] {
  return renderer.root
    .findAll(node => typeof node.props?.transform === 'string')
    .map(node => {
      const match = /rotate\((-?[\d.]+)/.exec(node.props.transform as string);
      return match ? Number(match[1]) : NaN;
    })
    .filter(angle => Number.isFinite(angle));
}

describe('edge weight', () => {
  /**
   * One weight for every wall. A heavier highlight is a different kind of line,
   * and on a short edge the neighbours' round caps eat into it at both ends so
   * it ends up looking narrower than the walls around it.
   */
  it('draws a highlighted wall at the same weight as the rest', () => {
    const widths = lines(renderPlan([2])).map(node => node.props.strokeWidth);
    expect(widths.length).toBeGreaterThan(1);
    expect(new Set(widths).size).toBe(1);
  });

  it('keeps that weight when nothing is highlighted', () => {
    const plain = new Set(
      lines(renderPlan()).map(node => node.props.strokeWidth),
    );
    const withHighlight = new Set(
      lines(renderPlan([2])).map(node => node.props.strokeWidth),
    );
    expect(plain).toEqual(withHighlight);
  });

  it('marks the highlight with colour instead', () => {
    const strokes = lines(renderPlan([2])).map(node => node.props.stroke);
    expect(strokes.filter(stroke => stroke === ACCENT)).toHaveLength(1);
    expect(strokes.filter(stroke => stroke === OUTLINE).length).toBeGreaterThan(
      0,
    );
  });

  /**
   * Painted last, so the round caps of the walls either side of it cannot sit
   * on top of a short highlighted edge.
   */
  it('paints the highlighted wall above its neighbours', () => {
    const strokes = lines(renderPlan([2])).map(node => node.props.stroke);
    expect(strokes[strokes.length - 1]).toBe(ACCENT);
  });

  it('highlights every edge a dimension governs, not just the first', () => {
    const strokes = lines(renderPlan([1, 5])).map(node => node.props.stroke);
    expect(strokes.filter(stroke => stroke === ACCENT)).toHaveLength(2);
  });
});

describe('labels', () => {
  /**
   * Horizontal text beside a vertical wall is as wide as the room is tall, so
   * it collides with whatever is around the corner. Running the label along its
   * edge makes it as long as the wall it describes.
   */
  it('rotates a label to run along its own edge', () => {
    const angles = rotations(renderPlan());
    expect(angles.length).toBeGreaterThan(0);
    // An L has both horizontal and vertical walls, so both must appear.
    expect(angles.some(angle => Math.abs(angle) < 1)).toBe(true);
    expect(angles.some(angle => Math.abs(Math.abs(angle) - 90) < 1)).toBe(true);
  });

  /** Read from the bottom or the right — never upside down. */
  it('never turns a label past vertical', () => {
    for (const angle of rotations(renderPlan())) {
      expect(angle).toBeGreaterThanOrEqual(-90.001);
      expect(angle).toBeLessThanOrEqual(90.001);
    }
  });
});

describe('which mark a selected surface gets', () => {
  function renderSelecting(kind: 'floor' | 'ceiling' | 'wall') {
    const model = lShapeModel();
    const surface = model.surfaces.find(s => s.kind === kind)!;
    const renderer = renderOnDevice(
      'iPad Pro 11 (portrait)',
      <RoomPlanCanvas
        model={model}
        width={320}
        height={240}
        selectedSurfaceId={surface.id}
        colors={COLORS}
      />,
    );
    return renderer;
  }

  const faceMarks = (renderer: ReturnType<typeof renderOnDevice>) =>
    renderer.root.findAll(node => node.props?.testID === 'plan-face-highlight');

  /**
   * On a plan a floor IS the enclosed region, so an outline would be
   * indistinguishable from selecting all of its walls at once.
   */
  it('tints the whole area for a floor', () => {
    expect(faceMarks(renderSelecting('floor')).length).toBeGreaterThan(0);
  });

  it('does the same for a ceiling', () => {
    expect(faceMarks(renderSelecting('ceiling')).length).toBeGreaterThan(0);
  });

  /**
   * A wall IS an edge, so tinting the room would say nothing about which wall.
   */
  it('lights only the line for a wall, and leaves the area alone', () => {
    const renderer = renderSelecting('wall');
    expect(faceMarks(renderer)).toHaveLength(0);
    const strokes = lines(renderer).map(node => node.props.stroke);
    expect(strokes.filter(stroke => stroke === ACCENT)).toHaveLength(1);
  });

  it('does not also light an edge when a floor is selected', () => {
    const strokes = lines(renderSelecting('floor')).map(
      node => node.props.stroke,
    );
    expect(strokes.filter(stroke => stroke === ACCENT)).toHaveLength(0);
  });
});
