import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useNavigation } from "expo-router/react-navigation";
import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import type {
  AssistantChannelsEnabled,
  AssistantIdentity,
  AssistantIdentityPatch,
  AssistantMemory,
  AssistantTone,
} from '@/types/aihousekeeper';
import { aihousekeeperApi } from '@api/aihousekeeper';
import { PERSONAS, type PersonaId } from '@assets/aihousekeeper/personas';
import { PersonaAvatar } from '@components/aihousekeeper';
import { AppBackground, ScreenHeader } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Card, EmptyState, TimePickerSheet, Toggle, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { usePersistedQuery } from '@hooks/usePersistedQuery';
import { useAihousekeeperStore } from '@stores/aihousekeeperStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors, scaledFont } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

const TONE_OPTIONS: Array<{ value: AssistantTone; label: string }> = [
  { value: 'warm_brief', label: 'Warm & brief' },
  { value: 'direct', label: 'Direct' },
  { value: 'playful', label: 'Playful' },
];

export function AihousekeeperSettingsScreen() {  const colors = useAppColors();
  const navigation = useNavigation();
  const router = useRouter();
  const { isTablet } = useDeviceType();
  const { content: containerPadding } = useLayoutPadding();
  const queryClient = useQueryClient();
  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);
  const hid = currentHousehold?.id ?? null;
  const selectedPersonaId = useAihousekeeperStore((s) => s.selectedPersonaId);
  const setSelectedPersonaId = useAihousekeeperStore((s) => s.setSelectedPersonaId);
  const customPersonaName = useAihousekeeperStore((s) => s.customPersonaName);
  const setCustomPersonaName = useAihousekeeperStore((s) => s.setCustomPersonaName);

  // Local mirror so the TextInput stays responsive while the user types;
  // we commit to the store on blur or via the Save button.
  const [draftName, setDraftName] = useState(customPersonaName ?? '');
  useEffect(() => {
    setDraftName(customPersonaName ?? '');
  }, [customPersonaName]);

  const activePersona = PERSONAS.find((p) => p.id === selectedPersonaId) ?? PERSONAS[0];
  const defaultName = activePersona.displayName;
  const personaName = customPersonaName ?? defaultName;

  const identityQuery = usePersistedQuery({
    queryKey: ['aihousekeeper', 'identity', hid],
    queryFn: () => {
      if (!hid) throw new Error('No household selected');
      return aihousekeeperApi.getIdentity(hid);
    },
    enabled: !!hid,
  });

  const briefingsQuery = usePersistedQuery({
    queryKey: ['aihousekeeper', 'briefings', hid],
    queryFn: () => {
      if (!hid) throw new Error('No household selected');
      return aihousekeeperApi.listBriefings(hid);
    },
    enabled: !!hid,
  });

  const memoryQuery = usePersistedQuery({
    queryKey: ['aihousekeeper', 'memory', hid, { limit: 20 }],
    queryFn: () => {
      if (!hid) throw new Error('No household selected');
      return aihousekeeperApi.listMemory(hid, { limit: 20 });
    },
    enabled: !!hid,
  });

  const updateIdentity = useMutation({
    mutationFn: (patch: AssistantIdentityPatch) => {
      if (!hid) throw new Error('No household selected');
      return aihousekeeperApi.updateIdentity(hid, patch);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['aihousekeeper', 'identity', hid] });
      queryClient.invalidateQueries({ queryKey: ['aihousekeeper', 'briefings', hid] });
    },
  });

  const forgetMemory = useMutation({
    mutationFn: (memoryId: string) => {
      if (!hid) throw new Error('No household selected');
      return aihousekeeperApi.forgetMemory(hid, memoryId);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['aihousekeeper', 'memory', hid] });
    },
  });

  const identity = identityQuery.data?.identity;
  const briefings = briefingsQuery.data?.briefings ?? [];
  const memories = memoryQuery.data?.memories ?? [];

  const channelsParsed: AssistantChannelsEnabled | null = useMemo(() => {
    if (!identity) return null;
    return parseChannels(identity.channels_enabled);
  }, [identity]);

  const handleToneChange = useCallback(
    (tone: AssistantTone) => {
      if (!hid) return;
      updateIdentity.mutate({ tone });
    },
    [hid, updateIdentity]
  );

  const handleChannelToggle = useCallback(
    (key: keyof AssistantChannelsEnabled) => {
      if (!channelsParsed) return;
      const next: AssistantChannelsEnabled = {
        ...channelsParsed,
        [key]: !channelsParsed[key],
      };
      updateIdentity.mutate({ channels_enabled: next });
    },
    [channelsParsed, updateIdentity]
  );

  const deviceTimezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    []
  );

  // Which timing row is currently showing the native time picker. `null`
  // means no picker is open. `quiet` opens a dual-range picker for both
  // quiet_hours_start and quiet_hours_end in one sheet.
  const [timingPicker, setTimingPicker] = useState<null | 'briefing' | 'quiet'>(null);

  const handleTimeConfirm = useCallback(
    (value: string) => {
      updateIdentity.mutate({ briefing_time: value });
    },
    [updateIdentity]
  );

  const handleQuietRangeConfirm = useCallback(
    (start: string, end: string) => {
      updateIdentity.mutate({ quiet_hours_start: start, quiet_hours_end: end });
    },
    [updateIdentity]
  );

  const handleMaxPingsDelta = useCallback(
    (delta: number) => {
      if (!identity) return;
      const next = Math.max(0, Math.min(20, identity.daily_interrupt_budget + delta));
      if (next === identity.daily_interrupt_budget) return;
      updateIdentity.mutate({ daily_interrupt_budget: next });
    },
    [identity, updateIdentity]
  );

  // Auto-sync the backend timezone to the device's local timezone so
  // briefings and quiet hours respect where the user actually is.
  useEffect(() => {
    if (!hid || !identity) return;
    if (identity.timezone === deviceTimezone) return;
    updateIdentity.mutate({ timezone: deviceTimezone });
    // Only react to identity's timezone and hid; mutation ref is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hid, identity?.timezone, deviceTimezone]);

  const handleForgetMemory = useCallback(
    (memory: AssistantMemory) => {
      Alert.alert(
        'Forget this memory?',
        memory.redacted_body ?? `${personaName} will no longer use this.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Forget',
            style: 'destructive',
            onPress: () => forgetMemory.mutate(memory.id),
          },
        ]
      );
    },
    [forgetMemory]
  );

  if (!hid) {
    return (
      <AppBackground opacity={0.5}>
        <ScreenHeader
          title={personaName}
          showBackButton
          onBackPress={() => navigation.goBack()}
        />
        <EmptyState
          icon="home"
          title="Select a household"
          description={`Pick a household from the switcher to configure ${personaName}.`}
        />
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="aihousekeeper-settings-screen">
        <ScreenHeader
          title={personaName}
          showBackButton
          onBackPress={() => navigation.goBack()}
        />

        <AdaptiveContainer
          maxWidth={isTablet ? 800 : undefined}
          padding={containerPadding}
        >
          {identityQuery.isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : identityQuery.isError || !identity ? (
            <View style={styles.centered}>
              <Typography variant="body" color={colors.textSecondary}>
                Couldn't load {personaName}'s settings.
              </Typography>
              {identityQuery.error ? (
                <Typography
                  variant="footnote"
                  color={colors.textSecondary}
                  style={styles.errorDetail}
                >
                  {formatQueryError(identityQuery.error)}
                </Typography>
              ) : null}
              <Pressable
                onPress={() => identityQuery.refetch()}
                style={[
                  styles.retryBtn,
                  { backgroundColor: colors.primary },
                ]}
              >
                <Typography variant="body" weight="semibold" color={colors.white}>
                  Retry
                </Typography>
              </Pressable>
            </View>
          ) : (
            <ScrollView {...keyboardDismissScrollProps}
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Housekeeper: character picker + optional custom name */}
              <Section title="Housekeeper">
                <Card
                  variant="filled"
                  style={{ backgroundColor: colors.backgroundSecondary }}
                >
                  <View style={styles.personaGrid}>
                    {PERSONAS.map((p) => {
                      const active = p.id === selectedPersonaId;
                      return (
                        <Pressable
                          key={p.id}
                          onPress={() => setSelectedPersonaId(p.id as PersonaId)}
                          style={[
                            styles.personaTile,
                            {
                              borderColor: active
                                ? colors.primary
                                : colors.borderColor,
                              backgroundColor: active
                                ? colors.primary + '15'
                                : 'transparent',
                            },
                          ]}
                        >
                          <PersonaAvatar
                            persona={p}
                            size={86}
                            style={styles.personaTileImage}
                          />
                          <Typography
                            variant="footnote"
                            weight="semibold"
                            style={styles.personaTileName}
                          >
                            {p.displayName}
                          </Typography>
                          <Typography
                            variant="caption2"
                            color={colors.textSecondary}
                            style={styles.personaTileBlurb}
                            numberOfLines={3}
                          >
                            {p.blurb}
                          </Typography>
                        </Pressable>
                      );
                    })}
                  </View>

                  {/* Custom name editor — overrides the character's display
                      name everywhere (tab bar, chat header, placeholder,
                      briefing hero). Empty = use the character's default. */}
                  <View style={styles.nameRow}>
                    <Typography
                      variant="footnote"
                      color={colors.textSecondary}
                      style={styles.label}
                    >
                      Nickname
                    </Typography>
                    <TextInput
                      value={draftName}
                      onChangeText={setDraftName}
                      onBlur={() => {
                        if ((draftName ?? '').trim() !== (customPersonaName ?? '')) {
                          setCustomPersonaName(draftName);
                        }
                      }}
                      placeholder={defaultName}
                      placeholderTextColor={colors.textSecondary}
                      autoCorrect={false}
                      maxLength={40}
                      returnKeyType="done"
                      style={[
                        styles.nameInput,
                        {
                          color: colors.textPrimary,
                          borderColor: colors.borderColor,
                          backgroundColor: colors.backgroundMain,
                        },
                      ]}
                    />
                    {customPersonaName ? (
                      <Pressable
                        onPress={() => {
                          setCustomPersonaName(null);
                          setDraftName('');
                        }}
                        hitSlop={8}
                        style={styles.nameClear}
                      >
                        <Typography
                          variant="caption1"
                          weight="semibold"
                          color={colors.primary}
                        >
                          Reset
                        </Typography>
                      </Pressable>
                    ) : null}
                  </View>
                  <Typography
                    variant="caption2"
                    color={colors.textSecondary}
                    style={styles.nameHint}
                  >
                    Leave empty to use the default ({defaultName}).
                  </Typography>
                </Card>
              </Section>

              {/* Identity & tone */}
              <Section title={`${personaName}'s voice`}>
                <Card
                  variant="filled"
                  style={{ backgroundColor: colors.backgroundSecondary }}
                >
                  <View style={styles.rowList}>
                    <Typography
                      variant="footnote"
                      color={colors.textSecondary}
                      style={styles.label}
                    >
                      Name
                    </Typography>
                    <Typography variant="body" weight="medium">
                      {personaName}
                    </Typography>
                  </View>
                  <View style={styles.rowList}>
                    <Typography
                      variant="footnote"
                      color={colors.textSecondary}
                      style={styles.label}
                    >
                      Tone
                    </Typography>
                    <View style={styles.toneRow}>
                      {TONE_OPTIONS.map((opt) => {
                        const active = identity.tone === opt.value;
                        return (
                          <Pressable
                            key={opt.value}
                            onPress={() => handleToneChange(opt.value)}
                            disabled={updateIdentity.isPending}
                            style={[
                              styles.chip,
                              {
                                borderColor: colors.borderColor,
                                backgroundColor: active
                                  ? colors.primary
                                  : 'transparent',
                              },
                            ]}
                          >
                            <Typography
                              variant="footnote"
                              weight="medium"
                              color={active ? colors.white : colors.textPrimary}
                            >
                              {opt.label}
                            </Typography>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                </Card>
              </Section>

              {/* Briefing windows */}
              <Section title="Timing">
                <Card
                  variant="filled"
                  style={{ backgroundColor: colors.backgroundSecondary }}
                >
                  <KVRow
                    label="Daily briefing time"
                    value={identity.briefing_time}
                    theme={{ colors }}
                    onPress={() => setTimingPicker('briefing')}
                  />
                  <Pressable
                    onPress={() => setTimingPicker('quiet')}
                    style={styles.rowList}
                  >
                    <Typography
                      variant="footnote"
                      color={colors.textSecondary}
                      style={styles.label}
                    >
                      Quiet hours
                    </Typography>
                    <Typography
                      variant="body"
                      weight="medium"
                      color={colors.textPrimary}
                    >
                      {`${identity.quiet_hours_start} – ${identity.quiet_hours_end}`}
                    </Typography>
                  </Pressable>
                  <View style={styles.rowList}>
                    <Typography
                      variant="footnote"
                      color={colors.textSecondary}
                      style={styles.label}
                    >
                      Max pings / day
                    </Typography>
                    <View style={styles.stepper}>
                      <Pressable
                        onPress={() => handleMaxPingsDelta(-1)}
                        disabled={identity.daily_interrupt_budget <= 0}
                        style={({ pressed }) => [
                          styles.stepperBtn,
                          {
                            borderColor: colors.borderColor,
                            opacity:
                              identity.daily_interrupt_budget <= 0 ? 0.4 : pressed ? 0.6 : 1,
                          },
                        ]}
                        hitSlop={6}
                      >
                        <Typography
                          variant="body"
                          weight="semibold"
                          color={colors.textPrimary}
                        >
                          −
                        </Typography>
                      </Pressable>
                      <Typography
                        variant="body"
                        weight="medium"
                        color={colors.textPrimary}
                        style={styles.stepperValue}
                      >
                        {identity.daily_interrupt_budget}
                      </Typography>
                      <Pressable
                        onPress={() => handleMaxPingsDelta(1)}
                        disabled={identity.daily_interrupt_budget >= 20}
                        style={({ pressed }) => [
                          styles.stepperBtn,
                          {
                            borderColor: colors.borderColor,
                            opacity:
                              identity.daily_interrupt_budget >= 20 ? 0.4 : pressed ? 0.6 : 1,
                          },
                        ]}
                        hitSlop={6}
                      >
                        <Typography
                          variant="body"
                          weight="semibold"
                          color={colors.textPrimary}
                        >
                          +
                        </Typography>
                      </Pressable>
                    </View>
                  </View>
                  <KVRow
                    label="Timezone"
                    value={deviceTimezone}
                    theme={{ colors }}
                  />
                </Card>
              </Section>

              {timingPicker === 'quiet' ? (
                <TimePickerSheet
                  mode="range"
                  visible
                  startValue={identity.quiet_hours_start}
                  endValue={identity.quiet_hours_end}
                  startLabel="Start"
                  endLabel="End"
                  title="Quiet hours"
                  onClose={() => setTimingPicker(null)}
                  onConfirm={handleQuietRangeConfirm}
                />
              ) : (
                <TimePickerSheet
                  visible={timingPicker === 'briefing'}
                  value={identity.briefing_time}
                  title="Daily briefing time"
                  onClose={() => setTimingPicker(null)}
                  onConfirm={handleTimeConfirm}
                />
              )}

              {/* Channels */}
              {channelsParsed && (
                <Section title="Channels">
                  <Card
                    variant="filled"
                    style={{ backgroundColor: colors.backgroundSecondary }}
                  >
                    <ChannelRow
                      label="Push"
                      enabled={channelsParsed.push}
                      onToggle={() => handleChannelToggle('push')}
                      disabled={updateIdentity.isPending}
                    />
                    <ChannelRow
                      label="Weekly email"
                      enabled={channelsParsed.email_weekly}
                      onToggle={() => handleChannelToggle('email_weekly')}
                      disabled={updateIdentity.isPending}
                    />
                    <ChannelRow
                      label="Apple Watch"
                      enabled={channelsParsed.watch}
                      onToggle={() => handleChannelToggle('watch')}
                      disabled={updateIdentity.isPending}
                    />
                  </Card>
                </Section>
              )}

              {/* Connected accounts */}
              <Section title="Connected accounts">
                <Pressable
                  onPress={() => router.push('/aihousekeeper-connected-accounts')}
                >
                  <Card
                    variant="filled"
                    style={{ backgroundColor: colors.backgroundSecondary }}
                  >
                    <Typography variant="body" weight="medium">
                      Google Calendar
                    </Typography>
                    <Typography
                      variant="footnote"
                      color={colors.textSecondary}
                      style={{ marginTop: 4 }}
                    >
                      Link your calendar so {personaName} can propose open
                      slots when scheduling visits.
                    </Typography>
                  </Card>
                </Pressable>
              </Section>

              {/* Recent briefings */}
              <Section title="Recent briefings">
                {briefingsQuery.isLoading ? (
                  <ActivityIndicator color={colors.primary} />
                ) : briefingsQuery.isError ? (
                  <Typography
                    variant="footnote"
                    color={colors.textSecondary}
                  >
                    Couldn't load briefings.
                  </Typography>
                ) : briefings.length === 0 ? (
                  <Typography
                    variant="footnote"
                    color={colors.textSecondary}
                  >
                    No briefings yet. {personaName} is still getting to know
                    your household.
                  </Typography>
                ) : (
                  briefings.slice(0, 5).map((b) => (
                    <Card
                      key={b.id}
                      variant="filled"
                      style={[
                        styles.briefingItem,
                        { backgroundColor: colors.backgroundSecondary },
                      ]}
                    >
                      <Typography variant="footnote" weight="semibold">
                        {b.date}
                      </Typography>
                      <Typography
                        variant="body"
                        color={colors.textPrimary}
                        style={{ marginTop: 4 }}
                        numberOfLines={2}
                      >
                        {b.empty_reason ? 'All quiet today.' : b.paragraph}
                      </Typography>
                    </Card>
                  ))
                )}
              </Section>

              {/* Memories */}
              <Section title={`What ${personaName} remembers`}>
                {memoryQuery.isLoading ? (
                  <ActivityIndicator color={colors.primary} />
                ) : memoryQuery.isError ? (
                  <Typography
                    variant="footnote"
                    color={colors.textSecondary}
                  >
                    Couldn't load memories.
                  </Typography>
                ) : memories.length === 0 ? (
                  <Typography
                    variant="footnote"
                    color={colors.textSecondary}
                  >
                    {personaName} hasn't stored anything yet.
                  </Typography>
                ) : (
                  memories.map((m) => (
                    <Pressable
                      key={m.id}
                      onPress={() => handleForgetMemory(m)}
                    >
                      <Card
                        variant="filled"
                        style={[
                          styles.memoryItem,
                          { backgroundColor: colors.backgroundSecondary },
                        ]}
                      >
                        <Typography variant="footnote" weight="semibold">
                          {m.type}
                        </Typography>
                        <Typography
                          variant="body"
                          color={colors.textPrimary}
                          style={{ marginTop: 4 }}
                          numberOfLines={3}
                        >
                          {m.redacted_body ?? '(redacted)'}
                        </Typography>
                        <Typography
                          variant="caption2"
                          color={colors.textSecondary}
                          style={{ marginTop: 6 }}
                        >
                          Tap to forget
                        </Typography>
                      </Card>
                    </Pressable>
                  ))
                )}
              </Section>
            </ScrollView>
          )}
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.section}>
      <Typography
        variant="footnote"
        weight="semibold"
        color={colors.textSecondary}
        style={styles.sectionTitle}
      >
        {title.toUpperCase()}
      </Typography>
      {children}
    </View>
  );
}

function KVRow({
  label,
  value,
  theme,
  onPress,
}: {
  label: string;
  value: string;
  theme: { colors: { textSecondary: string; textPrimary: string } };
  onPress?: () => void;
}) {
  const content = (
    <>
      <Typography
        variant="footnote"
        color={theme.colors.textSecondary}
        style={styles.label}
      >
        {label}
      </Typography>
      <Typography variant="body" weight="medium" color={theme.colors.textPrimary}>
        {value}
      </Typography>
    </>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={styles.rowList}>
        {content}
      </Pressable>
    );
  }
  return <View style={styles.rowList}>{content}</View>;
}

function ChannelRow({
  label,
  enabled,
  onToggle,
  disabled,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.rowList}>
      <Typography variant="body" weight="medium" style={{ flex: 1 }}>
        {label}
      </Typography>
      <Toggle value={enabled} onValueChange={onToggle} disabled={disabled} />
    </View>
  );
}

function formatQueryError(err: unknown): string {
  // axios error shape — surface HTTP status + server message when present.
  const anyErr = err as {
    response?: { status?: number; data?: { error?: { message?: string } } };
    message?: string;
  };
  const status = anyErr?.response?.status;
  const serverMsg = anyErr?.response?.data?.error?.message;
  if (status && serverMsg) return `${status}: ${serverMsg}`;
  if (status) return `HTTP ${status}`;
  return anyErr?.message ?? 'Unknown error';
}

function parseChannels(
  raw: AssistantChannelsEnabled | string | null | undefined
): AssistantChannelsEnabled {
  const fallback: AssistantChannelsEnabled = {
    push: true,
    sms: false,
    email_weekly: false,
    watch: true,
  };
  if (!raw) return fallback;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return { ...fallback, ...parsed };
    } catch {
      return fallback;
    }
  }
  return { ...fallback, ...raw };
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
  },
  errorDetail: {
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 120 },
  section: { marginBottom: 24 },
  sectionTitle: {
    marginBottom: 8,
    paddingHorizontal: 4,
    letterSpacing: 0.5,
  },
  rowList: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    gap: 12,
  },
  label: { flex: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepperBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: { minWidth: 20, textAlign: 'center' },
  toneRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  briefingItem: { marginBottom: 8 },
  memoryItem: { marginBottom: 8 },
  personaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingVertical: 4,
  },
  personaTile: {
    flexBasis: '47%',
    flexGrow: 1,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
  },
  personaTileImage: {
    marginBottom: 8,
  },
  personaTileName: { marginTop: 2 },
  personaTileBlurb: { marginTop: 4, textAlign: 'center' },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
  },
  nameInput: {
    flex: 1,
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    ...scaledFont('labelRegular'),
  },
  nameClear: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  nameHint: {
    marginTop: 6,
    marginLeft: 4,
  },
});

// Prevent unused-export warnings for the type-only re-assertion
export type { AssistantIdentity };
