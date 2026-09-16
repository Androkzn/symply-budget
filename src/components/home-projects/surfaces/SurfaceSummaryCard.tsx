/**
 * The hub's window onto the surface planner.
 *
 * Read-only on purpose. The planner owns a drag gesture and two canvases, and
 * both fight the hub's scroll view; more importantly, **two editors writing the
 * same `home_project_geometry` row is a data-loss path**. `FloorPlanEditor`
 * wrote the v1 payload under `source: 'manual'` — the same row the surface
 * document occupies — so a member who opened the old editor on a v2 project and
 * tapped save would have replaced their walls, sub-areas and materials with a
 * width and a depth, with no warning and nothing to undo it. This card replaced
 * that editor in the hub rather than sitting beside it.
 *
 * A v1 payload still on a project is not a problem to report: the planner
 * upgrades it on open (`roomSurfaceModelFromLegacy`), so the card says what will
 * happen rather than asking the member to do anything about it.
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { HouseUnitSystem } from '@api/households';
import {
  computeTakeoff,
  loadRoomSurfaceModel,
  lengthUnitFor,
  formatSurfaceArea,
} from '@features/house/surfaces';
import { useAppColors } from '@theme';

import { RoomPlanCanvas } from './RoomPlanCanvas';

export interface SurfaceSummaryCardProps {
  payloadJson: string | null | undefined;
  source?: string;
  unitSystem?: HouseUnitSystem | null;
  onOpen: () => void;
  testID?: string;
}

export function SurfaceSummaryCard({
  payloadJson,
  source,
  unitSystem,
  onOpen,
  testID,
}: SurfaceSummaryCardProps) {
  const colors = useAppColors();
  const lengthUnit = lengthUnitFor(unitSystem ?? 'imperial');
  const loaded = useMemo(
    () => loadRoomSurfaceModel(payloadJson),
    [payloadJson],
  );
  const takeoff = useMemo(
    () => (loaded.model ? computeTakeoff(loaded.model) : null),
    [loaded.model],
  );

  const wallCount =
    loaded.model?.surfaces.filter(s => s.kind === 'wall').length ?? 0;
  const areaCount =
    loaded.model?.surfaces.reduce(
      (sum, surface) => sum + surface.subAreas.length,
      0,
    ) ?? 0;

  return (
    <View
      style={[
        styles.card,
        { borderColor: colors.borderColor, backgroundColor: colors.card },
      ]}
      testID={testID}
    >
      {loaded.model ? (
        <>
          <RoomPlanCanvas
            model={loaded.model}
            width={260}
            height={170}
            selectedSurfaceId={null}
            showAreas={false}
            lengthUnit={lengthUnit}
            colors={{
              outline: colors.textPrimary,
              fill: colors.backgroundMain,
              muted: colors.textSecondary,
              accent: colors.primary,
              background: colors.card,
              text: colors.textPrimary,
            }}
            testID="surface-summary-plan"
          />
          <Text style={[styles.line, { color: colors.textPrimary }]}>
            {wallCount} wall{wallCount === 1 ? '' : 's'}, floor and ceiling
            {areaCount > 0
              ? ` · ${areaCount} sub-area${areaCount === 1 ? '' : 's'}`
              : ''}
          </Text>
          {takeoff ? (
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              {formatSurfaceArea(takeoff.totalNetM2, lengthUnit)} to finish
              {takeoff.unassignedM2 > 0
                ? ` · ${formatSurfaceArea(
                    takeoff.unassignedM2,
                    lengthUnit,
                  )} still to decide`
                : ' · every area has a finish'}
            </Text>
          ) : null}
          {loaded.origin === 'upgraded_v1' ? (
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              Built from this project’s earlier measurements — open it to check
              the shape.
            </Text>
          ) : null}
          {source ? (
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              Source: {source}
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          Lay out the room once, then give each wall, the floor and the ceiling
          its own finish — including different materials on parts of the same
          wall. Quantities and costs follow from the measurements.
        </Text>
      )}

      <Pressable
        style={[styles.cta, { backgroundColor: colors.primary }]}
        onPress={onOpen}
        testID="open-surface-studio"
      >
        <Text style={styles.ctaText}>
          {loaded.model ? 'Open the surface planner' : 'Plan the surfaces'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
    gap: 8,
    alignItems: 'flex-start',
  },
  line: { fontSize: 14, fontWeight: '600' },
  meta: { fontSize: 12, lineHeight: 17 },
  cta: {
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    alignSelf: 'stretch',
    marginTop: 4,
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
