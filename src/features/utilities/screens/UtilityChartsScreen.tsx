import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { ScrollView, StyleSheet, View, RefreshControl, TouchableOpacity, Dimensions } from 'react-native';
import { LineChart, PieChart } from 'react-native-gifted-charts';

import { AppBackground, ScreenHeader } from '@components/common';
import { Typography, Card, FilterTabs, type FilterTab } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { AppBarChart } from '@components/ui/AppBarChart';
import { Icon } from '@components/ui/Icon';
import { utilitiesApi, type BillAnalytics, type ProviderKey, type UtilityBill } from '@features/utilities/api/utilities';
import { CHART_FILTER_TYPES, PROVIDER_META, getBillTypeIonicon, type IoniconName } from '@features/utilities/providers/bill-providers';
import type { UtilitiesStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, Layout, Spacing, useAppColors, type AppColors } from '@theme';
import { formatMoney, useDisplayCurrency } from '@utils/money';

type UtilityChartsScreenNavigationProp = NativeStackNavigationProp<UtilitiesStackParamList>;

// ---- Utility type metadata --------------------------------------------------

type BillType = UtilityBill['bill_type'];

type TypeMeta = { label: string; icon: IoniconName; color: string; unit: string };

// Theme-aware utility metadata. Colors resolve from design tokens so chart
// series read consistently in light/dark. Icons use the shared Ionicon mapping
// so glyphs stay consistent with the rest of the utilities feature.
function getTypeMeta(colors: AppColors): Record<string, TypeMeta> {
  return {
    electricity: { label: 'Electricity', icon: getBillTypeIonicon('electricity'), color: colors.warning, unit: 'kWh' },
    gas: { label: 'Gas', icon: getBillTypeIonicon('gas'), color: colors.error, unit: 'GJ' },
    water: { label: 'Water', icon: getBillTypeIonicon('water'), color: colors.primary, unit: 'm³' },
    sewer: { label: 'Sewer', icon: getBillTypeIonicon('sewer'), color: colors.info, unit: 'm³' },
    garbage: { label: 'Garbage', icon: getBillTypeIonicon('garbage'), color: colors.chartNeutral, unit: 'kg' },
    other: { label: 'Other', icon: getBillTypeIonicon('other'), color: colors.textTertiary, unit: '' },
  };
}

function metaForIn(typeMeta: Record<string, TypeMeta>, type: string): TypeMeta {
  return typeMeta[type] ?? typeMeta.other;
}

// ---- Formatting helpers -----------------------------------------------------

function formatCurrency(cents: number): string {
  return formatMoney(cents, { decimals: 2 });
}

function formatCurrencyShort(cents: number): string {
  return formatMoney(cents, { abbreviate: true });
}

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// "YYYY-MM" -> "Jan" (or "Jan '26" when January, to mark year boundaries)
function monthLabel(ym: string): string {
  const [year, month] = ym.split('-');
  const idx = parseInt(month, 10) - 1;
  const abbr = MONTH_ABBR[idx] ?? month;
  return idx === 0 ? `${abbr} '${year.slice(2)}` : abbr;
}

const screenWidth = Dimensions.get('window').width;

// ---- Time-period filtering --------------------------------------------------

type PeriodMode = 'thisYear' | 'lastYear' | 'all' | 'custom';

// How many years of history to pull up-front so period switching + the custom
// range picker have data to work with without re-hitting the API.
const PERIOD_HISTORY_YEARS = 9;

const PERIOD_TABS: FilterTab[] = [
  { id: 'thisYear', label: 'This Year' },
  { id: 'lastYear', label: 'Last Year' },
  { id: 'all', label: 'All' },
  { id: 'custom', label: 'Custom' },
];

