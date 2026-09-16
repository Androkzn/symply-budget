/**
 * "Is this connection one the member pays for by the megabyte?"
 *
 * This is nine lines of code with a genuinely asymmetric failure cost, which is
 * why it earns a test file of its own.
 *
 *  - **False negative** (say unmetered when metered): the app auto-fetches a
 *    screenful of sealed attachments over cellular. Blobs are sealed whole —
 *    there is no thumbnail to fetch instead — so this is a real bill for a real
 *    person.
 *  - **False positive** (say metered when not): every image becomes a manual
 *    tap. Annoying, recoverable, cheap.
 *
 * So the module leans toward reporting metered — EXCEPT when NetInfo itself
 * throws, where it deliberately returns `false`. That inversion is the subtle
 * part and the reason this file exists: a permanently broken probe would
 * otherwise turn every attachment in the app into a manual tap forever, which
 * is a worse and more permanent outcome than one unexpected download.
 *
 * The tethering case is not incidental either. iOS reports Low Data Mode and
 * personal hotspots through `isConnectionExpensive` while `type` still reads
 * `wifi`, so checking `type === 'cellular'` alone misses exactly the members
 * most likely to care.
 */
import NetInfo from '@react-native-community/netinfo';

import { isMeteredConnection } from '../meteredConnection';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: jest.fn() },
}));

const mockFetch = NetInfo.fetch as unknown as jest.Mock;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('isMeteredConnection', () => {
  it('reports metered on cellular', async () => {
    mockFetch.mockResolvedValue({ type: 'cellular', details: {} });
    await expect(isMeteredConnection()).resolves.toBe(true);
  });

  it('reports metered on an EXPENSIVE wifi — the tethering case', async () => {
    // Low Data Mode and personal hotspots surface here while `type` reads
    // `wifi`. A `type === 'cellular'` check alone would auto-download over
    // someone's phone hotspot.
    mockFetch.mockResolvedValue({ type: 'wifi', details: { isConnectionExpensive: true } });
    await expect(isMeteredConnection()).resolves.toBe(true);
  });

  it('reports unmetered on ordinary wifi', async () => {
    mockFetch.mockResolvedValue({ type: 'wifi', details: { isConnectionExpensive: false } });
    await expect(isMeteredConnection()).resolves.toBe(false);
  });

  it('treats a MISSING expensive flag as unmetered, not as truthy', async () => {
    // `details.isConnectionExpensive` is compared with `=== true` precisely so
    // `undefined` does not become "metered" by accident.
    mockFetch.mockResolvedValue({ type: 'wifi', details: {} });
    await expect(isMeteredConnection()).resolves.toBe(false);
  });

  it('FAILS OPEN when NetInfo throws — the deliberate inversion', async () => {
    // Everywhere else this module prefers "metered". Here it must not: a probe
    // that is permanently broken would make every attachment a manual tap
    // forever, which is worse than one unexpected download.
    mockFetch.mockRejectedValue(new Error('NetInfo unavailable'));
    await expect(isMeteredConnection()).resolves.toBe(false);
  });

  it('survives a null state without throwing into the caller', async () => {
    // `HouseBlobImage` calls this during render-time policy resolution; an
    // exception escaping here would take the image component down rather than
    // degrade to a download button.
    mockFetch.mockResolvedValue(null);
    await expect(isMeteredConnection()).resolves.toBe(false);
  });

  it('does not cache — connection type changes between attachments', async () => {
    // A member walks out of wifi range mid-screen. A memoised answer would keep
    // auto-downloading on cellular for the rest of the session.
    mockFetch.mockResolvedValueOnce({ type: 'wifi', details: {} });
    mockFetch.mockResolvedValueOnce({ type: 'cellular', details: {} });
    await expect(isMeteredConnection()).resolves.toBe(false);
    await expect(isMeteredConnection()).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
