import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { View, StyleSheet, Platform, TouchableOpacity, Animated, LayoutChangeEvent } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Reanimated, { useAnimatedRef } from 'react-native-reanimated';
import Sortable, { type SortableGridRenderItem } from 'react-native-sortables';

import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import type { WidgetConfig } from '@stores/widgetLayoutStore';
import { WIDGET_METADATA } from '@stores/widgetLayoutStore';
import { useAppColors, type AppColors } from '@theme';

import { WidgetCard } from './WidgetCard';

interface DraggableWidgetGridProps {
  widgets: WidgetConfig[];
  isEditMode: boolean;
  numColumns: number;
  onReorder: (widgets: WidgetConfig[]) => void;
  onWidgetPress: (widget: WidgetConfig) => void;
  onDeleteWidget: (widgetId: string) => void;
  onAddWidget: () => void;
  onEnterEditMode: () => void;
  onExitEditMode: () => void;
  contentContainerPadding?: number;
  gap?: number;
  hasAvailableWidgets?: boolean;
  /** Optional status badges keyed by widget type (e.g. garbage "Not set up"). */
  widgetBadges?: Record<string, string | undefined>;
}

// Card aspect ratio (width / height) — kept in sync with styles.widgetInner.
const CARD_ASPECT_RATIO = 0.9;

