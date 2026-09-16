import { BlurView } from 'expo-blur';
import React, { useMemo } from 'react';
import { View, StyleSheet, Modal, TouchableOpacity, ScrollView, Platform } from 'react-native';

import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useDeviceType } from '@hooks/useDeviceType';
import type { WidgetConfig, WidgetType } from '@stores/widgetLayoutStore';
import { WIDGET_METADATA } from '@stores/widgetLayoutStore';
import { Layout, Spacing, useAppColors, type AppColors } from '@theme';

import { WidgetCard } from './WidgetCard';

interface WidgetPickerModalProps {
  visible: boolean;
  onClose: () => void;
  hiddenWidgets: WidgetConfig[];
  onAddWidget: (widgetType: WidgetType) => void;
}

export function WidgetPickerModal({
  visible,
  onClose,
  hiddenWidgets,
  onAddWidget,
}: WidgetPickerModalProps) {  const colors = useAppColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { isIPad, width } = useDeviceType();
  const useCenteredSheet = isIPad && width >= Layout.sidebarBreakpoint;

  const handleAddWidget = (widgetType: WidgetType) => {
    onAddWidget(widgetType);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType={useCenteredSheet ? 'fade' : 'slide'}
      transparent
      onRequestClose={onClose}
    >
      <View style={[styles.overlay, useCenteredSheet && styles.overlayCentered]}>
        <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />

        <View
          style={[
            styles.container,
            useCenteredSheet && styles.containerCentered,
            { backgroundColor: colors.backgroundSecondary },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <Typography variant="title2" weight="bold" color={colors.textPrimary} style={styles.title}>
              Add Widget
            </Typography>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Icon name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Widget List */}
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {hiddenWidgets.length > 0 ? (
              <View style={styles.widgetGrid}>
                {hiddenWidgets.map((widget) => {
                  const metadata = WIDGET_METADATA[widget.type];
                  return (
                    <View key={widget.id} style={styles.widgetItem}>
                      <WidgetCard
                        icon={metadata.icon}
                        title={metadata.displayName}
                        gradientColors={metadata.gradientColors}
                        onPress={() => handleAddWidget(widget.type)}
                      />
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Icon
                  name="checkmark-done-circle"
                  size={64}
                  color={colors.success}
                  style={styles.emptyEmoji}
                />
                <Typography variant="title3" weight="semibold" color={colors.textPrimary} style={styles.emptyTitle}>
                  All widgets added!
                </Typography>
                <Typography variant="body" color={colors.textSecondary} style={styles.emptyMessage}>
                  You're using all available widgets. Remove one to add a different one.
                </Typography>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  overlayCentered: {
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  container: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '70%',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: {
        elevation: 16,
      },
    }),
  },
  containerCentered: {
    width: '100%',
    maxWidth: Layout.formSheetWidth,
    maxHeight: '78%',
    alignSelf: 'center',
    borderRadius: 28,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  title: {
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.cardSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
  },
  widgetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  widgetItem: {
    width: '47%',
    aspectRatio: 1.1,
  },
  emptyState: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  emptyEmoji: {
    marginBottom: 16,
  },
  emptyTitle: {
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyMessage: {
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
