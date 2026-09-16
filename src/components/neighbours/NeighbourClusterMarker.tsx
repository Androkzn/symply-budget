import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Typography } from '@components/ui';
import { useAppColors } from '@theme';

/**
 * The "6 homes" bubble that stands in for several pins at low zoom.
 *
 * Two numbers, not one, and that is the design: a cluster on THIS map is a
 * group of households, and "6 homes · 14 people" answers a different question
 * from "6". A member zoomed out to the whole neighbourhood is asking how many
 * people they have recorded, not how many markers got merged.
 *
 * ## Size scales with count, within bounds
 *
 * Every mapping library does this and it is worth saying why rather than copying
 * it: a cluster's size is the only channel available for magnitude once the
 * label is too small to read at a glance, and an unbounded scale produces a
 * bubble that covers the map. The range here is deliberately narrow — a
 * neighbourhood has tens of homes, not thousands, so the useful discrimination
 * is between "a few" and "a lot", not between 40 and 400.
 */

export const CLUSTER_MIN_SIZE = 46;
export const CLUSTER_MAX_SIZE = 68;

export function clusterSizeFor(count: number): number {
  if (count <= 2) return CLUSTER_MIN_SIZE;
  // log2 so the growth flattens: 4 homes and 8 homes differ visibly, 30 and 40
  // do not need to.
  const scaled = CLUSTER_MIN_SIZE + Math.log2(count) * 6;
  return Math.min(CLUSTER_MAX_SIZE, Math.round(scaled));
}

export type NeighbourClusterMarkerProps = {
  /** How many HOMES this bubble stands for. */
  homeCount: number;
  /** How many PEOPLE live in them, summed. Omitted when none are recorded. */
  personCount: number;
  testID?: string;
};

export function NeighbourClusterMarker({
  homeCount,
  personCount,
  testID,
}: NeighbourClusterMarkerProps) {
  const colors = useAppColors();
  const size = clusterSizeFor(homeCount);

  return (
    <View style={styles.wrapper} testID={testID}>
      {/* The halo. A cluster has no tail — it points at no single house — so the
          soft outer ring is what stops it reading as one very large pin. */}
      <View
        style={[
          styles.halo,
          {
            width: size + 12,
            height: size + 12,
            borderRadius: (size + 12) / 2,
            backgroundColor: `${colors.primary}26`,
          },
        ]}
      />
      <View
        style={[
          styles.bubble,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colors.primary,
            borderColor: colors.backgroundMain,
          },
        ]}
      >
        <Typography variant="headline" weight="bold" style={{ color: colors.white }}>
          {homeCount}
        </Typography>
        {personCount > 0 && (
          <Typography
            variant="caption2"
            weight="medium"
            style={{ color: colors.white, opacity: 0.9, marginTop: -2 }}
          >
            {personCount === 1 ? '1 person' : `${personCount} people`}
          </Typography>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
  },
  halo: {
    position: 'absolute',
  },
  bubble: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 6,
  },
});
