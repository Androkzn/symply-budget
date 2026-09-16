import React, { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { HEALTH_ACTIVITY_LEVELS } from '@api/health';
import { AppLineChart, BottomSheet, Icon, Typography, type InfoSource } from '@components/ui';
import { AppBarChart, type AppBarGroup } from '@components/ui/AppBarChart';
import type { AppLinePoint } from '@components/ui/AppLineChart';
import { ACTIVITY_LABELS, ACTIVITY_MULTIPLIERS } from '@features/health/healthWeightAnalytics';
import { Spacing, useAppColors } from '@theme';

interface HealthScienceInfoSheetProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Illustrates the SHAPE of each relationship, not this member's own data —
 * this sheet explains the mechanism in general, so a fixed example BMR keeps
 * every reader looking at the same chart regardless of their own numbers.
 */
const SAMPLE_BMR = 1500;

/**
 * Every citation for this sheet, in one place, so the collapsible list below
 * stays in sync with what the text actually claims. Prefer peer-reviewed or
 * institutional sources (PMC/NIH, journals, Harvard Health, ACE, JMIR) over
 * secondary blogs — this is the one place in the app making claims about
 * outside research rather than the app's own behaviour.
 */
const SOURCES: InfoSource[] = [
  {
    label: 'Mifflin & St Jeor equation — Medscape clinical reference',
    url: 'https://reference.medscape.com/calculator/846/mifflin-st-jeor-equation',
  },
  {
    label: 'Body size and human energy requirements — reduced mass-specific REE in tall adults (J Appl Physiol)',
    url: 'https://journals.physiology.org/doi/full/10.1152/japplphysiol.00461.2007',
  },
  {
    label: 'Sex and Gender Differences in Obesity (World J Mens Health)',
    url: 'https://www.wjmh.org/pdf/10.5534/wjmh.250126',
  },
  {
    label: 'Men and women respond differently to rapid weight loss — PREVIEW study (PMC)',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6282840/',
  },
  {
    label: 'Aging-related sarcopenia: metabolic characteristics and therapeutic strategies (PMC)',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11964442/',
  },
  {
    label: 'Use the NEAT factor to burn calories — Harvard Health',
    url: 'https://www.health.harvard.edu/diet-and-weight-loss/use-the-neat-factor-nonexercise-activity-thermogenesis-to-burn-calories',
  },
  {
    label: 'Resistance training as a key strategy for high-quality weight loss in men and women (Frontiers, 2025)',
    url: 'https://www.frontiersin.org/journals/endocrinology/articles/10.3389/fendo.2025.1725500/full',
  },
  {
    label: 'Metabolic adaptation is associated with less weight and fat mass loss (PMC)',
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8196522/',
  },
  {
    label: 'Metabolic adaptation is not a major barrier to weight-loss maintenance (PMC)',
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7458773/',
  },
  {
    label: 'Protein appetite as an integrator in the obesity system — the protein leverage hypothesis (Royal Society)',
    url: 'https://royalsocietypublishing.org/rstb/article/378/1888/20220212/109343/Protein-appetite-as-an-integrator-in-the-obesity',
  },
  {
    label: 'Chrononutrition and energy balance: meal timing and circadian rhythms (PMC)',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12252119/',
  },
  {
    label: 'GLP-1s and muscle loss: the conversation pharmacists should be having (Pharmacy Times)',
    url: 'https://www.pharmacytimes.com/view/glp-1s-and-muscle-loss-the-conversation-pharmacists-are-not-having-but-should-be',
  },
  {
    label: 'Short sleep is associated with reduced leptin, elevated ghrelin (PLOS Medicine)',
    url: 'https://journals.plos.org/plosmedicine/article?id=10.1371%2Fjournal.pmed.0010062',
  },
  {
    label: 'Impact of sleep deprivation on hunger-related hormones — 2025 meta-analysis (MDPI)',
    url: 'https://www.mdpi.com/2673-4168/5/2/48',
  },
  {
    label: 'Increased visceral fat and decreased energy expenditure during the menopausal transition (PubMed)',
    url: 'https://pubmed.ncbi.nlm.nih.gov/18332882/',
  },
  {
    label: 'Management of obesity in the menopause transition and postmenopausal period (ScienceDirect)',
    url: 'https://www.sciencedirect.com/science/article/pii/S1550728926000730',
  },
  {
    label: 'Menstrual cycle and resistance training: what the latest research says (ACE, 2025)',
    url: 'https://www.acefitness.org/continuing-education/certified/april-2025/8846/menstrual-cycle-and-resistance-training-what-the-latest-research-says/',
  },
  {
    label: 'Continuous glucose monitoring for personalized nutrition in real-world app users (JMIR, 2026)',
    url: 'https://humanfactors.jmir.org/2026/1/e80734',
  },
];

function Section({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: React.ReactNode;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Icon name={icon} size={18} color={colors.primary} />
        <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
          {title}
        </Typography>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function TrendItem({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: React.ReactNode;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.trendItem}>
      <View style={[styles.trendIcon, { backgroundColor: colors.backgroundSecondary }]}>
        <Icon name={icon} size={16} color={colors.primary} />
      </View>
      <View style={styles.trendText}>
        <Typography variant="subheadline" weight="semibold" color={colors.textPrimary}>
          {title}
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary}>
          {children}
        </Typography>
      </View>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  const colors = useAppColors();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Typography variant="caption2" color={colors.textSecondary}>
        {label}
      </Typography>
    </View>
  );
}

/**
 * Sources collapsed by default — 18 citations rendered inline would push the
 * sheet's actually-explanatory content (the sections above) below the fold.
 * Mirrors `InfoButton`'s tappable-link rendering, just gated behind a toggle.
 */
function SourcesDisclosure({ sources, testID }: { sources: InfoSource[]; testID: string }) {
  const colors = useAppColors();
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.sourcesBlock}>
      <Pressable
        onPress={() => setExpanded((value) => !value)}
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Hide sources' : 'Show sources'}
        accessibilityState={{ expanded }}
        testID={`${testID}-toggle`}
        style={styles.sourcesToggle}
        hitSlop={8}
      >
        <Icon
          name={expanded ? 'chevron-down' : 'chevron-forward'}
          size={14}
          color={colors.textSecondary}
        />
        <Typography variant="caption2" weight="semibold" color={colors.textSecondary}>
          Sources ({sources.length})
        </Typography>
      </Pressable>

      {expanded && (
        <View style={styles.sourcesList} testID={`${testID}-content`}>
          {sources.map((source) => (
            <Pressable
              key={source.url}
              onPress={() => void Linking.openURL(source.url).catch(() => {})}
              accessibilityRole="link"
              accessibilityLabel={source.label}
              hitSlop={4}
              testID={`${testID}-source-${source.url}`}
            >
              <Typography variant="caption2" color={colors.primary} style={styles.sourceLink}>
                {source.label}
              </Typography>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * "The science behind your numbers" — the deep-dive companion to the four
 * terse per-field `InfoButton`s on `HealthGoalsBiometricsScreen` (which only
 * explain what each field feeds into inside THIS app). This sheet explains
 * the outside research instead: why sex, age, height and activity level move
 * energy needs at all, plus a few of the newer ideas in weight-management
 * science. Entirely optional reading — nothing here gates onboarding.
 *
 * `height="tall"` (not `InfoButton`'s `"content"`) because this body is long
 * enough to need its own `ScrollView` and a real dismiss control, not a
 * hug-to-content sheet.
 */
export function HealthScienceInfoSheet({ visible, onClose }: HealthScienceInfoSheetProps) {
  const colors = useAppColors();
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(240, width - Spacing.xl * 2 - Spacing.base * 2);

  const bodyCompositionGroups: AppBarGroup[] = [
    {
      label: 'Body fat %',
      bars: [
        { value: 28, frontColor: colors.chartWarm },
        { value: 18, frontColor: colors.chartCool },
      ],
    },
    {
      label: 'Lean mass %',
      bars: [
        { value: 72, frontColor: colors.chartWarm },
        { value: 82, frontColor: colors.chartCool },
      ],
    },
  ];

  const muscleByAge: AppLinePoint[] = [
    { value: 100, label: '20' },
    { value: 99, label: '30' },
    { value: 96, label: '40' },
    { value: 90, label: '50' },
    { value: 82, label: '60' },
    { value: 72, label: '70' },
    { value: 62, label: '80' },
  ];

  const bmrWeighting = [
    { value: 10, label: 'Weight\n(per kg)' },
    { value: 6.25, label: 'Height\n(per cm)' },
    { value: -5, label: 'Age\n(per yr)' },
  ];

  const activityTdee = HEALTH_ACTIVITY_LEVELS.map((level) => ({
    label: ACTIVITY_LABELS[level],
    value: Math.round(SAMPLE_BMR * ACTIVITY_MULTIPLIERS[level]),
  }));

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height="tall"
      title="The Science Behind Your Numbers"
      showCloseButton
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        testID="health-science-sheet-content"
      >
        <Typography variant="footnote" color={colors.textSecondary}>
          Gender, age, height and activity level all change how your body burns and stores energy.
          Here's the mechanism behind each one — plus a few of the newer ideas shaping
          weight-management science right now.
        </Typography>

        <Section icon="male-female-outline" title="Sex & body composition">
          <Typography variant="caption1" color={colors.textSecondary}>
            On average, men carry more skeletal muscle and women carry more essential fat — driven
            largely by testosterone and estrogen. Muscle burns more energy at rest than fat, which is
            the main reason two people at the same weight can still have different BMRs.
          </Typography>
          <View style={styles.legendRow}>
            <LegendDot color={colors.chartWarm} label="Female (avg.)" />
            <LegendDot color={colors.chartCool} label="Male (avg.)" />
          </View>
          <AppBarChart
            groups={bodyCompositionGroups}
            width={chartWidth}
            formatValue={(value) => `${value}%`}
          />
          <Typography variant="caption2" color={colors.textSecondary}>
            Population averages, not diagnostic values — individual body composition varies widely.
          </Typography>
        </Section>

        <Section icon="hourglass-outline" title="Age & metabolism">
          <Typography variant="caption1" color={colors.textSecondary}>
            Muscle mass starts declining as early as your 40s and drops faster after 60
            (sarcopenia) — lowering resting energy burn even if weight stays the same. Enough
            protein and continued resistance exercise are the two levers shown to slow it.
          </Typography>
          <AppLineChart
            data={muscleByAge}
            width={chartWidth}
            baselineValue={50}
            formatValue={(value) => `${value}%`}
          />
          <Typography variant="caption2" color={colors.textSecondary}>
            Illustrative trend. Individual rates vary.
          </Typography>
        </Section>

        <Section icon="resize-outline" title="Height & your BMR formula">
          <Typography variant="caption1" color={colors.textSecondary}>
            This app estimates your resting burn with the Mifflin-St Jeor equation — the same one
            behind the Age, Height and Gender fields you just filled in. Every extra centimeter of
            height adds more to the estimate than every extra year of age subtracts:
          </Typography>
          <AppBarChart
            data={bmrWeighting}
            width={chartWidth}
            allowNegative
            formatValue={(value) => `${value > 0 ? '+' : ''}${value} kcal`}
          />
          <Typography variant="caption2" color={colors.textSecondary}>
            Taller people also carry less metabolically active tissue per kilogram than shorter
            people of the same weight — so height moves your total calorie need less than it moves
            BMR alone.
          </Typography>
        </Section>

        <Section icon="walk-outline" title="Activity level & everyday movement">
          <Typography variant="caption1" color={colors.textSecondary}>
            Your activity pick multiplies BMR into a full daily calorie need (TDEE). For a 1,500
            kcal BMR, here's the range that multiplier alone creates:
          </Typography>
          <AppBarChart
            data={activityTdee}
            width={chartWidth}
            formatValue={(value) => `${value} kcal`}
          />
          <Typography variant="caption2" color={colors.textSecondary}>
            Beyond formal exercise, everyday movement — fidgeting, walking, standing — (NEAT) can
            vary by up to ~2,000 kcal a day between two similarly sized people, independent of the
            gym.
          </Typography>
        </Section>

        <Section icon="sparkles-outline" title="What's shaping the science in 2026">
          <TrendItem icon="trending-down-outline" title="Metabolic adaptation">
            Weight loss can lower energy burn by more than the lost weight alone explains — part of
            why plateaus happen even while sticking to a plan.
          </TrendItem>
          <TrendItem icon="restaurant-outline" title="Protein leverage">
            The body seems to defend its protein intake more tightly than carbs or fat — too little
            protein in a diet can drive you to eat more total food just to "catch up" on protein.
          </TrendItem>
          <TrendItem icon="time-outline" title="Meal timing (chrononutrition)">
            Eating earlier in the day may line up better with the body's insulin sensitivity than
            identical calories eaten late at night — though the evidence is still developing.
          </TrendItem>
          <TrendItem icon="medkit-outline" title="GLP-1 medicines & muscle">
            Weight lost on GLP-1 medicines can be 25–45% lean mass; resistance training plus 1.2–1.6
            g of protein per kg is the current standard advice to protect it.
          </TrendItem>
          <TrendItem icon="moon-outline" title="Sleep & hunger hormones">
            Short sleep is linked to higher ghrelin (hunger) and lower leptin (fullness) in many
            studies — though a 2025 review found the effect less consistent than once thought.
          </TrendItem>
          <TrendItem icon="thermometer-outline" title="Menopause & midlife body composition">
            Declining estrogen during the menopause transition shifts fat storage toward the
            abdomen and lowers resting energy burn, independent of age alone.
          </TrendItem>
          <TrendItem icon="pulse-outline" title="Personalized nutrition (CGM)">
            Continuous glucose monitors are moving from diabetes care into general wellness,
            promising individualized meal guidance — though evidence outside diabetes is still
            early.
          </TrendItem>
        </Section>

        <Typography variant="caption2" color={colors.textSecondary} style={styles.disclaimer}>
          Educational context, not medical advice — talk to a clinician about your own plan.
        </Typography>

        <SourcesDisclosure sources={SOURCES} testID="health-science-sheet-sources" />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  section: {
    gap: Spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  sectionBody: {
    gap: Spacing.sm,
  },
  legendRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendSwatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  trendItem: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
  },
  trendIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trendText: {
    flex: 1,
    gap: 2,
  },
  disclaimer: {
    textAlign: 'center',
  },
  sourcesBlock: {
    gap: Spacing.sm,
  },
  sourcesToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sourcesList: {
    gap: 6,
    paddingLeft: Spacing.lg,
  },
  sourceLink: {
    textDecorationLine: 'underline',
  },
});
