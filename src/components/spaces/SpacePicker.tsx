import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Dimensions,
  TextInput,
} from 'react-native';

import { householdSpacesApi } from '@api/household-spaces';
import type { HouseholdSpace } from '@api/household-spaces';
import { Typography, Button } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { navigateToSpacesManagement } from '@services/navigation';
import { useSpaceStore } from '@stores/spaceStore';
import type { AppColors } from '@theme';
import { useAppColors } from '@theme';
import { getFloorLabel, groupSpacesForPicker } from '@utils/spaceLabels';

import { SpaceIcon } from './SpaceIcon';

interface SpacePickerProps {
  visible: boolean;
  currentSpaceId?: string | null;
  householdId: string;
  onClose: () => void;
  onSelect: (space: HouseholdSpace | null) => void;
  showTaskCounts?: boolean;
}

export function SpacePicker({
  visible,
  currentSpaceId,
  householdId,
  onClose,
  onSelect,
  showTaskCounts = false,
}: SpacePickerProps) {  const colors = useAppColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { spaces, setSpaces } = useSpaceStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (visible && householdId) {
      loadSpaces();
    }
  }, [visible, householdId]);

  const loadSpaces = async () => {
    setIsLoading(true);
    try {
      const { spaces: loadedSpaces } = await householdSpacesApi.list(householdId);
      setSpaces(loadedSpaces);
    } catch (error) {
      console.error('Failed to load spaces:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredSpaces = spaces.filter((space) =>
    space.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const groupedSpaces = groupSpacesForPicker(filteredSpaces);

  const handleSelect = (space: HouseholdSpace | null) => {
    onSelect(space);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />

        <View style={[styles.content, { backgroundColor: colors.backgroundMain }]}>
          <View style={styles.header}>
            <Typography variant="headline" weight="semibold">
              Select Space
            </Typography>
            <TouchableOpacity onPress={onClose}>
              <Icon name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Search Bar */}
          <View style={[styles.searchContainer, { backgroundColor: colors.backgroundSecondary }]}>
            <Icon name="search" size={18} color={colors.textSecondary} />
            <TextInput
              style={[styles.searchInput, { color: colors.textPrimary }]}
              placeholder="Search spaces..."
              placeholderTextColor={colors.textTertiary}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>

          {/* No Space Option */}
          <TouchableOpacity
            style={[
              styles.spaceItem,
              {
                backgroundColor:
                  currentSpaceId === null ? colors.primary + '20' : colors.backgroundSecondary,
              },
            ]}
            onPress={() => handleSelect(null)}
          >
            <SpaceIcon emoji="🏠" backgroundColor={colors.groupedListBackground} size="small" />
            <View style={styles.spaceInfo}>
              <Typography variant="body" weight="medium">
                No Specific Space
              </Typography>
              <Typography variant="footnote" color={colors.textSecondary}>
                General household task
              </Typography>
            </View>
            {currentSpaceId === null && (
              <Icon name="checkmark" size={20} color={colors.primary} />
            )}
          </TouchableOpacity>

          <View style={styles.divider} />

          {/* Spaces List */}
          {/* No `automaticallyAdjustKeyboardInsets` (i.e. not `keyboardDismissScrollProps`):
              the only field is the search box above, pinned outside this list, so the
              keyboard can never cover the field the member is typing in. */}
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.spacesList} showsVerticalScrollIndicator={false}>
            {isLoading ? (
              <Typography
                variant="body"
                color={colors.textSecondary}
                style={styles.emptyText}
              >
                Loading spaces...
              </Typography>
            ) : filteredSpaces.length === 0 ? (
              <Typography
                variant="body"
                color={colors.textSecondary}
                style={styles.emptyText}
              >
                No spaces found. Create your first space!
              </Typography>
            ) : (
              groupedSpaces.map((group) => (
                <View key={group.key}>
                  <Typography
                    variant="footnote"
                    color={colors.textSecondary}
                    weight="semibold"
                    style={styles.categoryHeader}
                  >
                    {group.label.toUpperCase()}
                  </Typography>

                  {group.spaces.map((space) => (
                    <TouchableOpacity
                      key={space.id}
                      style={[
                        styles.spaceItem,
                        {
                          backgroundColor:
                            space.id === currentSpaceId
                              ? colors.primary + '20'
                              : 'transparent',
                        },
                      ]}
                      onPress={() => handleSelect(space)}
                    >
                      <SpaceIcon
                        emoji={space.icon_emoji}
                        imageUrl={space.custom_image_url}
                        backgroundColor={space.icon_color || '#F5F5F5'}
                        size="small"
                        badge={
                          showTaskCounts && space.task_count
                            ? {
                                count: space.task_count,
                                color:
                                  space.task_count > 0 ? colors.error : colors.primary,
                              }
                            : undefined
                        }
                      />
                      <View style={styles.spaceInfo}>
                        <Typography variant="body" weight="medium">
                          {space.name}
                        </Typography>
                        <Typography variant="footnote" color={colors.textSecondary}>
                          {getFloorLabel(space.floor_level) ?? space.category ?? 'Space'}
                          {showTaskCounts && space.task_count != null
                            ? ` · ${space.task_count} ${space.task_count === 1 ? 'task' : 'tasks'}`
                            : ''}
                        </Typography>
                      </View>
                      {space.id === currentSpaceId && (
                        <Icon name="checkmark" size={20} color={colors.primary} />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              ))
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Button
              title="Manage Spaces"
              variant="secondary"
              size="md"
              onPress={() => {
                onClose();
                navigateToSpacesManagement(householdId);
              }}
              fullWidth
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const { height } = Dimensions.get('window');

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    backdrop: {
      ...StyleSheet.absoluteFill,
    },
    content: {
      maxHeight: height * 0.7,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 24,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
    },
    searchContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      borderRadius: 12,
      marginBottom: 16,
      gap: 8,
    },
    searchInput: {
      flex: 1,
      fontSize: 16,
    },
    spacesList: {
      flex: 1,
    },
    categoryHeader: {
      marginTop: 16,
      marginBottom: 8,
      paddingHorizontal: 4,
    },
    spaceItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      borderRadius: 12,
      marginBottom: 8,
      gap: 12,
    },
    spaceInfo: {
      flex: 1,
    },
    divider: {
      height: 1,
      backgroundColor: colors.divider,
      marginVertical: 12,
    },
    emptyText: {
      textAlign: 'center',
      marginVertical: 32,
    },
    footer: {
      marginTop: 16,
      paddingTop: 16,
      borderTopWidth: 1,
      borderTopColor: colors.divider,
    },
  });
