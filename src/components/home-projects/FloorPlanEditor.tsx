/**
 * SUPERSEDED — do not re-wire this into a screen.
 *
 * This was the hub's room editor: two numbers, a rectangle, and a v1 payload
 * written to `home_project_geometry` under `source: 'manual'`. The surface
 * planner (`screens/home-projects/SurfaceStudioScreen.tsx`) now owns that
 * **same row**, with a `schema_version: 2` document holding every surface, its
 * sub-areas, its openings and the project's material palette.
 *
 * The two cannot coexist on one project. `onSave` here writes a payload with a
 * width and a depth in it, so a member who opened this on a planned room and
 * tapped save would replace their walls, their wainscot and their tile
 * selections with a rectangle — no warning, nothing to undo it. That is why the
 * hub's Plans section renders `SurfaceSummaryCard` instead, and why nothing
 * imports this any more.
 *
 * It is kept rather than deleted because `roomSurfaceModelFromLegacy` upgrades
 * exactly what it used to write, and this file is the readable specification of
 * that shape (`ManualGeometryPayload` below). Read it; do not mount it.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, G, Line, Rect } from 'react-native-svg';

import { useAppColors } from '@theme';
import { numericTextHandler } from '@utils/keyboard';

export interface ManualGeometryPayload {
  units: 'm';
  floor: {
    polygon: [number, number][];
    area_m2: number;
    openings: Array<{ type: string; wallId: string; width_m: number }>;
  };
  walls: Array<{
    id: string;
    label: string;
    width_m: number;
    height_m: number;
    openings: unknown[];
  }>;
  ceiling: { area_m2: number };
  source_meta: { captured_at: string };
}

function dimsFromPayloadJson(payloadJson: string | null | undefined): {
  width: number;
  height: number;
} | null {
  if (!payloadJson) return null;
  try {
    const parsed = JSON.parse(payloadJson) as ManualGeometryPayload;
    const poly = parsed?.floor?.polygon;
    if (!poly || poly.length < 3) return null;
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    return {
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  } catch {
    return null;
  }
}

export function FloorPlanEditor({
  initialWidth = 3.2,
  initialHeight = 2.4,
  initialPayloadJson,
  onSave,
}: {
  initialWidth?: number;
  initialHeight?: number;
  initialPayloadJson?: string | null;
  onSave: (payload: ManualGeometryPayload) => void;
}) {
  const colors = useAppColors();
  const fromPayload = dimsFromPayloadJson(initialPayloadJson);
  const [widthM, setWidthM] = useState(String(fromPayload?.width ?? initialWidth));
  const [heightM, setHeightM] = useState(String(fromPayload?.height ?? initialHeight));

  const w = Math.max(0.5, Number(widthM) || initialWidth);
  const h = Math.max(0.5, Number(heightM) || initialHeight);
  const area = Number((w * h).toFixed(2));

  const preview = useMemo(() => {
    const scale = 80;
    return { pw: w * scale, ph: h * scale };
  }, [w, h]);

  const buildPayload = (): ManualGeometryPayload => ({
    units: 'm',
    floor: {
      polygon: [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ],
      area_m2: area,
      openings: [],
    },
    walls: [
      { id: 'w1', label: 'North', width_m: w, height_m: 2.4, openings: [] },
      { id: 'w2', label: 'East', width_m: h, height_m: 2.4, openings: [] },
      { id: 'w3', label: 'South', width_m: w, height_m: 2.4, openings: [] },
      { id: 'w4', label: 'West', width_m: h, height_m: 2.4, openings: [] },
    ],
    ceiling: { area_m2: area },
    source_meta: { captured_at: new Date().toISOString() },
  });

  return (
    <View style={styles.wrap}>
      <Text style={[styles.help, { color: colors.textSecondary }]}>
        Enter room dimensions (meters). Measured RoomPlan scans replace this when available.
      </Text>
      <View style={styles.inputs}>
        <LabeledInput label="Width (m)" value={widthM} onChangeText={setWidthM} colors={colors} />
        <LabeledInput label="Depth (m)" value={heightM} onChangeText={setHeightM} colors={colors} />
      </View>
      <View style={[styles.canvas, { borderColor: colors.borderColor }]}>
        <Svg width={Math.min(280, preview.pw + 40)} height={Math.min(220, preview.ph + 40)}>
          <G transform="translate(20,20)">
            <Rect
              x={0}
              y={0}
              width={preview.pw}
              height={preview.ph}
              stroke={colors.primary}
              strokeWidth={2}
              fill={colors.card}
            />
            <Line x1={0} y1={0} x2={preview.pw} y2={0} stroke={colors.primary} strokeWidth={2} />
            <Circle cx={0} cy={0} r={5} fill={colors.primary} />
            <Circle cx={preview.pw} cy={0} r={5} fill={colors.primary} />
            <Circle cx={preview.pw} cy={preview.ph} r={5} fill={colors.primary} />
            <Circle cx={0} cy={preview.ph} r={5} fill={colors.primary} />
          </G>
        </Svg>
        <Text style={[styles.area, { color: colors.textSecondary }]}>{area} m²</Text>
      </View>
      <Pressable
        style={[styles.save, { backgroundColor: colors.primary }]}
        onPress={() => onSave(buildPayload())}
        testID="floor-plan-editor-save"
      >
        <Text style={styles.saveText}>Save room plan</Text>
      </Pressable>
    </View>
  );
}

function LabeledInput({
  label,
  value,
  onChangeText,
  colors,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  colors: ReturnType<typeof useAppColors>;
}) {
  return (
    <View style={styles.inputWrap}>
      <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        value={value}
        // Raw RN input, so the decimal pad is only a suggestion — a paste or a
        // Bluetooth keyboard still puts letters into a metre measurement.
        onChangeText={numericTextHandler(onChangeText)}
        keyboardType="decimal-pad"
        style={[
          styles.input,
          { color: colors.textPrimary, borderColor: colors.borderColor, backgroundColor: colors.card },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  help: { fontSize: 13, lineHeight: 18 },
  inputs: { flexDirection: 'row', gap: 12 },
  inputWrap: { flex: 1 },
  inputLabel: { fontSize: 12, marginBottom: 4 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 16,
  },
  canvas: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    minHeight: 160,
  },
  area: { marginTop: 8, fontSize: 13 },
  save: { borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
