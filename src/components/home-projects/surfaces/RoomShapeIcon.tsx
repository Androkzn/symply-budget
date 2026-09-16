/**
 * The plan outline of a room-shape preset, drawn small.
 *
 * **Derived from the preset, not drawn by hand.** The icon calls the same
 * `build()` the "Create the room" button calls and projects it with the same
 * `fitProjection` the real canvas uses, so the picture is the shape — an L that
 * takes its bite out of the top-right on the icon takes it out of the top-right
 * in the editor. A hand-drawn SVG would be a second description of the same
 * fact, and the two would drift the first time a preset's proportions changed.
 *
 * Corner dots are on for the same reason the option text says "you can drag the
 * corners afterwards": the presets are a starting point, and a shape that looks
 * like a fixed template is one members do not try to adjust. Below a certain
 * size they are noise rather than a hint, so they are dropped.
 */

import React, { useMemo } from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

import {
  buildShapeOutline,
  fitProjection,
  roomShapePreset,
  seedShapeParams,
} from '@features/house/surfaces';
import type { RoomShapeKey } from '@features/house/surfaces';

export interface RoomShapeIconProps {
  shape: RoomShapeKey;
  width?: number;
  height?: number;
  color: string;
  fill: string;
  /**
   * Tint strength for `fill`, 0–1.
   *
   * An opacity rather than an alpha-hex suffix on the colour: `${primary}22`
   * only works while every theme token happens to be a 6-digit hex, and the
   * day one becomes `rgb(...)` it produces an invalid colour that silently
   * renders as black.
   */
  fillOpacity?: number;
  /** Off for the very small sizes, where dots read as noise. */
  showCorners?: boolean;
  testID?: string;
}

/**
 * The proportions the icon is drawn at.
 *
 * Fixed rather than taken from the member's width/depth fields: the icon is
 * identifying a *shape*, and redrawing it as the room is typed would turn a
 * stable row of options into four boxes that reflow on every keystroke.
 */
const ICON_WIDTH_M = 4;
const ICON_DEPTH_M = 3;

export function RoomShapeIcon({
  shape,
  width = 46,
  height = 36,
  color,
  fill,
  fillOpacity = 1,
  showCorners = true,
  testID,
}: RoomShapeIconProps) {
  const { path, corners } = useMemo(() => {
    const preset = roomShapePreset(shape);
    const outline = buildShapeOutline(
      preset,
      seedShapeParams(preset, ICON_WIDTH_M, ICON_DEPTH_M),
    );
    const projection = fitProjection(outline, width, height, { padding: 5 });
    return {
      path: projection.pathOf(outline),
      corners: outline.map(point => projection.toScreen(point)),
    };
  }, [shape, width, height]);

  return (
    <Svg width={width} height={height} testID={testID}>
      <Path
        d={path}
        fill={fill}
        fillOpacity={fillOpacity}
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {showCorners
        ? corners.map((corner, index) => (
            <Circle
              key={index}
              cx={corner[0]}
              cy={corner[1]}
              r={2.4}
              fill={color}
            />
          ))
        : null}
    </Svg>
  );
}
