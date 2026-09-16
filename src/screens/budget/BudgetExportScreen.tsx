import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Alert, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { AppBackground, SafeAreaView, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Card, GradientButton, IconBackgroundChip, Toggle, Typography } from '@components/ui';
import { hasBrandIcon } from '@components/ui/Icon';
import {
  getActiveBudgetHouseholdId,
  getLocalLedger,
  isLocalBudgetSessionOpen,
  subscribeToLedgerChanges,
} from '@features/budget/local/engine';
import { exportBudgetLedgerCsv } from '@features/budget/local/export/budgetLedgerExport';
import { exportBudgetWorkbookXlsx } from '@features/budget/local/export/budgetXlsxExport';
import {
  BUDGET_EXPORT_SECTIONS,
  budgetExportSelectionOf,
  countSelectedBudgetExportSections,
  isBudgetExportSectionOn,
  loadBudgetExportSelection,
  saveBudgetExportSelection,
  type BudgetExportSectionKey,
  type BudgetExportSelection,
} from '@features/budget/local/export/exportSelection';
import type { BudgetStackParamList } from '@navigation/types';
import { CornerRadius, hexToRgba, IconSize, Layout, Spacing, useAppColors } from '@theme';

/**
 * Budget → Settings → Export.
 *
 * Export used to be two controls stapled to the bottom of the Sync & sharing
 * card — a full-width "Export a spreadsheet" button and a CSV link — which made
 * it look like a peer of the section's copy rather than a destination, and left
 * no room to ask the one question an export actually has: *what goes in it?*
 *
 * It is now the fourth row of that section, alongside Device Sync, Backup and
 * Invite, and it owns this screen: a toggle per section (all on by default, with
 * Enable all / Disable all), then the two file formats. The selection drives
 * both formats — a section switched off is missing from the workbook tab list
 * AND from the CSV bundle — and it is remembered, since people who export
 * monthly tend to want the same slice every time.
 *
 * "Remembered" is per household (BR-016): `exportSelection.ts` keys the stored
 * choice by household id, because someone who exports their own budget in full
 * and a shared one down to two tabs means both, not the last one they touched.
 * So this screen follows the ACTIVE household explicitly and names it on every
 * read, write and export, rather than letting each helper re-resolve "whatever
 * is active" at its own await point.
 */

/**
 * The household this screen is exporting, re-read when the engine switches.
 *
 * The active household is a module variable, so a switch is invisible to React
 * until something else re-renders — and this screen would then be showing one
 * household's row counts over another's toggles, and writing the choice back
 * under the wrong id. The id itself is the snapshot rather than the revision:
 * everything here is per household and nothing is per op, so the hundreds of
 * bumps a sync produces compare equal and cost one function call each.
 */
function useActiveBudgetHouseholdId(): string | null {
  return useSyncExternalStore(
    subscribeToLedgerChanges,
    getActiveBudgetHouseholdId,
    getActiveBudgetHouseholdId,
  );
}

