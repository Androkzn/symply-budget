import { Image } from 'expo-image';
import type { ImagePickerAsset } from 'expo-image-picker';
import React, { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Modal,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { wishesApi, type Wish } from '@api/wishes';
// Concrete path, not the @components/common barrel: that barrel re-exports
// screens' headers which import from @components/ui, so reaching SheetHeader
// through it closes a ui <-> common circular require and the component
// arrives undefined at render (see the same note in ui/BottomSheet).
import { SheetHeader } from '@components/common/SheetHeader';
import { Button, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { ENV } from '@config/env';
import { useKeyboardInset } from '@hooks/useKeyboardInset';
import { useUnsavedChanges } from '@hooks/useUnsavedChanges';
import { PhotoUploadService } from '@services/photo-upload';
import { showToast } from '@services/toastManager';
import { CornerRadius, IconSize, scaledFont, Spacing, useAppColors } from '@theme';
import { numericTextHandler } from '@utils/keyboard';

interface AddWishModalProps {
  visible: boolean;
  householdId: string;
  editingWish?: Wish | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Cents → plain dollar string for the input (no symbol, no trailing .00). */
function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return '';
  const dollars = cents / 100;
  return dollars % 1 === 0 ? String(dollars) : dollars.toFixed(2);
}

/**
 * Quick create / edit sheet for a wish. Money is intentionally optional — a
 * wish is a dream first, a budget line never. See [[budget_add_spending]] for
 * the sibling spending form.
 */
export function AddWishModal({
  visible,
  householdId,
  editingWish,
  onClose,
  onSaved,
}: AddWishModalProps) {  const colors = useAppColors();
  // The sheet is anchored to the bottom edge, so an open keypad lands on top of
  // the cost field that summoned it. Lift the sheet by the inset instead of
  // wrapping it in a KeyboardAvoidingView, which is unreliable inside a Modal.
  const keyboardInset = useKeyboardInset();

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [cost, setCost] = useState('');
  const [photo, setPhoto] = useState<ImagePickerAsset | null>(null);
  const titleRef = useRef('');
  const notesRef = useRef('');
  const costRef = useRef('');
  const titleInputRef = useRef<TextInput>(null);
  const pendingSaveRef = useRef(false);
  const [titleInputKey, setTitleInputKey] = useState(0);

  // Existing cover shown as the preview when editing (until a new one is picked).
  const existingCover = editingWish?.cover_image_key ?? null;

  useEffect(() => {
    if (!visible) return;
    setPhoto(null);
    if (editingWish) {
      const nextTitle = editingWish.title;
      const nextNotes = editingWish.notes ?? '';
      const nextCost = centsToInput(editingWish.estimated_cost_cents);
      titleRef.current = nextTitle;
      notesRef.current = nextNotes;
      costRef.current = nextCost;
      setTitle(nextTitle);
      setNotes(nextNotes);
      setCost(nextCost);
    } else {
      const draft =
        __DEV__
          ? (
              require('@services/e2e-wish-draft') as typeof import('@services/e2e-wish-draft')
            ).peekE2EWishDraftTitle()
          : null;
      if (draft) {
        titleRef.current = draft;
        notesRef.current = '';
        costRef.current = '';
        setTitle(draft);
        setNotes('');
        setCost('');
      } else {
        titleRef.current = '';
        notesRef.current = '';
        costRef.current = '';
        setTitle('');
        setNotes('');
        setCost('');
      }
      setTitleInputKey((k) => k + 1);
    }
  }, [editingWish, visible]);

  const pickPhoto = async () => {
    const asset = await PhotoUploadService.pickPhoto({ allowsEditing: true, quality: 0.8, aspect: [16, 9] });
    if (asset) setPhoto(asset);
  };

  // Track changes against the wish being edited (or an empty draft when new) so
  // Save stays disabled until there is something to persist. See
  // [[useUnsavedChanges]].
  const syncNativeText = (field: 'title' | 'notes' | 'cost', text: string) => {
    if (field === 'title') {
      titleRef.current = text;
      if (text !== title) setTitle(text);
      return;
    }
    if (field === 'notes') {
      notesRef.current = text;
      if (text !== notes) setNotes(text);
      return;
    }
    costRef.current = text;
    if (text !== cost) setCost(text);
  };

  // Raw `react-native` TextInput — it has no shared-component chokepoint, so the
  // letter strip is applied here (a paste or a Bluetooth keyboard gets letters
  // past `decimal-pad`). Used for the native end-editing flush too.
  const syncCostText = numericTextHandler((text) => syncNativeText('cost', text));

  const resolveTitle = () => (titleRef.current || title).trim();
  const resolveNotes = () => (notesRef.current || notes).trim();
  const resolveCost = () => costRef.current || cost;

  const { isDirty, isSaving, save } = useUnsavedChanges({
    values: { title, notes, cost, photo },
    baseline: {
      title: editingWish?.title ?? '',
      notes: editingWish?.notes ?? '',
      cost: centsToInput(editingWish?.estimated_cost_cents),
      photo: null as ImagePickerAsset | null,
    },
    successMessage: editingWish ? 'Wish updated' : 'Wish added',
    saveWhen: (_values, dirty) =>
      editingWish
        ? dirty
        : // Maestro inputText can update native text without onChangeText; allow save
          // attempts on create and validate from refs inside onSave.
          true,
    onClose,
    onSave: async () => {
      if (!householdId) {
        showToast('error', 'Select a home first');
        return false;
      }

      let trimmed = resolveTitle();
      if (!trimmed && __DEV__) {
        const draft = (
          require('@services/e2e-wish-draft') as typeof import('@services/e2e-wish-draft')
        ).consumeE2EWishDraftTitle();
        if (draft) {
          syncNativeText('title', draft);
          trimmed = draft;
        }
      }
      if (!trimmed) {
        showToast('error', 'Give your wish a name');
        return false;
      }

      const notesValue = resolveNotes();
      const costValue = resolveCost();
      const parsedCost = costValue.trim()
        ? Math.round(parseFloat(costValue.replace(/[^0-9.]/g, '')) * 100)
        : undefined;
      const estimated_cost_cents =
        parsedCost != null && Number.isFinite(parsedCost) && parsedCost >= 0 ? parsedCost : undefined;

      let wishId: string;
      if (editingWish) {
        await wishesApi.update(householdId, editingWish.id, {
          title: trimmed,
          notes: notesValue || null,
          estimated_cost_cents: estimated_cost_cents ?? null,
        });
        wishId = editingWish.id;
      } else {
        const created = await wishesApi.create(householdId, {
          title: trimmed,
          notes: notesValue || undefined,
          estimated_cost_cents,
        });
        wishId = created.id;
      }

      // Upload the picked cover photo (if any): store in R2, add it to the feed,
      // and set it as the wish's main photo.
      if (photo) {
        const imageKey = await wishesApi.uploadImage(householdId, wishId, photo);
        await wishesApi.addEntry(householdId, wishId, { kind: 'image', image_key: imageKey });
        await wishesApi.update(householdId, wishId, { cover_image_key: imageKey });
      }

      onSaved();
      return;
    },
  });

  const runSaveAfterNativeFlush = () => {
    if (pendingSaveRef.current) return;
    pendingSaveRef.current = true;
    Keyboard.dismiss();
    titleInputRef.current?.blur();

    const finish = () => {
      if (!pendingSaveRef.current) return;
      pendingSaveRef.current = false;
      void save();
    };

    // onEndEditing usually fires during blur; keep a fallback for Maestro.
    setTimeout(finish, 650);
  };

  const handleTitleEndEditing = (text: string) => {
    // Uncontrolled create inputs blur with empty native text when Maestro never
    // typed; do not wipe a deeplink/ref-backed draft title on that blur.
    if (text.trim().length > 0 || !resolveTitle()) {
      syncNativeText('title', text);
    }
    if (pendingSaveRef.current) {
      pendingSaveRef.current = false;
      void save();
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.container, { paddingBottom: keyboardInset }]}>
        <TouchableOpacity
          style={[styles.backdrop, { backgroundColor: colors.modalBackdrop }]}
          activeOpacity={1}
          onPress={onClose}
        />

        <View style={[styles.sheet, { backgroundColor: colors.backgroundMain }]}>
          {/* The app's one sheet header — glass ✕ on the left, centred title,
              hairline rule under it — not this sheet's own title-plus-bare-✕ row. */}
          <SheetHeader
            title={editingWish ? 'Edit wish' : 'New wish'}
            leftVariant="close"
            onLeftPress={onClose}
            leftTestID="wish-modal-close"
            leftAccessibilityLabel="Close"
            showDivider
          />

          {/* No `automaticallyAdjustKeyboardInsets` here, and that is deliberate: the
              sheet is ALREADY lifted clear of the keypad by `keyboardInset` on the
              backdrop above. Letting the scroller offset by the keyboard height as
              well counts it twice and drives the focused field's own label off the
              top of the card. Verified on a device via ProjectionTargetModal. */}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.field}>
              <Typography variant="footnote" weight="medium" color={colors.textSecondary} style={styles.label}>
                Photo (optional)
              </Typography>
              <TouchableOpacity
                onPress={pickPhoto}
                disabled={isSaving}
                testID="wish-modal-add-photo"
                accessibilityLabel="Add a photo"
                style={[styles.photoPicker, { backgroundColor: colors.backgroundSecondary, borderColor: colors.divider }]}
              >
                {photo ? (
                  <Image source={{ uri: photo.uri }} style={styles.photoPreview} contentFit="cover" />
                ) : existingCover ? (
                  <Image
                    source={{ uri: `${ENV.API_BASE_URL}/files/${existingCover}` }}
                    style={styles.photoPreview}
                    contentFit="cover"
                  />
                ) : (
                  <View style={styles.photoEmpty}>
                    <Icon name="camera-outline" size={IconSize.lg} color={colors.primary} />
                    <Typography variant="subheadline" weight="medium" color={colors.primary}>
                      Add a photo
                    </Typography>
                  </View>
                )}
                {(photo || existingCover) && (
                  <View style={[styles.photoChange, { backgroundColor: colors.modalBackdrop }]}>
                    <Icon name="camera-outline" size={IconSize.sm} color={colors.white} />
                    <Typography variant="caption1" weight="semibold" color={colors.white}>
                      {photo ? 'Photo selected' : 'Change photo'}
                    </Typography>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.field}>
              <Typography variant="footnote" weight="medium" color={colors.textSecondary} style={styles.label}>
                What do you dream of?
              </Typography>
              <TextInput
                ref={titleInputRef}
                key={editingWish ? `wish-title-edit-${editingWish.id}` : `wish-title-new-${titleInputKey}`}
                style={[
                  styles.input,
                  { color: colors.textPrimary, backgroundColor: colors.backgroundSecondary, borderColor: colors.divider },
                ]}
                {...(editingWish || title
                  ? {
                      value: title,
                      onChangeText: (text: string) => syncNativeText('title', text),
                    }
                  : {
                      defaultValue: '',
                      onChangeText: (text: string) => syncNativeText('title', text),
                    })}
                onEndEditing={(event) => handleTitleEndEditing(event.nativeEvent.text)}
                placeholder="e.g. Buy a boat"
                placeholderTextColor={colors.textTertiary}
                editable={!isSaving}
                autoFocus={!editingWish}
                returnKeyType="next"
                testID="wish-modal-title"
              />
            </View>

            <View style={styles.field}>
              <Typography variant="footnote" weight="medium" color={colors.textSecondary} style={styles.label}>
                Notes (optional)
              </Typography>
              <TextInput
                style={[
                  styles.input,
                  styles.textArea,
                  { color: colors.textPrimary, backgroundColor: colors.backgroundSecondary, borderColor: colors.divider },
                ]}
                value={notes}
                onChangeText={(text) => syncNativeText('notes', text)}
                onEndEditing={(event) => syncNativeText('notes', event.nativeEvent.text)}
                placeholder="Why it matters, what you're picturing…"
                placeholderTextColor={colors.textTertiary}
                editable={!isSaving}
                multiline
                textAlignVertical="top"
                testID="wish-modal-notes"
              />
            </View>

            <View style={styles.field}>
              <Typography variant="footnote" weight="medium" color={colors.textSecondary} style={styles.label}>
                Ballpark cost (optional)
              </Typography>
              <View
                style={[
                  styles.input,
                  styles.costRow,
                  { backgroundColor: colors.backgroundSecondary, borderColor: colors.divider },
                ]}
              >
                <Typography variant="body" color={colors.textSecondary}>
                  $
                </Typography>
                <TextInput
                  style={[styles.costInput, { color: colors.textPrimary }]}
                  value={cost}
                  onChangeText={syncCostText}
                  onEndEditing={(event) => syncCostText(event.nativeEvent.text)}
                  placeholder="0"
                  placeholderTextColor={colors.textTertiary}
                  editable={!isSaving}
                  keyboardType="decimal-pad"
                  testID="wish-modal-cost"
                />
              </View>
              <Typography variant="caption1" color={colors.textTertiary} style={styles.hint}>
                Just a rough idea — a wish is never part of your budget math.
              </Typography>
            </View>
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: colors.divider }]}>
            <Button
              title={isSaving ? 'Saving…' : editingWish ? 'Save changes' : 'Add wish'}
              variant="primary"
              onPress={runSaveAfterNativeFlush}
              disabled={
                isSaving ||
                (editingWish ? !isDirty || !title.trim() : false)
              }
              loading={isSaving}
              fullWidth
              testID="wish-modal-save"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    borderTopLeftRadius: CornerRadius.sheet,
    borderTopRightRadius: CornerRadius.sheet,
    paddingTop: Spacing.base,
    maxHeight: '88%',
  },
  body: { padding: Spacing.lg, gap: Spacing.lg },
  field: { gap: Spacing.sm },
  label: { textTransform: 'uppercase', letterSpacing: 0.5 },
  photoPicker: {
    height: 160,
    borderRadius: CornerRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoPreview: { width: '100%', height: '100%' },
  photoEmpty: { alignItems: 'center', gap: Spacing.xs },
  photoChange: {
    position: 'absolute',
    bottom: Spacing.sm,
    right: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: CornerRadius.full,
  },
  input: {
    ...scaledFont('body'),
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.base,
    borderRadius: CornerRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  textArea: { minHeight: 96 },
  costRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingVertical: 0, minHeight: 48 },
  costInput: { flex: 1, ...scaledFont('body'), paddingVertical: Spacing.md },
  hint: { marginTop: Spacing.xxs },
  footer: {
    padding: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
