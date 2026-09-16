import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, Alert, Share } from 'react-native';

import * as calendarApi from '@api/calendar';
import { AppBackground, SafeAreaView, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Toggle, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { ENV } from '@config/env';
import type { SettingsStackScreenProps } from '@navigation/types';
import { calendarSyncService, DeviceCalendar } from '@services/calendarSyncService';
import { useAppColors } from '@theme';

interface SettingRowProps {
  title: string;
  description?: string;
  value?: boolean;
  onValueChange?: (value: boolean) => void;
  onPress?: () => void;
  disabled?: boolean;
  showChevron?: boolean;
  rightElement?: React.ReactNode;
}

function SettingRow({
  title,
  description,
  value,
  onValueChange,
  onPress,
  disabled,
  showChevron,
  rightElement,
}: SettingRowProps) {
  const colors = useAppColors();
  const content = (
    <View style={[styles.settingRow, { borderBottomColor: colors.borderColor }]}>
      <View style={styles.settingContent}>
        <Typography variant="body" weight="medium">
          {title}
        </Typography>
        {description && (
          <Typography variant="footnote" color={colors.textSecondary} style={styles.description}>
            {description}
          </Typography>
        )}
      </View>
      {onValueChange !== undefined && value !== undefined && (
        <Toggle value={value} onValueChange={onValueChange} disabled={disabled} />
      )}
      {showChevron && (
        <Icon name="chevron-forward" size={20} color={colors.textSecondary} />
      )}
      {rightElement}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} disabled={disabled}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}

interface SettingSectionProps {
  title: string;
  children: React.ReactNode;
}

function SettingSection({ title, children }: SettingSectionProps) {
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
      <View style={[styles.sectionContent, { backgroundColor: colors.backgroundSecondary }]}>
        {children}
      </View>
    </View>
  );
}