export function DraggableWidgetGrid({
  widgets,
  isEditMode,
  numColumns,
  onReorder,
  onWidgetPress,
  onDeleteWidget,
  onAddWidget,
  onEnterEditMode,
  onExitEditMode,
  gap = 10,
  hasAvailableWidgets = true,
  widgetBadges,
}: DraggableWidgetGridProps) {
  const colors = useAppColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Container width for calculating widget sizes
  const [containerWidth, setContainerWidth] = useState(0);

  // Shaking animation for edit mode (iOS home-screen "jiggle")
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const scrollableRef = useAnimatedRef<Reanimated.ScrollView>();

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    setContainerWidth(width);
  }, []);

  useEffect(() => {
    if (isEditMode) {
      // Start shaking animation
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(shakeAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
          Animated.timing(shakeAnim, { toValue: -1, duration: 100, useNativeDriver: true }),
          Animated.timing(shakeAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
          Animated.timing(shakeAnim, { toValue: 0, duration: 100, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
    // Stop shaking
    shakeAnim.setValue(0);
    return undefined;
  }, [isEditMode, shakeAnim]);

  const handleLongPress = () => {
    if (!isEditMode) {
      if (Platform.OS === 'ios') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      onEnterEditMode();
    }
  };

  // Calculate widget width based on container width and columns
  const widgetWidth = containerWidth > 0
    ? (containerWidth - gap * (numColumns - 1)) / numColumns
    : 0;
  const widgetHeight = widgetWidth > 0 ? widgetWidth / CARD_ASPECT_RATIO : 0;

  const shakeInterpolate = shakeAnim.interpolate({
    inputRange: [-1, 1],
    outputRange: ['-2deg', '2deg'],
  });

  // Sortable grid item (edit mode). The card renders statically so the grid's
  // drag gesture owns the touch; the ✕ uses Sortable.Touchable so its tap
  // coexists with the drag gesture instead of fighting RN's touch responder.
  const renderEditItem = useCallback<SortableGridRenderItem<WidgetConfig>>(
    ({ item }) => {
      const metadata = WIDGET_METADATA[item.type];
      return (
        <Animated.View
          style={[styles.editItem, { height: widgetHeight, transform: [{ rotate: shakeInterpolate }] }]}
        >
          <WidgetCard
            icon={metadata.icon}
            title={metadata.displayName}
            gradientColors={metadata.gradientColors}
            badge={widgetBadges?.[item.type]}
            isEditMode
            staticRender
          />
          <Sortable.Touchable
            onTap={() => onDeleteWidget(item.id)}
            hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
            style={styles.deleteButton}
          >
            <View style={styles.deleteButtonCircle}>
              <Icon name="close" size={15} color={colors.white} />
            </View>
          </Sortable.Touchable>
        </Animated.View>
      );
    },
    [widgetHeight, shakeInterpolate, widgetBadges, onDeleteWidget, styles, colors.white]
  );

  if (isEditMode) {
    const widgetCount = widgets.length;
    const maxWidgets = 12; // You can adjust this limit

    return (
      <View style={styles.container} onLayout={handleLayout}>
        <GestureHandlerRootView style={styles.gestureRoot}>
          <Reanimated.ScrollView
            ref={scrollableRef}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {/* Widget Count Header */}
            <View style={styles.headerContainer}>
              <View style={styles.countBadge}>
                <Typography variant="caption1" weight="semibold" style={styles.countText}>
                  {widgetCount} widgets
                </Typography>
              </View>
              {widgetCount >= maxWidgets && (
                <View style={styles.maxBadge}>
                  <Typography variant="caption1" weight="semibold" style={styles.maxText}>
                    Max reached
                  </Typography>
                </View>
              )}
            </View>

            {containerWidth > 0 && (
              <Sortable.Grid
                data={widgets}
                columns={numColumns}
                rowGap={gap}
                columnGap={gap}
                keyExtractor={(item) => item.id}
                renderItem={renderEditItem}
                scrollableRef={scrollableRef}
                dragActivationDelay={180}
                activeItemScale={1.06}
                activeItemShadowOpacity={0.2}
                overflow="visible"
                onDragStart={() => {
                  if (Platform.OS === 'ios') {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }
                }}
                onDragEnd={({ data, fromIndex, toIndex }) => {
                  if (fromIndex !== toIndex && Platform.OS === 'ios') {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  }
                  onReorder(data);
                }}
              />
            )}

            {/* Add Widget Button - static, only shown if widgets are available */}
            {hasAvailableWidgets && widgetWidth > 0 && (
              <View style={styles.addWidgetContainer}>
                <View style={{ width: widgetWidth, height: widgetHeight }}>
                  <TouchableOpacity
                    style={styles.addWidgetButton}
                    onPress={onAddWidget}
                    activeOpacity={0.7}
                  >
                    <Icon name="add" size={48} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </Reanimated.ScrollView>

          {/* Floating Done Button */}
          <TouchableOpacity style={styles.doneButton} onPress={onExitEditMode}>
            <Typography variant="headline" weight="semibold" style={styles.doneText}>
              Done
            </Typography>
          </TouchableOpacity>
        </GestureHandlerRootView>
      </View>
    );
  }

  // Static grid when not in edit mode
  return (
    <View style={styles.container} onLayout={handleLayout}>
      {containerWidth > 0 && (
        <View style={styles.staticGrid}>
          {widgets.map((widget, index) => {
            const metadata = WIDGET_METADATA[widget.type];
            const isLastInRow = (index + 1) % numColumns === 0;
            return (
              <View
                key={widget.id}
                style={[
                  styles.widgetWrapper,
                  {
                    width: widgetWidth,
                    marginRight: isLastInRow ? 0 : gap,
                    marginBottom: gap,
                  },
                ]}
              >
                <View style={styles.widgetInner}>
                  <WidgetCard
                    icon={metadata.icon}
                    title={metadata.displayName}
                    gradientColors={metadata.gradientColors}
                    badge={widgetBadges?.[widget.type]}
                    onPress={() => onWidgetPress(widget)}
                    onLongPress={handleLongPress}
                  />
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  container: {
    flex: 1,
  },
  gestureRoot: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120,
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 8,
  },
  countBadge: {
    backgroundColor: colors.accent + '26',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  countText: {
    color: colors.primary,
  },
  maxBadge: {
    backgroundColor: colors.warning + '26',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  maxText: {
    color: colors.warning,
  },
  staticGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  widgetWrapper: {
    // Width is set dynamically
  },
  widgetInner: {
    aspectRatio: CARD_ASPECT_RATIO,
  },
  editItem: {
    width: '100%',
  },
  addWidgetContainer: {
    flexDirection: 'row',
    marginTop: 4,
  },
  addWidgetButton: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: colors.accent + '1A',
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.accent,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: colors.accent,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  deleteButton: {
    position: 'absolute',
    top: -6,
    right: -6,
    zIndex: 10,
  },
  deleteButtonCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.white,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  doneButton: {
    position: 'absolute',
    top: 20,
    right: 20,
    backgroundColor: colors.accent,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 8,
      },
    }),
    zIndex: 1000,
  },
  doneText: {
    color: colors.white,
  },
});
