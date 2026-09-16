import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ScreenFooterGlass } from '@components/common';
import { Button } from '@components/ui/Button';
import { Typography } from '@components/ui/Typography';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { Spacing } from '@theme';

interface GardenEditSaveBarProps {
  title?: string;
  /** Whether the current edit session has unsaved changes. */
  hasChanges?: boolean;
  /** Save is in flight. */
  saving?: boolean;
  /** Disable Save regardless of changes (e.g. invalid geometry). */
  saveDisabled?: boolean;
  bottomInset: number;
  onSave: () => void;
  onCancel: () => void;
}

/**
 * Bottom action strip shown while a garden edit overlay (boundary/objects) is
 * active. Shows a status caption plus Cancel / Save actions.
 */
export function GardenEditSaveBar({
  title,
  hasChanges = false,
  saving = false,
  saveDisabled = false,
  bottomInset,
  onSave,
  onCancel,
}: GardenEditSaveBarProps) {
  const { content: containerPadding } = useLayoutPadding();
  return (
    <View
      style={[
        styles.root,
        { paddingHorizontal: containerPadding, paddingBottom: bottomInset + Spacing.sm },
      ]}
    >
      <ScreenFooterGlass />
      {title ? (
        <Typography variant="caption1" color="textSecondary" style={styles.title}>
          {title}
        </Typography>
      ) : null}
      <View style={styles.actions}>
        <Button
          title="Cancel"
          variant="ghost"
          size="lg"
          onPress={onCancel}
          disabled={saving}
          style={styles.action}
          testID="garden-edit-save-cancel"
        />
        <Button
          title="Save"
          variant="primary"
          size="lg"
          loading={saving}
          disabled={saveDisabled || !hasChanges}
          onPress={onSave}
          style={styles.action}
          testID="garden-edit-save-save"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // Tall enough that the glass fade begins well above the buttons, so its
    // top edge reads as transparent rather than a hard line over the map.
    paddingTop: 32,
    overflow: 'hidden',
  },
  title: {
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  action: {
    flex: 1,
  },
});
