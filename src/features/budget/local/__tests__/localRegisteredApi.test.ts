import {
  closeLocalBudgetSession,
  getLocalLedger,
  getLocalMemberId,
  openLocalBudgetSessionForTests,
} from '../engine';
import { localRegisteredApi } from '../savings/localRegisteredApi';
import { SAVINGS_LIMITS } from '../savings/savingsLimits';

describe('localRegisteredApi', () => {
  beforeEach(async () => {
    await openLocalBudgetSessionForTests({ userId: 'user-reg-1' });
  });

  afterEach(async () => {
    await closeLocalBudgetSession();
  });

  it('creates a TFSA account and computes room from starting room minus contributions', async () => {
    const householdId = getLocalLedger().household.id;
    const memberId = getLocalMemberId();
    const accountId = 'acct_tfsa_test';

    await localRegisteredApi.createAccount(householdId, {
      id: accountId,
      member_id: memberId,
      account_type: 'tfsa',
      starting_room_cents: 700000,
      balance_cents: 0,
    });

    await localRegisteredApi.addTransaction(householdId, accountId, {
      id: 'tx_contrib_1',
      type: 'contribution',
      amount_cents: 200000,
      transaction_date: '2025-03-15',
      tax_year: 2025,
    });

    const room = await localRegisteredApi.getRoom(householdId, accountId, 2025);
    expect(room.used).toBe(200000);
    expect(room.roomRemaining).toBe(500000);
    expect(room.annualLimit).toBe(SAVINGS_LIMITS[2025].tfsa);

    const { accounts } = await localRegisteredApi.listAccounts(householdId);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].balance_cents).toBe(200000);
  });

  it('builds pension overview grouped by member with totals', async () => {
    const householdId = getLocalLedger().household.id;
    const memberId = getLocalMemberId();

    await localRegisteredApi.createAccount(householdId, {
      id: 'acct_rrsp_1',
      member_id: memberId,
      account_type: 'rrsp',
      starting_room_cents: 3000000,
      balance_cents: 100000,
    });

    await localRegisteredApi.addTransaction(householdId, 'acct_rrsp_1', {
      id: 'tx_rrsp_1',
      type: 'contribution',
      amount_cents: 50000,
      transaction_date: '2025-06-01',
      tax_year: 2025,
    });

    const overview = await localRegisteredApi.getRegisteredOverview(householdId, 2025);
    expect(overview.year).toBe(2025);
    expect(overview.groups).toHaveLength(1);
    expect(overview.groups[0].memberId).toBe(memberId);
    expect(overview.totals.totalBalanceCents).toBe(150000);
    expect(overview.totals.totalContributedSelfCents).toBe(50000);
    expect(overview.totals.totalRoomRemainingCents).toBe(2950000);
  });

  it('upserts a member line and backfills monthly contributions', async () => {
    const householdId = getLocalLedger().household.id;
    const memberId = getLocalMemberId();

    const { account } = await localRegisteredApi.setMemberLine(householdId, {
      member_id: memberId,
      account_type: 'tfsa',
      room_cents: 700000,
      goal_cents: 700000,
    });
    expect(account).not.toBeNull();
    expect(account!.is_room_only).toBe(true);

    await localRegisteredApi.backfillMemberContributions(householdId, {
      member_id: memberId,
      account_type: 'tfsa',
      year: 2025,
      entries: [
        { month: 1, self_cents: 10000, employer_cents: 0 },
        { month: 2, self_cents: 15000, employer_cents: 5000 },
      ],
    });

    const { months } = await localRegisteredApi.getMemberMonthly(
      householdId,
      memberId,
      'tfsa',
      2025,
    );
    expect(months[0].selfCents).toBe(10000);
    expect(months[1].selfCents).toBe(15000);
    expect(months[1].employerCents).toBe(5000);

    const room = await localRegisteredApi.getRoom(householdId, account!.id, 2025);
    expect(room.used).toBe(30000);
    expect(room.roomRemaining).toBe(670000);
  });

  it('adds manual member contribution idempotently', async () => {
    const householdId = getLocalLedger().household.id;
    const memberId = getLocalMemberId();

    const first = await localRegisteredApi.addMemberContribution(householdId, {
      id: 'tx_member_manual',
      member_id: memberId,
      account_type: 'rrsp',
      amount_cents: 25000,
      transaction_date: '2025-04-10',
    });

    const second = await localRegisteredApi.addMemberContribution(householdId, {
      id: 'tx_member_manual',
      member_id: memberId,
      account_type: 'rrsp',
      amount_cents: 25000,
      transaction_date: '2025-04-10',
    });

    expect(second.account.balance_cents).toBe(first.account.balance_cents);
    expect(getLocalLedger().registeredTransactions).toHaveLength(1);
  });

  it('applies regular contribution once per month for full accounts', async () => {
    const householdId = getLocalLedger().household.id;
    const memberId = getLocalMemberId();

    const { account } = await localRegisteredApi.createAccount(householdId, {
      id: 'acct_regular',
      member_id: memberId,
      account_type: 'rrsp',
      regular_contribution_cents: 40000,
      balance_cents: 0,
    });

    const first = await localRegisteredApi.applyRegularContribution(householdId, account.id, {
      year: 2025,
      month: 5,
    });
    expect(first.created).toBe(true);
    expect(first.transaction?.amount_cents).toBe(40000);

    const second = await localRegisteredApi.applyRegularContribution(householdId, account.id, {
      year: 2025,
      month: 5,
    });
    expect(second.created).toBe(false);
    expect(getLocalLedger().registeredTransactions.filter((tx) => tx.kind === 'regular')).toHaveLength(1);
  });

  it('deletes account and cascades transactions', async () => {
    const householdId = getLocalLedger().household.id;

    await localRegisteredApi.createAccount(householdId, {
      id: 'acct_delete',
      account_type: 'fhsa',
      balance_cents: 0,
    });

    await localRegisteredApi.addTransaction(householdId, 'acct_delete', {
      id: 'tx_delete',
      type: 'contribution',
      amount_cents: 1000,
      transaction_date: '2025-01-01',
    });

    await localRegisteredApi.deleteAccount(householdId, 'acct_delete');
    const { accounts } = await localRegisteredApi.listAccounts(householdId);
    expect(accounts).toHaveLength(0);
    expect(getLocalLedger().registeredTransactions).toHaveLength(0);
  });
});
