import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { HealthWidgetPreferences } from '@api/healthAssets';
import { Card, Toggle, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { HealthSettingsShell } from '../components/HealthSettingsShell';
import {
  DEFAULT_HEALTH_WIDGET_PREFERENCES,
  describeWidgetPreferences,
  loadWidgetPreferences,
  MEDIUM_WIDGET_LAYOUT_LABELS,
  MEDIUM_WIDGET_LAYOUT_OPTIONS,
  MEDIUM_WIDGET_METRIC_LABELS,
  MEDIUM_WIDGET_METRIC_OPTIONS,
  saveWidgetPreferences,
  SMALL_WIDGET_METRIC_LABELS,
  SMALL_WIDGET_METRIC_OPTIONS,
  SMALL_WIDGET_STYLE_LABELS,
  SMALL_WIDGET_STYLE_OPTIONS,
  WIDGET_CHART_METRIC_LABELS,
  WIDGET_CHART_METRIC_OPTIONS,
  WIDGET_CHART_TYPE_LABELS,
  WIDGET_CHART_TYPE_OPTIONS,
} from '../healthWidgetStorage';

/**
 * Widget settings — the donor's `WidgetSettingsView`, minus its live preview.
 *
 * `GET`/`PUT /health/widget/preferences` have been deployed since parity P2
 * with no caller: six preference columns that decided what the Home Screen
 * widget and the Watch face show, which nobody could change. This is the screen
 * that owns them; `healthWidgetStorage` owns the reads, the writes and the
 * republish that makes a change visible on the widget without waiting for the
 * next launch.
 *
 * ## Deliberate differences from the donor
 *
 *  - **No 1,800-line rendered preview.** The donor re-implements every widget
 *    family in SwiftUI to draw a sample; that preview is a second renderer that
 *    can — and in the donor does — disagree with the real widget. A one-line
 *    summary of what the widget will show is honest and cannot drift.
 *  - **Chart options stay visible when "weight" is off.** The donor hides them,
 *    which makes a stored choice unreachable and looks like data loss. They are
 *    shown with the condition stated instead.
 *
 * ## The privacy line, and why it is on the screen
 *
 * A widget renders on a LOCKED screen. The snapshot the Worker builds carries
 * only counts, goals and totals — never a body photo, never cycle or vitality
 * data — and that is enforced server-side (`widgetSnapshot`). Saying so here is
 * what lets a member reason about what they are switching on.
 */
export function HealthWidgetSettingsScreen() {
  const colors = useAppColors();

  const [prefs, setPrefs] = useState<HealthWidgetPreferences>(DEFAULT_HEALTH_WIDGET_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadWidgetPreferences().then((loaded) => {
      if (cancelled) return;
      setPrefs(loaded);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = useCallback(async (change: Partial<HealthWidgetPreferences>) => {
    setPrefs((current) => ({ ...current, ...change }));
    setBusy(true);
    const result = await saveWidgetPreferences(change);
    setPrefs(result.preferences);
    setMessage(result.message);
    setBusy(false);
  }, []);

  return (
    <HealthSettingsShell title="Widget" testID="health-widget-screen" loading={loading}>
      <Card
        variant="filled"
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        testID="health-widget-summary"
      >
        <View style={styles.bannerRow}>
          <View style={[styles.iconTile, { backgroundColor: colors.primary + '1F' }]}>
            <Icon name="today-summary" size={18} color={colors.textPrimary} />
          </View>
          <View style={styles.bannerText}>
            <Typography variant="body" weight="medium" color={colors.textPrimary}>
              Your widget shows
            </Typography>
            <Typography
              variant="footnote"
              color={colors.textSecondary}
              testID="health-widget-summary-line"
            >
              {describeWidgetPreferences(prefs)}
            </Typography>
          </View>
        </View>
      </Card>

      <Card
        variant="filled"
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        testID="health-widget-small"
      >
        <Typography variant="footnote" weight="semibold" color={colors.textSecondary} style={styles.sectionLabel}>
          SMALL WIDGET
        </Typography>
        <Typography variant="footnote" color={colors.textSecondary}>
          The one number the smallest widget and the Watch complication lead with.
        </Typography>
        <ChoiceRow
          options={SMALL_WIDGET_METRIC_OPTIONS.map((key) => ({
            key,
            label: SMALL_WIDGET_METRIC_LABELS[key],
          }))}
          selected={prefs.small_widget_metric}
          disabled={busy}
          onSelect={(key) =>
            void patch({ small_widget_metric: key as HealthWidgetPreferences['small_widget_metric'] })
          }
          testIDPrefix="health-widget-metric"
        />
        <ChoiceRow
          label="Style"
          options={SMALL_WIDGET_STYLE_OPTIONS.map((key) => ({
            key,
            label: SMALL_WIDGET_STYLE_LABELS[key],
          }))}
          selected={prefs.small_widget_style}
          disabled={busy}
          onSelect={(key) =>
            void patch({ small_widget_style: key as HealthWidgetPreferences['small_widget_style'] })
          }
          testIDPrefix="health-widget-small-style"
        />
      </Card>

      <Card
        variant="filled"
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        testID="health-widget-medium"
      >
        <Typography variant="footnote" weight="semibold" color={colors.textSecondary} style={styles.sectionLabel}>
          MEDIUM WIDGET
        </Typography>
        <Typography variant="footnote" color={colors.textSecondary}>
          How the medium size lays out its metrics.
        </Typography>
        <ChoiceRow
          label="Layout"
          options={MEDIUM_WIDGET_LAYOUT_OPTIONS.map((key) => ({
            key,
            label: MEDIUM_WIDGET_LAYOUT_LABELS[key],
          }))}
          selected={prefs.medium_widget_layout}
          disabled={busy}
          onSelect={(key) =>
            void patch({ medium_widget_layout: key as HealthWidgetPreferences['medium_widget_layout'] })
          }
          testIDPrefix="health-widget-medium-layout"
        />
        {prefs.medium_widget_layout === 'dual' && (
          <>
            <ChoiceRow
              label="First metric"
              options={MEDIUM_WIDGET_METRIC_OPTIONS.map((key) => ({
                key,
                label: MEDIUM_WIDGET_METRIC_LABELS[key],
              }))}
              selected={prefs.medium_primary_metric}
              disabled={busy}
              onSelect={(key) =>
                void patch({
                  medium_primary_metric: key as HealthWidgetPreferences['medium_primary_metric'],
                })
              }
              testIDPrefix="health-widget-medium-primary"
            />
            <ChoiceRow
              label="Second metric"
              options={MEDIUM_WIDGET_METRIC_OPTIONS.map((key) => ({
                key,
                label: MEDIUM_WIDGET_METRIC_LABELS[key],
              }))}
              selected={prefs.medium_secondary_metric}
              disabled={busy}
              onSelect={(key) =>
                void patch({
                  medium_secondary_metric: key as HealthWidgetPreferences['medium_secondary_metric'],
                })
              }
              testIDPrefix="health-widget-medium-secondary"
            />
          </>
        )}
        {prefs.medium_widget_layout === 'standard' && (
          <ToggleRow
            title="Show every metric"
            description="List steps, calories, water and exercise alongside the main one"
            value={prefs.medium_show_all_metrics}
            disabled={busy}
            onValueChange={(next) => void patch({ medium_show_all_metrics: next })}
            testID="health-widget-medium-show-all"
          />
        )}
      </Card>

      <Card
        variant="filled"
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        testID="health-widget-sections"
      >
        <Typography variant="footnote" weight="semibold" color={colors.textSecondary} style={styles.sectionLabel}>
          WHAT THE LARGER WIDGET SHOWS
        </Typography>
        <ToggleRow
          title="Weight and trends"
          description="Your latest reading and the weekly chart"
          value={prefs.show_weight}
          disabled={busy}
          onValueChange={(next) => void patch({ show_weight: next })}
          testID="health-widget-show-weight"
        />
        <ToggleRow
          title="Nutrition"
          description="Calories logged today against your target"
          value={prefs.show_nutrition}
          disabled={busy}
          onValueChange={(next) => void patch({ show_nutrition: next })}
          testID="health-widget-show-nutrition"
        />
        <ToggleRow
          title="Workouts"
          description="Sessions, minutes and calories for today"
          value={prefs.show_workouts}
          disabled={busy}
          onValueChange={(next) => void patch({ show_workouts: next })}
          testID="health-widget-show-workouts"
        />
      </Card>

      <Card
        variant="filled"
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        testID="health-widget-chart"
      >
        <Typography variant="footnote" weight="semibold" color={colors.textSecondary} style={styles.sectionLabel}>
          CHART
        </Typography>
        <Typography variant="footnote" color={colors.textSecondary}>
          {prefs.show_weight
            ? 'How the weekly chart is drawn.'
            : 'How the weekly chart is drawn — it appears once "Weight and trends" is on.'}
        </Typography>
        <ChoiceRow
          label="Style"
          options={WIDGET_CHART_TYPE_OPTIONS.map((key) => ({
            key,
            label: WIDGET_CHART_TYPE_LABELS[key],
          }))}
          selected={prefs.chart_type}
          disabled={busy}
          onSelect={(key) => void patch({ chart_type: key as HealthWidgetPreferences['chart_type'] })}
          testIDPrefix="health-widget-chart-type"
        />
        <ChoiceRow
          label="Measure"
          options={WIDGET_CHART_METRIC_OPTIONS.map((key) => ({
            key,
            label: WIDGET_CHART_METRIC_LABELS[key],
          }))}
          selected={prefs.chart_metric}
          disabled={busy}
          onSelect={(key) =>
            void patch({ chart_metric: key as HealthWidgetPreferences['chart_metric'] })
          }
          testIDPrefix="health-widget-chart-metric"
        />
      </Card>

      {message !== null && (
        <Typography variant="footnote" color={colors.textSecondary} testID="health-widget-message">
          {message}
        </Typography>
      )}

      <Card
        variant="filled"
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        testID="health-widget-privacy"
      >
        <View style={styles.bannerRow}>
          <View style={[styles.iconTile, { backgroundColor: colors.primary + '1F' }]}>
            <Icon name="lock-screen-hide" size={18} color={colors.textPrimary} />
          </View>
          <View style={styles.bannerText}>
            <Typography variant="body" weight="medium" color={colors.textPrimary}>
              On a locked screen
            </Typography>
            <Typography variant="footnote" color={colors.textSecondary}>
              A widget can be read without unlocking your phone, so it only ever carries counts and
              totals — steps, water, calories, workout minutes and your latest weight. Photos, cycle
              records and vitality records are never sent to it.
            </Typography>
          </View>
        </View>
      </Card>
    </HealthSettingsShell>
  );
}

/* ------------------------------- pieces -------------------------------- */

function ToggleRow({
  title,
  description,
  value,
  disabled,
  onValueChange,
  testID,
}: {
  title: string;
  description: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (next: boolean) => void;
  testID: string;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Typography variant="body" weight="medium" color={colors.textPrimary}>
          {title}
        </Typography>
        <Typography variant="footnote" color={colors.textSecondary}>
          {description}
        </Typography>
      </View>
      <Toggle
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        testID={testID}
      />
    </View>
  );
}

function ChoiceRow({
  label,
  options,
  selected,
  disabled,
  onSelect,
  testIDPrefix,
}: {
  label?: string;
  options: Array<{ key: string; label: string }>;
  selected: string;
  disabled?: boolean;
  onSelect: (key: string) => void;
  testIDPrefix: string;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.field}>
      {label !== undefined && (
        <Typography variant="caption1" color={colors.textSecondary}>
          {label}
        </Typography>
      )}
      <View style={styles.choiceRow}>
        {options.map((option) => {
          const active = option.key === selected;
          return (
            <Pressable
              key={option.key}
              onPress={() => onSelect(option.key)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled }}
              testID={`${testIDPrefix}-${option.key}`}
              style={[
                styles.choice,
                {
                  borderColor: active ? colors.primary : colors.borderColor,
                  backgroundColor: active ? colors.primary + '1F' : 'transparent',
                },
              ]}
            >
              <Typography
                variant="caption1"
                weight="semibold"
                color={active ? colors.primary : colors.textSecondary}
              >
                {option.label}
              </Typography>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  bannerText: {
    flex: 1,
    gap: 2,
  },
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  toggleText: {
    flex: 1,
  },
  field: {
    gap: Spacing.xs,
  },
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  choice: {
    borderWidth: 1,
    borderRadius: CornerRadius.xxl,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
});
