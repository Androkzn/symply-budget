import { useNavigation } from "expo-router/react-navigation";
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Button, Card, Typography } from '@components/ui';
import { useAihousekeeperPersona } from '@hooks/useAihousekeeperPersona';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useAppColors } from '@theme';

/**
 * 2-step Aihousekeeper onboarding (plan §H2):
 *   1. Family role
 *   2. Responsibilities
 *
 * This screen gathers preferences locally and is intended to POST the result
 * via an existing household/member-update API. Concrete API wiring is left
 * to a follow-up once Stream F exposes `aihousekeeper/onboarding`; the shell here
 * demonstrates the 2-step flow and leaves one `onSubmit` callback.
 */

const ROLE_OPTIONS = [
  { value: 'primary', label: 'Primary home owner' },
  { value: 'co_owner', label: 'Co-owner / partner' },
  { value: 'roommate', label: 'Roommate' },
  { value: 'guest', label: 'Just helping out' },
] as const;

const RESPONSIBILITY_OPTIONS = [
  { value: 'maintenance', label: 'Maintenance & repairs' },
  { value: 'cleaning', label: 'Cleaning & upkeep' },
  { value: 'contractors', label: 'Hiring contractors' },
  { value: 'bills', label: 'Bills & utilities' },
  { value: 'appliances', label: 'Appliances & electronics' },
  { value: 'outdoor', label: 'Yard / outdoor' },
];

type Role = (typeof ROLE_OPTIONS)[number]['value'];

export function AihousekeeperOnboardingScreen() {  const colors = useAppColors();
  const navigation = useNavigation();
  const { isTablet } = useDeviceType();
  const { content: containerPadding } = useLayoutPadding();
  const { name: personaName } = useAihousekeeperPersona();

  const [step, setStep] = useState<1 | 2>(1);
  const [role, setRole] = useState<Role | null>(null);
  const [responsibilities, setResponsibilities] = useState<Set<string>>(
    new Set()
  );

  const toggleResponsibility = (value: string) => {
    setResponsibilities((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  };

  const handleFinish = () => {
    // TODO(Stream F): wire to backend aihousekeeper/onboarding endpoint when it lands.
    // Locally, defer to the navigator to pop back; a future patch can mutate
    // household_members.responsibilities_json via the members API.
    navigation.goBack();
  };

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container}>
        <ScreenHeader
          title={`Meet ${personaName}`}
          showBackButton
          onBackPress={() => {
            if (step === 2) setStep(1);
            else navigation.goBack();
          }}
        />
        <AdaptiveContainer
          maxWidth={isTablet ? 800 : undefined}
          padding={containerPadding}
        >
          <ScrollView
        style={screenScrollViewStyle.scroll}
        contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>
            <Typography
              variant="footnote"
              color={colors.textSecondary}
              style={{ marginBottom: 4 }}
            >
              Step {step} of 2
            </Typography>

            {step === 1 ? (
              <>
                <Typography variant="title3" weight="bold">
                  What's your role at home?
                </Typography>
                <Typography
                  variant="body"
                  color={colors.textSecondary}
                  style={{ marginTop: 8, marginBottom: 16 }}
                >
                  {personaName} uses this to decide who to ping for what.
                </Typography>

                {ROLE_OPTIONS.map((opt) => {
                  const active = role === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => setRole(opt.value)}
                    >
                      <Card
                        variant="filled"
                        style={[
                          styles.optionCard,
                          {
                            backgroundColor: active
                              ? colors.primary
                              : colors.backgroundSecondary,
                          },
                        ]}
                      >
                        <Typography
                          variant="body"
                          weight="medium"
                          color={active ? colors.white : colors.textPrimary}
                        >
                          {opt.label}
                        </Typography>
                      </Card>
                    </Pressable>
                  );
                })}

                <View style={{ marginTop: 20 }}>
                  <Button
                    title="Continue"
                    variant="primary"
                    size="md"
                    onPress={() => setStep(2)}
                    disabled={!role}
                  />
                </View>
              </>
            ) : (
              <>
                <Typography variant="title3" weight="bold">
                  What do you handle?
                </Typography>
                <Typography
                  variant="body"
                  color={colors.textSecondary}
                  style={{ marginTop: 8, marginBottom: 16 }}
                >
                  Pick whatever applies — {personaName} uses this to route reminders.
                </Typography>

                {RESPONSIBILITY_OPTIONS.map((opt) => {
                  const active = responsibilities.has(opt.value);
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => toggleResponsibility(opt.value)}
                    >
                      <Card
                        variant="filled"
                        style={[
                          styles.optionCard,
                          {
                            backgroundColor: active
                              ? colors.primary
                              : colors.backgroundSecondary,
                          },
                        ]}
                      >
                        <Typography
                          variant="body"
                          weight="medium"
                          color={active ? colors.white : colors.textPrimary}
                        >
                          {opt.label}
                        </Typography>
                      </Card>
                    </Pressable>
                  );
                })}

                <View style={{ marginTop: 20 }}>
                  <Button
                    title="Done"
                    variant="primary"
                    size="md"
                    onPress={handleFinish}
                  />
                </View>
              </>
            )}
          </ScrollView>
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingBottom: 120 },
  optionCard: { marginBottom: 8 },
});
