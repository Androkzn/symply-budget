import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { householdSpacesApi, type HouseholdSpace } from '@api/household-spaces';
import { AppBackground, SafeAreaView } from '@components/common';
import { OnboardingStepHeader } from '@components/onboarding';
import { SpaceIcon } from '@components/spaces/SpaceIcon';
import { Button, GradientButton, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { houseOnboardingProgress } from '@features/house/onboarding/aiSteps';
import { useKeyboardInset } from '@hooks/useKeyboardInset';
import type { OnboardingStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useSpaceStore } from '@stores/spaceStore';
import { useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';
import {
  findDuplicateNameGroups,
  suggestDisambiguatedNames,
} from '@utils/spaceLabels';

type NavigationProp = NativeStackNavigationProp<OnboardingStackParamList, 'SpaceSetup'>;

const HOME_TYPES = [
  {
    id: 'small_apartment',
    title: 'Small Apartment',
    subtitle: 'Studio or 1-bed',
    icon: 'business-outline' as const,
  },
  {
    id: 'apartment',
    title: 'Apartment',
    subtitle: '2–3 bedrooms',
    icon: 'home-outline' as const,
  },
  {
    id: 'single_family',
    title: 'Single Family',
    subtitle: 'Typical house',
    icon: 'home' as const,
  },
  {
    id: 'large_house',
    title: 'Large House',
    subtitle: '4+ bedrooms',
    icon: 'layers-outline' as const,
  },
];

export function SpaceSetupScreen() {
  const navigation = useNavigation<NavigationProp>();
  const colors = useAppColors();
  const currentHousehold = useHouseholdStore((s) => s.currentHousehold);
  const setSpaces = useSpaceStore((s) => s.setSpaces);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // The rename sheet is anchored to the bottom edge, so an open keyboard sits on
  // top of the very field that summoned it — and its Continue button with it.
  // Lift the sheet by the inset and shrink its height ceiling by the same amount
  // so a short phone doesn't get it pushed off the TOP instead.
  const keyboardInset = useKeyboardInset();

  const [loading, setLoading] = useState(false);
  const [duplicateSpaces, setDuplicateSpaces] = useState<HouseholdSpace[]>([]);
  const [renameValues, setRenameValues] = useState<Record<string, string>>({});
  const [showRenameModal, setShowRenameModal] = useState(false);

  /**
   * Into the AI ask, not straight into the report upload.
   *
   * `UploadReport` and `FloorPlan` both need a model, so the question that
   * decides whether they are shown at all has to be asked before the first of
   * them. `AIProviderScreen` forwards entitled members through without a stop.
   */
  const finishOnboarding = () => {
    navigation.navigate('AIProvider');
  };

  const openRenameModal = (spaces: HouseholdSpace[]) => {
    const groups = findDuplicateNameGroups(spaces);
    const toRename: HouseholdSpace[] = [];
    const initialNames: Record<string, string> = {};

    for (const [, group] of groups) {
      const baseName = group[0].name;
      const suggestions = suggestDisambiguatedNames(
        baseName,
        group.length,
        spaces.map((s) => s.name)
      );
      group.forEach((space, index) => {
        if (index === 0) return;
        toRename.push(space);
        initialNames[space.id] = suggestions[index] ?? `${baseName} ${index + 1}`;
      });
    }

    if (toRename.length === 0) {
      finishOnboarding();
      return;
    }

    setDuplicateSpaces(toRename);
    setRenameValues(initialNames);
    setShowRenameModal(true);
  };

  const handleSelectHomeType = async (templateType: string) => {
    if (!currentHousehold) {
      Alert.alert('Error', 'Please create a home first');
      return;
    }

    try {
      setLoading(true);
      const { spaces } = await householdSpacesApi.bulkCreate(
        currentHousehold.id,
        templateType
      );
      setSpaces(spaces);
      openRenameModal(spaces);
    } catch (error) {
      console.error('Space setup error:', error);
      const message = error instanceof Error ? error.message : 'Failed to set up spaces';
      Alert.alert('Setup Failed', message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveRenames = async () => {
    if (!currentHousehold) return;

    try {
      setLoading(true);
      for (const space of duplicateSpaces) {
        const newName = renameValues[space.id]?.trim();
        if (newName && newName !== space.name) {
          await householdSpacesApi.update(currentHousehold.id, space.id, {
            name: newName,
            version: space.version,
          });
        }
      }
      const { spaces } = await householdSpacesApi.list(currentHousehold.id);
      setSpaces(spaces);
      setShowRenameModal(false);
      finishOnboarding();
    } catch (error) {
      Alert.alert('Error', 'Failed to rename spaces');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppBackground opacity={0.5}>
      <SafeAreaView>
        {/* Outside the ScrollView, unlike the bare progress bar it replaces:
            the back arrow has to stay reachable when the member has scrolled
            down to the tiles. */}
        <OnboardingStepHeader
          testID="onboarding-space-setup"
          {...houseOnboardingProgress('SpaceSetup')}
          stepLabel="Your Spaces"
          onBack={() => navigation.goBack()}
          // Same destination "Skip for Now" reaches — this step invents nothing
          // when it is passed over, so the two are one action.
          onForward={finishOnboarding}
          forwardDisabled={loading}
        />
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Typography variant="largeTitle" weight="bold" align="center" color={colors.textPrimary}>
              Set Up Your Spaces
            </Typography>
            <Typography
              variant="body"
              color={colors.textSecondary}
              align="center"
              style={styles.subtitle}
            >
              Pick rooms and areas so tasks know where they belong — bathroom, garage, backyard, and more.
            </Typography>
          </View>

          <View style={styles.grid}>
            {HOME_TYPES.map((type) => (
              <TouchableOpacity
                key={type.id}
                style={[styles.card, { backgroundColor: colors.cardBackground }]}
                onPress={() => handleSelectHomeType(type.id)}
                disabled={loading}
              >
                <Icon name={type.icon} size={28} color={colors.primary} />
                <Typography variant="headline" weight="semibold" style={styles.cardTitle}>
                  {type.title}
                </Typography>
                <Typography variant="footnote" color={colors.textSecondary}>
                  {type.subtitle}
                </Typography>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.actions}>
            <Button
              title="Skip for Now"
              variant="ghost"
              onPress={finishOnboarding}
              disabled={loading}
              fullWidth
            />
          </View>

          <Typography variant="caption1" color={colors.textSecondary} align="center">
            You can add or edit spaces anytime in Settings
          </Typography>
        </ScrollView>
      </SafeAreaView>

      <Modal visible={showRenameModal} transparent animationType="slide">
        <View style={[styles.modalOverlay, { paddingBottom: keyboardInset }]}>
          <View
            style={[
              styles.modalContent,
              {
                backgroundColor: colors.cardBackground,
                maxHeight: windowHeight - keyboardInset - insets.top - 32,
              },
            ]}
          >
            <Typography variant="title3" weight="bold" style={styles.modalTitle}>
              Name your spaces
            </Typography>
            <Typography variant="body" color={colors.textSecondary} style={styles.modalSubtitle}>
              You have multiple rooms with the same name. Give each one a clear label.
            </Typography>

            <ScrollView style={styles.renameList} {...keyboardDismissScrollProps}>
              {duplicateSpaces.map((space) => (
                <View key={space.id} style={styles.renameRow}>
                  <SpaceIcon
                    emoji={space.icon_emoji}
                    backgroundColor={space.icon_color || '#F5F5F5'}
                    size="small"
                  />
                  <TextInput
                    style={[
                      styles.renameInput,
                      {
                        color: colors.textPrimary,
                        borderColor: colors.borderColor,
                        backgroundColor: colors.backgroundSecondary,
                      },
                    ]}
                    value={renameValues[space.id] ?? space.name}
                    onChangeText={(text) =>
                      setRenameValues((prev) => ({ ...prev, [space.id]: text }))
                    }
                    placeholder="Space name"
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>
              ))}
            </ScrollView>

            <GradientButton
              title={loading ? 'Saving...' : 'Continue'}
              variant="teal"
              onPress={handleSaveRenames}
              disabled={loading}
              fullWidth
            />
          </View>
        </View>
      </Modal>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingBottom: 32 },
  header: { paddingHorizontal: 24, marginBottom: 24 },
  subtitle: { marginTop: 8 },
  grid: {
    paddingHorizontal: 24,
    gap: 12,
  },
  card: {
    borderRadius: 16,
    padding: 20,
    gap: 6,
  },
  cardTitle: { marginTop: 4 },
  actions: { paddingHorizontal: 24, marginTop: 24, marginBottom: 12 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '80%',
  },
  modalTitle: { marginBottom: 8 },
  modalSubtitle: { marginBottom: 16 },
  renameList: {
    flex: 1, maxHeight: 280, marginBottom: 16 },
  renameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  renameInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
});
