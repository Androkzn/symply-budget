/**
 * Regression guard for a blank-app bug found by the two-member sync E2E
 * (2026-08-10).
 *
 * `+not-found` deliberately renders nothing for a dev-only `e2e-*` deep link
 * while signed in, so an observability link fired mid-flow does not bounce the
 * app off the screen under test. It relied on `router.back()` to leave — but
 * after a dev-client reload the e2e link IS the initial URL, so there is no
 * history, `back()` is a no-op, and the route rendered null forever. The app
 * stayed permanently blank: root view plus nothing, while JS kept running and
 * making network calls. Every Maestro flow that opens an e2e-* link and then
 * reconnects Metro could hit it.
 */
import { Redirect, router, usePathname } from 'expo-router';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { useAuthStore } from '@stores/authStore';

import NotFoundRedirect from '../+not-found';

jest.mock('@stores/authStore', () => ({
  useAuthStore: jest.fn(),
}));

// jest.setup.js stubs expo-router with plain functions (`Redirect: () => null`),
// which cannot record calls. Override locally so the redirect is assertable.
jest.mock('expo-router', () => ({
  Redirect: jest.fn(() => null),
  usePathname: jest.fn(),
  router: { canGoBack: jest.fn(), back: jest.fn() },
}));

const mockedUsePathname = usePathname as unknown as jest.Mock;
const mockedUseAuthStore = useAuthStore as unknown as jest.Mock;
const mockedRedirect = Redirect as unknown as jest.Mock;

function renderRoute() {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<NotFoundRedirect />);
  });
  // @ts-expect-error assigned inside act
  return tree;
}

describe('+not-found — e2e-* deep links', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseAuthStore.mockImplementation((selector: (s: unknown) => unknown) =>
      selector({ isAuthenticated: true }),
    );
    mockedRedirect.mockImplementation(() => null);
  });

  it('goes back when there is a screen under test to return to', () => {
    mockedUsePathname.mockReturnValue('/e2e-block-network');
    (router.canGoBack as jest.Mock).mockReturnValue(true);

    renderRoute();

    expect(router.back).toHaveBeenCalled();
    expect(mockedRedirect).not.toHaveBeenCalled();
  });

  it('redirects home instead of rendering nothing when there is no history', () => {
    // The dev-client reload case: the e2e link is the initial URL.
    mockedUsePathname.mockReturnValue('/e2e-logout');
    (router.canGoBack as jest.Mock).mockReturnValue(false);

    renderRoute();

    expect(router.back).not.toHaveBeenCalled();
    // The whole point: it must NOT stay on a null render.
    expect(mockedRedirect).toHaveBeenCalled();
    expect(mockedRedirect.mock.calls[0][0]).toMatchObject({ href: '/' });
  });

  it('redirects home for a non-e2e unmatched route', () => {
    mockedUsePathname.mockReturnValue('/some/stale/link');
    (router.canGoBack as jest.Mock).mockReturnValue(true);

    renderRoute();

    expect(router.back).not.toHaveBeenCalled();
    expect(mockedRedirect).toHaveBeenCalled();
  });

  it('redirects home for an e2e link when signed out', () => {
    mockedUseAuthStore.mockImplementation((selector: (s: unknown) => unknown) =>
      selector({ isAuthenticated: false }),
    );
    mockedUsePathname.mockReturnValue('/e2e-login');
    (router.canGoBack as jest.Mock).mockReturnValue(false);

    renderRoute();

    expect(mockedRedirect).toHaveBeenCalled();
  });
});
