/**
 * Detects which sibling Symply apps are installed on the device by probing each
 * brand's URL scheme with `Linking.canOpenURL('<scheme>://')`.
 *
 * iOS caveat: `canOpenURL` only returns true for schemes listed in
 * `LSApplicationQueriesSchemes` (app.config.ts). Without that entry — or on a
 * build predating it — every probe resolves false, so the grid degrades to a
 * manual "I've installed it" confirmation rather than a wrong "not installed"
 * with no recovery. Re-probes whenever the app returns to the foreground, so a
 * fresh install (done in the App Store, then back to us) is picked up.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus, Linking } from 'react-native';

export type InstalledMap = Record<string, boolean>;

type SchemeEntry = { id: string; scheme: string };

async function probe(entries: SchemeEntry[]): Promise<InstalledMap> {
  const results = await Promise.all(
    entries.map(async ({ id, scheme }) => {
      try {
        const canOpen = await Linking.canOpenURL(`${scheme}://`);
        return [id, canOpen] as const;
      } catch {
        return [id, false] as const;
      }
    }),
  );
  return Object.fromEntries(results);
}

export function useInstalledApps(entries: SchemeEntry[]) {
  const [installed, setInstalled] = useState<InstalledMap>({});
  const [loading, setLoading] = useState(true);

  // Keep the latest entries in a ref so the AppState listener never goes stale
  // yet does not need re-subscribing on every render.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const recheck = useCallback(async () => {
    const map = await probe(entriesRef.current);
    setInstalled(map);
    setLoading(false);
  }, []);

  useEffect(() => {
    void recheck();
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') void recheck();
    });
    return () => sub.remove();
  }, [recheck]);

  return { installed, loading, recheck };
}
