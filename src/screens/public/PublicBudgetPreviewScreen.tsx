import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  announcePublicBudgetPreviewInteraction,
  announcePublicBudgetPreviewScreen,
  startPublicBudgetPreviewBridge,
  type PublicBudgetPreviewScreen as PreviewSection,
} from '@/platform/web/public-preview-bridge';
import { AppBackground } from '@components/common/AppBackground';
import { HeaderLogo } from '@components/common/HeaderLogo';
import { Icon } from '@components/ui/Icon';
import { Typography } from '@components/ui/Typography';
import { useAppColors, type AppColors } from '@theme';

type BudgetCategory = {
  id: string;
  name: string;
  amount: number;
  limit: number;
  icon: string;
  color: string;
};

type PlannedItem = {
  id: string;
  title: string;
  meta: string;
  amount: number;
  status: 'planned' | 'next';
};

type PreviewMonth = {
  id: string;
  label: string;
  income: number;
  planned: number;
  spent: number;
  savings: number;
  savingsTarget: number;
  categories: BudgetCategory[];
  plannedItems: PlannedItem[];
};

const PREVIEW_MONTHS: PreviewMonth[] = [
  {
    id: 'september-2026',
    label: 'September 2026',
    income: 6200,
    planned: 4100,
    spent: 2748,
    savings: 12400,
    savingsTarget: 18000,
    categories: [
      { id: 'housing', name: 'Housing', amount: 1800, limit: 2100, icon: 'home-outline', color: '#4ECDC4' },
      { id: 'food', name: 'Food & groceries', amount: 620, limit: 800, icon: 'restaurant-outline', color: '#F4A261' },
      { id: 'transport', name: 'Transport', amount: 280, limit: 420, icon: 'car-outline', color: '#5B8DEF' },
      { id: 'home', name: 'Home projects', amount: 300, limit: 450, icon: 'construct-outline', color: '#B07BAC' },
    ],
    plannedItems: [
      { id: 'insurance', title: 'Home insurance', meta: 'Due Sep 18 · recurring', amount: 126, status: 'next' },
      { id: 'school', title: 'School supplies', meta: 'Planned for this month', amount: 95, status: 'planned' },
      { id: 'filter', title: 'HVAC filter replacement', meta: 'Home maintenance', amount: 42, status: 'planned' },
    ],
  },
  {
    id: 'october-2026',
    label: 'October 2026',
    income: 6200,
    planned: 4380,
    spent: 0,
    savings: 12720,
    savingsTarget: 18000,
    categories: [
      { id: 'housing', name: 'Housing', amount: 2100, limit: 2100, icon: 'home-outline', color: '#4ECDC4' },
      { id: 'food', name: 'Food & groceries', amount: 0, limit: 800, icon: 'restaurant-outline', color: '#F4A261' },
      { id: 'transport', name: 'Transport', amount: 0, limit: 420, icon: 'car-outline', color: '#5B8DEF' },
      { id: 'home', name: 'Home projects', amount: 0, limit: 450, icon: 'construct-outline', color: '#B07BAC' },
    ],
    plannedItems: [
      { id: 'mortgage', title: 'Mortgage payment', meta: 'Due Oct 1 · recurring', amount: 2100, status: 'next' },
      { id: 'winter', title: 'Prepare for winter', meta: 'Planned home project', amount: 380, status: 'planned' },
      { id: 'gifts', title: 'Early holiday gifts', meta: 'Long-term plan', amount: 240, status: 'planned' },
    ],
  },
];

const PREVIEW_SECTIONS: Array<{ id: PreviewSection; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'spending', label: 'Spending' },
  { id: 'planning', label: 'Planning' },
  { id: 'savings', label: 'Savings' },
];

