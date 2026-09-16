/**
 * AI usage panel — estimated spend + tokens for a period, with a per-day bar
 * strip and a breakdown. Shared by the Usage tab (whole household, split by
 * provider) and the provider-detail screen (one provider, split by feature).
 *
 * Every dollar figure is an ESTIMATE (our token-count × price table), labelled
 * as such — the provider's console has the exact bill. Server computes the
 * dollars; this only renders them.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { AIUsageResponse } from '@api/aiUsage';
import { providerLabel } from '@components/ai/providerMeta';
import { Icon, InfoButton, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useAppColors } from '@theme';

/**
 * Deliberately NOT routed through @utils/money: this is what the AI provider
 * (OpenAI/Anthropic/Gemini) bills, and they bill in US dollars. Re-labelling it
 * with the user's display currency would claim a conversion that never happened.
 */
export function formatUsd(usd: number): string {
  if (!usd) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function formatDay(iso: string): string {
  // `YYYY-MM-DD` → `M/D`
  const [, m, d] = iso.split('-');
  return m && d ? `${Number(m)}/${Number(d)}` : iso;
}

type DayBucket = AIUsageResponse['byDay'][number];

/** `YYYY-MM-DD` + 1 day, in UTC — the calendar the server buckets by. */
function nextDay(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One bucket per calendar day between `start` and `end`, zeros filled in.
 *
 * The server already returns a dense series; this is the same fill applied
 * again on the client, and it is deliberate rather than redundant. A build in
 * the field talks to whatever Worker is deployed, and against an older one
 * `byDay` arrives sparse — four scattered calls would render as four adjacent
 * bars, which is precisely the lie the dense series exists to stop. Without
 * period bounds we can still close the interior gaps.
 */
export function densifyDays(days: DayBucket[], start?: string, end?: string): DayBucket[] {
  if (days.length === 0) return days;
  const from = start && ISO_DAY.test(start) ? start : days[0].date;
  const to = end && ISO_DAY.test(end) ? end : days[days.length - 1].date;
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to)) return days;

  const byDate = new Map(days.map((d) => [d.date, d]));
  const dates = new Set(byDate.keys());
  // Cap the walk: a nonsense range must not spin here on the render path.
  for (let day = from, i = 0; day <= to && i <= 366; day = nextDay(day), i++) dates.add(day);

  return [...dates]
    .sort((a, b) => a.localeCompare(b))
    .map((date) => byDate.get(date) ?? { date, requests: 0, tokens: 0, costUsd: 0 });
}

/**
 * Up to `count` evenly spaced dates, always including the first and last. The
 * series is one bar per calendar day, so a 90-day period has ~91 columns and
 * labelling each one is illegible — the axis carries a few anchors instead and
 * the bars carry the shape.
 */
export function axisTicks(dates: string[], count = 4): string[] {
  if (dates.length <= count) return dates;
  const step = (dates.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => dates[Math.round(i * step)]);
}

/** One "**Lead.** body" line of the methodology sheet. */
function MethodLine({ lead, children }: { lead: string; children: string }) {
  const colors = useAppColors();
  return (
    <Typography variant="caption2" color={colors.textSecondary} style={styles.methodLine}>
      <Typography variant="caption2" weight="semibold" color={colors.textPrimary}>
        {lead}{' '}
      </Typography>
      {children}
    </Typography>
  );
}

/**
 * "Where does this number come from?" — the honest account of a figure the app
 * derives rather than reads. Users pay the provider directly under BYOK, so the
 * gap between this estimate and their invoice is a question they WILL ask; the
 * answer belongs next to the number, not in a support article.
 */
