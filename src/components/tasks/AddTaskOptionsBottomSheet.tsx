import React from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';

import { BottomSheet, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { IconSize, useAppColors } from '@theme';
import type { IoniconName } from '@utils/categoryIcons';

interface AddTaskOptionsBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  onLinkExisting?: () => void;
  onAddNew: () => void;
  onCopyExisting: () => void;
  onAddFromTemplates: () => void;
}

interface OptionItemProps {
  icon: IoniconName;
  iconColor: string;
  title: string;
  description: string;
  onPress: () => void;
  backgroundColor: string;
}

function OptionItem({ icon, iconColor, title, description, onPress, backgroundColor }: OptionItemProps) {
  // The parent sheet calls this hook; this row never did, while reading
  // `colors.*` three times — a ReferenceError on every render.
  const colors = useAppColors();
  return (
    <TouchableOpacity
      style={[styles.option, { backgroundColor: colors.backgroundSecondary }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.iconContainer, { backgroundColor }]}>
        <Icon name={icon} size={IconSize.lg} color={iconColor} />
      </View>
      <View style={styles.optionContent}>
        <Typography variant="subheadline" weight="semibold">
          {title}
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary}>
          {description}
        </Typography>
      </View>
      <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

export function AddTaskOptionsBottomSheet({
  visible,
  onClose,
  onLinkExisting,
  onAddNew,
  onCopyExisting,
  onAddFromTemplates,
}: AddTaskOptionsBottomSheetProps) {
  const colors = useAppColors();

  const handleOptionPress = (callback: () => void) => {
    onClose();
    // Small delay to allow bottom sheet to close smoothly
    setTimeout(callback, 300);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height="standard"
      title="Add Task"
      showHandle={true}
      showCloseButton
    >
      <View style={styles.container}>
        {onLinkExisting && (
          <OptionItem
            icon="link"
            iconColor={colors.accent}
            title="Link Existing Task"
            description="Pin one of your current tasks here"
            onPress={() => handleOptionPress(onLinkExisting)}
            backgroundColor={colors.accent + '1A'}
          />
        )}

        <OptionItem
          icon="pencil"
          iconColor={colors.primary}
          title="Add New Task"
          description="Create a custom maintenance task"
          onPress={() => handleOptionPress(onAddNew)}
          backgroundColor={colors.primary + '1A'}
        />

        <OptionItem
          icon="copy"
          iconColor={colors.purple}
          title="Copy from Existing Tasks"
          description="Duplicate an existing task"
          onPress={() => handleOptionPress(onCopyExisting)}
          backgroundColor={colors.purple + '1A'}
        />

        <OptionItem
          icon="library"
          iconColor={colors.warning}
          title="Add from Templates"
          description="50+ pre-built maintenance tasks"
          onPress={() => handleOptionPress(onAddFromTemplates)}
          backgroundColor={colors.warning + '1A'}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingBottom: 48,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  optionContent: {
    flex: 1,
  },
});
