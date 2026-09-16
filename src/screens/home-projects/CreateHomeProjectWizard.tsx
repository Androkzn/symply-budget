import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { homeProjectsApi, useCreateHomeProject } from '@api/home-projects';
import { householdSpacesApi, type HouseholdSpace } from '@api/household-spaces';
import { ScreenFooterGlass, ScreenHeader } from '@components/common';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Chip } from '@components/ui/Chip';
import { Icon } from '@components/ui/Icon';
import {
  MonthPickerSheet,
  currentMonthKey,
  formatMonthKey,
  monthSuggestions,
} from '@components/ui/MonthPickerSheet';
import { isHouseLocalFirst } from '@features/house/local/flag';
import { useFeature } from '@hooks/useFeature';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import type { HomeProjectsStackParamList } from '@navigation/types';
import { trackEvent } from '@services/analytics';
import { setMonitoringTag } from '@services/monitoring';
import { useHomeProjectStore } from '@stores/homeProjectStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';
import { keyboardDismissScrollProps, numericTextHandler } from '@utils/keyboard';

/**
 * How far above the window bottom this screen's PINNED footer starts.
 *
 * Not the 64pt `TAB_BAR_CONTENT_HEIGHT` the Kaizen screens use
 * (`src/features/kaizen/screens/common.tsx`): 64 clears the tab bar's capsule
 * and nothing else. The floating tab bar also paints a stack of bottom-
 * anchored blur bands OVER the screen (`BACKDROP_BLUR_BANDS` in
 * `app/(tabs)/_layout.tsx`), the tallest reaching `insets.bottom + 104`.
 * Pinned at 64 this footer's button ended at `insets.bottom + 80` — straddling
 * that band's top edge, so its lower half came out frosted white while its
 * upper half stayed crisp, reading as a half-erased control. Caught on the
 * Smart wizard's "Cancel", which shares this footer recipe verbatim.
 *
 * 104 for the tallest band + 8pt of clear air, less the 16pt the footer
 * already pads below its content.
 */
const TAB_BAR_FOOTER_CLEARANCE = 96;

type Props = NativeStackScreenProps<
  HomeProjectsStackParamList,
  'CreateHomeProject'
>;

/**
 * The tiles on step 1.
 *
 * These used to carry a cost hint — "~$12k avg · varies by location" — which was
 * a national average invented well away from this member's contractor, city and
 * scope. A number shown at the moment someone picks a template anchors what they
 * then budget, and a wrong anchor is worse than none. The member sets the budget
 * themselves on step 3, so the guess is gone rather than relabelled.
 *
 * What replaces it is an icon: the grid is scanned, not read, and a shape tells
 * you which tile is the bathroom faster than its title does.
 *
 * The `title` here is SHORTER than the catalogue's — picking a tile pre-fills the
 * project name on step 2, and "Bathroom reno" is a better default name to edit
 * than "Bathroom renovation". The catalogue title is what seeds a project created
 * without passing one at all.
 *
 * Grouped rather than one flat grid: sixteen tiles in a row-by-row scan is a wall,
 * and someone arriving with "the water heater died" wants the systems group, not
 * an alphabet. Order matches `HOME_PROJECT_TEMPLATE_SEEDS`, which is the order the
 * catalogue lists in — the two drifting apart would put a tile in the wrong group.
 */