function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString('en-CA')}`;
}

/**
 * Deterministic, local-only Budget surface for the public Web preview.
 *
 * It deliberately does not import auth, API clients, stores, SecureStore, or
 * the local-first engine. The interactions only change component state and
 * never write data, so the preview cannot touch an account or backend record.
 */
export function PublicBudgetPreviewScreen() {
  const colors = useAppColors();
  const [section, setSection] = useState<PreviewSection>('overview');
  const [monthIndex, setMonthIndex] = useState(0);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const month = PREVIEW_MONTHS[monthIndex];
  const remaining = month.income - month.spent;
  const selectedCategory = useMemo(
    () => month.categories.find((category) => category.id === selectedCategoryId) ?? null,
    [month.categories, selectedCategoryId],
  );

  useEffect(() => startPublicBudgetPreviewBridge('overview'), []);
  useEffect(() => {
    announcePublicBudgetPreviewScreen(section);
  }, [section]);

  const selectSection = (next: PreviewSection) => {
    setSection(next);
    setSelectedCategoryId(null);
    setExpandedPlanId(null);
  };

  const changeMonth = (nextIndex: number) => {
    setMonthIndex(nextIndex);
    setSelectedCategoryId(null);
    setExpandedPlanId(null);
    announcePublicBudgetPreviewInteraction('month.change', PREVIEW_MONTHS[nextIndex].id);
  };

  const selectCategory = (categoryId: string) => {
    setSelectedCategoryId(categoryId);
    announcePublicBudgetPreviewInteraction('category.select', categoryId);
  };

  return (
    <AppBackground reserveSidebarInset={false}>
      <View style={styles.root} testID="public-budget-preview">
        <View style={styles.header}>
          <View style={styles.brand}>
            <HeaderLogo height={34} />
            <View>
              <Typography variant="headline" weight="bold" color={colors.textPrimary}>
                Budget
              </Typography>
              <Typography variant="caption1" color={colors.textSecondary}>
                Public read-only preview
              </Typography>
            </View>
          </View>
          <View style={[styles.previewBadge, { backgroundColor: `${colors.primary}18` }]}>
            <View style={[styles.liveDot, { backgroundColor: colors.success }]} />
            <Typography variant="caption1" weight="semibold" color={colors.primary}>
              SYNTHETIC DATA
            </Typography>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.intro}>
            <Typography variant="largeTitle" weight="bold" color={colors.textPrimary}>
              Make every dollar feel intentional.
            </Typography>
            <Typography variant="body" color={colors.textSecondary}>
              A calm monthly view for the decisions that keep a household moving.
            </Typography>
          </View>

          <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.borderColor }]}>
            <View style={styles.heroCopy}>
              <Typography variant="caption1" weight="semibold" color={colors.primary}>
                AVAILABLE THIS MONTH
              </Typography>
              <Typography variant="largeTitle" weight="bold" color={colors.textPrimary}>
                {formatCurrency(remaining)}
              </Typography>
              <Typography variant="body" color={colors.textSecondary}>
                after {formatCurrency(month.spent)} spent from {formatCurrency(month.income)} income
              </Typography>
            </View>
            <View style={[styles.heroIcon, { backgroundColor: `${colors.primary}18` }]}>
              <Icon name="wallet-outline" forceIonicons size={26} color={colors.primary} />
            </View>
          </View>

          <View style={styles.monthRow}>
            <Typography variant="title2" weight="bold" color={colors.textPrimary}>
              {month.label}
            </Typography>
            <View style={styles.monthControls}>
              <MonthButton
                icon="chevron-back"
                label="Previous month"
                disabled={monthIndex === 0}
                onPress={() => changeMonth(monthIndex - 1)}
                colors={colors}
                testID="public-budget-month-prev"
              />
              <MonthButton
                icon="chevron-forward"
                label="Next month"
                disabled={monthIndex === PREVIEW_MONTHS.length - 1}
                onPress={() => changeMonth(monthIndex + 1)}
                colors={colors}
                testID="public-budget-month-next"
              />
            </View>
          </View>

          <View style={styles.statsRow}>
            <Stat value={formatCurrency(month.income)} label="Income" colors={colors} />
            <Stat value={formatCurrency(month.planned)} label="Planned" colors={colors} />
            <Stat value={formatCurrency(month.spent)} label="Spent" colors={colors} />
          </View>

          <View style={styles.segmentedControl}>
            {PREVIEW_SECTIONS.map((item) => {
              const selected = section === item.id;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  onPress={() => selectSection(item.id)}
                  style={[
                    styles.segment,
                    selected && { backgroundColor: colors.card, shadowColor: colors.textPrimary },
                  ]}
                  testID={`public-budget-tab-${item.id}`}
                >
                  <Typography
                    variant="subheadline"
                    weight={selected ? 'semibold' : 'regular'}
                    color={selected ? colors.textPrimary : colors.textSecondary}
                  >
                    {item.label}
                  </Typography>
                </Pressable>
              );
            })}
          </View>

          {section === 'overview' ? <OverviewView month={month} colors={colors} onSelectCategory={selectCategory} /> : null}
          {section === 'spending' ? (
            <SpendingView
              month={month}
              colors={colors}
              selectedCategory={selectedCategory}
              onSelectCategory={selectCategory}
            />
          ) : null}
          {section === 'planning' ? (
            <PlanningView
              month={month}
              colors={colors}
              expandedPlanId={expandedPlanId}
              onTogglePlan={(id) => setExpandedPlanId((current) => (current === id ? null : id))}
            />
          ) : null}
          {section === 'savings' ? <SavingsView month={month} colors={colors} /> : null}

          <View style={[styles.disclosure, { backgroundColor: colors.backgroundSecondary }]}>
            <Icon name="information-circle-outline" forceIonicons size={18} color={colors.textSecondary} />
            <Typography variant="caption1" color={colors.textSecondary} style={styles.disclosureText}>
              Demo data is local to this preview. No account, credentials, or production API access is used.
            </Typography>
          </View>
        </ScrollView>
      </View>
    </AppBackground>
  );
}

function OverviewView({
  month,
  colors,
  onSelectCategory,
}: {
  month: PreviewMonth;
  colors: AppColors;
  onSelectCategory: (id: string) => void;
}) {
  return (
    <>
      <SectionHeader title="Spending by category" action="Tap a row" colors={colors} />
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.borderColor }]}>
        {month.categories.map((category) => (
          <CategoryRow key={category.id} category={category} colors={colors} onPress={() => onSelectCategory(category.id)} />
        ))}
      </View>

      <SectionHeader title="Next up" action="3 planned" colors={colors} />
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.borderColor }]}>
        <PlanRow item={month.plannedItems[0]} colors={colors} />
      </View>
    </>
  );
}

function SpendingView({
  month,
  colors,
  selectedCategory,
  onSelectCategory,
}: {
  month: PreviewMonth;
  colors: AppColors;
  selectedCategory: BudgetCategory | null;
  onSelectCategory: (id: string) => void;
}) {
  return (
    <View testID="public-budget-spending-view">
      <SectionHeader title="Where money is going" action={`${month.categories.length} categories`} colors={colors} />
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.borderColor }]}>
        {month.categories.map((category) => (
          <CategoryRow
            key={category.id}
            category={category}
            colors={colors}
            selected={selectedCategory?.id === category.id}
            onPress={() => onSelectCategory(category.id)}
          />
        ))}
      </View>
      {selectedCategory ? (
        <View style={[styles.detailCard, { backgroundColor: colors.backgroundSecondary }]} testID="public-budget-category-detail">
          <Typography variant="caption1" weight="semibold" color={colors.primary}>
            CATEGORY DETAIL
          </Typography>
          <Typography variant="title2" weight="bold" color={colors.textPrimary}>
            {selectedCategory.name}
          </Typography>
          <Typography variant="body" color={colors.textSecondary}>
            {formatCurrency(selectedCategory.amount)} of {formatCurrency(selectedCategory.limit)} planned · {selectedCategory.amount <= selectedCategory.limit ? 'on track' : 'over budget'}
          </Typography>
        </View>
      ) : null}
    </View>
  );
}

function PlanningView({
  month,
  colors,
  expandedPlanId,
  onTogglePlan,
}: {
  month: PreviewMonth;
  colors: AppColors;
  expandedPlanId: string | null;
  onTogglePlan: (id: string) => void;
}) {
  return (
    <View testID="public-budget-planning-view">
      <SectionHeader title="Planned spending" action="Tap to inspect" colors={colors} />
      {month.plannedItems.map((item) => (
        <Pressable
          key={item.id}
          onPress={() => onTogglePlan(item.id)}
          style={[styles.planCard, { backgroundColor: colors.card, borderColor: colors.borderColor }]}
          testID={`public-budget-plan-${item.id}`}
        >
          <View style={[styles.planIcon, { backgroundColor: `${colors.primary}18` }]}>
            <Icon name="calendar-outline" forceIonicons size={19} color={colors.primary} />
          </View>
          <View style={styles.planCopy}>
            <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
              {item.title}
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              {expandedPlanId === item.id ? `${item.meta} · reserved in this plan` : item.meta}
            </Typography>
          </View>
          <Typography variant="headline" weight="bold" color={colors.textPrimary}>
            {formatCurrency(item.amount)}
          </Typography>
        </Pressable>
      ))}
    </View>
  );
}

function SavingsView({ month, colors }: { month: PreviewMonth; colors: AppColors }) {
  const progress = Math.min(1, month.savings / month.savingsTarget);
  return (
    <View testID="public-budget-savings-view">
      <SectionHeader title="Savings progress" action="Long-term view" colors={colors} />
      <View style={[styles.savingsCard, { backgroundColor: colors.card, borderColor: colors.borderColor }]}>
        <View style={styles.savingsHeader}>
          <View style={[styles.savingsIcon, { backgroundColor: `${colors.success}20` }]}>
            <Icon name="trending-up-outline" forceIonicons size={22} color={colors.success} />
          </View>
          <View style={styles.savingsCopy}>
            <Typography variant="headline" weight="bold" color={colors.textPrimary}>
              Emergency fund
            </Typography>
            <Typography variant="body" color={colors.textSecondary}>
              A simple buffer for the unexpected.
            </Typography>
          </View>
        </View>
        <View style={styles.savingsAmounts}>
          <Typography variant="largeTitle" weight="bold" color={colors.textPrimary}>
            {formatCurrency(month.savings)}
          </Typography>
          <Typography variant="body" color={colors.textSecondary}>
            of {formatCurrency(month.savingsTarget)}
          </Typography>
        </View>
        <View style={[styles.progressTrack, { backgroundColor: colors.borderColor }]}>
          <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: colors.success }]} />
        </View>
        <Typography variant="caption1" color={colors.textSecondary}>
          {Math.round(progress * 100)}% funded · consistent progress beats perfect months
        </Typography>
      </View>
    </View>
  );
}

function MonthButton({
  icon,
  label,
  disabled,
  onPress,
  colors,
  testID,
}: {
  icon: string;
  label: string;
  disabled: boolean;
  onPress: () => void;
  colors: AppColors;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.monthButton, { borderColor: colors.borderColor, opacity: disabled ? 0.4 : 1 }]}
      testID={testID}
    >
      <Icon name={icon} forceIonicons size={17} color={colors.textPrimary} />
    </Pressable>
  );
}

function Stat({ value, label, colors }: { value: string; label: string; colors: AppColors }) {
  return (
    <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.borderColor }]}>
      <Typography variant="title2" weight="bold" color={colors.textPrimary}>{value}</Typography>
      <Typography variant="caption1" color={colors.textSecondary}>{label}</Typography>
    </View>
  );
}

function SectionHeader({ title, action, colors }: { title: string; action: string; colors: AppColors }) {
  return (
    <View style={styles.sectionHeader}>
      <Typography variant="title2" weight="bold" color={colors.textPrimary}>{title}</Typography>
      <Typography variant="subheadline" weight="semibold" color={colors.primary}>{action}</Typography>
    </View>
  );
}

function CategoryRow({
  category,
  colors,
  selected = false,
  onPress,
}: {
  category: BudgetCategory;
  colors: AppColors;
  selected?: boolean;
  onPress: () => void;
}) {
  const progress = category.limit === 0 ? 0 : Math.min(1, category.amount / category.limit);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View ${category.name}`}
      onPress={onPress}
      style={[styles.categoryRow, selected && { backgroundColor: colors.surfaceSelected }]}
      testID={`public-budget-category-${category.id}`}
    >
      <View style={[styles.categoryIcon, { backgroundColor: `${category.color}22` }]}>
        <Icon name={category.icon} forceIonicons size={18} color={category.color} />
      </View>
      <View style={styles.categoryCopy}>
        <Typography variant="headline" weight="semibold" color={colors.textPrimary}>{category.name}</Typography>
        <View style={[styles.categoryTrack, { backgroundColor: colors.borderColor }]}>
          <View style={[styles.categoryFill, { width: `${progress * 100}%`, backgroundColor: category.color }]} />
        </View>
      </View>
      <Typography variant="body" weight="semibold" color={colors.textPrimary}>{formatCurrency(category.amount)}</Typography>
    </Pressable>
  );
}

