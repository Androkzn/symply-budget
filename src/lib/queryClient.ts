/**
 * Shared React Query client (Track A / A7).
 * Imported by app root and non-React refresh helpers (e.g. movement feed).
 *
 * Connectivity is fed into `onlineManager` from `useNetworkStatus` (the single
 * NetInfo subscription, mounted once via `NetworkBlockOverlay` at the app
 * root) rather than a second subscription wired here — this module is
 * imported very widely (any screen/hook touching React Query), and a
 * module-scope `NetInfo.addEventListener` call throws under Jest/Node in any
 * test that doesn't happen to mock the native module.
 */
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
    },
  },
});