export const TEMPLATE_GROUPS = [
  {
    label: 'Rooms & spaces',
    templates: [
      { key: 'bathroom_reno', title: 'Bathroom reno', icon: 'water-outline' },
      {
        key: 'kitchen_reno',
        title: 'Kitchen reno',
        icon: 'restaurant-outline',
      },
      {
        key: 'basement_finish',
        title: 'Finish basement',
        icon: 'layers-outline',
      },
      { key: 'expand_space', title: 'Expand space', icon: 'resize-outline' },
    ],
  },
  {
    label: 'Surfaces & furnishings',
    templates: [
      {
        key: 'paint_refresh',
        title: 'Paint refresh',
        icon: 'color-palette-outline',
      },
      { key: 'flooring_replace', title: 'Flooring', icon: 'grid-outline' },
      { key: 'furniture_replace', title: 'Furniture', icon: 'bed-outline' },
      { key: 'appliance_replace', title: 'Appliance', icon: 'cube-outline' },
    ],
  },
  {
    label: 'Systems & structure',
    templates: [
      // `git-merge-outline` is the closest glyph the set has to a pipe run.
      { key: 'plumbing_replace', title: 'Plumbing', icon: 'git-merge-outline' },
      { key: 'electrical_upgrade', title: 'Electrical', icon: 'flash-outline' },
      {
        key: 'hvac_replace',
        title: 'Heating & cooling',
        icon: 'thermometer-outline',
      },
      { key: 'roof_replace', title: 'Roof', icon: 'home-outline' },
      {
        key: 'window_door_replace',
        title: 'Windows & doors',
        icon: 'browsers-outline',
      },
      {
        key: 'replace_fixture',
        title: 'Replace fixture',
        icon: 'build-outline',
      },
    ],
  },
  {
    label: 'Outdoor & other',
    templates: [
      {
        key: 'outdoor_refresh',
        title: 'Outdoor refresh',
        icon: 'leaf-outline',
      },
      { key: 'blank', title: 'Blank', icon: 'add-circle-outline' },
    ],
  },
] as const;

/**
 * Whether the "Describe it" entry point is offered.
 *
 * The rollout flag, and nothing else — resolving BRD open question Q4.
 *
 * This used to also require `!localFirst`, because generation ran on the Worker
 * and wrote the drafted project into D1: on a local-first household that
 * produced a project the member's own encrypted ledger could never read. Since
 * House is local-first BY DEFAULT, that gate hid the feature from every House
 * member — the whole audience.
 *
 * The split fixed the cause rather than the symptom. The server now only
 * generates (`POST /smart-draft/generate`, which stores nothing) and the client
 * saves the plan through `homeProjectsApi`, whose local proxy already routes to
 * the ledger or to D1 per household. There is no longer a configuration in
 * which a drafted project lands where its owner cannot see it, so there is
 * nothing left for a second gate to protect.
 *
 * `localFirst` is retained in the signature because the tests that pin this
 * behaviour are worth keeping: if a future change reintroduces a server-write,
 * the gate has an obvious home again.
 */
export function isSmartProjectAvailable(
  flagOn: boolean,
  _localFirst: boolean,
): boolean {
  return flagOn;
}