function PlanRow({ item, colors }: { item: PlannedItem; colors: AppColors }) {
  return (
    <View style={styles.planRow}>
      <View style={[styles.planIcon, { backgroundColor: `${colors.primary}18` }]}>
        <Icon name="calendar-outline" forceIonicons size={19} color={colors.primary} />
      </View>
      <View style={styles.planCopy}>
        <Typography variant="headline" weight="semibold" color={colors.textPrimary}>{item.title}</Typography>
        <Typography variant="caption1" color={colors.textSecondary}>{item.meta}</Typography>
      </View>
      <Typography variant="headline" weight="bold" color={colors.textPrimary}>{formatCurrency(item.amount)}</Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { maxWidth: 1040, width: '100%', alignSelf: 'center', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  previewBadge: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8 },
  liveDot: { width: 7, height: 7, borderRadius: 999 },
  content: { width: '100%', maxWidth: 1040, alignSelf: 'center', padding: 24, paddingBottom: 56 },
  intro: { gap: 5, marginTop: 18, marginBottom: 22 },
  heroCard: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroCopy: { gap: 4 },
  heroIcon: { width: 58, height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  monthRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24 },
  monthControls: { flexDirection: 'row', gap: 8 },
  monthButton: { width: 34, height: 34, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  stat: { flex: 1, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 2 },
  segmentedControl: { marginTop: 26, marginBottom: 22, padding: 4, borderRadius: 14, backgroundColor: 'rgba(120, 120, 128, 0.12)', flexDirection: 'row' },
  segment: { flex: 1, alignItems: 'center', borderRadius: 10, paddingVertical: 10, shadowOpacity: 0.08, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 3, marginBottom: 11 },
  card: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 15, paddingVertical: 4 },
  categoryRow: { minHeight: 68, borderRadius: 13, paddingVertical: 10, paddingHorizontal: 3, flexDirection: 'row', alignItems: 'center', gap: 11 },
  categoryIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  categoryCopy: { flex: 1, gap: 7 },
  categoryTrack: { height: 5, borderRadius: 999, overflow: 'hidden' },
  categoryFill: { height: 5, borderRadius: 999 },
  planRow: { minHeight: 68, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 11 },
  planCard: { borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, padding: 14, marginBottom: 9, flexDirection: 'row', alignItems: 'center', gap: 11 },
  planIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  planCopy: { flex: 1, gap: 3 },
  detailCard: { borderRadius: 16, padding: 16, marginTop: 12, gap: 5 },
  savingsCard: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 18, gap: 12 },
  savingsHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  savingsIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  savingsCopy: { flex: 1, gap: 3 },
  savingsAmounts: { flexDirection: 'row', alignItems: 'baseline', gap: 7 },
  progressTrack: { height: 10, borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: 10, borderRadius: 999 },
  disclosure: { marginTop: 26, borderRadius: 13, padding: 13, flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
  disclosureText: { flex: 1, lineHeight: 18 },
});
