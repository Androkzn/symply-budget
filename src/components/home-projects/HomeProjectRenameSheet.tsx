/**
 * Rename a home project, from the pencil on its list card.
 *
 * A sheet rather than `Alert.prompt`, which exists on iOS only — this list ships
 * on Android too, and a rename that silently does nothing there is worse than no
 * pencil at all.
 *
 * `height="short"` and not `"content"`: a content-sized sheet has no definite
 * height anywhere in its chain and collapses to zero on device (see the note on
 * `contentAuto` in BottomSheet). A fixed fraction is more than enough for one
 * field and a button, and it is the variant that actually renders.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BottomSheet, GradientButton, TextInput, Typography } from '@components/ui';
import { Spacing, useAppColors } from '@theme';

/** `patchProjectSchema.title` — `z.string().min(1).max(200)`. */
export const PROJECT_TITLE_MAX_LENGTH = 200;

interface Props {
  visible: boolean;
  /** The project's current title, re-seeded every time the sheet opens. */
  value: string;
  onClose: () => void;
  /** Rejects on failure: the sheet stays open so what was typed is not lost. */
  onSave: (title: string) => Promise<void> | void;
}

export function HomeProjectRenameSheet({ visible, value, onClose, onSave }: Props) {
  const colors = useAppColors();
  const [title, setTitle] = useState(value);
  const [saving, setSaving] = useState(false);

  // The sheet outlives one edit — without this it would re-open holding the
  // previous project's name.
  useEffect(() => {
    if (visible) setTitle(value);
  }, [visible, value]);

  const trimmed = title.trim();
  // An empty name is rejected by both backends, and an unchanged one is a
  // round-trip that can only fail — both close instead of saving.
  const canSave = trimmed.length > 0 && trimmed !== value.trim();

  const save = async () => {
    if (!canSave) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await onSave(trimmed);
      onClose();
    } catch {
      // The caller raises the alert. Leaving the sheet open keeps the typed name.
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Rename project"
      height="short"
      showCloseButton
    >
      <View style={styles.body}>
        <Typography variant="caption1" color={colors.textSecondary}>
          Everyone with access to this project sees the new name.
        </Typography>

        <TextInput
          testID="home-project-rename-input"
          label="Project name"
          placeholder="Upstairs bathroom"
          value={title}
          onChangeText={setTitle}
          maxLength={PROJECT_TITLE_MAX_LENGTH}
          autoFocus
          autoCapitalize="sentences"
          returnKeyType="done"
          onSubmitEditing={() => void save()}
        />

        <GradientButton
          title={saving ? 'Saving…' : 'Save'}
          disabled={saving || !canSave}
          fullWidth
          onPress={() => void save()}
          testID="home-project-rename-save"
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.base, paddingBottom: Spacing.lg },
});

export default HomeProjectRenameSheet;
