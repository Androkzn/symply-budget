import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useState, useCallback } from 'react';
import { ScrollView, StyleSheet, View, RefreshControl, Linking, TouchableOpacity } from 'react-native';

import { AppBackground, ScreenHeader } from '@components/common';
import { Typography, Card, GradientButton } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { utilitiesApi, type PropertyTax, type MunicipalityConfig } from '@features/utilities/api/utilities';
import {
  assessmentAuthorityLabel,
  usBillDeliveryNote,
  useResolvedJurisdiction,
} from '@hooks/usePropertyJurisdiction';
import type { UtilitiesStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import type { PropertyReliefProgram, UsHomesteadExemption } from '@symply/contracts';
import { CornerRadius, hexToRgba, Layout, Spacing, useAppColors } from '@theme';
import { formatMoney, useDisplayCurrency } from '@utils/money';

type PropertyTaxScreenNavigationProp = NativeStackNavigationProp<UtilitiesStackParamList>;

// Format currency from cents
function formatCurrency(cents: number): string {
  return formatMoney(cents, { decimals: 2 });
}

// Format date
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function openUrl(url: string): void {
  Linking.openURL(url).catch(console.error);
}

/**
 * How the homeowner gets the program. `on-bill` relief is automatic — it must
 * never read as something they still have to go and do.
 */
function reliefStatusLabel(program: PropertyReliefProgram): string {
  switch (program.applyMode) {
    case 'on-bill':
      return 'Applied to your bill';
    case 'income-tax-return':
      return 'Claim on your tax return';
    default:
      return 'Application required';
  }
}

/** The call-to-action under a program, or plain wording where there is no action. */
function reliefLinkLabel(program: PropertyReliefProgram): string {
  switch (program.applyMode) {
    case 'on-bill':
      return 'Program details';
    case 'income-tax-return':
      return 'How to claim';
    default:
      return 'How to apply';
  }
}

/**
 * Registry copy marks the traps it warns about with markdown emphasis
 * ("**not to school levies**"). Nothing here renders markdown, so without this
 * the homeowner reads the asterisks.
 */
function plainText(text: string): string {
  return text.replace(/\*\*/g, '');
}

/** Where a US benefit lands, short enough for the status badge. */
function usExemptionDeliveryBadge(exemption: UsHomesteadExemption): string {
  switch (exemption.deliveryMethod) {
    case 'reduces_taxable_value':
      return 'Lowers taxed value';
    case 'reduces_tax_due':
      return 'Lowers tax due';
    // `separate_payment`
    default:
      return 'Paid separately';
  }
}

/**
 * The sentence under the badge. New York's STAR credit is a cheque or direct
 * deposit from the state, so a homeowner who reads their bill looking for it
 * concludes they are getting nothing — this is the line that stops that, and it
 * is why the badge above must never claim the bill went down.
 */
function usExemptionDeliveryLine(exemption: UsHomesteadExemption): string {
  switch (exemption.deliveryMethod) {
    case 'reduces_taxable_value':
      return 'Comes off the value your rate is applied to.';
    case 'reduces_tax_due':
      return 'Comes off the tax due on your bill.';
    // `separate_payment`
    default:
      return 'Paid to you separately by the state — it never appears on your tax bill.';
  }
}

/**
 * Which levies the benefit reaches. Florida's second $25,000 band skips school
 * levies and New York's STAR touches nothing else; school millage is usually the
 * largest line on the bill, so "it applies to everything" overstates the saving
 * by the biggest number on the page. Null where it genuinely is everything.
 */
function usExemptionScopeLabel(exemption: UsHomesteadExemption): string | null {
  if (exemption.appliesToSchoolLevies && exemption.appliesToNonSchoolLevies) return null;
  if (exemption.appliesToSchoolLevies) return 'School levies only';
  if (exemption.appliesToNonSchoolLevies) return 'Does not apply to school levies';
  return null;
}

export function PropertyTaxScreen() {  const colors = useAppColors();
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const navigation = useNavigation<PropertyTaxScreenNavigationProp>();
  const { currentHousehold } = useHouseholdStore();
  // Everything region-specific — the authority, the lookup, which relief exists
  // — comes from here. Nothing on this screen may assume BC, or Canada.
  const jurisdiction = useResolvedJurisdiction();
  // Split the tagged union once: the Canadian record carries `authorityName` and
  // `reliefPrograms`, the US one `assessingBodyLabel` and `homesteadExemptions`,
  // and reading across is a compile error rather than a blank card.
  const ca = jurisdiction?.country === 'CA' ? jurisdiction.ca : null;
  const us = jurisdiction?.country === 'US' ? jurisdiction.us : null;
  const [taxes, setTaxes] = useState<PropertyTax[]>([]);
  const [municipality, setMunicipality] = useState<MunicipalityConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    if (!currentHousehold?.id) return;

    try {
      const [taxesData, municipalityData] = await Promise.all([
        utilitiesApi.getPropertyTaxes(currentHousehold.id),
        utilitiesApi.getMunicipality(currentHousehold.id),
      ]);
      setTaxes(taxesData);
      setMunicipality(municipalityData.municipality);
    } catch (error) {
      console.error('Error loading property tax data:', error);
    }
  }, [currentHousehold?.id]);

  useEffect(() => {
    setIsLoading(true);
    loadData().finally(() => setIsLoading(false));
  }, [loadData]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    setIsRefreshing(false);
  };

  const currentYear = new Date().getFullYear();
  const currentYearTax = taxes.find((t) => t.tax_year === currentYear);
  const reliefPrograms = ca?.reliefPrograms ?? [];
  // The grant the stored `homeowner_grant_*` columns refer to, named the way the
  // homeowner's own province names it — not "Home Owner Grant" everywhere.
  const grantProgram = reliefPrograms.find((p) => p.kind === 'grant') ?? null;
  const grantLabel = grantProgram?.name ?? 'Homeowner grant';
  // US homestead exemptions are not relief programs in the Canadian sense: they
  // are held by the county against the value, and one of them (STAR) is not a
  // bill reduction at all — so they get their own section rather than being
  // flattened into one that badges everything "Applied to your bill".
  const exemptions = us?.homesteadExemptions ?? [];
  // Most mortgaged US homes escrow property tax, so "no property tax data for
  // 2026" is the normal case there and must not read as "you owe nothing".
  const escrowNote = usBillDeliveryNote(jurisdiction);

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

  return (
    <AppBackground opacity={0.5}>
      <ScreenHeader showBackButton onBackPress={() => navigation.goBack()} />
      <View style={styles.container} testID="property-tax-screen">
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
          testID="property-tax-screen-scroll"
        >
          {municipality && (
            <Card variant="filled" style={styles.municipalityCard}>
              <Typography variant="title3" weight="semibold" style={styles.municipalityTitle}>
                {municipality.municipality_name}
              </Typography>
              <Typography variant="caption1" color={colors.textSecondary}>
                Property taxes due: {municipality.property_tax_main_due_date}
              </Typography>
              {municipality.portal_url && (
                <GradientButton
                  onPress={() => Linking.openURL(municipality.portal_url!).catch(console.error)}
                  style={styles.portalButton}
                  title="Open Portal"
                  fullWidth
                />
              )}
            </Card>
          )}

          {currentYearTax ? (
            <Card variant="filled" style={styles.taxCard}>
              <Typography variant="headline" weight="semibold" style={styles.taxYear}>
                {currentYearTax.tax_year} Property Tax
              </Typography>
              <Typography variant="title1" weight="bold" color={colors.primary} style={styles.taxAmount}>
                {formatCurrency(currentYearTax.tax_amount)}
              </Typography>

              <View style={styles.paymentSection}>
                {/* `!= null`, not truthiness: advance_payment_amount is
                    `number | null`, and a legitimate 0 made this render the
                    bare number 0 as a child of a <View>, which throws
                    "Text strings must be rendered within a <Text> component"
                    and takes the whole screen down. */}
                {currentYearTax.advance_payment_amount != null && (
                  <View style={[styles.paymentItem, { borderBottomColor: colors.divider }]}>
                    <View style={styles.paymentHeader}>
                      <Typography variant="body" weight="semibold">
                        Advance Payment
                      </Typography>
                      {currentYearTax.advance_payment_paid_date ? (
                        <View style={[styles.paidBadge, { backgroundColor: hexToRgba(colors.success, 0.1) }]}>
                          <Typography variant="caption2" color={colors.success}>
                            Paid
                          </Typography>
                        </View>
                      ) : (
                        <Typography variant="caption1" color={colors.textSecondary}>
                          Due: {currentYearTax.advance_payment_due_date ? formatDate(currentYearTax.advance_payment_due_date) : 'N/A'}
                        </Typography>
                      )}
                    </View>
                    <Typography variant="title3" weight="semibold">
                      {formatCurrency(currentYearTax.advance_payment_amount)}
                    </Typography>
                  </View>
                )}

                <View style={[styles.paymentItem, { borderBottomColor: colors.divider }]}>
                  <View style={styles.paymentHeader}>
                    <Typography variant="body" weight="semibold">
                      Main Payment
                    </Typography>
                    {currentYearTax.main_payment_paid_date ? (
                      <View style={[styles.paidBadge, { backgroundColor: colors.success + '1A' }]}>
                        <Typography variant="caption2" color={colors.success}>
                          Paid
                        </Typography>
                      </View>
                    ) : (
                      <Typography variant="caption1" color={colors.textSecondary}>
                        Due: {formatDate(currentYearTax.main_payment_due_date)}
                      </Typography>
                    )}
                  </View>
                  <Typography variant="title3" weight="semibold">
                    {formatCurrency(currentYearTax.main_payment_amount)}
                  </Typography>
                </View>
              </View>

              {currentYearTax.homeowner_grant_eligible && (
                <View style={[styles.grantSection, { borderTopColor: colors.divider }]}>
                  <Typography variant="body" weight="semibold" style={styles.grantTitle}>
                    {grantLabel}
                  </Typography>
                  {currentYearTax.homeowner_grant_status === 'approved' && currentYearTax.homeowner_grant_amount ? (
                    <View style={styles.grantApprovedRow}>
                      <Icon name="checkmark-circle" size={18} color={colors.success} />
                      <Typography variant="body" color={colors.success}>
                        Approved: {formatCurrency(currentYearTax.homeowner_grant_amount)}
                      </Typography>
                    </View>
                  ) : (
                    <Typography variant="body" color={colors.textSecondary}>
                      {grantProgram
                        ? grantProgram.summary
                        : 'Marked as eligible on this notice. Check with your municipality for the amount.'}
                    </Typography>
                  )}
                  {/* Only a grant the homeowner has to claim gets a button — an
                      on-bill program is already deducted and needs no action. */}
                  {grantProgram &&
                    grantProgram.applyMode !== 'on-bill' &&
                    !currentYearTax.homeowner_grant_applied_date && (
                      <GradientButton
                        onPress={() => openUrl(grantProgram.url)}
                        style={styles.grantButton}
                        title={
                          grantProgram.applyMode === 'income-tax-return'
                            ? `Claim ${grantProgram.name}`
                            : `Apply for ${grantProgram.name}`
                        }
                        fullWidth
                      />
                    )}
                </View>
              )}
            </Card>
          ) : (
            <Card variant="filled" style={styles.emptyCard}>
              <Typography variant="body" color={colors.textSecondary} style={styles.emptyText}>
                No property tax data for {currentYear}. Scan your notice to get started.
              </Typography>
              <GradientButton
                onPress={() => navigation.navigate('AddPropertyTax')}
                style={styles.addButton}
                title="Add Property Tax"
                fullWidth
                testID="property-tax-add"
              />
            </Card>
          )}

          {currentYearTax && (
            <GradientButton
              onPress={() => navigation.navigate('AddPropertyTax')}
              style={styles.importButton}
              title="Scan / Import a Notice"
              variant="blue"
              fullWidth
              testID="property-tax-import"
            />
          )}

          {/* Sits directly under the tax card, because it is the answer to the
              card above it: a US owner whose servicer pays out of escrow has no
              bill to scan, and the empty state must not read as a debt. */}
          {!!escrowNote && (
            <Card variant="filled" style={styles.escrowCard} testID="property-tax-escrow-note">
              <Typography variant="body" weight="semibold" style={styles.authorityTitle}>
                Your bill may go to your mortgage servicer
              </Typography>
              <Typography variant="caption1" color={colors.textSecondary}>
                {escrowNote}
              </Typography>
            </Card>
          )}

          {/* Exemptions the state offers. Each one says where the money lands and
              which levies it reaches — the two things a homeowner cannot read
              off their own bill, and the two the registry exists to carry. */}
          {exemptions.length > 0 && (
            <View style={styles.reliefSection}>
              <Typography variant="title2" weight="semibold" style={styles.sectionTitle}>
                Exemptions
              </Typography>
              {exemptions.map((exemption) => {
                // A cheque from the state is not a smaller bill, so it does not
                // get the colour that means "already handled for you".
                const reducesBill = exemption.deliveryMethod !== 'separate_payment';
                const statusColor = reducesBill ? colors.success : colors.primary;
                const scope = usExemptionScopeLabel(exemption);
                return (
                  <Card key={exemption.id} variant="filled" style={styles.reliefCard}>
                    <View style={styles.reliefBody} testID={`property-tax-relief-${exemption.id}`}>
                      <View style={styles.reliefHeader}>
                        <Typography variant="body" weight="semibold" style={styles.reliefName}>
                          {exemption.name}
                        </Typography>
                        <View
                          style={[
                            styles.reliefBadge,
                            { backgroundColor: hexToRgba(statusColor, 0.1) },
                          ]}
                        >
                          <Typography variant="caption2" weight="semibold" color={statusColor}>
                            {usExemptionDeliveryBadge(exemption)}
                          </Typography>
                        </View>
                      </View>
                      <Typography variant="caption1" weight="semibold" color={colors.textSecondary}>
                        {usExemptionDeliveryLine(exemption)}
                      </Typography>
                      {!!scope && (
                        <Typography variant="caption1" weight="semibold" color={colors.textPrimary}>
                          {scope}
                        </Typography>
                      )}
                      <Typography variant="caption1" color={colors.textSecondary}>
                        {plainText(exemption.summary)}
                      </Typography>
                      <TouchableOpacity onPress={() => openUrl(exemption.url)} activeOpacity={0.7}>
                        <Typography variant="caption1" weight="semibold" color={colors.primary}>
                          {exemption.applicationDeadline
                            ? `How to apply — by ${exemption.applicationDeadline}`
                            : 'How to apply'}
                        </Typography>
                      </TouchableOpacity>
                    </View>
                  </Card>
                );
              })}
            </View>
          )}

          {/* Relief the homeowner's own province actually offers. Alberta,
              Saskatchewan and Newfoundland have none province-wide, so the whole
              section is omitted rather than shown empty. */}
          {reliefPrograms.length > 0 && (
            <View style={styles.reliefSection}>
              <Typography variant="title2" weight="semibold" style={styles.sectionTitle}>
                Relief programs
              </Typography>
              {reliefPrograms.map((program) => {
                const isAutomatic = program.applyMode === 'on-bill';
                const statusColor = isAutomatic ? colors.success : colors.primary;
                return (
                  <Card key={program.id} variant="filled" style={styles.reliefCard}>
                    <View style={styles.reliefBody} testID={`property-tax-relief-${program.id}`}>
                      <View style={styles.reliefHeader}>
                        <Typography variant="body" weight="semibold" style={styles.reliefName}>
                          {program.name}
                        </Typography>
                        <View
                          style={[styles.reliefBadge, { backgroundColor: hexToRgba(statusColor, 0.1) }]}
                        >
                          <Typography variant="caption2" weight="semibold" color={statusColor}>
                            {reliefStatusLabel(program)}
                          </Typography>
                        </View>
                      </View>
                      <Typography variant="caption1" color={colors.textSecondary}>
                        {program.summary}
                      </Typography>
                      <TouchableOpacity onPress={() => openUrl(program.url)} activeOpacity={0.7}>
                        <Typography variant="caption1" weight="semibold" color={colors.primary}>
                          {reliefLinkLabel(program)}
                        </Typography>
                      </TouchableOpacity>
                    </View>
                  </Card>
                );
              })}
            </View>
          )}

          {/* Who assessed this property, and where to look it up. */}
          <Card variant="filled" style={styles.authorityCard}>
            {ca ? (
              <>
                <Typography variant="body" weight="semibold" style={styles.authorityTitle}>
                  {assessmentAuthorityLabel(jurisdiction)}
                </Typography>
                <Typography variant="caption1" color={colors.textSecondary}>
                  {ca.valuationDateRule}
                </Typography>
                <TouchableOpacity
                  onPress={() => openUrl(ca.lookupUrl ?? ca.authorityUrl)}
                  activeOpacity={0.7}
                  style={styles.authorityLink}
                  testID="property-tax-authority-link"
                >
                  <Typography variant="caption1" weight="semibold" color={colors.primary}>
                    {ca.lookupUrl
                      ? `Look up your property with ${ca.authorityName}`
                      : `Open ${ca.authorityName}`}
                  </Typography>
                </TouchableOpacity>
                {/* No province-wide lookup exists (YT, NT, NU, and Alberta), so the
                    hint is plain text — there is nothing to link to. */}
                {!ca.lookupUrl && ca.lookupHint && (
                  <Typography variant="caption2" color={colors.textTertiary}>
                    {ca.lookupHint}
                  </Typography>
                )}
              </>
            ) : us ? (
              <>
                {/* The office that *values* — never the one that bills, and in
                    Texas never the state either. There is no national US parcel
                    lookup and no URL naming pattern, so the only link offered is
                    the state agency's, with what it cannot do said first. */}
                <Typography variant="body" weight="semibold" style={styles.authorityTitle}>
                  {assessmentAuthorityLabel(jurisdiction)}
                </Typography>
                {!!us.revaluationNote && (
                  <Typography variant="caption1" color={colors.textSecondary}>
                    {us.revaluationNote}
                  </Typography>
                )}
                <Typography variant="caption2" color={colors.textTertiary}>
                  {plainText(us.stateRole)}
                </Typography>
                <TouchableOpacity
                  onPress={() => openUrl(us.stateAgencyUrl)}
                  activeOpacity={0.7}
                  style={styles.authorityLink}
                  testID="property-tax-authority-link"
                >
                  <Typography variant="caption1" weight="semibold" color={colors.primary}>
                    Open {us.stateAgencyName}
                  </Typography>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Typography variant="body" weight="semibold" style={styles.authorityTitle}>
                  Property assessment
                </Typography>
                <Typography variant="caption1" color={colors.textSecondary}>
                  We don&apos;t have assessment rules for your area yet. Your assessment notice and
                  your municipality&apos;s website carry the authority, the appeal deadline and any
                  relief you can claim.
                </Typography>
              </>
            )}
          </Card>

          {taxes.length > 0 && (
            <View style={styles.historySection}>
              <Typography variant="title2" weight="semibold" style={styles.historyTitle}>
                Previous Years
              </Typography>
              {taxes
                .filter((t) => t.tax_year < currentYear)
                .map((tax) => (
                  <Card key={tax.id} variant="filled" style={styles.historyCard}>
                    <View style={styles.historyRow} testID={`property-tax-history-${tax.tax_year}`}>
                      <Typography variant="body" weight="semibold">
                        {tax.tax_year}
                      </Typography>
                      <Typography variant="body" weight="semibold">
                        {formatCurrency(tax.tax_amount)}
                      </Typography>
                    </View>
                  </Card>
                ))}
            </View>
          )}
        </ScrollView>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
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
  municipalityCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.base,
  },
  municipalityTitle: {
    marginBottom: Spacing.sm,
  },
  portalButton: {
    marginTop: Spacing.md,
  },
  taxCard: {
    padding: Spacing.xl,
    marginBottom: Spacing.base,
  },
  taxYear: {
    marginBottom: Spacing.sm,
  },
  taxAmount: {
    marginBottom: Spacing.xl,
  },
  paymentSection: {
    marginBottom: Spacing.xl,
  },
  paymentItem: {
    marginBottom: Spacing.base,
    paddingBottom: Spacing.base,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  paymentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  paidBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: CornerRadius.sm,
  },
  grantSection: {
    paddingTop: Spacing.base,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  grantTitle: {
    marginBottom: Spacing.sm,
  },
  grantApprovedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  grantButton: {
    marginTop: Spacing.md,
  },
  emptyCard: {
    padding: Spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    marginBottom: Spacing.base,
    textAlign: 'center',
  },
  addButton: {
    marginTop: Spacing.sm,
  },
  importButton: {
    marginBottom: Spacing.base,
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
  reliefSection: {
    marginBottom: Spacing.base,
  },
  reliefCard: {
    padding: Spacing.base,
    marginBottom: Spacing.sm,
  },
  reliefBody: {
    gap: Spacing.xs,
  },
  reliefHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  reliefName: {
    flex: 1,
  },
  reliefBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: CornerRadius.sm,
  },
  authorityCard: {
    padding: Spacing.base,
    marginBottom: Spacing.base,
    gap: Spacing.xs,
  },
  escrowCard: {
    padding: Spacing.base,
    marginBottom: Spacing.base,
    gap: Spacing.xs,
  },
  authorityTitle: {
    marginBottom: Spacing.xxs,
  },
  authorityLink: {
    marginTop: Spacing.xxs,
  },
  historySection: {
    marginTop: Spacing.sm,
  },
  historyTitle: {
    marginBottom: Spacing.md,
  },
  historyCard: {
    padding: Spacing.base,
    marginBottom: Spacing.sm,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