export function CreateHomeProjectWizard({ navigation, route }: Props) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  /** iPad's floating leading rail draws over x=0 — reserve its width. */
  const { sidebarInset } = useLayoutPadding();
  const householdId = useHouseholdStore(s => s.currentHousehold?.id);
  const { wizardDraft, setWizardDraft, resetWizardDraft } =
    useHomeProjectStore();
  const create = useCreateHomeProject(householdId);
  const smartProjectFlag = useFeature('smartProject');
  const smartProjectAvailable = isSmartProjectAvailable(
    smartProjectFlag,
    isHouseLocalFirst(),
  );
  const [step, setStep] = useState(1);
  const [spaces, setSpaces] = useState<HouseholdSpace[]>([]);
  const [finishMonth, setFinishMonth] = useState(
    wizardDraft.targetEndAt?.slice(0, 7) || '',
  );
  const [budgetText, setBudgetText] = useState(
    wizardDraft.targetBudgetCents
      ? String(wizardDraft.targetBudgetCents / 100)
      : '',
  );
  const [monthSheetVisible, setMonthSheetVisible] = useState(false);
  /** Measured, not assumed: the footer is one row on every step, but its height
   *  still moves with Dynamic Type, and the scroll content has to clear it. */
  const [footerHeight, setFooterHeight] = useState(0);
  /**
   * iOS only. The footer is pinned to the bottom of the WINDOW, which the
   * software keyboard then covers — steps 2 and 3 both raise one, so without
   * this the member types a name and cannot reach Continue at all. Android
   * resizes the window itself (`adjustResize`), so its footer is already clear.
   */
  const [keyboardInset, setKeyboardInset] = useState(0);

  // Pinned for the life of the screen: both read the clock, and re-reading it
  // on every render would let a wizard left open across midnight on the 31st
  // renumber its own suggestions under the member.
  const finishSuggestions = useMemo(() => monthSuggestions(), []);
  const earliestFinishMonth = useMemo(() => currentMonthKey(), []);

  useEffect(() => {
    setMonitoringTag('feature', 'home_projects');
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const showSub = Keyboard.addListener('keyboardWillShow', e =>
      setKeyboardInset(e.endCoordinates.height),
    );
    const hideSub = Keyboard.addListener('keyboardWillHide', () =>
      setKeyboardInset(0),
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  /**
   * Seed the deep-linked space ONCE, when the param arrives.
   *
   * The exhaustive-deps rule wants `wizardDraft.spaceIds` here, and adding it
   * would be a behaviour bug rather than a fix: this effect WRITES spaceIds, so
   * it would re-run on every selection change and re-add the preset space the
   * moment a member deselected it — the one space they cannot opt out of.
   * `setWizardDraft` is a stable store setter, so it contributes nothing.
   */
  useEffect(() => {
    const presetSpaceId = route.params?.spaceId;
    if (presetSpaceId && !wizardDraft.spaceIds.includes(presetSpaceId)) {
      setWizardDraft({ spaceIds: [...wizardDraft.spaceIds, presetSpaceId] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.spaceId]);

  useEffect(() => {
    if (!householdId) return;
    void homeProjectsApi.listTemplates(householdId).catch(() => undefined);
    void householdSpacesApi
      .list(householdId)
      .then(res => setSpaces(res.spaces))
      .catch(() => setSpaces([]));
  }, [householdId]);

  /** `''` clears the target — the field is optional and stays that way. */
  const applyFinishMonth = (month: string) => {
    setFinishMonth(month);
    setWizardDraft({
      targetEndAt: month ? `${month}-01T00:00:00.000Z` : undefined,
    });
  };

  const toggleSpace = (spaceId: string) => {
    const next = wizardDraft.spaceIds.includes(spaceId)
      ? wizardDraft.spaceIds.filter(id => id !== spaceId)
      : [...wizardDraft.spaceIds, spaceId];
    setWizardDraft({ spaceIds: next });
  };

  const onCreate = async () => {
    if (!householdId) return;
    try {
      const dollars = Number(budgetText);
      const targetEndAt = finishMonth
        ? `${finishMonth}-01T00:00:00.000Z`
        : wizardDraft.targetEndAt;
      const project = await create.mutateAsync({
        templateKey: wizardDraft.templateKey || 'blank',
        title: wizardDraft.title,
        spaceIds: wizardDraft.spaceIds,
        targetBudgetCents:
          Number.isFinite(dollars) && dollars > 0
            ? Math.round(dollars * 100)
            : undefined,
        targetEndAt,
      });
      trackEvent('home_project_created', {
        project_id: project.id,
        template_key: wizardDraft.templateKey || 'blank',
      });
      if (wizardDraft.templateKey) {
        trackEvent('home_project_template_used', {
          template_key: wizardDraft.templateKey,
        });
      }
      resetWizardDraft();
      navigation.replace('HomeProjectHub', { projectId: project.id });
    } catch (e) {
      Alert.alert(
        'Could not create project',
        e instanceof Error ? e.message : 'Try again',
      );
    }
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.backgroundMain,
        paddingLeft: sidebarInset,
      }}
    >
      <ScreenHeader
        title="New project"
        // The wizard's own steps now hang off this chevron: the per-step "Back"
        // button that used to sit beside Continue is gone, so on steps 2 and 3
        // this walks back through the wizard and only leaves it from step 1.
        showBackButton={step > 1 || navigation.canGoBack()}
        onBackPress={() => (step > 1 ? setStep(step - 1) : navigation.goBack())}
        showNotificationBell={false}
        showAvatar={false}
      />
      <ScrollView
        {...keyboardDismissScrollProps}
        contentContainerStyle={[
          styles.content,
          /**
           * Reserve the footer's OFFSET as well as its height.
           *
           * The footer is pinned `TAB_BAR_FOOTER_CLEARANCE` above the window
           * bottom so it clears the tab bar, but this padding only ever counted
           * `footerHeight` — leaving that offset unreserved, so the last rows of
           * the template grid came to rest UNDERNEATH the footer. A tap aimed at
           * a template there landed on Continue instead, which fired the
           * "Choose a template" validation alert with no template selected: the
           * tap looked delivered and the selection never happened.
           *
           * Mirrors the footer's own `bottom` exactly, so the two cannot drift.
           */
          {
            paddingBottom:
              footerHeight +
              (keyboardInset > 0 ? keyboardInset : TAB_BAR_FOOTER_CLEARANCE) +
              24,
          },
        ]}
      >
        <Text style={[styles.step, { color: colors.textSecondary }]}>
          Step {step} of 3
        </Text>

        {step === 1 && (
          <>
            {/* Describe-to-draft, above the grid because it is the answer for
                the member the grid fails: the one whose project is not a room
                type, or whose scope is defined by what is already built. It is
                an alternative to the tiles, not a step before them. */}
            {smartProjectAvailable && (
              <Pressable
                style={[
                  styles.smartCard,
                  { backgroundColor: colors.card, borderColor: colors.primary },
                ]}
                onPress={() =>
                  navigation.navigate('SmartProject', route.params?.spaceId
                    ? { spaceId: route.params.spaceId }
                    : undefined)
                }
                accessibilityRole="button"
                accessibilityLabel="Describe your project and let AI draft it"
                testID="home-projects-smart-entry"
              >
                <Icon name="sparkles-outline" size={22} color={colors.primary} />
                <View style={styles.smartCardBody}>
                  <Text
                    style={[styles.smartTitle, { color: colors.textPrimary }]}
                  >
                    Describe it instead
                  </Text>
                  <Text
                    style={[styles.smartHelp, { color: colors.textSecondary }]}
                  >
                    Tell us what you have and what you want. We will draft the
                    phases, surfaces and materials for you to review.
                  </Text>
                </View>
                <Icon
                  name="chevron-forward"
                  size={18}
                  color={colors.textSecondary}
                />
              </Pressable>
            )}

            <Text style={[styles.heading, { color: colors.textPrimary }]}>
              Pick a template
            </Text>
            <Text
              style={[
                styles.help,
                { color: colors.textSecondary, marginTop: 0, marginBottom: 8 },
              ]}
            >
              A template fills in the phases, the decisions to make and the
              budget lines for that kind of job. You can change all of it
              afterwards.
            </Text>
            {TEMPLATE_GROUPS.map(group => (
              <View key={group.label}>
                <Text
                  style={[styles.groupLabel, { color: colors.textSecondary }]}
                >
                  {group.label}
                </Text>
                <View style={styles.grid}>
                  {group.templates.map(t => {
                    const selected = wizardDraft.templateKey === t.key;
                    return (
                      <Pressable
                        key={t.key}
                        style={[
                          styles.tile,
                          {
                            backgroundColor: colors.card,
                            borderColor: selected
                              ? colors.primary
                              : colors.borderColor,
                          },
                        ]}
                        onPress={() =>
                          setWizardDraft({ templateKey: t.key, title: t.title })
                        }
                        testID={`template-${t.key}`}
                      >
                        <View
                          style={[
                            styles.tileIcon,
                            {
                              backgroundColor: selected
                                ? `${colors.primary}1F`
                                : colors.cardSubtle,
                            },
                          ]}
                        >
                          <Icon
                            name={t.icon}
                            size={22}
                            color={
                              selected ? colors.primary : colors.textSecondary
                            }
                          />
                        </View>
                        <Text
                          style={[
                            styles.tileTitle,
                            { color: colors.textPrimary },
                          ]}
                        >
                          {t.title}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </>
        )}

        {step === 2 && (
          <>
            <Text style={[styles.heading, { color: colors.textPrimary }]}>
              Name & spaces
            </Text>
            <TextInput
              value={wizardDraft.title || ''}
              onChangeText={title => setWizardDraft({ title })}
              placeholder="e.g. Master bath remodel"
              placeholderTextColor={colors.textSecondary}
              style={[
                styles.input,
                {
                  color: colors.textPrimary,
                  borderColor: colors.borderColor,
                  backgroundColor: colors.card,
                },
              ]}
              testID="home-project-title"
            />
            <Text style={[styles.sectionLabel, { color: colors.textPrimary }]}>
              Spaces
            </Text>
            <Text
              style={[
                styles.help,
                { color: colors.textSecondary, marginTop: 0 },
              ]}
            >
              Select one or more spaces this project covers (optional).
            </Text>
            <View style={styles.chipRow}>
              {spaces.length === 0 ? (
                <Text style={{ color: colors.textSecondary }}>
                  No spaces yet — add them in My Home.
                </Text>
              ) : (
                spaces.map(space => {
                  const selected = wizardDraft.spaceIds.includes(space.id);
                  return (
                    <Pressable
                      key={space.id}
                      onPress={() => toggleSpace(space.id)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: selected
                            ? colors.primary
                            : colors.card,
                          borderColor: colors.borderColor,
                        },
                      ]}
                      testID={`space-chip-${space.id}`}
                    >
                      <Text
                        style={{
                          color: selected ? '#fff' : colors.textPrimary,
                          fontWeight: '600',
                        }}
                      >
                        {space.name}
                      </Text>
                    </Pressable>
                  );
                })
              )}
            </View>
          </>
        )}

        {step === 3 && (
          <>
            <Text style={[styles.heading, { color: colors.textPrimary }]}>
              Budget & timing
            </Text>
            <TextInput
              value={budgetText}
              // Raw RN input: the decimal pad is a suggestion, not a
              // constraint, and this figure becomes the project's budget.
              onChangeText={numericTextHandler(setBudgetText)}
              keyboardType="decimal-pad"
              placeholder="Total budget in dollars (optional)"
              placeholderTextColor={colors.textSecondary}
              style={[
                styles.input,
                {
                  color: colors.textPrimary,
                  borderColor: colors.borderColor,
                  backgroundColor: colors.card,
                },
              ]}
              testID="home-project-budget"
            />
            <Text style={[styles.sectionLabel, { color: colors.textPrimary }]}>
              Target finish month (optional)
            </Text>
            {/* Three bubbles cover most answers in one tap; the wheels behind the
              field below take the rest. Each bubble carries the month it lands
              on, because "this year" on a target date means DECEMBER and there
              is no way to read that off the shorthand alone. */}
            <View style={styles.chipRow}>
              {finishSuggestions.map(suggestion => (
                <Chip
                  key={suggestion.key}
                  label={`${suggestion.label} · ${formatMonthKey(
                    suggestion.month,
                    'short',
                  )}`}
                  size="sm"
                  outlined
                  variant={
                    finishMonth === suggestion.month ? 'primary' : 'secondary'
                  }
                  onPress={() => applyFinishMonth(suggestion.month)}
                  testID={`home-project-finish-${suggestion.key}`}
                />
              ))}
            </View>
            <Pressable
              onPress={() => setMonthSheetVisible(true)}
              accessibilityRole="button"
              accessibilityLabel={
                finishMonth
                  ? `Target finish month, ${formatMonthKey(finishMonth)}`
                  : 'Choose a target finish month'
              }
              style={[
                styles.input,
                styles.pickerField,
                {
                  borderColor: colors.borderColor,
                  backgroundColor: colors.card,
                },
              ]}
              testID="home-project-finish-month"
            >
              <Icon
                name="calendar-outline"
                size={18}
                color={colors.textSecondary}
              />
              <Text
                style={[
                  styles.pickerFieldText,
                  {
                    color: finishMonth
                      ? colors.textPrimary
                      : colors.textSecondary,
                  },
                ]}
              >
                {finishMonth ? formatMonthKey(finishMonth) : 'Pick a month'}
              </Text>
              {finishMonth ? (
                <Pressable
                  onPress={() => applyFinishMonth('')}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Clear target finish month"
                  testID="home-project-finish-month-clear"
                >
                  <Icon
                    name="close-circle"
                    size={18}
                    color={colors.textSecondary}
                  />
                </Pressable>
              ) : (
                <Icon
                  name="chevron-forward"
                  size={16}
                  color={colors.textSecondary}
                />
              )}
            </Pressable>
            <MonthPickerSheet
              visible={monthSheetVisible}
              value={finishMonth}
              title="Target finish month"
              // A project cannot finish before the month it is created in, so the
              // wheels do not offer one.
              minMonth={earliestFinishMonth}
              helperText="A target, not a deadline — change it any time on the hub."
              onConfirm={applyFinishMonth}
              onClose={() => setMonthSheetVisible(false)}
              testID="home-project-finish-month-sheet"
            />
            <Text style={[styles.help, { color: colors.textSecondary }]}>
              Contingency comes from the template — 10% on small jobs, 20% on
              structural ones. You can edit every line on the hub.
            </Text>
          </>
        )}
      </ScrollView>

      {/* The step's one action, pinned over the content rather than parked at
          the end of it. Step 1's grid is sixteen tiles long on a phone, so a
          Continue that scrolls with them is off-screen the whole time someone
          is choosing — which is exactly when it needs to be in reach. Same
          absolute-footer-over-`ScreenFooterGlass` recipe as MaintenanceSetup
          and the onboarding step shell. */}
      <View
        style={[
          styles.footer,
          {
            /**
             * Lifted clear of the bottom tab bar.
             *
             * Home Projects became a TAB (`app/(tabs)/projects.tsx`), so the
             * floating tab bar now sits over the very bottom of every screen in
             * this stack — including this pinned footer. The result was that
             * "Continue" rendered underneath it: invisible, and a tap on it hit
             * the tab bar and jumped to another tab. A member could not create a
             * project from a template at all.
             *
             * `TAB_BAR_FOOTER_CLEARANCE` clears the bar's blur backdrop too,
             * not just the capsule — see the constant. When the keyboard is up
             * the whole bar is covered anyway, so only the keyboard inset
             * applies.
             */
            bottom: keyboardInset > 0 ? keyboardInset : TAB_BAR_FOOTER_CLEARANCE,
            paddingBottom: keyboardInset > 0 ? 16 : insets.bottom + 16,
          },
        ]}
        onLayout={e => setFooterHeight(e.nativeEvent.layout.height)}
      >
        <ScreenFooterGlass />
        {step === 1 && (
          <Pressable
            style={[styles.next, { backgroundColor: colors.primary }]}
            onPress={() => {
              if (!wizardDraft.templateKey) {
                Alert.alert('Choose a template');
                return;
              }
              setStep(2);
            }}
          >
            <Text style={styles.nextText}>Continue</Text>
          </Pressable>
        )}
        {step === 2 && (
          <Pressable
            style={[styles.next, { backgroundColor: colors.primary }]}
            onPress={() => setStep(3)}
          >
            <Text style={styles.nextText}>Continue</Text>
          </Pressable>
        )}
        {step === 3 && (
          <Pressable
            style={[styles.next, { backgroundColor: colors.primary }]}
            onPress={() => void onCreate()}
            disabled={create.isPending}
            testID="home-project-create-submit"
          >
            {create.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.nextText}>Create project</Text>
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  step: { fontSize: 13, marginBottom: 8 },
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 16 },
  smartCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 20,
  },
  smartCardBody: { flex: 1 },
  smartTitle: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
  smartHelp: { fontSize: 13, lineHeight: 18 },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 6,
  },
  groupLabel: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 18,
    marginBottom: 8,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '48%',
    borderWidth: 2,
    borderRadius: 12,
    padding: 14,
    minHeight: 96,
  },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  tileTitle: { fontSize: 15, fontWeight: '600' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    // Tall enough that the glass fade begins well above the button, so its top
    // edge reads as transparent rather than a hard line over the content.
    paddingTop: 32,
    overflow: 'hidden',
  },
  next: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  nextText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
  /** `input` shape, but a row that opens a wheel instead of the keyboard. */
  pickerField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  pickerFieldText: { flex: 1, fontSize: 16 },
  help: { marginTop: 10, fontSize: 13, lineHeight: 18 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