export function UtilityChartsScreen() {  const colors = useAppColors();
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const navigation = useNavigation<UtilityChartsScreenNavigationProp>();
  const typeMeta = useMemo(() => getTypeMeta(colors), [colors]);
  const metaFor = useCallback((type: string) => metaForIn(typeMeta, type), [typeMeta]);
  const { currentHousehold } = useHouseholdStore();
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const [analytics, setAnalytics] = useState<BillAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [selectedProviders, setSelectedProviders] = useState<Set<ProviderKey>>(
    new Set(['overview'])
  );
  const [usageType, setUsageType] = useState<BillType | null>(null);
  // Time-period filter. Defaults to the current calendar year so the screen
  // opens on "this year" data. `custom` exposes a From/To year range.
  const [periodMode, setPeriodMode] = useState<PeriodMode>('thisYear');
  const [customRange, setCustomRange] = useState<{ from: number; to: number }>({
    from: currentYear,
    to: currentYear,
  });

  // Fetch a wide window once and filter by period client-side. This keeps
  // period switching instant (no refetch flicker) and lets us derive the set
  // of years that actually have data for the custom range pickers.
  const loadAnalytics = useCallback(async () => {
    if (!currentHousehold?.id) return;
    try {
      const data = await utilitiesApi.getAnalytics(currentHousehold.id, {
        startYear: currentYear - PERIOD_HISTORY_YEARS,
        endYear: currentYear,
      });
      setAnalytics(data);
    } catch (error) {
      console.error('Error loading analytics:', error);
    }
  }, [currentHousehold?.id, currentYear]);

  useEffect(() => {
    setIsLoading(true);
    loadAnalytics().finally(() => setIsLoading(false));
  }, [loadAnalytics]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadAnalytics();
    setIsRefreshing(false);
  };

  const toggleType = (typeId: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(typeId)) next.delete(typeId);
      else next.add(typeId);
      return next;
    });
  };

  const toggleProvider = (key: ProviderKey) => {
    setSelectedProviders((prev) => {
      const next = new Set(prev);
      if (key === 'overview') return new Set(['overview']);
      next.delete('overview');
      if (next.has(key)) next.delete(key);
      else next.add(key);
      if (next.size === 0) return new Set(['overview']);
      return next;
    });
  };

  // Years that actually have prorated activity, newest first — drives the
  // custom range pickers and the "All" bounds.
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const row of analytics?.monthlyData ?? []) {
      years.add(parseInt(row.month.slice(0, 4), 10));
    }
    if (years.size === 0) years.add(currentYear);
    return Array.from(years).sort((a, b) => b - a);
  }, [analytics, currentYear]);
  const minYear = availableYears[availableYears.length - 1];
  const maxYear = availableYears[0];
  const hasHistory = minYear < currentYear;

  // Clamp a stale custom range back inside the real data bounds once analytics
  // load (e.g. the default {currentYear, currentYear} when only older data exists).
  useEffect(() => {
    setCustomRange((r) => {
      const from = Math.min(Math.max(r.from, minYear), maxYear);
      const to = Math.min(Math.max(r.to, minYear), maxYear);
      return from === r.from && to === r.to ? r : { from, to };
    });
  }, [minYear, maxYear]);

  const { periodStartYear, periodEndYear } = useMemo(() => {
    switch (periodMode) {
      case 'lastYear':
        return { periodStartYear: currentYear - 1, periodEndYear: currentYear - 1 };
      case 'all':
        return { periodStartYear: minYear, periodEndYear: maxYear };
      case 'custom':
        return {
          periodStartYear: Math.min(customRange.from, customRange.to),
          periodEndYear: Math.max(customRange.from, customRange.to),
        };
      case 'thisYear':
      default:
        return { periodStartYear: currentYear, periodEndYear: currentYear };
    }
  }, [periodMode, currentYear, minYear, maxYear, customRange]);

  const inPeriod = useCallback(
    (monthKey: string) => {
      const y = parseInt(monthKey.slice(0, 4), 10);
      return y >= periodStartYear && y <= periodEndYear;
    },
    [periodStartYear, periodEndYear]
  );

  // Only offer Last Year / All / Custom once there's more than one year on
  // record — otherwise the period control just clutters a single-year dataset.
  const periodTabs = useMemo(
    () => (hasHistory ? PERIOD_TABS : PERIOD_TABS.filter((t) => t.id === 'thisYear')),
    [hasHistory]
  );

  // Human label for the active period, used as the "Total spent" tile subtitle.
  const periodLabel = useMemo(() => {
    if (periodStartYear === periodEndYear) {
      return periodStartYear === currentYear ? 'This year' : String(periodStartYear);
    }
    return `${periodStartYear}–${periodEndYear}`;
  }, [periodStartYear, periodEndYear, currentYear]);

  // The AI narrative below is computed all-time on the backend and its trend
  // copy names specific recent months — only surface it when the current view
  // actually includes the latest data, so a past-year view never shows it.
  const periodIncludesLatest = periodEndYear >= maxYear;

  const filteredMonthly = useMemo(() => {
    if (!analytics) return [];
    const showAllTypes = selectedTypes.size === 0;
    const showAllProviders = selectedProviders.has('overview');

    return analytics.monthlyData.filter((row) => inPeriod(row.month)).map((row) => {
      let total = 0;
      for (const [type, amount] of Object.entries(row.byType)) {
        if (!showAllTypes && !selectedTypes.has(type)) continue;
        total += amount;
      }
      if (!showAllProviders) {
        total = 0;
        for (const [pk, amount] of Object.entries(row.byProvider)) {
          if (selectedProviders.has(pk as ProviderKey)) total += amount;
        }
      }
      return { ...row, total };
    });
  }, [analytics, selectedTypes, selectedProviders, inPeriod]);

  const {
    monthlyCost,
    typeTotals,
    availableTypes,
    insights,
  } = useMemo(() => {
    const months = filteredMonthly.map((m) => m.month);
    const monthlyCostData = filteredMonthly.map((m) => m.total);

    const typeMap = new Map<string, number>();
    for (const row of filteredMonthly) {
      for (const [type, amount] of Object.entries(row.byType)) {
        if (selectedTypes.size > 0 && !selectedTypes.has(type)) continue;
        typeMap.set(type, (typeMap.get(type) ?? 0) + amount);
      }
    }

    const totalSpent = monthlyCostData.reduce((s, v) => s + v, 0);
    const activeMonths = monthlyCostData.filter((v) => v > 0).length;
    const monthCount = activeMonths || 1;
    const avgMonthly = totalSpent / monthCount;

    let highestMonth: { ym: string; amount: number } | null = null;
    for (let i = 0; i < months.length; i++) {
      const amount = monthlyCostData[i];
      if (highestMonth === null || amount > highestMonth.amount) {
        highestMonth = { ym: months[i], amount };
      }
    }

    let topType: { type: string; amount: number } | null = null;
    for (const [type, amount] of typeMap.entries()) {
      if (!topType || amount > topType.amount) topType = { type, amount };
    }

    let trendPercent: number | null = null;
    if (monthlyCostData.length >= 2) {
      const last = monthlyCostData[monthlyCostData.length - 1];
      const prev = monthlyCostData[monthlyCostData.length - 2];
      if (prev > 0) trendPercent = ((last - prev) / prev) * 100;
    }

    return {
      monthlyCost: { months, data: monthlyCostData },
      typeTotals: Array.from(typeMap.entries()).map(([type, amount]) => ({ type, amount })),
      availableTypes: Array.from(typeMap.keys()) as BillType[],
      insights: {
        totalSpent,
        avgMonthly,
        highestMonth,
        topType,
        trendPercent,
        activeMonths,
      },
    };
  }, [filteredMonthly, selectedTypes]);

  // Default the usage selector to the first available type — and re-point it
  // when the current period/type filter no longer includes the selected utility
  // (otherwise the usage chart silently blanks out).
  useEffect(() => {
    if (availableTypes.length === 0) return;
    if (!usageType || !availableTypes.includes(usageType)) {
      setUsageType(availableTypes[0]);
    }
  }, [availableTypes, usageType]);

  const usageSeries = useMemo(() => {
    if (!usageType || !analytics) return [];
    return analytics.monthlyData
      .filter((m) => inPeriod(m.month))
      .filter((m) => (m.byType[usageType] ?? 0) > 0)
      .slice(-12)
      .map((m) => ({
        value: m.usage,
        label: monthLabel(m.month),
      }));
  }, [analytics, usageType, inPeriod]);

  const chartWidth = screenWidth - 96;

  // ---- Render ---------------------------------------------------------------

  if (isLoading) {
    return (
      <AppBackground opacity={0.5}>
        <ScreenHeader showBackButton onBackPress={() => navigation.goBack()} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </AppBackground>
    );
  }

  const hasData = (analytics?.totalBills ?? 0) > 0;

  if (!hasData) {
    return (
      <AppBackground opacity={0.5}>
        <ScreenHeader showBackButton onBackPress={() => navigation.goBack()} />
        <View style={styles.emptyContainer}>
          <Icon name="stats-chart-outline" size={56} color={colors.textSecondary} />
          <Typography variant="headline" weight="semibold" style={styles.emptyTitle}>
            No data yet
          </Typography>
          <Typography variant="body" color={colors.textSecondary} align="center">
            Add a few utility bills to see your spending and usage trends.
          </Typography>
        </View>
      </AppBackground>
    );
  }

  const barData = monthlyCost.months.map((ym, i) => ({
    value: monthlyCost.data[i] / 100, // dollars
    label: monthLabel(ym),
  }));

  const pieData = typeTotals
    .sort((a, b) => b.amount - a.amount)
    .map(({ type, amount }) => ({
      value: amount,
      color: metaFor(type).color,
      text: '',
      type,
    }));
  const pieTotal = pieData.reduce((s, d) => s + d.value, 0) || 1;

  const usageMeta = usageType ? metaFor(usageType) : null;
  const maxUsage = Math.max(...usageSeries.map((d) => d.value), 1);

  return (
    <AppBackground opacity={0.5}>
      <ScreenHeader showBackButton onBackPress={() => navigation.goBack()} />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
        testID="utilities-charts-screen"
      >
        {/* Compact filter bar: time period + utility type + provider */}
        <Card variant="filled" style={styles.filterCard}>
          <FilterTabs
            tabs={periodTabs}
            activeTab={periodMode}
            onTabChange={(id) => setPeriodMode(id as PeriodMode)}
            showActiveIndicator={false}
          />

          {periodMode === 'custom' && (
            <View style={styles.customRangeRow}>
              <YearStepper
                label="From"
                value={customRange.from}
                min={minYear}
                max={customRange.to}
                onChange={(v) => setCustomRange((r) => ({ ...r, from: v }))}
              />
              <View style={[styles.rangeDash, { backgroundColor: colors.borderColor }]} />
              <YearStepper
                label="To"
                value={customRange.to}
                min={customRange.from}
                max={maxYear}
                onChange={(v) => setCustomRange((r) => ({ ...r, to: v }))}
              />
            </View>
          )}

          <View style={[styles.filterDivider, { backgroundColor: colors.borderColor }]} />

          {/* Utility type — icon chips, horizontally scrollable */}
          <View style={styles.filterRow}>
            <Typography
              variant="caption2"
              weight="semibold"
              color={colors.textSecondary}
              style={styles.filterRowLabel}
            >
              Utility
            </Typography>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              <FilterChip
                label="All"
                active={selectedTypes.size === 0}
                onPress={() => setSelectedTypes(new Set())}
              />
              {CHART_FILTER_TYPES.map((t) => (
                <FilterChip
                  key={t.id}
                  label={t.label}
                  icon={t.ionicon}
                  active={selectedTypes.has(t.id)}
                  onPress={() => toggleType(t.id)}
                />
              ))}
            </ScrollView>
          </View>

          {/* Provider — text chips, horizontally scrollable */}
          <View style={styles.filterRow}>
            <Typography
              variant="caption2"
              weight="semibold"
              color={colors.textSecondary}
              style={styles.filterRowLabel}
            >
              Provider
            </Typography>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {(['overview', 'bc_hydro', 'fortisbc', 'city_of_surrey'] as ProviderKey[]).map((key) => (
                <FilterChip
                  key={key}
                  label={key === 'overview' ? 'All' : PROVIDER_META[key].label}
                  active={selectedProviders.has(key)}
                  onPress={() => toggleProvider(key)}
                />
              ))}
            </ScrollView>
          </View>
        </Card>

        {/* ---- Essential figures: sit directly below the filters ---- */}
        <View style={styles.insightGrid}>
          <InsightTile
            label="Total spent"
            value={formatCurrency(insights.totalSpent)}
            sub={periodLabel}
          />
          <InsightTile
            label="Avg / month"
            value={formatCurrency(insights.avgMonthly)}
            sub={`over ${insights.activeMonths} month${insights.activeMonths !== 1 ? 's' : ''}`}
          />
          <InsightTile
            label="Highest month"
            value={insights.highestMonth ? formatCurrency(insights.highestMonth.amount) : '—'}
            sub={insights.highestMonth ? monthLabel(insights.highestMonth.ym) : ''}
          />
          <InsightTile
            label="Top cost"
            value={insights.topType ? metaFor(insights.topType.type).label : '—'}
            sub={insights.topType ? formatCurrency(insights.topType.amount) : ''}
            accent={insights.topType ? metaFor(insights.topType.type).color : undefined}
          />
        </View>

        {insights.trendPercent != null && (
          <Card variant="filled" style={styles.trendCard}>
            <Typography variant="body" color={colors.textSecondary}>
              Latest month vs. previous
            </Typography>
            <View style={styles.trendValue}>
              <Icon
                name={insights.trendPercent > 0 ? 'trending-up' : 'trending-down'}
                size={22}
                color={insights.trendPercent > 0 ? colors.error : colors.success}
              />
              <Typography
                variant="title2"
                weight="bold"
                color={insights.trendPercent > 0 ? colors.error : colors.success}
              >
                {insights.trendPercent > 0 ? '+' : ''}
                {Math.abs(insights.trendPercent).toFixed(1)}%
              </Typography>
            </View>
          </Card>
        )}

        {/* AI / rule-based narrative — stacked full-width copy, not a squeezed row */}
        {periodIncludesLatest && analytics?.insights && analytics.insights.length > 0 && (
          <Card variant="filled" style={styles.bannerCard}>
            <Typography variant="body" weight="semibold">
              {analytics.insights[0].title}
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              {analytics.insights[0].body}
            </Typography>
          </Card>
        )}

        {/* ---- Monthly cost bar chart ---- */}
        <Card variant="filled" style={styles.chartCard}>
          <Typography variant="title3" weight="semibold" style={styles.chartTitle}>
            Monthly spending
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary} style={styles.chartSubtitle}>
            Prorated monthly totals (multi-month bills split by day)
          </Typography>
          <AppBarChart data={barData} width={chartWidth} />
        </Card>

        {/* ---- Cost by utility type (donut) ---- */}
        {pieData.length > 0 && (
          <Card variant="filled" style={styles.chartCard}>
            <Typography variant="title3" weight="semibold" style={styles.chartTitle}>
              Cost by utility
            </Typography>
            <View style={styles.pieRow}>
              <PieChart
                data={pieData}
                donut
                radius={80}
                innerRadius={50}
                innerCircleColor={colors.backgroundSecondary}
                centerLabelComponent={() => (
                  <View style={styles.pieCenter}>
                    <Typography variant="caption2" color={colors.textSecondary}>
                      Total
                    </Typography>
                    <Typography variant="body" weight="bold">
                      {formatCurrencyShort(pieTotal)}
                    </Typography>
                  </View>
                )}
              />
              <View style={styles.legend}>
                {pieData.map((d) => {
                  const pct = ((d.value / pieTotal) * 100).toFixed(0);
                  const m = metaFor(d.type);
                  return (
                    <View key={d.type} style={styles.legendRow}>
                      <View style={[styles.legendDot, { backgroundColor: d.color }]} />
                      <Icon name={m.icon} size={14} color={colors.textPrimary} />
                      <Typography variant="caption1" style={styles.legendLabel}>
                        {m.label}
                      </Typography>
                      <Typography variant="caption1" weight="semibold" color={colors.textSecondary}>
                        {pct}%
                      </Typography>
                    </View>
                  );
                })}
              </View>
            </View>
          </Card>
        )}

        {/* ---- Usage trend (per utility) ---- */}
        <Card variant="filled" style={styles.chartCard}>
          <Typography variant="title3" weight="semibold" style={styles.chartTitle}>
            Usage trend
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary} style={styles.chartSubtitle}>
            Consumption per billing period{usageMeta?.unit ? ` (${usageMeta.unit})` : ''}
          </Typography>

          {/* Type selector */}
          <View style={styles.typeSelector}>
            {availableTypes.map((type) => {
              const m = metaFor(type);
              const active = usageType === type;
              return (
                <TouchableOpacity
                  key={type}
                  onPress={() => setUsageType(type)}
                  style={[
                    styles.typeChip,
                    {
                      backgroundColor: active ? m.color : colors.groupedListBackground,
                    },
                  ]}
                >
                  <View style={styles.typeChipContent}>
                    <Icon
                      name={m.icon}
                      size={14}
                      color={active ? colors.white : colors.textPrimary}
                    />
                    <Typography
                      variant="caption1"
                      weight="semibold"
                      color={active ? colors.white : colors.textPrimary}
                    >
                      {m.label}
                    </Typography>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {usageSeries.length >= 2 ? (
            <LineChart
              data={usageSeries}
              width={chartWidth}
              height={180}
              color={usageMeta?.color}
              thickness={3}
              curved
              dataPointsColor={usageMeta?.color}
              startFillColor={usageMeta?.color}
              endFillColor={usageMeta?.color}
              startOpacity={0.25}
              endOpacity={0.02}
              areaChart
              noOfSections={4}
              maxValue={Math.ceil(maxUsage * 1.15)}
              yAxisThickness={0}
              xAxisThickness={0}
              // Chart-library axis label sizing (numeric config, not <Text>).
               
              yAxisTextStyle={{ color: colors.textSecondary, fontSize: 10 }}
               
              xAxisLabelTextStyle={{ color: colors.textSecondary, fontSize: 9 }}
              rulesColor={colors.borderColor}
              rulesType="dashed"
              initialSpacing={12}
              isAnimated
            />
          ) : (
            <Typography variant="body" color={colors.textSecondary} style={styles.emptyChart}>
              Not enough usage data recorded for this utility yet.
            </Typography>
          )}
        </Card>
      </ScrollView>
    </AppBackground>
  );
}

// ---- Compact filter primitives ----------------------------------------------

interface FilterChipProps {
  label: string;
  icon?: IoniconName;
  active: boolean;
  onPress: () => void;
}

// A small, tokenized pill used for both the utility-type and provider filters.
function FilterChip({ label, icon, active, onPress }: FilterChipProps) {
  const colors = useAppColors();
  const fg = active ? colors.white : colors.textPrimary;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.chipSm,
        { backgroundColor: active ? colors.primary : colors.groupedListBackground },
      ]}
    >
      {icon && <Icon name={icon} size={13} color={fg} />}
      <Typography variant="caption1" weight="semibold" color={fg}>
        {label}
      </Typography>
    </TouchableOpacity>
  );
}

