/**
 * ProviderKeyGuide — an illustrated, in-app "how to get your API key" diagram.
 *
 * Rather than bundling real console screenshots (which go stale the moment a
 * provider redesigns, add app weight, and carry brand-asset concerns) this
 * renders a lightweight, theme-aware guide: a header with the provider's own
 * logo + name, then a numbered step timeline. Step 1 is a live link into the
 * provider console (with the console address shown right beneath it), and every
 * step exposes an ⓘ that opens an annotated example of the screen it refers to.
 *
 * It is fully self-contained and brand-neutral for the app, so every app in the
 * ecosystem renders it in its own colours.
 */

import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import type { AIProviderId } from '@api/aiAccess';
import { Icon, Typography } from '@components/ui';
import { useAppColors } from '@theme';

import { ProviderBrandMark } from './ProviderBrandMark';
import { PROVIDER_META, type ProviderGuideStep } from './providerMeta';
import { StepExampleModal } from './StepExampleModal';

interface ProviderKeyGuideProps {
  provider: AIProviderId;
}

export function ProviderKeyGuide({ provider }: ProviderKeyGuideProps) {
  const colors = useAppColors();
  const meta = PROVIDER_META[provider];
  const [exampleIndex, setExampleIndex] = useState<number | null>(null);

  const openConsole = () => {
    Linking.openURL(meta.consoleUrl).catch(() => {
      /* no-op: user can still type the URL from the visible host */
    });
  };

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.borderColor },
      ]}
      accessibilityLabel={`How to get your ${meta.label} key`}
    >
      {/* Header — provider logo + name */}
      <View style={styles.header}>
        <ProviderBrandMark provider={provider} size={40} />
        <View style={styles.headerText}>
          <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
            {meta.label}
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary}>
            How to get your key · about a minute
          </Typography>
        </View>
        {meta.freeTier ? (
          <View style={[styles.freePill, { backgroundColor: colors.success + '22' }]}>
            <Typography variant="caption2" weight="semibold" color={colors.success}>
              FREE TIER
            </Typography>
          </View>
        ) : null}
      </View>

      {/* Step timeline */}
      <View style={styles.steps}>
        {meta.steps.map((step, index) => (
          <GuideStepRow
            key={`${provider}-${index}`}
            step={step}
            index={index}
            isLast={index === meta.steps.length - 1}
            accent={meta.accent}
            keyFormat={meta.keyFormat}
            consoleName={meta.consoleName}
            onOpenConsole={openConsole}
            onInfo={() => setExampleIndex(index)}
          />
        ))}
      </View>

      {/* Cost / plan clarification */}
      <View style={[styles.costRow, { borderTopColor: colors.divider }]}>
        <Icon name="information-circle-outline" size={16} color={colors.textTertiary} />
        <Typography variant="caption1" color={colors.textSecondary} style={styles.costText}>
          {meta.cost}
        </Typography>
      </View>

      <StepExampleModal
        provider={provider}
        step={exampleIndex !== null ? meta.steps[exampleIndex] : null}
        stepNumber={(exampleIndex ?? 0) + 1}
        visible={exampleIndex !== null}
        onClose={() => setExampleIndex(null)}
      />
    </View>
  );
}

function GuideStepRow({
  step,
  index,
  isLast,
  accent,
  keyFormat,
  consoleName,
  onOpenConsole,
  onInfo,
}: {
  step: ProviderGuideStep;
  index: number;
  isLast: boolean;
  accent: string;
  keyFormat: string;
  consoleName: string;
  onOpenConsole: () => void;
  onInfo: () => void;
}) {
  const colors = useAppColors();
  const isLinkStep = index === 0;

  return (
    <View style={styles.stepRow}>
      {/* Numbered rail */}
      <View style={styles.rail}>
        <View style={[styles.stepNum, { backgroundColor: accent }]}>
          <Typography variant="caption1" weight="bold" color={colors.white}>
            {index + 1}
          </Typography>
        </View>
        {!isLast ? <View style={[styles.railLine, { backgroundColor: colors.divider }]} /> : null}
      </View>

      {/* Step body + inline illustration */}
      <View style={styles.stepBody}>
        <View style={styles.stepHeaderRow}>
          <View style={styles.stepTitleCol}>
            {isLinkStep ? (
              <Pressable
                onPress={onOpenConsole}
                accessibilityRole="link"
                accessibilityLabel={`${step.title} — opens ${consoleName}`}
                style={styles.linkTitleRow}
                hitSlop={6}
              >
                <Typography variant="subheadline" weight="semibold" color={accent} style={styles.linkTitle}>
                  {step.title}
                </Typography>
                <Icon name="open-outline" size={14} color={accent} />
              </Pressable>
            ) : (
              <Typography variant="subheadline" weight="medium" color={colors.textPrimary}>
                {step.title}
              </Typography>
            )}
            {step.detail ? (
              <Typography variant="caption1" color={colors.textSecondary} style={styles.stepDetail}>
                {step.detail}
              </Typography>
            ) : null}
          </View>

          {/* Per-step "see an example" info button */}
          <Pressable
            onPress={onInfo}
            accessibilityRole="button"
            accessibilityLabel={`See an example: ${step.title}`}
            testID={`ai-guide-step-info-${index}`}
            hitSlop={8}
            style={styles.infoButton}
          >
            <Icon name="information-circle-outline" size={20} color={colors.textTertiary} />
          </Pressable>
        </View>

        {isLinkStep ? (
          <ConsoleBar consoleName={consoleName} accent={accent} onPress={onOpenConsole} />
        ) : (
          <StepIllustration visual={step.visual} accent={accent} keyFormat={keyFormat} />
        )}
      </View>
    </View>
  );
}

