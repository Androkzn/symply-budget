/**
 * How `navigateToBudgetInvite` hands over its destination.
 *
 * `notificationRouting.budgetInvite.test.ts` proves the tap RESOLVES to this
 * helper; it stubs `@services/navigation`, so it cannot see whether the member
 * ever arrives. They did not: verified on Budget-A, tapping "Lisa is waiting to
 * join" closed the notification list and stopped on Home.
 *
 * Two things have to hold, and only together:
 *
 *  - the handover goes through `Linking`, not `router.push` — an imperative
 *    push cannot deliver new search params to a tab that is already mounted,
 *    which is the state every notification tap arrives in;
 *  - it aims at the tab that actually hosts the Budget stack. On this brand
 *    `/budget` only `<Redirect>`s to Home, and that redirect is itself an
 *    imperative navigation, so routing through it loses the destination again.
 */

jest.unmock('@services/navigation');

jest.mock('expo-linking', () => ({
  __esModule: true,
  createURL: jest.fn(
    (pathname: string, options?: { queryParams?: Record<string, string> }) => {
      const qs = new URLSearchParams(options?.queryParams ?? {}).toString();
      return `simplebudget://${pathname}${qs ? `?${qs}` : ''}`;
    },
  ),
  openURL: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('expo-router', () => ({
  __esModule: true,
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

jest.mock('expo-router/react-navigation', () => ({
  __esModule: true,
  createNavigationContainerRef: () => ({
    isReady: () => false,
    navigate: jest.fn(),
    getCurrentRoute: () => undefined,
  }),
}));

function load(budget: { off?: boolean; brand?: boolean }) {
  let navigateToBudgetInvite!: () => void;
  let openURL!: jest.Mock;
  let push!: jest.Mock;
  jest.isolateModules(() => {
    jest.doMock('@features/budget', () => ({
      __esModule: true,
      isBudgetBrand: () => budget.brand ?? true,
      isBudgetOff: () => budget.off ?? false,
      isFullBudget: () => !(budget.off ?? false),
      sanitizeBudgetNavigation: (nav: unknown) => nav,
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- reload under isolateModules with the per-brand @features/budget mock
    navigateToBudgetInvite = require('../navigation').navigateToBudgetInvite;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- same isolate scope → the module instances the helper called
    openURL = require('expo-linking').openURL as jest.Mock;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- same isolate scope
    push = require('expo-router').router.push as jest.Mock;
  });
  return { navigateToBudgetInvite, openURL, push };
}

describe('navigateToBudgetInvite', () => {
  beforeEach(() => jest.clearAllMocks());

  it('hands the destination to Linking rather than pushing it', () => {
    const { navigateToBudgetInvite, openURL, push } = load({});
    navigateToBudgetInvite();
    expect(openURL).toHaveBeenCalledTimes(1);
    // A push here is the bug: it moves the tab and drops `screen=`.
    expect(push).not.toHaveBeenCalled();
  });

  it('aims at the tab that hosts the Budget stack, not the redirect-only /budget', () => {
    const { navigateToBudgetInvite, openURL } = load({ brand: true });
    navigateToBudgetInvite();
    const url = openURL.mock.calls[0][0] as string;
    expect(url).toContain('screen=BudgetInvite');
    expect(url).not.toContain('/budget');
  });

  it('keeps the real /budget tab for brands that still have one', () => {
    const { navigateToBudgetInvite, openURL } = load({ brand: false });
    navigateToBudgetInvite();
    expect(openURL.mock.calls[0][0]).toContain('/budget');
  });

  it('carries a fresh nonce so a second tap is not de-duped away', () => {
    // `BudgetNavigator` keys on `screen:itemId:navNonce`. Without a distinct
    // nonce the second "someone is waiting" tap reads as already-handled.
    const { navigateToBudgetInvite, openURL } = load({});
    navigateToBudgetInvite();
    navigateToBudgetInvite();
    const [first, second] = openURL.mock.calls.map((c) => c[0] as string);
    expect(first).toContain('navNonce=');
    expect(second).toContain('navNonce=');
  });

  it('sends the tap home on a brand without Budget', () => {
    const { navigateToBudgetInvite, openURL, push } = load({ off: true });
    navigateToBudgetInvite();
    expect(openURL).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/');
  });
});
