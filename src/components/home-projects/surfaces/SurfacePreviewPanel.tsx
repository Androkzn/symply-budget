/**
 * The AI preview, and the receipt that comes with it.
 *
 * Two rules shape this panel, and both exist because a generated picture of a
 * room is unusually easy to mistake for a measurement:
 *
 *  1. **The scale drawing is never replaced.** The render appears *below* the
 *     canvas, labelled as an impression. The drawing above it is the one that
 *     is to scale and the one the quantities came from, and it stays on screen.
 *  2. **The brief is shown, verbatim.** The exact sentences the model was given
 *     — "13 whole pieces across, then a 64 mm cut" — are collapsible directly
 *     under the image. A render with no statement of its instructions is
 *     indistinguishable from one that had none, and this feature's whole claim
 *     is that its pictures follow the measurements.
 *
 * The disclaimer says "for choosing, not for ordering" in those words rather
 * than in legal boilerplate, because that is the actual distinction and members
 * act on it.
 */

import { Image } from 'expo-image';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { HomeProjectAttachment } from '@api/home-projects';
import { HouseBlobImage } from '@components/house-v2/HouseBlobImage';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import type { SurfaceScaleBrief } from '@symply/contracts';
import { useAppColors } from '@theme';

export interface SurfacePreviewPanelProps {
  surfaceLabel: string;
  householdId?: string;
  /** The newest render for this surface, or null. */
  attachment: HomeProjectAttachment | null;
  brief: SurfaceScaleBrief | null;
  width: number;
  busy: boolean;
  /** Absent on a backend that cannot run it — the button is then not shown. */
  onGenerate?: () => void;
  error?: string | null;
  testID?: string;
}

export function SurfacePreviewPanel({
  surfaceLabel,
  householdId,
  attachment,
  brief,
  width,
  busy,
  onGenerate,
  error,
  testID,
}: SurfacePreviewPanelProps) {
  const colors = useAppColors();
  const [briefOpen, setBriefOpen] = useState(false);
  const height = Math.round(width * 0.62);

  return (
    <View style={styles.wrap} testID={testID}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>
        Photo preview
      </Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        A photo-realistic impression of {surfaceLabel.toLowerCase()}, built from
        the drawing above and your real material sizes. For choosing, not for
        ordering — the drawing and the quantities are what to buy from.
      </Text>

      {attachment ? (
        <View
          style={[
            styles.frame,
            { borderColor: colors.borderColor, width, height },
          ]}
        >
          {attachment.blob ? (
            <HouseBlobImage
              descriptor={attachment.blob}
              householdId={householdId}
              width={width}
              height={height}
              accessibilityLabel={`Photo preview of ${surfaceLabel}`}
              testID="surface-preview-blob"
            />
          ) : attachment.url ? (
            <Image
              source={{ uri: attachment.url }}
              style={{ width, height }}
              contentFit="cover"
              testID="surface-preview-image"
            />
          ) : (
            <View style={styles.centered}>
              <Text style={{ color: colors.textSecondary }}>
                This preview is still uploading.
              </Text>
            </View>
          )}
        </View>
      ) : null}

      {error ? (
        <Text
          style={[styles.body, { color: colors.error }]}
          testID="surface-preview-error"
        >
          {error}
        </Text>
      ) : null}

      {brief ? (
        <>
          <Pressable
            onPress={() => setBriefOpen(open => !open)}
            hitSlop={8}
            testID="surface-preview-brief-toggle"
          >
            <Text style={[styles.link, { color: colors.primary }]}>
              {briefOpen
                ? 'Hide what the preview was told'
                : 'What was the preview told?'}
            </Text>
          </Pressable>
          {briefOpen ? (
            <View
              style={[
                styles.briefBox,
                {
                  borderColor: colors.borderColor,
                  backgroundColor: colors.card,
                },
              ]}
              testID="surface-preview-brief"
            >
              {brief.lines.map((line, index) => (
                <Text
                  key={index}
                  style={[styles.briefLine, { color: colors.textSecondary }]}
                >
                  {line}
                </Text>
              ))}
            </View>
          ) : null}
        </>
      ) : null}

      {onGenerate ? (
        <Pressable
          style={[
            styles.cta,
            { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 },
          ]}
          onPress={onGenerate}
          disabled={busy}
          testID="surface-preview-generate"
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaText}>
              {attachment ? 'Generate again' : 'Generate a photo preview'}
            </Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginTop: 8 },
  title: { fontSize: 16, fontWeight: '700' },
  body: { fontSize: 12, lineHeight: 17 },
  frame: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  link: { fontSize: 13, fontWeight: '600' },
  briefBox: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 4,
  },
  briefLine: { fontSize: 12, lineHeight: 17 },
  cta: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