/** The provider console address as a tappable browser bar (moved under step 1). */
function ConsoleBar({
  consoleName,
  accent,
  onPress,
}: {
  consoleName: string;
  accent: string;
  onPress: () => void;
}) {
  const colors = useAppColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`Open ${consoleName}`}
      style={[styles.browser, { backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor }]}
    >
      <View style={styles.trafficLights}>
        <View style={[styles.dot, { backgroundColor: '#FF5F57' }]} />
        <View style={[styles.dot, { backgroundColor: '#FEBC2E' }]} />
        <View style={[styles.dot, { backgroundColor: '#28C840' }]} />
      </View>
      <View style={[styles.urlPill, { backgroundColor: colors.backgroundMain, borderColor: colors.borderColor }]}>
        <Icon name="lock-closed" size={11} color={colors.textTertiary} />
        <Typography variant="caption1" color={colors.textSecondary} numberOfLines={1} style={styles.urlText}>
          {consoleName}
        </Typography>
        <Icon name="open-outline" size={13} color={accent} />
      </View>
    </Pressable>
  );
}

function StepIllustration({
  visual,
  accent,
  keyFormat,
}: {
  visual: ProviderGuideStep['visual'];
  accent: string;
  keyFormat: string;
}) {
  const colors = useAppColors();

  if (visual === 'create') {
    return (
      <View style={styles.mockRow}>
        <View style={[styles.mockButton, { backgroundColor: accent }]}>
          <Icon name="add" size={13} color={colors.white} />
          <Typography variant="caption1" weight="semibold" color={colors.white}>
            Create key
          </Typography>
        </View>
      </View>
    );
  }

  if (visual === 'copy') {
    return (
      <View style={styles.mockRow}>
        <View style={[styles.keyChip, { backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor }]}>
          <Typography variant="caption1" color={colors.textSecondary} numberOfLines={1} style={styles.keyChipText}>
            {keyFormat.split(' ')[0]}••••••••••••
          </Typography>
          <Icon name="copy-outline" size={14} color={accent} />
        </View>
      </View>
    );
  }

  if (visual === 'billing') {
    return (
      <View style={styles.mockRow}>
        <View style={[styles.billingChip, { borderColor: colors.borderColor }]}>
          <Icon name="card-outline" size={13} color={colors.textTertiary} />
          <Typography variant="caption2" color={colors.textTertiary}>
            Billing
          </Typography>
        </View>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerText: {
    flex: 1,
  },
  freePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  browser: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  trafficLights: {
    flexDirection: 'row',
    gap: 5,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  urlPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  urlText: {
    flex: 1,
  },
  steps: {
    gap: 0,
  },
  stepRow: {
    flexDirection: 'row',
    gap: 12,
  },
  rail: {
    alignItems: 'center',
    width: 24,
  },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railLine: {
    flex: 1,
    width: 2,
    marginVertical: 4,
    borderRadius: 1,
    minHeight: 16,
  },
  stepBody: {
    flex: 1,
    paddingBottom: 16,
  },
  stepHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  stepTitleCol: {
    flex: 1,
  },
  linkTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  linkTitle: {
    textDecorationLine: 'underline',
    flexShrink: 1,
  },
  infoButton: {
    marginTop: 1,
  },
  stepDetail: {
    marginTop: 2,
  },
  mockRow: {
    flexDirection: 'row',
    marginTop: 8,
  },
  mockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  keyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: '100%',
  },
  keyChipText: {
    fontFamily: 'Courier',
  },
  billingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  costRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
  },
  costText: {
    flex: 1,
    lineHeight: 17,
  },
});
