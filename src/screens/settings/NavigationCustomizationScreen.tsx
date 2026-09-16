import * as Haptics from 'expo-haptics';
import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import DraggableFlatList, {
  RenderItemParams,
  ScaleDecorator,
} from 'react-native-draggable-flatlist';

import { AppBackground, HeaderActionButton, ScreenHeader } from '@components/common';
import { DraggableTabItem, TabBarPreview } from '@components/customization';
import { AdaptiveContainer } from '@components/layout';
import { Typography, Button } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { isBudgetOff, isMinimalBudget } from '@features/budget';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useIsDirty } from '@hooks/useUnsavedChanges';
import type { SettingsStackScreenProps } from '@navigation/types';
import { showToast } from '@services/toastManager';
import {
  useNavigationCustomizationStore,
  TAB_METADATA,
  TabConfig,
  TabType,
} from '@stores/navigationCustomizationStore';
import { useAppColors } from '@theme';

export function NavigationCustomizationScreen({ navigation }: SettingsStackScreenProps<'NavigationCustomization'>) {  const colors = useAppColors();
  const { isTablet } = useDeviceType();
  const { content: containerPadding } = useLayoutPadding();

  // Get store data with stable selectors
  const tabs = useNavigationCustomizationStore((state) => state.tabs);
  const updateTabOrder = useNavigationCustomizationStore((state) => state.updateTabOrder);
  const canToggleTab = useNavigationCustomizationStore((state) => state.canToggleTab);
  const resetToDefaults = useNavigationCustomizationStore((state) => state.resetToDefaults);

  const hideUtilities = isBudgetOff() || isMinimalBudget();
  const customizationTabs = useMemo(
    () =>
      hideUtilities ? tabs.filter((t) => t.type !== TabType.UTILITIES) : tabs,
    [tabs, hideUtilities]
  );

  // Memoize derived data to prevent infinite re-renders
  const visibleTabs = useMemo(
    () => customizationTabs.filter((t) => t.isVisible).sort((a, b) => a.order - b.order),
    [customizationTabs]
  );
  const hiddenTabs = useMemo(
    () => customizationTabs.filter((t) => !t.isVisible).sort((a, b) => a.order - b.order),
    [customizationTabs]
  );

  const [localVisibleTabs, setLocalVisibleTabs] = useState(visibleTabs);
  // Snapshot the initial visible order/visibility on mount so Save stays disabled
  // until the user reorders or toggles a tab (a Reset that changes the layout
  // therefore also enables Save).
  const [baseline] = useState(visibleTabs);
  const isDirty = useIsDirty(localVisibleTabs, baseline);

  const handleSave = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    updateTabOrder(localVisibleTabs);
    showToast('success', 'Navigation updated');
    navigation.goBack();
  };

  const handleReset = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Reset to Defaults?',
      'This will restore the default navigation layout. Your current customization will be lost.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            resetToDefaults();
            const newTabs = useNavigationCustomizationStore.getState().tabs;
            setLocalVisibleTabs(
              newTabs.filter((t) => t.isVisible).sort((a, b) => a.order - b.order)
            );
          },
        },
      ]
    );
  };

  const handleAddTab = (tabId: string) => {
    const tab = hiddenTabs.find((t) => t.id === tabId);
    if (tab && localVisibleTabs.length < 5) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setLocalVisibleTabs([...localVisibleTabs, { ...tab, isVisible: true }]);
    }
  };

  const handleRemoveTab = (tabId: string) => {
    const tab = localVisibleTabs.find((t) => t.id === tabId);
    if (tab && canToggleTab(tabId) && localVisibleTabs.length > 3) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setLocalVisibleTabs(localVisibleTabs.filter((t) => t.id !== tabId));
    } else if (tab && !canToggleTab(tabId)) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const metadata = TAB_METADATA[tab.type];
      if (metadata.isRequired) {
        Alert.alert('Cannot Remove', 'This tab is required and cannot be removed.');
      } else if (localVisibleTabs.length <= 3) {
        Alert.alert('Minimum Tabs', 'You must have at least 3 tabs visible.');
      }
    }
  };

  const renderVisibleTabItem = ({ item, drag, isActive }: RenderItemParams<TabConfig>) => {
    const metadata = TAB_METADATA[item.type];
    const canRemove = canToggleTab(item.id) && localVisibleTabs.length > 3;

    return (
      <ScaleDecorator>
        <View style={styles.draggableItemContainer}>
          <DraggableTabItem
            iconName={metadata.icon}
            title={metadata.displayName}
            isRequired={metadata.isRequired}
            drag={drag}
            isActive={isActive}
          />
          {canRemove && (
            <TouchableOpacity
              style={styles.removeButton}
              onPress={() => handleRemoveTab(item.id)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Typography variant="body" color={colors.error}>
                Remove
              </Typography>
            </TouchableOpacity>
          )}
        </View>
      </ScaleDecorator>
    );
  };

  const rightHeaderElement = (
    <HeaderActionButton label="Save" onPress={handleSave} disabled={!isDirty} />
  );

  return (
    <AppBackground opacity={0.5}>
      <ScreenHeader
        title="Customize Navigation"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        rightElement={rightHeaderElement}
      />
      <View style={styles.container}>
        <AdaptiveContainer maxWidth={isTablet ? 1000 : undefined} padding={containerPadding}>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {/* Tab Bar Preview */}
            <TabBarPreview tabs={localVisibleTabs} />

            {/* Shown Tabs Section */}
            <View style={styles.section}>
              <Typography
                variant="footnote"
                weight="semibold"
                color={colors.textSecondary}
                style={styles.sectionHeader}
              >
                SHOWN TABS ({localVisibleTabs.length}/5)
              </Typography>
              <DraggableFlatList
                data={localVisibleTabs}
                renderItem={renderVisibleTabItem}
                keyExtractor={(item) => item.id}
                onDragBegin={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
                onDragEnd={({ data }) => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setLocalVisibleTabs(data);
                }}
                scrollEnabled={false}
              />
              <Typography variant="caption2" color={colors.textSecondary} style={styles.hint}>
                Minimum 3 tabs, maximum 5 tabs
              </Typography>
            </View>

            {/* Hidden Tabs Section */}
            {hiddenTabs.filter((ht) => !localVisibleTabs.find((vt) => vt.id === ht.id)).length >
              0 && (
              <View style={styles.section}>
                <Typography
                  variant="footnote"
                  weight="semibold"
                  color={colors.textSecondary}
                  style={styles.sectionHeader}
                >
                  HIDDEN TABS
                </Typography>
                {hiddenTabs
                  .filter((ht) => !localVisibleTabs.find((vt) => vt.id === ht.id))
                  .map((tab) => {
                    const metadata = TAB_METADATA[tab.type];
                    const canAdd = localVisibleTabs.length < 5;

                    return (
                      <TouchableOpacity
                        key={tab.id}
                        style={[
                          styles.hiddenTabItem,
                          { backgroundColor: colors.backgroundSecondary, shadowColor: colors.black },
                          !canAdd && styles.hiddenTabItemDisabled,
                        ]}
                        onPress={() => handleAddTab(tab.id)}
                        disabled={!canAdd}
                        activeOpacity={0.7}
                      >
                        <View style={styles.hiddenTabIcon}>
                          <Icon name={metadata.icon} size={20} color={colors.textPrimary} />
                        </View>
                        <Typography
                          variant="body"
                          weight="semibold"
                          color={colors.textPrimary}
                          style={styles.hiddenTabText}
                        >
                          {metadata.displayName}
                        </Typography>
                        <Icon
                          name="add"
                          size={20}
                          color={canAdd ? colors.success : colors.textTertiary}
                        />
                      </TouchableOpacity>
                    );
                  })}
              </View>
            )}

            {/* Reset Button */}
            <View style={styles.resetSection}>
              <Button
                title="Reset to Defaults"
                onPress={handleReset}
                variant="outline"
              />
            </View>
          </ScrollView>
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    paddingTop: 16,
    paddingBottom: 100,
    backgroundColor: 'transparent',
  },
  section: {
    marginTop: 24,
  },
  sectionHeader: {
    marginBottom: 12,
    marginLeft: 4,
    letterSpacing: 0.5,
  },
  hint: {
    marginTop: 8,
    marginLeft: 4,
  },
  draggableItemContainer: {
    position: 'relative',
  },
  removeButton: {
    position: 'absolute',
    right: 48,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  hiddenTabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  hiddenTabItemDisabled: {
    opacity: 0.5,
  },
  hiddenTabIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.03)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  hiddenTabText: {
    flex: 1,
  },
  resetSection: {
    marginTop: 32,
    marginBottom: 16,
  },
});
