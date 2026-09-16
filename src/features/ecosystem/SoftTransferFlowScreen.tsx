import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import {
  smartEngineApi,
  type SmartEnginePackage,
  type TransferPackageId,
} from '@api/smart-engine';
import {
  brand,
  isHealthCapableBrand,
  isHouseBrand,
  isHouseBudgetTransferPair,
  isHouseHealthTransferPair,
  isHouseLanguageTransferPair,
  isHouseOrFullBudgetBrand,
  isLanguageCapableBrand,
} from '@brand';
import { SafeAreaView, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Card, IconBackgroundChip, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import {
  buildLocalBudgetSummaryV1,
  toBudgetSummaryEnvelopePayload,
} from '@features/budget/local/export/localBudgetSummary';
import { isBudgetLocalFirst } from '@features/budget/local/flag';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, IconSize, Layout, Spacing, useAppColors } from '@theme';

import { ConsentConfirmationCard } from './ConsentConfirmationCard';
import { fetchBudgetHouseholds, fetchSpineHouseholds } from './crossHouseholds';
import { resolveSoftTransferErrorMessage } from './errors';
import { HouseholdPicker } from './HouseholdPicker';
import { getBrandDisplayName, getPackageLabel } from './labels';
import { runSoftTransfer } from './runTransfer';


export type SoftTransferPreset =
  | 'house-to-budget'
  | 'budget-to-house'
  | 'house-to-health'
  | 'health-to-house'
  | 'house-to-language'
  | 'language-to-house';

export type SoftTransferFlowScreenProps = {
  title: string;
  preset?: SoftTransferPreset;
  /** When set, skip package selection and use this package directly. */
  fixedPackageId?: TransferPackageId;
};

type FlowStep = 'packages' | 'consent' | 'households' | 'running' | 'done' | 'error';

type SoftTransferFlowNavigation = NativeStackNavigationProp<Record<string, object | undefined>>;

const PRESET_PACKAGES: Record<SoftTransferPreset, TransferPackageId[]> = {
  'house-to-budget': [
    'profile.core.v1',
    'house.property.v1',
    'home_project_cost_summary.v1',
  ],
  'budget-to-house': ['budget.summary.v1'],
  'house-to-health': ['profile.core.health.v1'],
  'health-to-house': ['health.summary.v1'],
  'house-to-language': ['profile.core.language.v1'],
  'language-to-house': ['language.summary.v1'],
};

const DEFAULT_PURPOSE: Record<TransferPackageId, string> = {
  'profile.core.v1': 'Share confirmed profile basics across Symply apps',
  'house.property.v1': 'Pre-fill Budget setup from a shared household summary',
  'budget.summary.v1': 'Show a high-level Budget summary in a linked app',
  'profile.core.health.v1': 'Share profile basics with Symply Health onboarding',
  'health.summary.v1': 'Show a high-level Health check-in summary in a linked app',
  'profile.core.language.v1': 'Share profile basics with Symply Language onboarding',
  'language.summary.v1': 'Show a high-level Language learning summary in a linked app',
  'home_project_cost_summary.v1':
    'Share the latest Home Project cost rollup with Symply Budget',
};

function packagesForPreset(preset?: SoftTransferPreset): TransferPackageId[] | null {
  if (!preset) return null;
  return PRESET_PACKAGES[preset] ?? null;
}

function packageTouchesActiveBrand(pkg: SmartEnginePackage): boolean {
  return pkg.source_brand_id === brand.id || pkg.destination_brand_id === brand.id;
}

function isRelevantTransferPackage(pkg: SmartEnginePackage): boolean {
  if (isHouseBudgetTransferPair(pkg.source_brand_id, pkg.destination_brand_id)) {
    return isHouseOrFullBudgetBrand() && packageTouchesActiveBrand(pkg);
  }
  if (isHouseHealthTransferPair(pkg.source_brand_id, pkg.destination_brand_id)) {
    return (isHouseBrand() || isHealthCapableBrand()) && packageTouchesActiveBrand(pkg);
  }
  if (isHouseLanguageTransferPair(pkg.source_brand_id, pkg.destination_brand_id)) {
    return (isHouseBrand() || isLanguageCapableBrand()) && packageTouchesActiveBrand(pkg);
  }
  return false;
}