function UsageMethodologyInfo({ usage, testID }: { usage: AIUsageResponse | null; testID: string }) {
  const rawWindow = usage?.range?.rawWindowDays ?? 90;
  const pricingVersion = usage?.estimate?.pricingVersion;
  const unpriced = usage?.estimate?.unpricedRequests ?? 0;

  return (
    <InfoButton
      title="How this is calculated"
      testID={testID}
      accessibilityLabel="How this usage estimate is calculated"
    >
      <View style={styles.method}>
        <MethodLine lead="Tokens are measured, not guessed.">
          Every AI call records the token counts the provider itself reports. Input, output,
          thinking and cached tokens are stored apart because each bills at a different rate.
        </MethodLine>
        <MethodLine lead="The dollars are ours.">
          {`We multiply those tokens by a price table we maintain${
            pricingVersion ? ` (rates ${pricingVersion})` : ''
          } — an API key can't read your invoice, so this is our reconstruction of it, not a bill.`}
        </MethodLine>
        <MethodLine lead="One bar is one day.">
          Each bar is a UTC calendar day in the selected period. A day with no AI use stays flat
          rather than being skipped, so quiet stretches are visible instead of collapsing.
        </MethodLine>
        <MethodLine lead="Recent days are live.">
          {`The last ${rawWindow} days are summed from individual requests, so today's bar moves as you use the app; older days come from a nightly rollup.`}
        </MethodLine>
        <MethodLine lead="Failed calls count as requests, not spend.">
          A call the provider rejected costs almost nothing, but it is still counted so a retry
          storm shows up somewhere.
        </MethodLine>
        {unpriced > 0 ? (
          <MethodLine lead="Some models are unrecognised.">
            {`${unpriced} request${
              unpriced === 1 ? '' : 's'
            } used a model missing from our table and were priced at that provider's most expensive known rate, so the total is an upper bound.`}
          </MethodLine>
        ) : null}
        <MethodLine lead="The exact figure lives at the provider.">
          Your provider&apos;s console shows what was actually charged — treat that as the number
          of record and this as the running estimate between statements.
        </MethodLine>
      </View>
    </InfoButton>
  );
}

export interface AiUsagePanelProps {
  usage: AIUsageResponse | null;
  isLoading?: boolean;
  /** 'provider' → break down by feature; 'all' → break down by provider. */
  mode: 'all' | 'provider';
  /** Accent for bars/highlights (provider accent on the detail screen). */
  accent?: string;
  testID?: string;
}

