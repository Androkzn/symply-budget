/**
 * Step 3 of Smart Project — the photos, and the four places they come from.
 *
 * ## Optional, and it says so before it asks
 *
 * Steps 1 and 2 already produce a usable draft. This one exists because a
 * paragraph describes intent and a photograph describes CONDITION, and
 * condition is the half a member is worst at putting into words: nobody writes
 * "the plaster is blown along the bottom 300 mm of the north wall", they write
 * "the wall needs doing". So the copy names what photos change rather than
 * asking for them — a step that begs produces four blurry pictures of a ceiling
 * and no better plan.
 *
 * ## Why four sources and not one
 *
 * Where a member's photos of their own house live is not a preference, it is a
 * fact about their phone, and getting it wrong ends the step:
 *
 *  - **Camera** — the common case standing in the room.
 *  - **Gallery** — the common case on the sofa, months after the survey.
 *  - **Files** — a surveyor's or estate agent's photos, which arrive by email
 *    and land in Files, never in the camera roll.
 *  - **Drive** — the same, for a household that keeps documents in Google
 *    Drive. This one is a real OAuth'd browse (`CloudFilePicker`), not a
 *    hand-off to the system Files provider, because the provider only appears
 *    if the Drive app is installed and signed in on that device.
 *
 * The tile row itself is `ScanImportSources`, which is the same row the receipt
 * scanner and the savings importer use. Re-forking four buttons here is how the
 * fleet ends up with four subtly different pickers.
 */
