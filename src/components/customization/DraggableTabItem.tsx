import React, { useMemo } from 'react';
import { StyleSheet, View, TouchableOpacity, Platform } from 'react-native';

import { BrandSymbol } from '@components/common';
import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useAppColors } from '@theme';

interface DraggableTabItemProps {
  /** Ionicons glyph (Android + legacy fallback), e.g. the tab's `icon`. */
  iconName: string;
  /** Brand PNG icon-kit name so the row matches the bottom tab bar exactly. */
  brandIcon?: string;
  /**
   * Rendered instead of the icon-kit symbol. For rows whose bar/More-hub icon is
   * not a glyph at all — the housekeeper's persona avatar — so the editor shows
   * the same artwork the member sees everywhere else.
   */
  iconElement?: React.ReactNode;
  title: string;
  isRequired?: boolean;
  drag: () => void;
  isActive: boolean;
}

export function DraggableTabItem({
  iconName,
  brandIcon,
  iconElement,
  title,
  isRequired,
  drag,
  isActive,
}: DraggableTabItemProps) {  const colors = useAppColors();
  const styles = useMemo(() => makeStyles(), []);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.backgroundSecondary },
        isActive && styles.containerActive,
      ]}
    >
      <View style={styles.iconContainer}>
        {iconElement ?? (
          <BrandSymbol
            ionicon={iconName}
            brandIcon={brandIcon}
            size={28}
            color={colors.primary}
          />
        )}
      </View>
      <View style={styles.content}>
        <Typography variant="body" weight="semibold" color={colors.textPrimary}>
          {title}
        </Typography>
        {isRequired && (
          <Typography
            variant="caption2"
            color={colors.textSecondary}
            testID={`tab-customize-locked-${title}`}
          >
            Required
          </Typography>
        )}
      </View>
      <TouchableOpacity
        onPressIn={drag}
        style={styles.dragHandle}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Icon name="reorder-three" size={22} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    marginBottom: 12,
    borderRadius: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  containerActive: {
    opacity: 0.7,
    ...Platform.select({
      ios: {
        shadowOpacity: 0.15,
        shadowRadius: 8,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  content: {
    flex: 1,
  },
  dragHandle: {
    padding: 8,
    marginLeft: 8,
  },
});
