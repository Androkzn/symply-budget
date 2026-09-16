import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useState, useEffect } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, Alert } from 'react-native';

import { aiHousekeeperApi } from '@api/ai-housekeeper';
import { AppBackground, ScreenHeader } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Card, Toggle, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useAppColors } from '@theme';

interface AIPreferences {
  enabled: boolean;
  notification_frequency: 'daily' | 'three_per_week' | 'weekly' | 'disabled';
  ai_personality: 'friendly' | 'professional' | 'data_driven';
  diy_skill_level: 'none' | 'beginner' | 'intermediate' | 'advanced';
  budget_preference: 'tight' | 'moderate' | 'flexible';
  preferred_learning_style: 'video' | 'article' | 'expert_call';
  enable_predictions: boolean;
  enable_seasonal_reminders: boolean;
  enable_cost_insights: boolean;
  enable_procrastination_nudges: boolean;
  enable_celebrations: boolean;
}

interface SettingItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  rightElement?: React.ReactNode;
  onPress?: () => void;
}

function SettingItem({ icon, title, subtitle, rightElement, onPress }: SettingItemProps) {
  const colors = useAppColors();
  return (
    <Card
      variant="filled"
      pressable={!!onPress}
      onPress={onPress}
      style={[styles.settingItem, { backgroundColor: colors.backgroundSecondary }]}
    >
      <View style={styles.settingIcon}>
        <Icon name={icon} size={22} color={colors.textPrimary} />
      </View>
      <View style={styles.settingContent}>
        <Typography variant="body" weight="medium" color={colors.textPrimary}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="footnote" color={colors.textSecondary} style={{ marginTop: 2 }}>
            {subtitle}
          </Typography>
        )}
      </View>
      {rightElement && <View style={styles.settingRight}>{rightElement}</View>}
    </Card>
  );
}

