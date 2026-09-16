import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { HouseholdSpace, PresetSpaceTemplate } from '@api/household-spaces';
import { ScanImportSources } from '@components/common/ScanImportSources';
import { useAttachmentSources } from '@components/common/useAttachmentSources';
import { Typography, Button } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useKeyboardInset } from '@hooks/useKeyboardInset';
import { useAppColors } from '@theme';
import { keyboardDismissScrollProps, numericTextHandler } from '@utils/keyboard';

import { SpaceIcon } from './SpaceIcon';


interface SpaceFormModalProps {
  visible: boolean;
  space?: HouseholdSpace | null;
  presetTemplates: PresetSpaceTemplate[];
  onClose: () => void;
  onSave: (data: SpaceFormData) => Promise<void>;
}

export interface SpaceFormData {
  name: string;
  space_type: 'preset' | 'custom';
  category?: string;
  floor_level?: number;
  icon_emoji?: string;
  icon_color?: string;
  custom_image_uri?: string;
  description?: string;
  area_sqft?: number;
}

const COMMON_EMOJIS = [
  '🛋️',
  '🍳',
  '🛏️',
  '🚿',
  '🧺',
  '💻',
  '🍽️',
  '🚪',
  '🌳',
  '🌿',
  '🪵',
  '🪑',
  '🌻',
  '🏊',
  '🚗',
  '📦',
  '🔧',
  '🪟',
  '🏠',
  '🌱',
  '🔥',
  '💡',
  '🎨',
  '📚',
];

const PRESET_COLORS = [
  '#E8F5F3',
  '#FFF3E8',
  '#F5F5F5',
  '#E3F2FD',
  '#E8F5E9',
  '#FFFDE7',
  '#FCE4EC',
  '#F3E5F5',
  '#E8EAF6',
  '#E0F2F1',
  '#FFF8E1',
  '#EFEBE9',
];

const CATEGORIES = [
  { value: 'indoor', label: 'Indoor' },
  { value: 'outdoor', label: 'Outdoor' },
  { value: 'garage', label: 'Garage' },
  { value: 'basement', label: 'Basement' },
  { value: 'attic', label: 'Attic' },
];