export function SoftTransferFlowScreen({
  title,
  preset,
  fixedPackageId,
}: SoftTransferFlowScreenProps) {  const colors = useAppColors();
  const navigation = useNavigation<SoftTransferFlowNavigation>();
  const localHouseholds = useHouseholdStore((s) => s.households);
  const currentHousehold = useHouseholdStore((s) => s.currentHousehold);

  const [catalog, setCatalog] = useState<SmartEnginePackage[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [step, setStep] = useState<FlowStep>('packages');
  const [selectedPackageId, setSelectedPackageId] = useState<TransferPackageId | null>(null);
  useEffect(() => {
    if (!fixedPackageId || catalog.length === 0) return;
    const match = catalog.find((p) => p.package_id === fixedPackageId);
    if (match) {
      setSelectedPackageId(fixedPackageId);
      setStep('consent');
    }
  }, [fixedPackageId, catalog]);
  const [sourceHouseholdId, setSourceHouseholdId] = useState<string | null>(
    currentHousehold?.id ?? null
  );
  const [destinationHouseholdId, setDestinationHouseholdId] = useState<string | null>(
    currentHousehold?.id ?? null
  );
  const [remoteSourceHouseholds, setRemoteSourceHouseholds] = useState<typeof localHouseholds>([]);
  const [remoteDestinationHouseholds, setRemoteDestinationHouseholds] = useState<
    typeof localHouseholds
  >([]);
  const [loadingHouseholds, setLoadingHouseholds] = useState(false);
  const [running, setRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const allowedPackageIds = useMemo(() => packagesForPreset(preset), [preset]);

  const availablePackages = useMemo(() => {
    return catalog.filter((pkg) => {
      if (allowedPackageIds && !allowedPackageIds.includes(pkg.package_id)) return false;
      return isRelevantTransferPackage(pkg);
    });
  }, [catalog, allowedPackageIds]);

  const selectedPackage = useMemo(
    () => availablePackages.find((p) => p.package_id === selectedPackageId) ?? null,
    [availablePackages, selectedPackageId]
  );

  const loadCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    setErrorMessage(null);
    try {
      const rows = await smartEngineApi.listPackages();
      setCatalog(rows);
    } catch (error) {
      setErrorMessage(resolveSoftTransferErrorMessage(error));
      setStep('error');
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (!selectedPackage || step !== 'households') return;
    const needsRemoteSource =
      selectedPackage.requires_source_household &&
      selectedPackage.source_brand_id !== brand.id;
    const needsRemoteDestination =
      selectedPackage.requires_destination_household &&
      selectedPackage.destination_brand_id !== brand.id;
    if (!needsRemoteSource && !needsRemoteDestination) return;

    setLoadingHouseholds(true);
    const tasks: Promise<void>[] = [];

    if (needsRemoteSource) {
      const loader = isHouseBrand(selectedPackage.source_brand_id)
        ? fetchSpineHouseholds
        : fetchBudgetHouseholds;
      tasks.push(
        loader().then((rows) => {
          setRemoteSourceHouseholds(rows);
          if (!sourceHouseholdId && rows[0]) setSourceHouseholdId(rows[0].id);
        })
      );
    }

    if (needsRemoteDestination) {
      const loader = isHouseBrand(selectedPackage.destination_brand_id)
        ? fetchSpineHouseholds
        : fetchBudgetHouseholds;
      tasks.push(
        loader().then((rows) => {
          setRemoteDestinationHouseholds(rows);
          if (!destinationHouseholdId && rows[0]) {
            setDestinationHouseholdId(rows[0].id);
          }
        })
      );
    }

    void Promise.all(tasks)
      .catch((error) => {
        setErrorMessage(resolveSoftTransferErrorMessage(error));
        setStep('error');
      })
      .finally(() => setLoadingHouseholds(false));
  }, [selectedPackage, step, sourceHouseholdId, destinationHouseholdId]);

  const sourceHouseholdOptions = useMemo(() => {
    if (!selectedPackage) return [];
    if (selectedPackage.source_brand_id === brand.id) return localHouseholds;
    return remoteSourceHouseholds;
  }, [selectedPackage, localHouseholds, remoteSourceHouseholds]);

  const destinationHouseholdOptions = useMemo(() => {
    if (!selectedPackage) return [];
    if (selectedPackage.destination_brand_id === brand.id) return localHouseholds;
    return remoteDestinationHouseholds;
  }, [selectedPackage, localHouseholds, remoteDestinationHouseholds]);

  const handleSelectPackage = (packageId: TransferPackageId) => {
    setSelectedPackageId(packageId);
    setStep('consent');
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleConsentContinue = () => {
    if (!selectedPackage) return;
    const needsHouseholds =
      selectedPackage.requires_source_household || selectedPackage.requires_destination_household;
    setStep(needsHouseholds ? 'households' : 'running');
    if (!needsHouseholds) void executeTransfer();
  };

  const canRunTransfer = useMemo(() => {
    if (!selectedPackage) return false;
    if (
      selectedPackage.requires_source_household &&
      !sourceHouseholdId
    ) {
      return false;
    }
    if (
      selectedPackage.requires_destination_household &&
      !destinationHouseholdId
    ) {
      return false;
    }
    return true;
  }, [selectedPackage, sourceHouseholdId, destinationHouseholdId]);

  const executeTransfer = async () => {
    if (!selectedPackage || !selectedPackageId) return;
    setRunning(true);
    setErrorMessage(null);
    setStep('running');
    try {
      let clientPayload: Record<string, unknown> | undefined;
      let localFirstExport = false;
      if (
        isBudgetLocalFirst() &&
        selectedPackageId === 'budget.summary.v1' &&
        selectedPackage.source_brand_id === 'symply-budget'
      ) {
        const summary = buildLocalBudgetSummaryV1();
        clientPayload = toBudgetSummaryEnvelopePayload(summary);
        localFirstExport = true;
      }

      const result = await runSoftTransfer({
        packageId: selectedPackageId,
        sourceBrandId: selectedPackage.source_brand_id,
        destinationBrandId: selectedPackage.destination_brand_id,
        purpose: DEFAULT_PURPOSE[selectedPackageId],
        sourceHouseholdId,
        destinationHouseholdId,
        clientPayload,
        localFirstExport,
      });
      const pkg = getPackageLabel(selectedPackageId);
      setSuccessMessage(
        result.importStatus === 'already_imported'
          ? `${pkg.title} was already imported for this operation.`
          : `${pkg.title} imported successfully.`
      );
      setStep('done');
    } catch (error) {
      setErrorMessage(resolveSoftTransferErrorMessage(error));
      setStep('error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <SafeAreaView edges={[]} testID="soft-transfer-flow-screen">
      <ScreenHeader
        title={title}
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />

      <ScrollView
        style={[screenScrollViewStyle.scroll, styles.flex]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {loadingCatalog ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null}

        {step === 'packages' && !loadingCatalog ? (
          <View style={styles.section}>
            <Typography variant="body" color={colors.textSecondary} style={styles.intro}>
              Choose what to share. Each package is versioned, opt-in, and scoped — no silent
              cross-app reads.
            </Typography>
            {availablePackages.map((pkg) => {
              const label = getPackageLabel(pkg.package_id);
              return (
                <TouchableOpacity
                  key={pkg.package_id}
                  onPress={() => handleSelectPackage(pkg.package_id)}
                  activeOpacity={0.85}
                  testID={`package-option-${pkg.package_id}`}
                >
                  <Card variant="filled" style={styles.packageCard}>
                    <IconBackgroundChip name="document-text-outline" style={styles.packageIcon} />
                    <View style={styles.packageText}>
                      <Typography variant="body" weight="semibold">
                        {label.title}
                      </Typography>
                      <Typography variant="footnote" color={colors.textSecondary}>
                        {getBrandDisplayName(pkg.source_brand_id)} →{' '}
                        {getBrandDisplayName(pkg.destination_brand_id)}
                      </Typography>
                      <Typography variant="caption1" color={colors.textTertiary}>
                        {label.summary}
                      </Typography>
                    </View>
                    <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
                  </Card>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}

        {step === 'consent' && selectedPackage && selectedPackageId ? (
          <ConsentConfirmationCard
            packageId={selectedPackageId}
            sourceBrandId={selectedPackage.source_brand_id}
            destinationBrandId={selectedPackage.destination_brand_id}
            purpose={DEFAULT_PURPOSE[selectedPackageId]}
            onConfirm={handleConsentContinue}
            onCancel={() => setStep('packages')}
          />
        ) : null}

        {step === 'households' && selectedPackage ? (
          <View style={styles.section}>
            {selectedPackage.requires_source_household ? (
              loadingHouseholds ? (
                <ActivityIndicator color={colors.primary} style={styles.loading} />
              ) : (
                <HouseholdPicker
                  label={`Source — ${getBrandDisplayName(selectedPackage.source_brand_id)}`}
                  households={sourceHouseholdOptions}
                  selectedId={sourceHouseholdId}
                  onSelect={setSourceHouseholdId}
                  testID="source-household-picker"
                />
              )
            ) : null}
            {selectedPackage.requires_destination_household ? (
              <HouseholdPicker
                label={`Destination — ${getBrandDisplayName(selectedPackage.destination_brand_id)}`}
                households={destinationHouseholdOptions}
                selectedId={destinationHouseholdId}
                onSelect={setDestinationHouseholdId}
                testID="destination-household-picker"
              />
            ) : null}
            <TouchableOpacity
              onPress={() => void executeTransfer()}
              disabled={!canRunTransfer || running}
              style={[
                styles.primaryAction,
                {
                  backgroundColor: canRunTransfer ? colors.primary : colors.divider,
                },
              ]}
              testID="run-transfer-button"
            >
              <Typography variant="body" weight="semibold" color="#FFFFFF">
                {running ? 'Transferring…' : 'Start transfer'}
              </Typography>
            </TouchableOpacity>
          </View>
        ) : null}

        {step === 'running' ? (
          <Card variant="filled" style={styles.messageCard}>
            <ActivityIndicator color={colors.primary} style={styles.loading} />
            <Typography variant="body" weight="medium" style={styles.centerText}>
              Preparing, exporting, and importing your package…
            </Typography>
            <Typography variant="footnote" color={colors.textSecondary} style={styles.centerText}>
              This usually takes a few seconds. Stay on this screen.
            </Typography>
          </Card>
        ) : null}

        {step === 'done' && successMessage ? (
          <Card variant="filled" style={styles.messageCard}>
            <IconBackgroundChip name="checkmark-circle-outline" size={IconSize.lg} style={styles.successIcon} />
            <Typography variant="title3" weight="semibold" style={styles.centerText}>
              Transfer complete
            </Typography>
            <Typography variant="body" color={colors.textSecondary} style={styles.centerText}>
              {successMessage}
            </Typography>
            <Typography variant="footnote" color={colors.textTertiary} style={styles.centerText}>
              You can revoke this permission anytime under Settings → Data sharing.
            </Typography>
          </Card>
        ) : null}

        {step === 'error' && errorMessage ? (
          <Card variant="filled" style={styles.messageCard}>
            <Typography variant="title3" weight="semibold" style={styles.centerText}>
              Transfer unavailable
            </Typography>
            <Typography variant="body" color={colors.textSecondary} style={styles.centerText}>
              {errorMessage}
            </Typography>
          </Card>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    padding: Spacing.base,
    paddingBottom: Layout.bottomTabBarClearance,
    gap: Spacing.md,
  },
  section: {
    gap: Spacing.md,
  },
  intro: {
    marginBottom: Spacing.xs,
  },
  loading: {
    paddingVertical: Spacing.lg,
    alignItems: 'center',
  },
  packageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: CornerRadius.lg,
    gap: Spacing.smd,
    marginBottom: Spacing.sm,
  },
  packageIcon: {
    width: 40,
    height: 40,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  packageText: {
    flex: 1,
    gap: Spacing.xxs,
  },
  messageCard: {
    alignItems: 'center',
    padding: Spacing.xl,
    borderRadius: CornerRadius.lg,
    gap: Spacing.sm,
  },
  successIcon: {
    width: 56,
    height: 56,
    borderRadius: CornerRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  centerText: {
    textAlign: 'center',
  },
  primaryAction: {
    marginTop: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: CornerRadius.md,
    alignItems: 'center',
  },
});