import * as DocumentPicker from 'expo-document-picker';
import React, { useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { CloudFilePicker } from '@components/cloud-storage';
import { ScanImportSources } from '@components/common';
import { Icon } from '@components/ui/Icon';
import ImageCropPicker from '@services/image-picker-compat';
import { useAppColors } from '@theme';
import {
  isPickerPermissionError,
  presentPickerPermissionDeniedAlert,
} from '@utils/pickerPermissionAlert';

import {
  importDraftPhoto,
  SMART_PROJECT_MAX_PHOTOS,
  type DraftPhoto,
} from './smartProjectPhotos';

/**
 * What the pickers are allowed to return.
 *
 * HEIC is absent on purpose and is NOT an oversight: `importDraftPhoto`
 * re-encodes every picked file to JPEG, so an iPhone original is welcome — it
 * simply arrives through the image pickers, which report it as `image/jpeg`
 * or `image/heic` inconsistently across OS versions. The list here filters the
 * FILE browsers, where a member could otherwise pick a PDF and get a failure
 * three screens later at upload time.
 */
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

interface Props {
  photos: DraftPhoto[];
  /** Appended in the order picked; the caller enforces nothing. */
  onAdd: (added: DraftPhoto[]) => void;
  onOpen: (index: number) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
}

export function SmartProjectPhotoStep({
  photos,
  onAdd,
  onOpen,
  onRemove,
  disabled,
}: Props) {
  const colors = useAppColors();
  const [showDrive, setShowDrive] = useState(false);
  const [importing, setImporting] = useState(false);

  const remaining = SMART_PROJECT_MAX_PHOTOS - photos.length;
  const full = remaining <= 0;

  /**
   * Normalise everything picked, then hand the survivors over in one call.
   *
   * Sequential rather than `Promise.all`: each import is a decode plus a
   * re-encode, and ten of those in parallel on a mid-range phone is where the
   * step drops frames or is killed for memory. The same reasoning the receipt
   * scanner's `prepared` loop records.
   *
   * A file that fails to decode is SKIPPED and counted, not thrown. One
   * unreadable download out of six must not cost the member the other five, and
   * a silent skip would leave them counting tiles wondering which one vanished.
   */
  const ingest = async (
    picked: ReadonlyArray<{ uri: string }>,
    source: DraftPhoto['source'],
  ) => {
    const room = picked.slice(0, Math.max(0, remaining));
    if (!room.length) return;

    setImporting(true);
    try {
      const out: DraftPhoto[] = [];
      let failed = 0;
      for (const item of room) {
        try {
          out.push(await importDraftPhoto(item.uri, source));
        } catch (err) {
          failed += 1;
          if (__DEV__) console.warn('[smart-project] photo import failed', err);
        }
      }
      if (out.length) onAdd(out);
      if (failed) {
        Alert.alert(
          failed === room.length ? 'Could not add those' : 'Some photos were skipped',
          `${failed} ${failed === 1 ? 'file' : 'files'} could not be read as an image.`,
        );
      }
      if (picked.length > room.length) {
        Alert.alert(
          'That is the limit',
          `We take up to ${SMART_PROJECT_MAX_PHOTOS} photos, so the last ${
            picked.length - room.length
          } were not added.`,
        );
      }
    } finally {
      setImporting(false);
    }
  };

  const handleCamera = async () => {
    try {
      const shot = await ImageCropPicker.openCamera({
        cropping: false,
        compressImageQuality: 0.9,
        mediaType: 'photo',
      });
      await ingest([{ uri: shot.path }], 'camera');
    } catch (error) {
      if (isPickerPermissionError(error)) {
        presentPickerPermissionDeniedAlert('camera');
      } else if ((error as { code?: string }).code !== 'E_PICKER_CANCELLED') {
        Alert.alert('Could not open the camera', 'Try adding from your gallery instead.');
      }
    }
  };

  const handleGallery = async () => {
    try {
      // `selectionLimit` is the room actually left, so the OS picker greys out
      // the eleventh photo. Refusing it in the sheet the member is already in
      // beats accepting the tap and apologising on the next screen.
      const picked = await ImageCropPicker.openPickerMultiple({
        compressImageQuality: 0.9,
        mediaType: 'photo',
        selectionLimit: Math.max(1, remaining),
      });
      await ingest(
        picked.map(image => ({ uri: image.path })),
        'library',
      );
    } catch (error) {
      if (isPickerPermissionError(error)) {
        presentPickerPermissionDeniedAlert('library');
      } else if ((error as { code?: string }).code !== 'E_PICKER_CANCELLED') {
        Alert.alert('Could not open your photos', 'Try the camera or Files instead.');
      }
    }
  };

  const handleFiles = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: IMAGE_MIME_TYPES,
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (picked.canceled) return;
      await ingest(picked.assets.map(a => ({ uri: a.uri })), 'files');
    } catch {
      Alert.alert('Could not open Files', 'Try the camera or your gallery instead.');
    }
  };

  const handleDriveFiles = async (files: Array<{ uri: string; name: string }>) => {
    setShowDrive(false);
    await ingest(files, 'drive');
  };

  return (
    <>
      <Text style={[styles.heading, { color: colors.textPrimary }]}>
        Show us the space
      </Text>
      {/* Names the trade honestly, the way step 2 names what skipping costs.
          "Optional" alone reads as filler; this says what the photos buy. */}
      <Text style={[styles.help, { color: colors.textSecondary }]}>
        Optional — but this is the step that changes the answer most. Photos tell
        us the condition of what is already there: whether the plaster is sound,
        whether the studs are bare, what the existing wiring looks like. We will
        not measure anything from them.
      </Text>

      <ScanImportSources
        testIDPrefix="smart-photo"
        disabled={disabled || full || importing}
        onCamera={handleCamera}
        onGallery={handleGallery}
        onFile={handleFiles}
        onDrive={() => setShowDrive(true)}
      />

      <View style={styles.counterRow}>
        <Text style={[styles.counter, { color: colors.textSecondary }]}>
          {photos.length === 0
            ? `Add up to ${SMART_PROJECT_MAX_PHOTOS}`
            : `${photos.length} of ${SMART_PROJECT_MAX_PHOTOS}`}
        </Text>
        {importing && (
          <Text style={[styles.counter, { color: colors.primary }]}>Preparing…</Text>
        )}
      </View>

      {photos.length > 0 && (
        <View style={styles.grid} testID="smart-photo-grid">
          {photos.map((photo, index) => (
            <Pressable
              key={photo.id}
              style={[styles.tile, { borderColor: colors.borderColor }]}
              onPress={() => onOpen(index)}
              accessibilityRole="button"
              accessibilityLabel={`Edit photo ${index + 1}${
                photo.note ? `, noted: ${photo.note}` : ''
              }`}
              testID={`smart-photo-tile-${index}`}
            >
              <Image source={{ uri: photo.uri }} style={styles.thumb} />

              {/* The order badge is not decoration: the notes the member writes
                  say "photo 3", and this is where that number comes from. */}
              <View style={styles.order}>
                <Text style={styles.orderText}>{index + 1}</Text>
              </View>

              {!!photo.note && (
                <View style={styles.noted}>
                  <Icon name="sparkles" size={11} color="#fff" />
                </View>
              )}

              <View style={styles.editHint} pointerEvents="none">
                <Icon name="crop-outline" size={13} color="#fff" />
              </View>

              <Pressable
                style={styles.removeBtn}
                onPress={() => onRemove(photo.id)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove photo ${index + 1}`}
                testID={`smart-photo-remove-${index}`}
              >
                <Icon name="close" size={13} color="#fff" />
              </Pressable>
            </Pressable>
          ))}

          {!full && (
            <Pressable
              style={[styles.tile, styles.addTile, { borderColor: colors.borderColor }]}
              onPress={handleGallery}
              disabled={disabled || importing}
              accessibilityRole="button"
              accessibilityLabel="Add more photos"
              testID="smart-photo-add-more"
            >
              <Icon name="add" size={26} color={colors.textSecondary} />
            </Pressable>
          )}
        </View>
      )}

      {photos.length > 0 && (
        <Text style={[styles.tapHint, { color: colors.textSecondary }]}>
          Tap a photo to crop, straighten, or say what to look at in it.
        </Text>
      )}

      <CloudFilePicker
        visible={showDrive}
        provider="google-drive"
        mimeTypeFilter={IMAGE_MIME_TYPES}
        rememberScope="home-project-photos"
        multiSelect
        onClose={() => setShowDrive(false)}
        onFileSelected={file => void handleDriveFiles([file])}
        onFilesSelected={files => void handleDriveFiles(files)}
      />
    </>
  );
}

const TILE_GAP = 8;

const styles = StyleSheet.create({
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  help: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  counterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  counter: { fontSize: 12 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: TILE_GAP,
    marginTop: 10,
  },
  // Three across at any width the wizard runs at, without measuring: the
  // container is 16pt-padded on both sides, so a percentage basis with the gap
  // subtracted keeps the row from wrapping one tile early on a narrow phone.
  tile: {
    width: `${100 / 3}%`,
    aspectRatio: 1,
    maxWidth: 132,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: 96,
  },
  addTile: {
    alignItems: 'center',
    justifyContent: 'center',
    borderStyle: 'dashed',
    borderWidth: 1,
  },
  thumb: { width: '100%', height: '100%' },
  order: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  orderText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  noted: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  editHint: {
    position: 'absolute',
    left: 6,
    top: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  removeBtn: {
    position: 'absolute',
    right: 4,
    top: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  tapHint: { fontSize: 12, lineHeight: 17, marginTop: 12 },
});
