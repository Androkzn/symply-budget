/**
 * A material, tiled across a fixed *real-world* width.
 *
 * The strip always shows the same 1.2 metres of wall, whatever the material —
 * so a 600 mm tile fills half of it and a 75 mm mosaic repeats sixteen times,
 * and the difference between the two is visible at a glance instead of being a
 * number in a field. A swatch scaled to fit its box, which is what a swatch
 * usually is, shows both of those as the same picture and teaches the member
 * nothing.
 *
 * The 1.2 m reference is stated in the caption for the same reason a map has a
 * scale bar: a preview that is to scale and does not say so is indistinguishable
 * from one that is not.
 */

import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, Image as SvgImage, Pattern, Rect } from 'react-native-svg';

import {
  cellPixelSize,
  patternCell,
  tileTopLeft,
} from '@features/house/surfaces';
import type { Material } from '@symply/contracts';
import { useAppColors } from '@theme';

/** The real width the strip represents, metres. */
export const SWATCH_REFERENCE_M = 1.2;

export interface SwatchPreviewProps {
  material: Material;
  textureUri?: string;
  /** 0 or omitted → fill the parent's width. */
  width?: number;
  height?: number;
  caption?: string;
  showScaleNote?: boolean;
  testID?: string;
}

export function SwatchPreview({
  material,
  textureUri,
  width,
  height = 96,
  caption,
  showScaleNote = true,
  testID,
}: SwatchPreviewProps) {
  const colors = useAppColors();
  const window = useWindowDimensions();
  // 32 is the editor's horizontal padding either side. A measured layout would
  // be more correct and would also make this component async — it renders
  // inside a scrolling form where a one-frame flash of the wrong width is worse
  // than a few pixels of imprecision.
  const boxWidth = width && width > 0 ? width : window.width - 32;
  const scale = boxWidth / SWATCH_REFERENCE_M;
  const cell = patternCell(material);
  const id = `swatch-${material.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <View style={styles.wrap} testID={testID}>
      <View style={[styles.frame, { borderColor: colors.borderColor }]}>
        <Svg width={boxWidth} height={height}>
          {cell ? (
            <Defs>
              <Pattern
                id={id}
                patternUnits="userSpaceOnUse"
                x={0}
                y={height}
                width={Math.max(2, cellPixelSize(cell, scale).w)}
                height={Math.max(2, cellPixelSize(cell, scale).h)}
                patternTransform={
                  cell.rotationDeg ? `rotate(${cell.rotationDeg})` : undefined
                }
              >
                <Rect
                  x={0}
                  y={0}
                  width={cellPixelSize(cell, scale).w}
                  height={cellPixelSize(cell, scale).h}
                  fill={material.groutColorHex ?? '#cfcac2'}
                />
                {cell.tiles.map((tile, index) => {
                  const [tx, ty] = tileTopLeft(cell, tile);
                  const rect = {
                    x: tx * scale,
                    y: ty * scale,
                    width: tile.width * scale,
                    height: tile.height * scale,
                  };
                  return textureUri ? (
                    <SvgImage
                      key={index}
                      href={{ uri: textureUri }}
                      {...rect}
                      preserveAspectRatio="xMidYMid slice"
                    />
                  ) : (
                    <Rect key={index} {...rect} fill={material.colorHex} />
                  );
                })}
              </Pattern>
            </Defs>
          ) : null}
          <Rect
            x={0}
            y={0}
            width={boxWidth}
            height={height}
            fill={cell ? `url(#${id})` : material.colorHex}
          />
        </Svg>
      </View>
      {caption || showScaleNote ? (
        <Text
          style={[styles.caption, { color: colors.textSecondary }]}
          numberOfLines={2}
        >
          {[
            caption,
            showScaleNote ? `shown across ${SWATCH_REFERENCE_M} m` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  frame: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  caption: { fontSize: 12 },
});