export function CalendarSyncScreen({ navigation }: SettingsStackScreenProps<'CalendarSync'>) {
  const colors = useAppColors();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [settings, setSettings] = useState<calendarApi.CalendarSettings | null>(null);
  const [subscribeTokens, setSubscribeTokens] = useState<calendarApi.CalendarSyncToken[]>([]);
  const [deviceCalendars, setDeviceCalendars] = useState<DeviceCalendar[]>([]);
  const [hasCalendarPermission, setHasCalendarPermission] = useState(false);

  // Load data on mount
  useEffect(() => {
    loadData();
  }, []);

  const handleGoBack = () => {
    navigation.goBack();
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [settingsRes, tokensRes, hasPermission] = await Promise.all([
        calendarApi.getCalendarSettings(),
        calendarApi.getSubscribeTokens(),
        calendarSyncService.hasPermissions(),
      ]);
      
      setSettings(settingsRes.settings);
      setSubscribeTokens(tokensRes.tokens);
      setHasCalendarPermission(hasPermission);

      if (hasPermission) {
        const calendars = await calendarSyncService.getCalendars();
        setDeviceCalendars(calendars);
      }
    } catch (error) {
      console.error('Error loading calendar settings:', error);
      Alert.alert('Error', 'Failed to load calendar settings');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateSetting = async (key: string, value: any) => {
    if (!settings) return;
    
    setIsSaving(true);
    try {
      const result = await calendarApi.updateCalendarSettings({ [key]: value });
      setSettings(result.settings);
    } catch (error) {
      console.error('Error updating setting:', error);
      Alert.alert('Error', 'Failed to update setting');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRequestCalendarPermission = async () => {
    const granted = await calendarSyncService.requestPermissions();
    setHasCalendarPermission(granted);
    
    if (granted) {
      const calendars = await calendarSyncService.getCalendars();
      setDeviceCalendars(calendars);
    }
  };

  const handleCreateSubscribeUrl = async () => {
    try {
      setIsSaving(true);
      const result = await calendarApi.createSubscribeToken({
        name: `${ENV.APP_NAME} Calendar`,
        include_tasks: true,
        include_appointments: true,
        include_garbage: true,
      });

      // Show options to subscribe
      Alert.alert(
        'Calendar Created',
        'How would you like to add this calendar?',
        [
          {
            text: 'Open in Calendar App',
            onPress: () => calendarSyncService.openCalendarSubscription(result.webcal_url),
          },
          {
            text: 'Add to Google Calendar',
            onPress: () => calendarSyncService.openGoogleCalendarSubscription(result.subscribe_url),
          },
          {
            text: 'Copy URL',
            onPress: () => calendarSyncService.copyCalendarUrl(result.subscribe_url),
          },
          { text: 'Cancel', style: 'cancel' },
        ]
      );

      // Reload tokens
      const tokensRes = await calendarApi.getSubscribeTokens();
      setSubscribeTokens(tokensRes.tokens);
    } catch (error) {
      console.error('Error creating subscribe URL:', error);
      Alert.alert('Error', 'Failed to create calendar subscription');
    } finally {
      setIsSaving(false);
    }
  };

  const handleShareSubscribeUrl = async (token: calendarApi.CalendarSyncToken) => {
    try {
      await Share.share({
        message: `Subscribe to my ${ENV.APP_NAME} calendar: ${token.subscribe_url}`,
        url: token.subscribe_url,
      });
    } catch (error) {
      console.error('Error sharing URL:', error);
    }
  };

  const handleDeleteSubscribeToken = async (tokenId: string) => {
    Alert.alert(
      'Delete Calendar Link',
      'Are you sure you want to delete this calendar subscription? Anyone using this link will lose access.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await calendarApi.deleteSubscribeToken(tokenId);
              setSubscribeTokens(tokens => tokens.filter(t => t.id !== tokenId));
            } catch (error) {
              console.error('Error deleting token:', error);
              Alert.alert('Error', 'Failed to delete calendar link');
            }
          },
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <AppBackground>
        <SafeAreaView style={[styles.container, { backgroundColor: colors.backgroundMain }]}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  return (
    <AppBackground>
    <SafeAreaView style={[styles.container, { backgroundColor: colors.backgroundMain }]}>
      <ScreenHeader
        title="Calendar Sync"
        showBackButton
        onBackPress={handleGoBack}
        showNotificationBell={false}
        showAvatar={false}
      />

      <ScrollView
        style={screenScrollViewStyle.scroll}
        contentContainerStyle={styles.scrollContent}>
        {/* Header Info */}
        <View style={[styles.infoCard, { backgroundColor: colors.backgroundSecondary }]}>
          <Icon name="calendar-outline" size={32} color={colors.primary} />
          <Typography variant="body" style={styles.infoText}>
            Sync your tasks, appointments, and garbage collection schedules with your favorite calendar app.
          </Typography>
        </View>

        {/* Calendar Subscriptions */}
        <SettingSection title="Calendar Subscriptions">
          <SettingRow
            title="Create Calendar Subscription"
            description="Generate a URL to subscribe in any calendar app"
            onPress={handleCreateSubscribeUrl}
            showChevron
            disabled={isSaving}
          />
          
          {subscribeTokens.map((token) => (
            <View key={token.id} style={[styles.tokenRow, { borderBottomColor: colors.borderColor }]}>
              <View style={styles.tokenInfo}>
                <Typography variant="body" weight="medium">
                  {token.name}
                </Typography>
                <Typography variant="caption1" color={colors.textSecondary}>
                  {token.access_count} syncs • Created {new Date(token.created_at).toLocaleDateString()}
                </Typography>
              </View>
              <View style={styles.tokenActions}>
                <TouchableOpacity
                  onPress={() => calendarSyncService.openCalendarSubscription(token.webcal_url)}
                  style={styles.iconButton}
                >
                  <Icon name="open-outline" size={20} color={colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleShareSubscribeUrl(token)}
                  style={styles.iconButton}
                >
                  <Icon name="share-outline" size={20} color={colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleDeleteSubscribeToken(token.id)}
                  style={styles.iconButton}
                >
                  <Icon name="trash-outline" size={20} color={colors.error} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </SettingSection>

        {/* Native Calendar Integration */}
        <SettingSection title="Device Calendar">
          {!hasCalendarPermission ? (
            <SettingRow
              title="Enable Calendar Access"
              description={`Allow ${ENV.APP_NAME} to add events to your device calendar`}
              onPress={handleRequestCalendarPermission}
              showChevron
            />
          ) : (
            <>
              <SettingRow
                title="Auto-sync Tasks"
                description="Automatically add task due dates to your calendar"
                value={settings?.auto_sync_tasks || false}
                onValueChange={(value) => handleUpdateSetting('auto_sync_tasks', value)}
                disabled={isSaving}
              />
              <SettingRow
                title="Auto-sync Appointments"
                description="Automatically add contractor appointments"
                value={settings?.auto_sync_appointments || false}
                onValueChange={(value) => handleUpdateSetting('auto_sync_appointments', value)}
                disabled={isSaving}
              />
              <SettingRow
                title="Auto-sync Garbage Collection"
                description="Add garbage collection reminders to calendar"
                value={settings?.auto_sync_garbage || false}
                onValueChange={(value) => handleUpdateSetting('auto_sync_garbage', value)}
                disabled={isSaving}
              />
            </>
          )}
        </SettingSection>

        {/* Event Settings */}
        {hasCalendarPermission && (
          <SettingSection title="Event Settings">
            <SettingRow
              title="Include Reminder in Events"
              description="Add calendar alerts for synced events"
              value={settings?.sync_task_reminder || false}
              onValueChange={(value) => handleUpdateSetting('sync_task_reminder', value)}
              disabled={isSaving}
            />
            <SettingRow
              title="Default Calendar"
              description={settings?.default_calendar_name || 'Not selected'}
              onPress={() => {
                // TODO: Show calendar picker
                Alert.alert(
                  'Select Calendar',
                  'Choose which calendar to add events to',
                  deviceCalendars.map(cal => ({
                    text: cal.title,
                    onPress: () => handleUpdateSetting('default_calendar_id', cal.id),
                  })).concat([{ text: 'Cancel', style: 'cancel' } as any])
                );
              }}
              showChevron
            />
          </SettingSection>
        )}

        {/* Sync Latency Info (2026 best practice - transparency) */}
        <View style={[styles.latencyInfoCard, { backgroundColor: colors.backgroundSecondary }]}>
          <Icon name="time-outline" size={20} color={colors.warning} />
          <View style={styles.latencyInfoContent}>
            <Typography variant="footnote" weight="semibold" color={colors.warning}>
              About Sync Speed
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              Device Calendar: Changes appear instantly{'\n'}
              iCal Subscriptions: Updates every 15-60 min (varies by app)
            </Typography>
          </View>
        </View>

        {/* Help Section */}
        <SettingSection title="Help">
          <SettingRow
            title="How Calendar Sync Works"
            description="Learn about the different sync options"
            onPress={() => {
              const latencyInfo = calendarSyncService.getSyncLatencyInfo();
              Alert.alert(
                'Calendar Sync',
                'Calendar Subscriptions:\n' +
                'Creates a URL that your calendar app checks periodically for updates. ' +
                'Works with Google Calendar, Apple Calendar, Outlook, and more.\n\n' +
                latencyInfo.iCalSubscription + '\n\n' +
                'Device Calendar:\n' +
                'Directly adds events to your phone\'s calendar. ' +
                latencyInfo.directSync + '\n\n' +
                '💡 Tip: ' + latencyInfo.recommendation,
                [{ text: 'Got it' }]
              );
            }}
            showChevron
          />
        </SettingSection>
      </ScrollView>
    </SafeAreaView>
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
  },
  scrollContent: {
    paddingBottom: 40,
  },
  infoCard: {
    margin: 16,
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  infoText: {
    flex: 1,
  },
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  sectionContent: {
    borderRadius: 12,
    marginHorizontal: 16,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  settingContent: {
    flex: 1,
  },
  description: {
    marginTop: 2,
  },
  tokenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tokenInfo: {
    flex: 1,
  },
  tokenActions: {
    flexDirection: 'row',
    gap: 8,
  },
  iconButton: {
    padding: 8,
  },
  latencyInfoCard: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: 12,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  latencyInfoContent: {
    flex: 1,
  },
});

export default CalendarSyncScreen;