export function BudgetExportScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();

  const activeHouseholdId = useActiveBudgetHouseholdId();

  /**
   * The stored choice, held WITH the household it was loaded for.
   *
   * A bare selection object plus a save that defaults to the active household is
   * a silent cross-household write: switch while this screen is open and the
   * next toggle press files the household you LEFT's fourteen switches under the
   * one you arrived in, overwriting a choice the member made deliberately. The
   * pairing makes the mismatch visible in render, so the toggles fall back to
   * all-on — the same thing a household with no stored choice shows — until this
   * household's own answer lands.
   */
  const [loaded, setLoaded] = useState<{
    householdId: string | null;
    selection: BudgetExportSelection;
  }>(() => ({ householdId: null, selection: budgetExportSelectionOf(true) }));
  const [isExporting, setIsExporting] = useState(false);

  // Stable identity so the "not loaded yet" branch does not hand every memo
  // below a fresh object on each render.
  const allSectionsOn = useMemo(() => budgetExportSelectionOf(true), []);
  const selection = loaded.householdId === activeHouseholdId ? loaded.selection : allSectionsOn;

  useEffect(() => {
    if (!activeHouseholdId) return;
    let cancelled = false;
    void loadBudgetExportSelection(activeHouseholdId).then((stored) => {
      if (!cancelled) setLoaded({ householdId: activeHouseholdId, selection: stored });
    });
    return () => {
      cancelled = true;
    };
  }, [activeHouseholdId]);

  // Row counts come off the open ledger so each toggle can say how much it is
  // worth ("Spending · 412 rows"). Read once PER HOUSEHOLD — this screen is
  // transient, and a ledger write mid-export is not a case worth re-rendering
  // for, but a switch replaces every number on the list, and 412 rows of
  // somebody else's spending is a worse answer than none.
  //
  // `getLocalLedger()` is the ACTIVE session's, which is the household this
  // screen describes; the id is read here rather than only used as a cache key
  // so the two can never disagree about whether there is one at all.
  const rowCounts = useMemo(() => {
    if (!activeHouseholdId || !isLocalBudgetSessionOpen()) return null;
    try {
      const ledger = getLocalLedger();
      return Object.fromEntries(
        BUDGET_EXPORT_SECTIONS.map((s) => [s.key, s.rowCount(ledger)]),
      ) as Record<BudgetExportSectionKey, number>;
    } catch {
      return null;
    }
  }, [activeHouseholdId]);

  const persist = useCallback(
    (next: BudgetExportSelection) => {
      setLoaded({ householdId: activeHouseholdId, selection: next });
      // Named, never defaulted. `saveBudgetExportSelection` no-ops without a
      // target anyway, but resolving the household here rather than inside it
      // is what guarantees the write lands under the household whose toggles
      // the member just moved.
      if (activeHouseholdId) void saveBudgetExportSelection(next, activeHouseholdId);
    },
    [activeHouseholdId],
  );

  const toggleSection = useCallback(
    (key: BudgetExportSectionKey) => {
      persist({ ...selection, [key]: !isBudgetExportSectionOn(selection, key) });
    },
    [persist, selection],
  );

  const selectedCount = countSelectedBudgetExportSections(selection);
  const total = BUDGET_EXPORT_SECTIONS.length;
  const allOn = selectedCount === total;
  const noneOn = selectedCount === 0;

  // Only the data sections carry rows; Summary is a fixed cover sheet.
  const selectedRows = useMemo(() => {
    if (!rowCounts) return null;
    return BUDGET_EXPORT_SECTIONS.filter((s) => isBudgetExportSectionOn(selection, s.key)).reduce(
      (sum, s) => sum + (rowCounts[s.key] ?? 0),
      0,
    );
  }, [rowCounts, selection]);

  const summaryLine =
    selectedRows === null
      ? `${selectedCount} of ${total} sections included`
      : `${selectedCount} of ${total} sections · ${selectedRows} row${
          selectedRows === 1 ? '' : 's'
        }`;

  /**
   * The household is captured at press time and passed down, so the file is the
   * budget the member was looking at when they asked for it.
   *
   * Both export paths default to the active household, and an export is a long
   * chain of awaits — hydrate, build every sheet, write the file, wait on the
   * share sheet. Left to default, a switch anywhere in that chain would hand
   * over a workbook of the other household's spending under this one's name,
   * with the toggles chosen here applied to data they were never about. Naming
   * it also lets the id be wrong loudly: `BudgetLocalUnknownHouseholdError`
   * escapes the friendly "could not export" catch by design.
   */
  const runExport = useCallback(
    (kind: 'xlsx' | 'csv') => {
      if (noneOn || isExporting) return;
      const householdId = activeHouseholdId ?? undefined;
      setIsExporting(true);
      void (async () => {
        try {
          const options = { sections: selection, householdId };
          const result =
            kind === 'xlsx'
              ? await exportBudgetWorkbookXlsx(options)
              : await exportBudgetLedgerCsv(options);
          Alert.alert(result.status === 'shared' ? 'Export ready' : 'Export', result.message);
        } catch (error) {
          console.error(`Budget ${kind} export failed`, error);
          Alert.alert('Error', 'Could not export budget data.');
        } finally {
          setIsExporting(false);
        }
      })();
    },
    [activeHouseholdId, isExporting, noneOn, selection],
  );

  return (
    <AppBackground>
      <SafeAreaView edges={[]} testID="budget-export-screen">
        <ScreenHeader
          title="Export"
          showBackButton
          onBackPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
              return;
            }
            navigation.navigate('BudgetSettings');
          }}
          showNotificationBell={false}
          showAvatar={false}
          showPropertySwitcher={false}
        />

        <ScrollView
          style={[screenScrollViewStyle.scroll, styles.flex]}
          contentContainerStyle={styles.content}
        >
          <Typography variant="caption1" color={colors.textSecondary} style={styles.intro}>
            Choose what goes into the file. Everything on this list is included unless you switch it
            off, and your choice is remembered for next time.
          </Typography>

          {/* Bulk controls sit in the section header, where the eye already is
              when it starts down a list of fourteen switches. */}
          <View style={styles.groupHeader}>
            <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
              INCLUDE
            </Typography>
            <View style={styles.bulkActions}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={{ disabled: allOn }}
                disabled={allOn}
                onPress={() => persist(budgetExportSelectionOf(true))}
                style={styles.bulkButton}
                testID="budget-export-enable-all"
              >
                <Typography
                  variant="footnote"
                  weight="medium"
                  color={allOn ? colors.textTertiary : colors.primary}
                >
                  Enable all
                </Typography>
              </TouchableOpacity>
              <Typography variant="footnote" color={colors.textTertiary}>
                ·
              </Typography>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={{ disabled: noneOn }}
                disabled={noneOn}
                onPress={() => persist(budgetExportSelectionOf(false))}
                style={styles.bulkButton}
                testID="budget-export-disable-all"
              >
                <Typography
                  variant="footnote"
                  weight="medium"
                  color={noneOn ? colors.textTertiary : colors.primary}
                >
                  Disable all
                </Typography>
              </TouchableOpacity>
            </View>
          </View>

          <Card style={styles.group}>
            {BUDGET_EXPORT_SECTIONS.map((section, index) => {
              const on = isBudgetExportSectionOn(selection, section.key);
              const count = rowCounts?.[section.key];
              const isLast = index === BUDGET_EXPORT_SECTIONS.length - 1;
              return (
                <View
                  key={section.key}
                  style={[
                    styles.row,
                    !isLast && styles.rowDivider,
                    !isLast && { borderBottomColor: colors.borderColor },
                  ]}
                >
                  {/* The glyph carries the section's identity — fourteen rows
                      of label + description otherwise scan as one block of
                      text. It dims with the toggle so a disabled section reads
                      as excluded at a glance, not just by switch position. */}
                  <IconBackgroundChip
                    name={section.icon}
                    size={IconSize.md}
                    active={on && hasBrandIcon(section.icon)}
                    color={on ? colors.primary : colors.textTertiary}
                    backgroundColor={hexToRgba(colors.primary, on ? 0.12 : 0.05)}
                    style={styles.rowIcon}
                    testID={`budget-export-icon-${section.key}`}
                  />
                  <View style={styles.rowLabel}>
                    <Typography variant="body">
                      {section.label}
                      {count ? ` · ${count} row${count === 1 ? '' : 's'}` : ''}
                    </Typography>
                    <Typography variant="caption2" color={colors.textSecondary}>
                      {section.description}
                    </Typography>
                  </View>
                  <Toggle
                    value={on}
                    onValueChange={() => toggleSection(section.key)}
                    accessibilityLabel={`Include ${section.label}`}
                    testID={`budget-export-toggle-${section.key}`}
                  />
                </View>
              );
            })}
          </Card>

          <Typography
            variant="caption2"
            color={noneOn ? colors.warning : colors.textTertiary}
            style={styles.summary}
            testID="budget-export-summary"
          >
            {noneOn ? 'Nothing selected — switch at least one section on to export.' : summaryLine}
          </Typography>

          {/* Excel is the headline action — a real multi-tab workbook is what
              people mean by "export my budget". CSV stays available beneath it
              for anything that has to parse the data. */}
          <GradientButton
            title={isExporting ? 'Preparing…' : 'Export a spreadsheet (Excel)'}
            variant="secondary"
            fullWidth
            disabled={noneOn || isExporting}
            onPress={() => runExport('xlsx')}
            style={styles.exportButton}
            testID="budget-settings-export-xlsx"
          />

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ disabled: noneOn || isExporting }}
            disabled={noneOn || isExporting}
            onPress={() => runExport('csv')}
            style={styles.exportCsvLink}
            testID="budget-settings-export-csv"
          >
            <Typography
              variant="footnote"
              color={noneOn || isExporting ? colors.textTertiary : colors.textSecondary}
            >
              Export raw data (CSV)
            </Typography>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.base, paddingBottom: Layout.bottomTabBarClearance + 48 },
  intro: { marginBottom: Spacing.lg },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  groupLabel: { letterSpacing: 0.6, opacity: 0.6 },
  bulkActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  bulkButton: { paddingVertical: Spacing.xxs, paddingHorizontal: Spacing.xxs },
  group: { padding: 0, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.smd,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.base,
    minHeight: 56,
  },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth },
  // Same chip geometry as the Settings nav rows this screen is reached from.
  rowIcon: {
    width: Spacing.xxl,
    height: Spacing.xxl,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { flex: 1, gap: 2 },
  summary: { marginTop: Spacing.md, textAlign: 'center' },
  exportButton: { marginTop: Spacing.md },
  exportCsvLink: { paddingVertical: Spacing.sm, alignItems: 'center' },
});
