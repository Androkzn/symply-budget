/**
 * StepExampleModal — opens from a step's ⓘ button and shows the annotated
 * example console screen for that step (an in-app mock, not a bundled
 * screenshot; see `AnnotatedConsole`).
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { AIProviderId } from '@api/aiAccess';
import { BottomSheet, Typography } from '@components/ui';
import { useAppColors } from '@theme';

import { AnnotatedConsole } from './ConsoleMock';
import type { ProviderGuideStep } from './providerMeta';

interface StepExampleModalProps {
  provider: AIProviderId;
  /** The step whose example to show, or null when nothing is open. */
  step: ProviderGuideStep | null;
  /** 1-based number of the step, for the header. */
  stepNumber: number;
  visible: boolean;
  onClose: () => void;
}

export function StepExampleModal({ provider, step, stepNumber, visible, onClose }: StepExampleModalProps) {
  const colors = useAppColors();

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height="standard"
      showCloseButton
      title={`Step ${stepNumber}`}
    >
      {step ? (
        <View style={styles.content} testID="ai-step-example-modal">
          <Typography variant="title3" weight="semibold" color={colors.textPrimary}>
            {step.example.headline}
          </Typography>
          <AnnotatedConsole provider={provider} visual={step.visual} comment={step.example.comment} />
          <Typography variant="caption1" color={colors.textTertiary} style={styles.disclaimer}>
            Illustrative example — the real console may look a little different.
          </Typography>
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 14,
    paddingBottom: 8,
  },
  disclaimer: {
    lineHeight: 17,
  },
});