interface YearStepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (year: number) => void;
}

// Compact "− year +" control for choosing a custom period bound. Year-granular
// because that's what the analytics API filters on.
function YearStepper({ label, value, min, max, onChange }: YearStepperProps) {
  const colors = useAppColors();
  const canDec = value > min;
  const canInc = value < max;
  return (
    <View style={styles.stepper}>
      <Typography variant="caption2" weight="semibold" color={colors.textSecondary}>
        {label}
      </Typography>
      <View style={styles.stepperControls}>
        <TouchableOpacity
          disabled={!canDec}
          onPress={() => onChange(value - 1)}
          style={[styles.stepperBtn, { backgroundColor: colors.groupedListBackground }, !canDec && styles.stepperBtnDisabled]}
        >
          <Icon name="chevron-back" size={16} color={canDec ? colors.textPrimary : colors.textTertiary} />
        </TouchableOpacity>
        <Typography variant="callout" weight="bold" color={colors.textPrimary} style={styles.stepperValue}>
          {value}
        </Typography>
        <TouchableOpacity
          disabled={!canInc}
          onPress={() => onChange(value + 1)}
          style={[styles.stepperBtn, { backgroundColor: colors.groupedListBackground }, !canInc && styles.stepperBtnDisabled]}
        >
          <Icon name="chevron-forward" size={16} color={canInc ? colors.textPrimary : colors.textTertiary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ---- Insight tile -----------------------------------------------------------

interface InsightTileProps {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}

function InsightTile({ label, value, sub, accent }: InsightTileProps) {
  const colors = useAppColors();
  return (
    <Card variant="filled" style={styles.insightTile}>
      <Typography variant="caption1" color={colors.textSecondary}>
        {label}
      </Typography>
      <Typography variant="title3" weight="bold" color={accent ?? colors.textPrimary} numberOfLines={1}>
        {value}
      </Typography>
      {!!sub && (
        <Typography variant="caption2" color={colors.textSecondary} numberOfLines={1}>
          {sub}
        </Typography>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    padding: Spacing.base,
    paddingBottom: Layout.bottomTabBarClearance,
    backgroundColor: 'transparent',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xxl,
    gap: Spacing.sm,
  },
  emptyTitle: {
    marginTop: Spacing.sm,
  },
  insightGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  insightTile: {
    width: '47%',
    flexGrow: 1,
    padding: Spacing.md,
    gap: Spacing.xxs,
  },
  trendValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  trendCard: {
    padding: Spacing.base,
    marginBottom: Spacing.base,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chartCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.base,
  },
  chartTitle: {
    marginBottom: Spacing.xs,
  },
  chartSubtitle: {
    marginBottom: Spacing.base,
  },
  emptyChart: {
    paddingVertical: Spacing.xl,
    textAlign: 'center',
  },
  pieRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.base,
  },
  pieCenter: {
    alignItems: 'center',
  },
  legend: {
    flex: 1,
    gap: Spacing.sm,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  legendDot: {
    width: Spacing.smd,
    height: Spacing.smd,
    borderRadius: Spacing.xs + Spacing.xxs / 2,
  },
  legendLabel: {
    flex: 1,
  },
  typeSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.base,
  },
  // Single-line, horizontally-scrollable chip rows so the filters never wrap.
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingRight: Spacing.base,
  },
  bannerCard: {
    padding: Spacing.base,
    marginBottom: Spacing.base,
    gap: Spacing.xxs,
  },
  typeChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + Spacing.xxs,
    borderRadius: CornerRadius.lg,
  },
  typeChipContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  filterCard: {
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  // Compact chip used by the utility-type + provider filter rows.
  chipSm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.smd,
    paddingVertical: Spacing.xs,
    borderRadius: CornerRadius.md,
  },
  // A single filter row: fixed leading label + horizontally-scrollable chips.
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  filterRowLabel: {
    width: 52,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  filterDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Spacing.xxs,
  },
  customRangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  rangeDash: {
    width: Spacing.md,
    height: StyleSheet.hairlineWidth,
  },
  stepper: {
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  stepperControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  stepperBtn: {
    width: 32,
    height: 32,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnDisabled: {
    opacity: 0.4,
  },
  stepperValue: {
    minWidth: 44,
    textAlign: 'center',
  },
});
