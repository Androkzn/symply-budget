import * as Haptics from 'expo-haptics';
import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import DraggableFlatList, {
  RenderItemParams,
  ScaleDecorator,
} from 'react-native-draggable-flatlist';

import { AppBackground, HeaderActionButton, ScreenHeader } from '@components/common';
import { DraggableWidgetItem, HiddenWidgetItem } from '@components/customization';
import { AdaptiveContainer } from '@components/layout';
import { Typography, Button } from '@components/ui';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useIsDirty } from '@hooks/useUnsavedChanges';
import type { SettingsStackScreenProps } from '@navigation/types';
import { showToast } from '@services/toastManager';
import { useWidgetLayoutStore, WIDGET_METADATA, WidgetConfig } from '@stores/widgetLayoutStore';
import { useAppColors } from '@theme';

export function WidgetCustomizationScreen({ navigation }: SettingsStackScreenProps<'WidgetCustomization'>) {
  const colors = useAppColors();
  const { isTablet } = useDeviceType();
  const { content: containerPadding } = useLayoutPadding();

  // Get store data with stable selectors
  const widgets = useWidgetLayoutStore((state) => state.widgets);
  const updateWidgetOrder = useWidgetLayoutStore((state) => state.updateWidgetOrder);
  const resetToDefaults = useWidgetLayoutStore((state) => state.resetToDefaults);

  // Memoize derived data to prevent infinite re-renders
  const visibleWidgets = useMemo(
    () => widgets.filter((w) => w.isVisible).sort((a, b) => a.order - b.order),
    [widgets]
  );
  const hiddenWidgets = useMemo(
    () => widgets.filter((w) => !w.isVisible).sort((a, b) => a.order - b.order),
    [widgets]
  );

  const [localVisibleWidgets, setLocalVisibleWidgets] = useState(visibleWidgets);
  // Snapshot the initial visible order/selection on mount so Save stays disabled
  // until the user reorders, adds, or removes a widget.
  const [baseline] = useState(visibleWidgets);
  const isDirty = useIsDirty(localVisibleWidgets, baseline);

  const handleSave = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    updateWidgetOrder(localVisibleWidgets);
    showToast('success', 'Widgets updated');
    navigation.goBack();
  };

  const handleReset = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Reset to Defaults?',
      'This will restore the default widget layout. Your current customization will be lost.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            resetToDefaults();
            const newWidgets = useWidgetLayoutStore.getState().widgets;
            setLocalVisibleWidgets(
              newWidgets.filter((w) => w.isVisible).sort((a, b) => a.order - b.order)
            );
          },
        },
      ]
    );
  };

  const handleAddWidget = (widgetId: string) => {
    const widget = hiddenWidgets.find((w) => w.id === widgetId);
    if (widget) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setLocalVisibleWidgets([...localVisibleWidgets, { ...widget, isVisible: true }]);
    }
  };

  const handleRemoveWidget = (widgetId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLocalVisibleWidgets(localVisibleWidgets.filter((w) => w.id !== widgetId));
  };

  const renderVisibleWidgetItem = ({ item, drag, isActive }: RenderItemParams<WidgetConfig>) => {
    const metadata = WIDGET_METADATA[item.type];

    return (
      <ScaleDecorator>
        <View style={styles.draggableItemContainer}>
          <DraggableWidgetItem
            icon={metadata.icon}
            title={metadata.displayName}
            drag={drag}
            isActive={isActive}
          />
          <TouchableOpacity
            style={styles.removeButton}
            onPress={() => handleRemoveWidget(item.id)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Typography variant="body" color={colors.error}>
              Remove
            </Typography>
          </TouchableOpacity>
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
        title="Customize Widgets"
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
            {/* Shown Widgets Section */}
            <View style={styles.section}>
              <Typography
                variant="footnote"
                weight="semibold"
                color={colors.textSecondary}
                style={styles.sectionHeader}
              >
                SHOWN WIDGETS
              </Typography>
              <DraggableFlatList
                data={localVisibleWidgets}
                renderItem={renderVisibleWidgetItem}
                keyExtractor={(item) => item.id}
                onDragBegin={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
                onDragEnd={({ data }) => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setLocalVisibleWidgets(data);
                }}
                scrollEnabled={false}
              />
            </View>

            {/* Hidden Widgets Section */}
            {hiddenWidgets.filter(
              (hw) => !localVisibleWidgets.find((vw) => vw.id === hw.id)
            ).length > 0 && (
              <View style={styles.section}>
                <Typography
                  variant="footnote"
                  weight="semibold"
                  color={colors.textSecondary}
                  style={styles.sectionHeader}
                >
                  HIDDEN WIDGETS
                </Typography>
                <View style={styles.hiddenGrid}>
                  {hiddenWidgets
                    .filter((hw) => !localVisibleWidgets.find((vw) => vw.id === hw.id))
                    .map((widget) => {
                      const metadata = WIDGET_METADATA[widget.type];
                      return (
                        <View key={widget.id} style={styles.gridItem}>
                          <HiddenWidgetItem
                            icon={metadata.icon}
                            title={metadata.displayName}
                            onPress={() => handleAddWidget(widget.id)}
                          />
                        </View>
                      );
                    })}
                </View>
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
  hiddenGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
  },
  gridItem: {
    width: '33.333%',
    padding: 6,
  },
  resetSection: {
    marginTop: 32,
    marginBottom: 16,
  },
});
