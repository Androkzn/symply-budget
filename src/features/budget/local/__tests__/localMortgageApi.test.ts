import {
  closeLocalBudgetSession,
  getLocalLedger,
  openLocalBudgetSessionForTests,
} from '../engine';
import { localMortgageApi } from '../mortgage/localMortgageApi';

describe('localMortgageApi', () => {
  beforeEach(async () => {
    await openLocalBudgetSessionForTests({ userId: 'user-mtg-1' });
  });

  afterEach(async () => {
    await closeLocalBudgetSession();
  });

  it('creates a mortgage and projects summary + schedule offline', async () => {
    const householdId = getLocalLedger().household.id;
    const mortgage = await localMortgageApi.create(householdId, {
      nickname: 'Primary',
      lender: 'Local Bank',
      startDate: '2024-01-01',
      originalPrincipalCents: 400_000_00,
      originalAmortizationMonths: 300,
      termMonths: 60,
      rateType: 'fixed',
      compounding: 'semi_annual',
      nominalRateBps: 450,
      paymentFrequency: 'monthly',
    });

    expect(mortgage.original_principal_cents).toBe(400_000_00);
    expect(getLocalLedger().mortgageTerms).toHaveLength(1);

    const { mortgages } = await localMortgageApi.list(householdId);
    expect(mortgages).toHaveLength(1);
    expect(mortgages[0].nickname).toBe('Primary');
    expect(mortgages[0].currentBalanceCents).toBeLessThan(400_000_00);

    const summary = await localMortgageApi.getSummary(householdId, mortgage.id);
    expect(summary.scheduleAvailable).toBe(true);
    expect(summary.scheduledPaymentCents).toBeGreaterThan(0);
    expect(summary.paymentsTotal).toBe(300);
    expect(summary.currentBalanceCents).toBe(mortgages[0].currentBalanceCents);

    const schedule = await localMortgageApi.getSchedule(householdId, mortgage.id);
    expect(schedule.scheduleAvailable).toBe(true);
    expect(schedule.rows.length).toBe(300);
    expect(schedule.rows[schedule.rows.length - 1].balance).toBe(0);
  });

  it('updates nickname and removes mortgage', async () => {
    const householdId = getLocalLedger().household.id;
    const mortgage = await localMortgageApi.create(householdId, {
      nickname: 'Temp',
      startDate: '2025-06-01',
      originalPrincipalCents: 100_000_00,
      termMonths: 12,
      rateType: 'fixed',
      compounding: 'monthly',
      nominalRateBps: 500,
      paymentFrequency: 'monthly',
    });

    const updated = await localMortgageApi.update(householdId, mortgage.id, {
      nickname: 'Renamed',
    });
    expect(updated.nickname).toBe('Renamed');

    await localMortgageApi.remove(householdId, mortgage.id);
    const { mortgages } = await localMortgageApi.list(householdId);
    expect(mortgages).toHaveLength(0);
    expect(getLocalLedger().mortgageTerms).toHaveLength(0);
  });

  it('anchors balance and interest to uploaded statements', async () => {
    const householdId = getLocalLedger().household.id;
    const mortgage = await localMortgageApi.create(householdId, {
      nickname: 'Anchored',
      startDate: '2024-01-01',
      originalPrincipalCents: 400_000_00,
      originalAmortizationMonths: 300,
      termMonths: 60,
      rateType: 'fixed',
      compounding: 'semi_annual',
      nominalRateBps: 450,
      paymentFrequency: 'monthly',
    });

    await localMortgageApi.addStatement(householdId, mortgage.id, {
      statementDate: '2026-01-01',
      closingBalanceCents: 350_000_00,
      interestPaidCents: 50_000_00,
    });

    const summary = await localMortgageApi.getSummary(householdId, mortgage.id);
    expect(summary.paidToDate?.interestSource).toBe('actual');
    expect(summary.paidToDate?.statementsWithInterest).toBe(1);
    expect(summary.paidToDate?.throughDate).toBe('2026-01-01');
    expect(summary.balanceAsOf).toBe('2026-01-01');
    expect(summary.balanceStatus).toBe('estimated');
    expect(summary.currentBalanceCents).toBeLessThan(350_000_00);

    const { mortgages } = await localMortgageApi.list(householdId);
    expect(mortgages[0].currentBalanceCents).toBe(summary.currentBalanceCents);
  });
});