export function SpaceFormModal({
  visible,
  space,
  presetTemplates,
  onClose,
  onSave,
}: SpaceFormModalProps) {  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // The card is centred in a `Modal`, so an open keypad covers its lower half —
  // Floor Level and Description sit there, along with the Save button. Re-centre
  // it in the space ABOVE the keyboard and shrink its ceiling by the same amount.
  const keyboardInset = useKeyboardInset();
  const contentMaxHeight = windowHeight - keyboardInset - insets.top - 48;
  const [isLoading, setIsLoading] = useState(false);
  const [showPresets, setShowPresets] = useState(!space);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  /** Whether the Camera · Gallery · File · Drive row is disclosed. */
  const [showImageSources, setShowImageSources] = useState(false);

  const [formData, setFormData] = useState<SpaceFormData>({
    name: space?.name || '',
    space_type: space?.space_type || 'custom',
    category: space?.category || undefined,
    floor_level: space?.floor_level || undefined,
    icon_emoji: space?.icon_emoji || '📦',
    icon_color: space?.icon_color || '#F5F5F5',
    description: space?.description || undefined,
    area_sqft: space?.area_sqft || undefined,
  });

  useEffect(() => {
    if (visible && space) {
      setFormData({
        name: space.name,
        space_type: space.space_type,
        category: space.category || undefined,
        floor_level: space.floor_level || undefined,
        icon_emoji: space.icon_emoji || '📦',
        icon_color: space.icon_color || '#F5F5F5',
        description: space.description || undefined,
        area_sqft: space.area_sqft || undefined,
      });
    }
  }, [visible, space]);

  const handleSelectPreset = (template: PresetSpaceTemplate) => {
    setFormData({
      ...formData,
      name: template.name,
      space_type: 'preset',
      category: template.category,
      icon_emoji: template.emoji,
      icon_color: template.color,
    });
    setShowPresets(false);
  };

  /**
   * A space's icon photo, from any of the four sources.
   *
   * "Upload Photo" opened the photo library directly, so a member whose room
   * shot sat in Files or Drive had no way in. It now discloses the shared
   * source row, mirroring how "Choose Emoji" discloses the emoji grid — the
   * two icon choices behave the same way as each other.
   */
  const { sourceHandlers, drivePicker, driveOpen } = useAttachmentSources({
    rememberScope: 'space-icon',
    pickerOptions: {
      cropping: true,
      cropperToolbarTitle: 'Crop Space Icon',
      compressImageQuality: 0.8,
      mediaType: 'photo',
      freeStyleCropEnabled: false,
    },
    onPicked: ([picked]) => {
      if (!picked) return;
      setShowImageSources(false);
      setFormData(current => ({
        ...current,
        custom_image_uri: picked.uri,
        icon_emoji: undefined,
      }));
    },
  });

  const handleSave = async () => {
    if (!formData.name.trim()) {
      Alert.alert('Error', 'Please enter a space name');
      return;
    }

    setIsLoading(true);
    try {
      await onSave(formData);
      onClose();
    } catch {
      Alert.alert('Error', 'Failed to save space');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
    {/* Hidden while Drive browses — see the note in `AttachmentSourceSheet`. */}
    <Modal visible={visible && !driveOpen} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.overlay, keyboardInset > 0 && { paddingBottom: keyboardInset }]}>
        <View
          style={[
            styles.content,
            { backgroundColor: colors.backgroundMain },
            keyboardInset > 0 && { maxHeight: contentMaxHeight },
          ]}
        >
          <View style={styles.header}>
            <Typography variant="title2" weight="bold">
              {space ? 'Edit Space' : 'Add New Space'}
            </Typography>
            <TouchableOpacity onPress={onClose}>
              <Icon name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView {...keyboardDismissScrollProps} showsVerticalScrollIndicator={false}>
            {!space && showPresets && (
              <View style={styles.section}>
                <Typography variant="headline" weight="semibold" style={styles.sectionTitle}>
                  Quick Start - Preset Spaces
                </Typography>

                <View style={styles.presetsGrid}>
                  {presetTemplates.slice(0, 12).map((template, index) => (
                    <TouchableOpacity
                      key={index}
                      style={[styles.presetItem, { backgroundColor: colors.backgroundSecondary }]}
                      onPress={() => handleSelectPreset(template)}
                    >
                      <SpaceIcon
                        emoji={template.emoji}
                        backgroundColor={template.color}
                        size="small"
                      />
                      <Typography variant="caption1" style={styles.presetName} numberOfLines={2}>
                        {template.name}
                      </Typography>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.customButton}>
                  <Button
                    title="Create Custom Space Instead"
                    variant="secondary"
                    size="md"
                    onPress={() => setShowPresets(false)}
                    fullWidth
                  />
                </View>
              </View>
            )}

            {(!showPresets || space) && (
              <>
                {/* Icon Selection */}
                <View style={styles.section}>
                  <Typography variant="headline" weight="semibold" style={styles.sectionTitle}>
                    Icon
                  </Typography>

                  <View style={styles.iconPreview}>
                    <SpaceIcon
                      emoji={formData.icon_emoji}
                      imageUrl={formData.custom_image_uri}
                      backgroundColor={formData.icon_color}
                      size="large"
                    />
                  </View>

                  <View style={styles.iconActions}>
                    <View style={{ flex: 1 }}>
                      <Button
                        title="Choose Emoji"
                        variant="secondary"
                        size="sm"
                        onPress={() => setShowEmojiPicker(!showEmojiPicker)}
                        fullWidth
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button
                        title="Upload Photo"
                        variant="secondary"
                        size="sm"
                        onPress={() => {
                          setShowImageSources(open => !open);
                          setShowEmojiPicker(false);
                        }}
                        fullWidth
                      />
                    </View>
                  </View>

                  {showImageSources && (
                    <View style={styles.imageSources}>
                      <ScanImportSources
                        testIDPrefix="space-icon-photo"
                        {...sourceHandlers}
                      />
                    </View>
                  )}

                  {showEmojiPicker && (
                    <View style={styles.emojiGrid}>
                      {COMMON_EMOJIS.map((emoji, index) => (
                        <TouchableOpacity
                          key={index}
                          style={[
                            styles.emojiItem,
                            {
                              backgroundColor:
                                formData.icon_emoji === emoji
                                  ? colors.primary + '30'
                                  : colors.backgroundSecondary,
                            },
                          ]}
                          onPress={() => {
                            setFormData({
                              ...formData,
                              icon_emoji: emoji,
                              custom_image_uri: undefined,
                            });
                            setShowEmojiPicker(false);
                          }}
                        >
                          <Typography variant="title3">{emoji}</Typography>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  {/* Color Picker */}
                  <Typography
                    variant="footnote"
                    color={colors.textSecondary}
                    style={styles.label}
                  >
                    Background Color
                  </Typography>
                  <View style={styles.colorGrid}>
                    {PRESET_COLORS.map((color, index) => (
                      <TouchableOpacity
                        key={index}
                        style={[
                          styles.colorItem,
                          {
                            backgroundColor: color,
                            borderWidth: formData.icon_color === color ? 3 : 1,
                            borderColor:
                              formData.icon_color === color
                                ? colors.primary
                                : colors.borderColor,
                          },
                        ]}
                        onPress={() => setFormData({ ...formData, icon_color: color })}
                      >
                        {formData.icon_color === color && (
                          <Icon name="checkmark" size={18} color={colors.primary} />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Name */}
                <View style={styles.section}>
                  <Typography
                    variant="footnote"
                    color={colors.textSecondary}
                    style={styles.label}
                  >
                    Space Name *
                  </Typography>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        color: colors.textPrimary,
                        backgroundColor: colors.backgroundSecondary,
                        borderColor: colors.borderColor,
                      },
                    ]}
                    value={formData.name}
                    onChangeText={(text) => setFormData({ ...formData, name: text })}
                    placeholder="e.g., Master Bedroom, Backyard"
                    placeholderTextColor={colors.textTertiary}
                  />
                </View>

                {/* Category */}
                <View style={styles.section}>
                  <Typography
                    variant="footnote"
                    color={colors.textSecondary}
                    style={styles.label}
                  >
                    Category
                  </Typography>
                  <View style={styles.categoryButtons}>
                    {CATEGORIES.map((cat) => (
                      <TouchableOpacity
                        key={cat.value}
                        style={[
                          styles.categoryButton,
                          {
                            backgroundColor:
                              formData.category === cat.value
                                ? colors.primary
                                : colors.backgroundSecondary,
                            borderColor: colors.borderColor,
                          },
                        ]}
                        onPress={() => setFormData({ ...formData, category: cat.value })}
                      >
                        <Typography
                          variant="footnote"
                          weight="medium"
                          color={
                            formData.category === cat.value
                              ? colors.white
                              : colors.textPrimary
                          }
                        >
                          {cat.label}
                        </Typography>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Floor Level */}
                <View style={styles.section}>
                  <Typography
                    variant="footnote"
                    color={colors.textSecondary}
                    style={styles.label}
                  >
                    Floor Level (optional)
                  </Typography>
                  {/* `number-pad` has no minus key on iOS, but the placeholder
                      promises "-1 = Basement" — so the sign gets its own control
                      rather than the field falling back to a letters-capable
                      keypad to buy one. */}
                  <View style={styles.floorLevelRow}>
                    <TextInput
                      style={[
                        styles.input,
                        styles.floorLevelInput,
                        {
                          color: colors.textPrimary,
                          backgroundColor: colors.backgroundSecondary,
                          borderColor: colors.borderColor,
                        },
                      ]}
                      value={formData.floor_level?.toString() || ''}
                      onChangeText={numericTextHandler((text) => {
                        const level = parseInt(text, 10);
                        setFormData({
                          ...formData,
                          floor_level: Number.isNaN(level) ? undefined : level,
                        });
                      })}
                      placeholder="0 = Ground floor, 1 = First floor, -1 = Basement"
                      placeholderTextColor={colors.textTertiary}
                      keyboardType="number-pad"
                    />
                    <TouchableOpacity
                      onPress={() =>
                        setFormData({
                          ...formData,
                          // Empty seeds -1: below ground is the only reason to
                          // reach for the sign in the first place.
                          floor_level:
                            formData.floor_level == null ? -1 : -formData.floor_level,
                        })
                      }
                      style={[styles.floorLevelSign, { borderColor: colors.borderColor }]}
                      accessibilityRole="button"
                      accessibilityLabel="Toggle above or below ground"
                      testID="space-floor-level-sign"
                    >
                      <Typography variant="body" weight="semibold" color={colors.textSecondary}>
                        ±
                      </Typography>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Description */}
                <View style={styles.section}>
                  <Typography
                    variant="footnote"
                    color={colors.textSecondary}
                    style={styles.label}
                  >
                    Description (optional)
                  </Typography>
                  <TextInput
                    style={[
                      styles.input,
                      styles.textArea,
                      {
                        color: colors.textPrimary,
                        backgroundColor: colors.backgroundSecondary,
                        borderColor: colors.borderColor,
                      },
                    ]}
                    value={formData.description}
                    onChangeText={(text) => setFormData({ ...formData, description: text })}
                    placeholder="Add notes about this space..."
                    placeholderTextColor={colors.textTertiary}
                    multiline
                    numberOfLines={3}
                  />
                </View>
              </>
            )}
          </ScrollView>

          {(!showPresets || space) && (
            <View style={styles.actions}>
              <View style={styles.actionButton}>
                <Button
                  title="Cancel"
                  variant="secondary"
                  size="md"
                  onPress={onClose}
                  disabled={isLoading}
                  fullWidth
                />
              </View>
              <View style={styles.actionButton}>
                <Button
                  title={space ? 'Save Changes' : 'Add Space'}
                  variant="primary"
                  size="md"
                  onPress={handleSave}
                  loading={isLoading}
                  fullWidth
                />
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
    {drivePicker}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    maxHeight: '90%',
    borderRadius: 16,
    padding: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    marginBottom: 16,
  },
  presetsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  presetItem: {
    width: '30%',
    aspectRatio: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  presetName: {
    textAlign: 'center',
  },
  customButton: {
    marginTop: 8,
  },
  iconPreview: {
    alignItems: 'center',
    marginBottom: 16,
  },
  iconActions: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  imageSources: {
    marginTop: 12,
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  emojiItem: {
    width: 48,
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
  },
  colorItem: {
    width: 48,
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginBottom: 8,
  },
  input: {
    fontSize: 17,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: 8,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  floorLevelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  floorLevelInput: {
    flex: 1,
  },
  floorLevelSign: {
    width: 48,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 8,
  },
  categoryButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  actionButton: {
    flex: 1,
  },
});
