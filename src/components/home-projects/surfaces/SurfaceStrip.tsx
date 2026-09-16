/**
 * The surface picker — a scrolling strip of live, scale-true thumbnails.
 *
 * Members do not think in a list of surface names. They think "the wall with
 * the window" and "the one behind the bath", and the fastest way to let them
 * say that on a phone is to show each surface as what it will look like. A
 * thumbnail rendered by the same `SurfaceCanvas` as the big view means the
 * chip is never out of date and never a different drawing of the same thing —
 * a wainscot appears in the strip the instant it is split.
 *
 * The thumbnails are deliberately not square. A wall drawn in a square box is
 * either letterboxed into a stripe or scaled non-uniformly, and the second is
 * the one thing this feature must never do, so the box is a wide rectangle and
 * `fitProjection` letterboxes honestly inside it.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { surfaceNetArea } from '@features/house/surfaces';
import {
  formatSurfaceArea,
  type LengthUnit,
} from '@features/house/surfaces/units';
import type { Material, Surface } from '@symply/contracts';
import { useAppColors } from '@theme';

import { SurfaceCanvas } from './SurfaceCanvas';

const THUMB_WIDTH = 104;
const THUMB_HEIGHT = 66;

export interface SurfaceStripProps {
  surfaces: Surface[];
  materials: Material[];
  textureUris?: Record<string, string | undefined>;
  selectedSurfaceId: string | null;
  onSelect: (surfaceId: string) => void;
  lengthUnit?: LengthUnit;
  /** Surfaces whose plan edge changed under a locked outline. */
  staleSurfaceIds?: string[];
  testID?: string;
}

export function SurfaceStrip({
  surfaces,
  materials,
  textureUris,
  selectedSurfaceId,
  onSelect,
  lengthUnit = 'm',
  staleSurfaceIds = [],
  testID,
}: SurfaceStripProps) {
  const colors = useAppColors();
  const stale = new Set(staleSurfaceIds);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      testID={testID}
    >
      {surfaces.map(surface => {
        const selected = surface.id === selectedSurfaceId;
        const netM2 = surfaceNetArea(surface);
        /**
         * What is on it, in as few words as the chip has room for.
         *
         * The AREA is always shown and is never the thing that gets dropped:
         * it is the number a member scans the strip for — "which of these is
         * the big one" — and it was previously replaced by "No finish yet" on
         * exactly the surfaces they had not decided about, which is when they
         * most needed it.
         */
        const finishes = new Set(
          [
            surface.materialId,
            ...surface.subAreas.map(area => area.materialId),
          ].filter((id): id is string => Boolean(id)),
        );
        const finishLabel =
          finishes.size === 0
            ? 'No finish yet'
            : finishes.size === 1
            ? materials.find(m => m.id === [...finishes][0])?.name ?? '1 finish'
            : `${finishes.size} finishes`;
        return (
          <Pressable
            key={surface.id}
            onPress={() => onSelect(surface.id)}
            style={[
              styles.chip,
              {
                borderColor: selected ? colors.primary : colors.borderColor,
                borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
                backgroundColor: colors.card,
                opacity: surface.excluded ? 0.45 : 1,
              },
            ]}
            testID={`surface-chip-${surface.id}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${surface.label}, ${formatSurfaceArea(
              netM2,
              lengthUnit,
            )}, ${surface.excluded ? 'not in scope' : finishLabel}`}
          >
            <SurfaceCanvas
              surface={surface}
              materials={materials}
              textureUris={textureUris}
              width={THUMB_WIDTH}
              height={THUMB_HEIGHT}
              padding={6}
              showOpenings
              backgroundColor={colors.card}
              outlineColor={colors.textPrimary}
              mutedColor={colors.textSecondary}
              accentColor={colors.primary}
            />
            <Text
              style={[styles.label, { color: colors.textPrimary }]}
              numberOfLines={1}
            >
              {surface.label}
            </Text>
            <Text
              style={[styles.area, { color: colors.textPrimary }]}
              numberOfLines={1}
            >
              {formatSurfaceArea(netM2, lengthUnit)}
            </Text>
            <Text
              style={[styles.meta, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {surface.excluded ? 'Not in scope' : finishLabel}
            </Text>
            {stale.has(surface.id) ? (
              <View style={[styles.badge, { backgroundColor: colors.warning }]}>
                <Text style={styles.badgeText}>Plan changed</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 10, paddingVertical: 8, paddingHorizontal: 2 },
  chip: {
    borderRadius: 12,
    padding: 6,
    width: THUMB_WIDTH + 12,
    overflow: 'hidden',
    // The thumbnail is centred in its own box, so left-aligned text under it
    // read as a second, misaligned column.
    alignItems: 'center',
  },
  label: { fontSize: 12, fontWeight: '700', marginTop: 6, textAlign: 'center' },
  area: { fontSize: 12, fontWeight: '600', marginTop: 2, textAlign: 'center' },
  meta: { fontSize: 11, marginTop: 1, textAlign: 'center' },
  badge: {
    marginTop: 5,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
    alignSelf: 'center',
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
});