export function AIHousePreferencesScreen() {
  const colors = useAppColors();
  /**
   * `navigation.goBack()`, never `router.back()`. This screen is registered in
   * `SettingsNavigator`, which the More tab mounts inside a
   * `NavigationIndependentTree` — expo-router's `router` addresses the ROOT
   * stack, so `router.back()` here left the More tab, not this screen. Every
   * other Settings-stack screen pops with `goBack()`; so does this one.
   */
  const navigation = useNavigation();
  const { isTablet } = useDeviceType();
  const { content: containerPadding } = useLayoutPadding();

  const [preferences, setPreferences] = useState<AIPreferences>({
    enabled: true,
    notification_frequency: 'daily',
    ai_personality: 'friendly',
    diy_skill_level: 'beginner',
    budget_preference: 'moderate',
    preferred_learning_style: 'article',
    enable_predictions: true,
    enable_seasonal_reminders: true,
    enable_cost_insights: true,
    enable_procrastination_nudges: true,
    enable_celebrations: true,
  });

  const [loading, setLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);

  // Load preferences from API
  useEffect(() => {
    loadPreferences();
  }, []);

  const loadPreferences = async () => {
    try {
      const prefs = await aiHousekeeperApi.getPreferences();
      setPreferences({
        enabled: prefs.enabled,
        notification_frequency: prefs.notification_frequency,
        ai_personality: prefs.ai_personality,
        diy_skill_level: prefs.diy_skill_level,
        budget_preference: prefs.budget_preference,
        preferred_learning_style: prefs.preferred_learning_style,
        enable_predictions: prefs.enable_predictions,
        enable_seasonal_reminders: prefs.enable_seasonal_reminders,
        enable_cost_insights: prefs.enable_cost_insights,
        enable_procrastination_nudges: prefs.enable_procrastination_nudges,
        enable_celebrations: prefs.enable_celebrations,
      });
    } catch (error) {
      console.error('Failed to load AI preferences:', error);
      Alert.alert('Error', 'Failed to load preferences. Using defaults.');
    } finally {
      setInitialLoading(false);
    }
  };

  const savePreferences = async (updatedPrefs: Partial<AIPreferences>) => {
    setLoading(true);
    try {
      const newPrefs = { ...preferences, ...updatedPrefs };
      setPreferences(newPrefs);
      await aiHousekeeperApi.updatePreferences(updatedPrefs);
    } catch (error) {
      console.error('Failed to save AI preferences:', error);
      Alert.alert('Error', 'Failed to save preferences. Please try again.');
      // Revert on error
      setPreferences(preferences);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = (key: keyof AIPreferences) => {
    savePreferences({ [key]: !preferences[key] });
  };

  const handleFrequencyChange = (frequency: AIPreferences['notification_frequency']) => {
    savePreferences({ notification_frequency: frequency });
  };

  const handlePersonalityChange = (personality: AIPreferences['ai_personality']) => {
    savePreferences({ ai_personality: personality });
  };

  const handleDIYChange = (level: AIPreferences['diy_skill_level']) => {
    savePreferences({ diy_skill_level: level });
  };

  const handleBudgetChange = (budget: AIPreferences['budget_preference']) => {
    savePreferences({ budget_preference: budget });
  };

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container}>
        <ScreenHeader
          title="AI Housekeeper"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
          showPropertySwitcher={false}
        />

        <AdaptiveContainer maxWidth={isTablet ? 800 : undefined} padding={containerPadding}>
          {initialLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Typography variant="body" color={colors.textSecondary} style={{ marginTop: 16 }}>
                Loading preferences...
              </Typography>
            </View>
          ) : (
            <ScrollView
              style={styles.scrollView}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Master Toggle */}
            <View style={styles.section}>
              <Card
                variant="filled"
                style={[styles.heroCard, { backgroundColor: colors.primary }]}
              >
                <View style={styles.heroContent}>
                  <Icon name="home" size={32} color={colors.white} />
                  <View style={styles.heroText}>
                    <Typography variant="title3" weight="bold" color={colors.white}>
                      Your AI Home Assistant
                    </Typography>
                    <Typography variant="body" color="rgba(255,255,255,0.9)" style={{ marginTop: 4 }}>
                      Get proactive suggestions, maintenance predictions, and smart reminders
                    </Typography>
                  </View>
                  <Toggle
                    value={preferences.enabled}
                    onValueChange={() => handleToggle('enabled')}
                    disabled={loading}
                    activeColor="rgba(255,255,255,0.5)"
                    inactiveColor="rgba(255,255,255,0.3)"
                    thumbColor={colors.white}
                  />
                </View>
              </Card>
            </View>

            {preferences.enabled && (
              <>
                {/* Notification Frequency */}
                <View style={styles.section}>
                  <Typography
                    variant="footnote"
                    color={colors.textSecondary}
                    style={styles.sectionHeader}
                  >
                    NOTIFICATION FREQUENCY
                  </Typography>

                  <Card variant="filled" style={{ backgroundColor: colors.backgroundSecondary }}>
                    {(['daily', 'three_per_week', 'weekly', 'disabled'] as const).map((freq) => (
                      <TouchableOpacity
                        key={freq}
                        style={[
                          styles.radioOption,
                          freq !== 'disabled' && { borderBottomWidth: 1, borderBottomColor: colors.borderColor },
                        ]}
                        onPress={() => handleFrequencyChange(freq)}
                      >
                        <View>
                          <Typography variant="body" weight="medium" color={colors.textPrimary}>
                            {freq === 'daily' && 'Daily'}
                            {freq === 'three_per_week' && '3x per Week'}
                            {freq === 'weekly' && 'Weekly'}
                            {freq === 'disabled' && 'Disabled'}
                          </Typography>
                          <Typography variant="caption1" color={colors.textSecondary}>
                            {freq === 'daily' && 'Get daily insights and reminders'}
                            {freq === 'three_per_week' && 'Monday, Wednesday, Friday'}
                            {freq === 'weekly' && 'Sunday evening summary'}
                            {freq === 'disabled' && 'No AI notifications'}
                          </Typography>
                        </View>
                        <View
                          style={[
                            styles.radio,
                            { borderColor: colors.borderColor },
                            preferences.notification_frequency === freq && {
                              backgroundColor: colors.primary,
                              borderColor: colors.primary,
                            },
                          ]}
                        >
                          {preferences.notification_frequency === freq && (
                            <View style={[styles.radioInner, { backgroundColor: colors.white }]} />
                          )}
                        </View>
                      </TouchableOpacity>
                    ))}
                  </Card>
                </View>

                {/* AI Personality */}
                <View style={styles.section}>
                  <Typography
                    variant="footnote"
                    color={colors.textSecondary}
                    style={styles.sectionHeader}
                  >
                    AI PERSONALITY
                  </Typography>

                  <Card variant="filled" style={{ backgroundColor: colors.backgroundSecondary }}>
                    {([
                      { value: 'friendly', icon: 'happy', title: 'Friendly & Encouraging', subtitle: 'Warm, supportive tone with motivation' },
                      { value: 'professional', icon: 'briefcase', title: 'Professional & Concise', subtitle: 'Clear, direct, business-like' },
                      { value: 'data_driven', icon: 'bar-chart', title: 'Data-Driven & Detailed', subtitle: 'Statistics, numbers, and analysis' },
                    ] as const).map((personality, index, array) => (
                      <TouchableOpacity
                        key={personality.value}
                        style={[
                          styles.radioOption,
                          index !== array.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.borderColor },
                        ]}
                        onPress={() => handlePersonalityChange(personality.value)}
                      >
                        <View style={styles.optionIcon}>
                          <Icon name={personality.icon} size={22} color={colors.textPrimary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Typography variant="body" weight="medium" color={colors.textPrimary}>
                            {personality.title}
                          </Typography>
                          <Typography variant="caption1" color={colors.textSecondary}>
                            {personality.subtitle}
                          </Typography>
                        </View>
                        <View
                          style={[
                            styles.radio,
                            { borderColor: colors.borderColor },
                            preferences.ai_personality === personality.value && {
                              backgroundColor: colors.primary,
                              borderColor: colors.primary,
                            },
                          ]}
                        >
                          {preferences.ai_personality === personality.value && (
                            <View style={[styles.radioInner, { backgroundColor: colors.white }]} />
                          )}
                        </View>
                      </TouchableOpacity>
                    ))}
                  </Card>
                </View>

                {/* DIY Skill Level */}
                <View style={styles.section}>
                  <Typography
                    variant="footnote"
                    color={colors.textSecondary}
                    style={styles.sectionHeader}
                  >
                    DIY SKILL LEVEL
                  </Typography>

                  <Card variant="filled" style={{ backgroundColor: colors.backgroundSecondary }}>
                    {([
                      { value: 'none', icon: 'people', title: 'Prefer Professionals', subtitle: 'Connect me with contractors' },
                      { value: 'beginner', icon: 'hammer', title: 'Beginner', subtitle: 'Guide me through simple tasks' },
                      { value: 'intermediate', icon: 'build', title: 'Intermediate', subtitle: 'I can handle moderate projects' },
                      { value: 'advanced', icon: 'construct', title: 'Advanced', subtitle: 'Love DIY, show me tutorials' },
                    ] as const).map((level, index, array) => (
                      <TouchableOpacity
                        key={level.value}
                        style={[
                          styles.radioOption,
                          index !== array.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.borderColor },
                        ]}
                        onPress={() => handleDIYChange(level.value)}
                      >
                        <View style={styles.optionIcon}>
                          <Icon name={level.icon} size={22} color={colors.textPrimary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Typography variant="body" weight="medium" color={colors.textPrimary}>
                            {level.title}
                          </Typography>
                          <Typography variant="caption1" color={colors.textSecondary}>
                            {level.subtitle}
                          </Typography>
                        </View>
                        <View
                          style={[
                            styles.radio,
                            { borderColor: colors.borderColor },
                            preferences.diy_skill_level === level.value && {
                              backgroundColor: colors.primary,
                              borderColor: colors.primary,
                            },
                          ]}
                        >
                          {preferences.diy_skill_level === level.value && (
                            <View style={[styles.radioInner, { backgroundColor: colors.white }]} />
                          )}
                        </View>
                      </TouchableOpacity>
                    ))}
                  </Card>
                </View>

                {/* Budget Preference */}
                <View style={styles.section}>
                  <Typography
                    variant="footnote"
                    color={colors.textSecondary}
                    style={styles.sectionHeader}
                  >
                    BUDGET PREFERENCE
                  </Typography>

                  <Card variant="filled" style={{ backgroundColor: colors.backgroundSecondary }}>
                    {([
                      { value: 'tight', title: 'Cost-Conscious', subtitle: 'Prioritize budget-friendly options' },
                      { value: 'moderate', title: 'Balanced', subtitle: 'Balance quality and cost' },
                      { value: 'flexible', title: 'Quality-Focused', subtitle: 'Best quality, cost is secondary' },
                    ] as const).map((budget, index, array) => (
                      <TouchableOpacity
                        key={budget.value}
                        style={[
                          styles.radioOption,
                          index !== array.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.borderColor },
                        ]}
                        onPress={() => handleBudgetChange(budget.value)}
                      >
                        <View style={{ flex: 1 }}>
                          <Typography variant="body" weight="medium" color={colors.textPrimary}>
                            {budget.title}
                          </Typography>
                          <Typography variant="caption1" color={colors.textSecondary}>
                            {budget.subtitle}
                          </Typography>
                        </View>
                        <View
                          style={[
                            styles.radio,
                            { borderColor: colors.borderColor },
                            preferences.budget_preference === budget.value && {
                              backgroundColor: colors.primary,
                              borderColor: colors.primary,
                            },
                          ]}
                        >
                          {preferences.budget_preference === budget.value && (
                            <View style={[styles.radioInner, { backgroundColor: colors.white }]} />
                          )}
                        </View>
                      </TouchableOpacity>
                    ))}
                  </Card>
                </View>

                {/* Feature Toggles */}
                <View style={styles.section}>
                  <Typography
                    variant="footnote"
                    color={colors.textSecondary}
                    style={styles.sectionHeader}
                  >
                    FEATURES
                  </Typography>

                  <SettingItem
                    icon="sparkles"
                    title="Predictive Maintenance"
                    subtitle="Get alerts before things fail"
                    rightElement={
                      <Toggle
                        value={preferences.enable_predictions}
                        onValueChange={() => handleToggle('enable_predictions')}
                        disabled={loading}
                      />
                    }
                  />

                  <SettingItem
                    icon="leaf"
                    title="Seasonal Reminders"
                    subtitle="Spring, summer, fall, winter checklists"
                    rightElement={
                      <Toggle
                        value={preferences.enable_seasonal_reminders}
                        onValueChange={() => handleToggle('enable_seasonal_reminders')}
                        disabled={loading}
                      />
                    }
                  />

                  <SettingItem
                    icon="cash"
                    title="Cost-Saving Insights"
                    subtitle="Find opportunities to save money"
                    rightElement={
                      <Toggle
                        value={preferences.enable_cost_insights}
                        onValueChange={() => handleToggle('enable_cost_insights')}
                        disabled={loading}
                      />
                    }
                  />

                  <SettingItem
                    icon="eye"
                    title="Procrastination Nudges"
                    subtitle="Gentle reminders for overdue tasks"
                    rightElement={
                      <Toggle
                        value={preferences.enable_procrastination_nudges}
                        onValueChange={() => handleToggle('enable_procrastination_nudges')}
                        disabled={loading}
                      />
                    }
                  />

                  <SettingItem
                    icon="gift"
                    title="Celebrations"
                    subtitle="Get recognized for completing tasks"
                    rightElement={
                      <Toggle
                        value={preferences.enable_celebrations}
                        onValueChange={() => handleToggle('enable_celebrations')}
                        disabled={loading}
                      />
                    }
                  />
                </View>
              </>
            )}

            {/* Info Section */}
            <View style={[styles.section, { marginBottom: 32 }]}>
              <Card variant="filled" style={{ backgroundColor: colors.groupedListBackground, padding: 16 }}>
                <Typography variant="body" color={colors.textSecondary}>
                  <Typography weight="semibold">About AI Housekeeper:</Typography> Your 24/7 home maintenance assistant
                  that analyzes your property, predicts maintenance needs, and sends smart reminders to keep everything
                  in top shape.
                </Typography>
              </Card>
            </View>
          </ScrollView>
          )}
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 16,
    paddingBottom: 32,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    marginBottom: 8,
    marginLeft: 4,
  },
  heroCard: {
    padding: 20,
  },
  heroContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  heroText: {
    flex: 1,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    marginBottom: 8,
    gap: 12,
  },
  settingIcon: {
    width: 32,
    alignItems: 'center',
  },
  settingContent: {
    flex: 1,
  },
  settingRight: {
    marginLeft: 12,
  },
  radioOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  optionIcon: {
    width: 32,
    alignItems: 'center',
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
});