export function AiUsagePanel({ usage, isLoading, mode, accent, testID }: AiUsagePanelProps) {
  const colors = useAppColors();
  const barColor = accent ?? colors.primary;

  if (isLoading && !usage) {
    return <ActivityIndicator color={barColor} style={styles.loader} />;
  }

  const totals = usage?.totals ?? { requests: 0, tokens: 0, costUsd: 0, errorRequests: 0 };
  const errorRequests = usage?.totals?.errorRequests ?? 0;
  const unpricedRequests = usage?.estimate?.unpricedRequests ?? 0;
  // Not memoised: at most ~366 buckets, and the early return above this rules
  // out a hook here anyway.
  const byDay = densifyDays(usage?.byDay ?? [], usage?.range?.start, usage?.range?.end);
  const maxDayCost = byDay.reduce((m, d) => Math.max(m, d.costUsd), 0) || 1;
  // 90 daily columns on a phone leave ~4pt each: the gap has to shrink with the
  // period or the bars vanish into it.
  const barGap = byDay.length > 45 ? 1 : byDay.length > 14 ? 2 : 4;
  const breakdown =
    mode === 'all'
      ? (usage?.byProvider ?? []).map((r) => ({ label: providerLabel(r.provider), ...r }))
      : (usage?.byFeature ?? []).map((r) => ({ label: r.feature, ...r }));

  const hasData = totals.requests > 0;

  return (
    <View style={styles.wrap} testID={testID}>
      {/* Period total */}
      <View style={[styles.totalCard, { backgroundColor: colors.card, borderColor: colors.borderColor }]}>
        <View style={styles.totalHeader}>
          <Typography variant="caption1" color={colors.textTertiary}>
            Estimated this period
          </Typography>
          {/* The `i` sits next to the badge that makes the claim: the badge says
              "estimate", this says why it is one and how the number was built. */}
          <View style={styles.estGroup}>
            <UsageMethodologyInfo usage={usage} testID={`${testID ?? 'ai-usage'}-method`} />
            <View style={[styles.estPill, { backgroundColor: colors.warning + '22' }]}>
              <Typography variant="caption2" weight="bold" color={colors.warning}>
                ESTIMATE
              </Typography>
            </View>
          </View>
        </View>
        <Typography variant="largeTitle" weight="bold" color={colors.textPrimary}>
          {formatUsd(totals.costUsd)}
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary}>
          {formatTokens(totals.tokens)} tokens · {totals.requests} request
          {totals.requests === 1 ? '' : 's'}
          {errorRequests > 0 ? ` · ${errorRequests} failed` : ''}
        </Typography>
        {/* Token counts are exact; the rates are our table. When a call used a
            model that table doesn't know, we billed it at the provider's
            priciest known rate — say so rather than presenting a guess as a
            measurement. */}
        {unpricedRequests > 0 ? (
          <Typography variant="caption2" color={colors.warning}>
            {unpricedRequests} request{unpricedRequests === 1 ? '' : 's'} used an unrecognised model
            — those are priced at the provider&apos;s highest rate, so the total is an upper bound.
          </Typography>
        ) : null}
      </View>

      {!hasData ? (
        <View style={styles.empty}>
          <Icon name="bar-chart-outline" size={22} color={colors.textTertiary} />
          <Typography variant="footnote" color={colors.textSecondary}>
            No AI usage recorded for this period yet.
          </Typography>
        </View>
      ) : (
        <>
          {/* Per-day bars — one column per calendar day in the period, including
              the days with no usage. Dropping empty days would put 22 July
              shoulder to shoulder with 16 August and read as steady daily
              spend. */}
          {byDay.length > 0 ? (
            <View style={styles.section}>
              <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
                Per day
              </Typography>
              <View
                style={[styles.bars, { gap: barGap }]}
                accessibilityRole="image"
                accessibilityLabel={`Estimated spend per day, ${formatDay(
                  byDay[0].date
                )} to ${formatDay(byDay[byDay.length - 1].date)}. Busiest day ${formatUsd(
                  maxDayCost
                )}.`}
                testID={testID ? `${testID}-bars` : undefined}
              >
                {byDay.map((d) => {
                  const idle = d.costUsd <= 0 && d.requests <= 0;
                  return (
                    <View key={d.date} style={styles.barTrack}>
                      <View
                        style={[
                          styles.barFill,
                          // A flat tick, not a stub bar: an unused day must not
                          // render as a small amount of spend.
                          idle && styles.barIdle,
                          idle
                            ? { backgroundColor: colors.divider }
                            : {
                                backgroundColor: barColor,
                                // Floor so a real-but-tiny day stays visible next
                                // to a day that cost 50x more.
                                height: `${Math.max(6, (d.costUsd / maxDayCost) * 100)}%`,
                              },
                        ]}
                      />
                    </View>
                  );
                })}
              </View>
              <View style={styles.axis}>
                {axisTicks(byDay.map((d) => d.date)).map((date, i, all) => (
                  <Typography
                    key={date}
                    variant="caption2"
                    color={colors.textTertiary}
                    numberOfLines={1}
                    style={[
                      styles.axisTick,
                      i === 0 && styles.axisTickFirst,
                      i === all.length - 1 && styles.axisTickLast,
                    ]}
                  >
                    {formatDay(date)}
                  </Typography>
                ))}
              </View>
            </View>
          ) : null}

          {/* Breakdown */}
          {breakdown.length > 0 ? (
            <View style={styles.section}>
              <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
                {mode === 'all' ? 'By provider' : 'By feature'}
              </Typography>
              {breakdown.map((row) => (
                <View key={row.label} style={[styles.row, { borderBottomColor: colors.divider }]}>
                  <Typography variant="footnote" color={colors.textPrimary} style={styles.rowLabel} numberOfLines={1}>
                    {row.label}
                  </Typography>
                  <Typography variant="caption1" color={colors.textTertiary}>
                    {formatTokens(row.tokens)}
                  </Typography>
                  <Typography variant="footnote" weight="semibold" color={colors.textPrimary} style={styles.rowCost}>
                    {formatUsd(row.costUsd)}
                  </Typography>
                </View>
              ))}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  loader: { marginVertical: 24 },
  totalCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 4 },
  totalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  estGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  estPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 24 },
  section: { gap: 10 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 72 },
  barTrack: { flex: 1, height: '100%', justifyContent: 'flex-end', borderRadius: 3, overflow: 'hidden' },
  barFill: { width: '100%', borderRadius: 3 },
  barIdle: { height: 2 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
  axisTick: { flex: 1, textAlign: 'center' },
  axisTickFirst: { textAlign: 'left' },
  axisTickLast: { textAlign: 'right' },
  method: { gap: 10 },
  methodLine: { lineHeight: 17 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { flex: 1 },
  rowCost: { minWidth: 60, textAlign: 'right' },
});
