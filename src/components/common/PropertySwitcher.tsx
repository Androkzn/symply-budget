import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import React, { useState, useRef } from 'react';
import {
  Alert,
  StyleSheet,
  View,
  TouchableOpacity,
  Modal,
  FlatList,
  Animated,
  Platform,
  Dimensions,
} from 'react-native';

import type { Household } from '@api/households';
import { isFullBudget, isHouseBrand } from '@brand';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
// The FLAG only — twenty lines with no imports of its own, so every brand can
// carry it. The engine behind it is loaded on demand in `handleSelectProperty`;
// importing it here would pull the SQLite driver, the noble crypto polyfill and
// the whole local-first store into House's bundle for a switcher that never
// touches them.
import { isBudgetLocalFirst } from '@features/budget/local/flag';
import { navigateToBudgetHouseholds, navigateToHouseholds } from '@services/navigation';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';

// Concrete path, not the `@components/common` barrel this file is part of.
import { SheetHeader } from './SheetHeader';

interface PropertySwitcherProps {
  compact?: boolean;
}

export function PropertySwitcher({ compact = false }: PropertySwitcherProps) {
  const colors = useAppColors();  const appColors = useAppColors();
  const [isOpen, setIsOpen] = useState(false);
  /** Non-null while an engine activation is in flight — see `handleSelectProperty`. */
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const {
    households,
    currentHousehold,
    propertyMode,
    setCurrentHousehold,
    setPropertyMode,
  } = useHouseholdStore();

  /**
   * SELECTION is for every brand; AGGREGATION is House's alone (BR-016).
   *
   * The sheet does two different things. Picking one household out of several is
   * a selection, and any brand that can hold several can serve it — which since
   * BR-016 includes Budget, whose engine keeps a session per household and
   * activates one at a time. "All Properties" is an AGGREGATE: it asks every
   * screen to read N households at once. House can do that because its screens
   * fan out over `getActiveHouseholdIds()` server-side (`DataContext`
   * `fetchPropertyData`); Budget cannot, because its reads resolve through
   * `getLocalLedgerFor(householdId)` — one household, hydrated on demand — and
   * its stores (budget/savings/pension/mortgage) hold the ACTIVE household's rows
   * and nothing else. Offering the toggle there would not render a combined view,
   * it would render the active household's numbers under an "all" label: a wrong
   * total rather than a missing feature.
   *
   * So the mode toggle is House-only, and every other brand is pinned to
   * `single` regardless of what the persisted `propertyMode` says — the store is
   * shared and its value survives a brand's own switcher never writing it.
   */
  const supportsAllProperties = isHouseBrand();
  const effectiveMode = supportsAllProperties ? propertyMode : 'single';

  // House calls a household a "property" — a home with an address — and the flow
  // that drives this sheet asserts on that exact word
  // (`e2e/maestro/house-multi-member/mm-30-property-switch-mid-sync.yaml`).
  // Budget's are households: a shared budget, no address, so the property
  // vocabulary would name something the app never shows.
  const sheetTitle = supportsAllProperties ? 'Switch Property' : 'Switch Household';
  const listSectionLabel = supportsAllProperties ? 'YOUR PROPERTIES' : 'YOUR HOUSEHOLDS';
  const emptySelectionLabel = supportsAllProperties ? 'Select Property' : 'Select Household';
  const manageLabel = supportsAllProperties ? 'Manage Properties' : 'Manage Households';

  // Don't render if only one property
  if (households.length <= 1 && effectiveMode !== 'all') {
    return null;
  }

  const openModal = () => {
    setIsOpen(true);
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  };

  /**
   * `onClosed` runs once the sheet is really gone, not when the dismissal
   * starts. The sheet is a full-screen `Modal` owned by this component, so
   * anything that navigates has to wait for it: pushing a screen underneath a
   * modal that is still animating out shows the member the sheet sliding off
   * their new destination.
   */
  const closeModalThen = (onClosed?: () => void) => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setIsOpen(false);
      onClosed?.();
    });
  };

  // Takes no arguments on purpose — it is passed straight to `onPress`, which
  // would otherwise hand the press event in as `onClosed`.
  const closeModal = () => {
    closeModalThen();
  };

  /**
   * The pre-BR-016 switch, and still House's whole path: the STORE is the
   * selection. House's ledger catches up lazily — `localHouseholdsApi`'s
   * `withProperty` activates on the first write — and in `all` mode there is no
   * single ledger to move to anyway.
   */
  const selectInStore = (household: Household) => {
    setCurrentHousehold(household);
    if (propertyMode === 'all') {
      setPropertyMode('single');
    }
    closeModal();
  };

  /**
   * Move to another household.
   *
   * Budget cannot use `selectInStore`, because its store is a MIRROR of the
   * engine's session registry rather than the source of truth.
   * `ensureSession.startHouseholdSetWatch` republishes `currentHousehold` from
   * `getActiveBudgetHouseholdId()` on every ledger change, so a store-only
   * switch is silently reverted by the next incoming op — and until it is,
   * `sync/ledgerRefresh` drops the on-screen household's changes, because it
   * repaints only for the ACTIVE household and the two now disagree. So the
   * ENGINE moves first and the store follows it, which is also what makes the
   * switch repaint at all: activation emits a whole-ledger change stamped with
   * the NEW household id, which is the one id that bridge does not filter out.
   *
   * Awaited rather than floated because activation hydrates that household's
   * rows on its first visit (34–37 µs/row cold; idempotent afterwards, so
   * switching back is free). The sheet stays up with a spinner on the row being
   * switched to rather than dismissing onto a screen still showing the previous
   * household's money.
   */
  const handleSelectProperty = async (household: Household) => {
    if (switchingId) return;
    if (Platform.OS === 'ios') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    // House is excluded BY BRAND before the flag is consulted: a House bundle
    // launched from a shell that still exports EXPO_PUBLIC_BUDGET_LOCAL_FIRST=1
    // answers true to `isBudgetLocalFirst()`, and House's switch must stay the
    // synchronous store write it has always been.
    if (isHouseBrand() || !isBudgetLocalFirst()) {
      selectInStore(household);
      return;
    }

    // Resolved on demand — see the import comment. Under Budget the module is
    // already in the registry (`ensureBudgetLocalSession` loaded it at sign-in),
    // so this settles on the next microtask rather than fetching anything.
    const { activateLocalBudgetHousehold, isLocalBudgetSessionOpen } = await import(
      '@features/budget/local/engine'
    );
    // Local-first with no open session has no ledger to activate — a sign-out
    // racing the tap. The store is then all there is, and it is what the header
    // reads, so fall back to it instead of throwing at the member.
    if (!isLocalBudgetSessionOpen()) {
      selectInStore(household);
      return;
    }

    setSwitchingId(household.id);
    try {
      await activateLocalBudgetHousehold(household.id);
      closeModal();
    } catch (error) {
      // `BudgetLocalUnknownHouseholdError`: a household this device holds no
      // ledger for, listed from a persisted store copy that outlived it (it was
      // removed on another screen, or the ledger never migrated). Saying so and
      // staying put beats leaving the member pointed at a household the engine
      // never switched to — the state where every Budget facade throws a
      // household mismatch while the screen still looks fine.
      console.warn('[PropertySwitcher] could not switch household', error);
      Alert.alert(
        'Could not switch',
        `“${household.name}” isn’t available on this device. Open Household & Members to refresh your households, then try again.`
      );
    } finally {
      setSwitchingId(null);
    }
  };

  /**
   * The way OUT of the switcher and into the manager — renaming a household,
   * seeing who is in it, adding or leaving one. The sheet lists households and
   * nothing else, so before this row the only door to that screen was several
   * taps away in another tab, and the sheet dead-ended for anyone who opened it
   * to change a household rather than to switch to one.
   *
   * Two managers behind one label, matching the fork `SettingsNavigator` makes
   * for its `HouseholdManagement` route: full Budget gets its own list
   * (`BudgetHouseholds`, in the Budget stack), every other brand gets the
   * property-oriented `HouseholdManagement` in Settings.
   */
  const handleManageHouseholds = () => {
    if (switchingId) return;
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    closeModalThen(() => {
      if (isFullBudget()) {
        navigateToBudgetHouseholds();
        return;
      }
      navigateToHouseholds();
    });
  };

  const handleSelectAllProperties = () => {
    if (Platform.OS === 'ios') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setPropertyMode('all');
    closeModal();
  };

  const screenHeight = Dimensions.get('window').height;
  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [screenHeight, 0],
  });

  const displayName = effectiveMode === 'all'
    ? 'All Properties'
    : currentHousehold?.name || emptySelectionLabel;

  const displayIcon: keyof typeof Ionicons.glyphMap =
    effectiveMode === 'all' ? 'business' : 'home';

  const renderPropertyItem = ({ item }: { item: Household }) => {
    const isSelected = effectiveMode === 'single' && currentHousehold?.id === item.id;
    const isSwitching = switchingId === item.id;

    return (
      <TouchableOpacity
        style={[
          styles.propertyItem,
          {
            backgroundColor: isSelected
              ? colors.primary + '15'
              : colors.backgroundSecondary,
            borderColor: isSelected
              ? colors.primary
              : colors.borderColor,
          },
        ]}
        onPress={() => {
          void handleSelectProperty(item);
        }}
        // Every row is disabled while one switch is in flight: activating a
        // second household mid-hydration queues behind the first on the engine's
        // session chain and lands the member somewhere they tapped twice ago.
        disabled={switchingId !== null}
        activeOpacity={0.7}
        testID={`property-switcher-item-${item.id}`}
      >
        <View style={styles.propertyIcon}>
          <Icon name="home" size={24} color={colors.textPrimary} />
        </View>
        <View style={styles.propertyInfo}>
          <Typography 
            variant="body" 
            weight={isSelected ? 'semibold' : 'regular'}
            color={colors.textPrimary}
          >
            {item.name}
          </Typography>
          {item.address_line1 && (
            <Typography variant="caption1" color={colors.textSecondary}>
              {item.address_line1}
              {item.city ? `, ${item.city}` : ''}
            </Typography>
          )}
        </View>
        {isSwitching ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          isSelected && (
            <Icon
              name="checkmark-circle"
              size={24}
              color={colors.primary}
            />
          )
        )}
      </TouchableOpacity>
    );
  };

  return (
    <>
      {/* Trigger Button */}
      <TouchableOpacity
        style={[
          styles.trigger,
          compact && styles.triggerCompact,
          { 
            backgroundColor: colors.backgroundSecondary,
            borderColor: colors.borderColor,
          },
        ]}
        onPress={openModal}
        activeOpacity={0.7}
        testID="property-switcher-trigger"
      >
        <Icon name={displayIcon} size={16} color={colors.textPrimary} />
        {!compact && (
          <Typography 
            variant="footnote" 
            weight="medium" 
            color={colors.textPrimary}
            numberOfLines={1}
            style={styles.triggerText}
          >
            {displayName}
          </Typography>
        )}
        <Icon 
          name="chevron-down" 
          size={16} 
          color={colors.textSecondary} 
        />
      </TouchableOpacity>

      {/* Property Switcher Modal */}
      <Modal
        visible={isOpen}
        transparent
        animationType="none"
        onRequestClose={closeModal}
      >
        <Animated.View 
          style={[
            styles.overlay,
            { opacity: fadeAnim, backgroundColor: appColors.overlayDim },
          ]}
        >
          <TouchableOpacity 
            style={StyleSheet.absoluteFill} 
            onPress={closeModal}
            activeOpacity={1}
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.modalContainer,
            {
              transform: [{ translateY }],
            },
          ]}
        >
          <BlurView
            style={StyleSheet.absoluteFill}
            intensity={Platform.OS === 'ios' ? 100 : 150}
            tint="light"
          />
          <View
            style={[styles.modalContent, { backgroundColor: colors.backgroundMain + 'F5' }]}
            testID="property-switcher-sheet"
          >
            {/* Handle */}
            <View style={styles.handleContainer}>
              <View style={[styles.handle, { backgroundColor: colors.borderColor }]} />
            </View>

            {/* The app's one sheet header: glass ✕ on the left, centred title —
                the same row every `BottomSheet` renders. This sheet used to draw
                its own (bold title left, bare ✕ icon right), which is how it
                ended up being the one sheet in the app that opened differently. */}
            <SheetHeader
              title={sheetTitle}
              titleLines={2}
              leftVariant="close"
              onLeftPress={closeModal}
              leftTestID="property-switcher-close"
              leftAccessibilityLabel="Close"
              showDivider
            />

            {/* Mode Toggle — House only (see `supportsAllProperties` above).
                Without it the sheet is exactly the switcher Budget needs: a list
                of households, one of them checked. */}
            {supportsAllProperties && (
              <View style={styles.modeSection}>
                <Typography 
                  variant="footnote" 
                  color={colors.textSecondary}
                  style={styles.modeLabel}
                >
                  VIEW MODE
                </Typography>
                <View style={styles.modeButtons}>
                  <TouchableOpacity
                    style={[
                      styles.modeButton,
                      {
                        backgroundColor: propertyMode === 'single' 
                          ? colors.primary 
                          : colors.backgroundSecondary,
                        borderColor: colors.borderColor,
                      },
                    ]}
                    onPress={() => {
                      setPropertyMode('single');
                      if (Platform.OS === 'ios') {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      }
                    }}
                  >
                    <Typography 
                      variant="footnote" 
                      weight="semibold"
                      color={propertyMode === 'single' ? appColors.white : colors.textPrimary}
                    >
                      Single Property
                    </Typography>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.modeButton,
                      {
                        backgroundColor: propertyMode === 'all' 
                          ? colors.primary 
                          : colors.backgroundSecondary,
                        borderColor: colors.borderColor,
                      },
                    ]}
                    onPress={handleSelectAllProperties}
                  >
                    <Typography 
                      variant="footnote" 
                      weight="semibold"
                      color={propertyMode === 'all' ? appColors.white : colors.textPrimary}
                    >
                      All Properties
                    </Typography>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Properties List */}
            {effectiveMode === 'single' && (
              <>
                <Typography
                  variant="footnote"
                  color={colors.textSecondary}
                  style={styles.sectionLabel}
                >
                  {listSectionLabel}
                </Typography>
                <FlatList
                  data={households}
                  renderItem={renderPropertyItem}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={styles.listContent}
                  showsVerticalScrollIndicator={false}
                  style={styles.list}
                />
              </>
            )}

            {/* All Properties Mode Info — unreachable off House, where
                `effectiveMode` is pinned to `single`. */}
            {effectiveMode === 'all' && (
              <View style={styles.allModeInfo}>
                <Icon
                  name="business"
                  size={56}
                  color={colors.primary}
                  style={styles.allModeIcon}
                />
                <Typography 
                  variant="headline" 
                  weight="semibold" 
                  color={colors.textPrimary}
                  style={styles.allModeTitle}
                >
                  All Properties Mode
                </Typography>
                <Typography 
                  variant="body" 
                  color={colors.textSecondary}
                  style={styles.allModeDescription}
                >
                  You're viewing tasks, projects, and data from all {households.length} properties combined.
                </Typography>
                <View style={styles.propertyChips}>
                  {households.map((h) => (
                    <View
                      key={h.id}
                      style={[
                        styles.propertyChip,
                        { backgroundColor: colors.primary + '15' },
                      ]}
                    >
                      <Typography variant="caption1" color={colors.primary}>
                        {h.name}
                      </Typography>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Footer — pinned under the list in both modes. */}
            <View style={styles.footer}>
              <TouchableOpacity
                style={[
                  styles.manageButton,
                  {
                    backgroundColor: colors.backgroundSecondary,
                    borderColor: colors.borderColor,
                  },
                ]}
                onPress={handleManageHouseholds}
                // Same rule as the rows above: no leaving the sheet while an
                // activation is hydrating the household behind it.
                disabled={switchingId !== null}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={manageLabel}
                testID="property-switcher-manage"
              >
                <Icon name="settings-outline" size={20} color={colors.primary} />
                <Typography variant="body" weight="semibold" color={colors.primary}>
                  {manageLabel}
                </Typography>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
    maxWidth: '100%',
  },
  triggerCompact: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 44,
  },
  triggerText: {
    flexShrink: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
  },
  modalContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '85%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  modalContent: {
    flex: 1,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  modeSection: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  modeLabel: {
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  modeButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  sectionLabel: {
    paddingHorizontal: 20,
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  propertyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 2,
    marginBottom: 10,
  },
  propertyIcon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  propertyInfo: {
    flex: 1,
  },
  allModeInfo: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 24,
  },
  allModeIcon: {
    marginBottom: 16,
  },
  allModeTitle: {
    marginBottom: 8,
    textAlign: 'center',
  },
  allModeDescription: {
    textAlign: 'center',
    marginBottom: 20,
  },
  propertyChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  propertyChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  manageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
});
