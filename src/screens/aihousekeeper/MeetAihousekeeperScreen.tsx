import { useNavigation } from "expo-router/react-navigation";
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppBackground } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Button, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useAihousekeeperPersona } from '@hooks/useAihousekeeperPersona';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useAihousekeeperStore } from '@stores/aihousekeeperStore';
import { useAppColors } from '@theme';
import type { IoniconName } from '@utils/categoryIcons';

/**
 * 3-slide Aihousekeeper intro (plan §H2).
 *
 * Greenfield: shown once after sign-in, gated by the MMKV-persisted
 * `hasSeenIntro` flag in `useAihousekeeperStore` (key `aihousekeeper_has_seen_aihousekeeper_intro`).
 * After "Got it" or "Skip", `setHasSeenIntro(true)` writes the flag so the
 * screen never appears again.
 */

export function MeetAihousekeeperScreen() {
  const colors = useAppColors();  const navigation = useNavigation();
  const { isTablet } = useDeviceType();
  const { content: containerPadding } = useLayoutPadding();
  const setHasSeenIntro = useAihousekeeperStore((s) => s.setHasSeenIntro);
  const { name: personaName } = useAihousekeeperPersona();

  const slides = useMemo<
    { icon: IoniconName; title: string; body: string }[]
  >(
    () => [
      {
        icon: 'hand-left',
        title: `Hi, I'm ${personaName}`,
        body:
          "I'm your household's quiet co-pilot. I read your inspection reports, keep an eye on what's coming up, and loop in contractors when needed — without spamming you.",
      },
      {
        icon: 'sunny',
        title: 'One briefing a day',
        body:
          "Every morning I give you a short rundown: what's due, what changed, what I'm keeping tabs on. That's it. No daily digest fatigue.",
      },
      {
        icon: 'shield-checkmark',
        title: "You're always in charge",
        body:
          "I show my work in the trust ledger, so you can see why I did what I did — and undo anything that isn't right.",
      },
    ],
    [personaName]
  );

  const [slide, setSlide] = useState(0);
  const current = slides[slide];
  const isLast = slide === slides.length - 1;

  const dismiss = () => {
    setHasSeenIntro(true);
    navigation.goBack();
  };

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container}>
        <AdaptiveContainer
          maxWidth={isTablet ? 600 : undefined}
          padding={containerPadding}
        >
          <View style={styles.content}>
            <View style={styles.topRow}>
              <Pressable onPress={dismiss}>
                <Typography
                  variant="footnote"
                  weight="medium"
                  color={colors.textSecondary}
                >
                  Skip
                </Typography>
              </Pressable>
            </View>

            <View style={styles.slide}>
              <Icon
                name={current.icon}
                size={72}
                color={colors.primary}
                style={styles.icon}
              />
              <Typography
                variant="title3"
                weight="bold"
                style={styles.title}
              >
                {current.title}
              </Typography>
              <Typography
                variant="body"
                color={colors.textSecondary}
                style={styles.body}
              >
                {current.body}
              </Typography>
            </View>

            <View style={styles.dots}>
              {slides.map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    {
                      backgroundColor:
                        i === slide
                          ? colors.primary
                          : colors.borderColor,
                    },
                  ]}
                />
              ))}
            </View>

            <View style={styles.buttonRow}>
              <Button
                title={isLast ? 'Got it' : 'Next'}
                variant="primary"
                size="md"
                onPress={() => {
                  if (isLast) dismiss();
                  else setSlide((s) => s + 1);
                }}
              />
            </View>
          </View>
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, paddingTop: 32, paddingBottom: 32 },
  topRow: { flexDirection: 'row', justifyContent: 'flex-end', padding: 8 },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  icon: {
    marginBottom: 24,
  },
  title: { textAlign: 'center', marginBottom: 12 },
  body: { textAlign: 'center', lineHeight: 24 },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 16,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  buttonRow: { marginTop: 16, paddingHorizontal: 24 },
});
