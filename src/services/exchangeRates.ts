/**
 * Reference exchange rates for receipt import.
 *
 * ## Why this talks to the internet at all, and what it does not send
 *
 * The rest of Budget is local-first: the ledger lives on the device and receipt
 * images go straight from the phone to the member's own AI provider. A rate is
 * the one input that genuinely is not on the device — nobody can derive
 * USD→CAD from a phone — so it is fetched, and the request is deliberately the
 * least revealing one possible: a currency PAIR and nothing else. No household,
 * no member, no amount, no vendor, no image. "Somebody wants to know what a US
 * dollar is worth today" is the entire disclosure, and it is the same request
 * every user of that endpoint makes.
 *
 * The provider is the ECB's published reference rates via Frankfurter — no API
 * key, so nothing key-shaped ships in the bundle (the reason `@services/
 * geocoding` uses the OS geocoder rather than a hosted one). All eleven
 * supported currencies are on the ECB's list.
 *
 * ## Failure is not an error state
 *
 * Every path here returns null rather than throwing, because a member on a
 * plane with a receipt from the airport still has to be able to import it. The
 * rate field on the scan screen is always editable and a hand-typed rate is a
 * first-class answer — this service only saves them the typing. That is also
 * why a stale cached rate is offered rather than withheld: yesterday's ECB rate
 * is a far better default than a blank box, and the member can see its date and
 * overrule it.
 */
import type { CurrencyCode } from '@config/currencies';
import { storageHelpers } from '@services/storage';
import { isUsableRate, type ConversionRate } from '@utils/currencyConversion';

export const FX_CACHE_KEY = 'budget.fxRates.v1';

/**
 * How long a cached rate is served without re-fetching.
 *
 * The ECB publishes once per working day, so anything under a day is already
 * finer-grained than the source. Twelve hours means a member who scans in the
 * morning and again after dinner pays for one lookup, and a rate can never be
 * more than a publication behind while the device has been online.
 */
export const FX_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/** A lookup that hangs is worse than one that fails — the member is waiting. */
const FX_TIMEOUT_MS = 6000;

const FX_ENDPOINT = 'https://api.frankfurter.dev/v1/latest';

interface CachedRate {
  rate: number;
  /** ECB reference date the rate was published for (YYYY-MM-DD). */
  asOf: string | null;
  /** When we fetched it, for the TTL. */
  fetchedAt: number;
}

type RateCache = Record<string, CachedRate>;

const pairKey = (from: CurrencyCode, to: CurrencyCode) => `${from}>${to}`;

async function readCache(): Promise<RateCache> {
  const stored = await storageHelpers.getObject<RateCache>(FX_CACHE_KEY);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
  return stored;
}

async function writeCache(key: string, entry: CachedRate): Promise<void> {
  try {
    const cache = await readCache();
    await storageHelpers.setObject(FX_CACHE_KEY, { ...cache, [key]: entry });
  } catch {
    // A cache that cannot be written costs a re-fetch, nothing more.
  }
}

/** The pair straight from the provider, or null if it could not be read. */
async function fetchPair(from: CurrencyCode, to: CurrencyCode): Promise<CachedRate | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FX_TIMEOUT_MS);
  try {
    const response = await fetch(`${FX_ENDPOINT}?base=${from}&symbols=${to}`, {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { date?: string; rates?: Record<string, number> };
    const rate = body?.rates?.[to];
    if (!isUsableRate(rate)) return null;
    return {
      rate,
      asOf: typeof body.date === 'string' ? body.date : null,
      fetchedAt: Date.now(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Today's rate for a pair, or the best one available.
 *
 * Order: a fresh cache hit, then the network, then a STALE cache hit. The last
 * rung is the offline case and is the reason a rate carries its `asOf` date all
 * the way to the screen — the member is shown what it is and when it is from,
 * rather than being told the lookup failed and left with an empty field.
 *
 * Returns null only when there is no rate at all: never fetched this pair, and
 * no network now.
 */
export async function getExchangeRate(
  from: CurrencyCode,
  to: CurrencyCode,
): Promise<ConversionRate | null> {
  if (from === to) return { from, to, rate: 1, asOf: null, source: 'fetched' };

  const key = pairKey(from, to);
  const cache = await readCache();
  const cached = cache[key];
  if (cached && Date.now() - cached.fetchedAt < FX_CACHE_TTL_MS && isUsableRate(cached.rate)) {
    return { from, to, rate: cached.rate, asOf: cached.asOf, source: 'fetched' };
  }

  const fresh = await fetchPair(from, to);
  if (fresh) {
    await writeCache(key, fresh);
    return { from, to, rate: fresh.rate, asOf: fresh.asOf, source: 'fetched' };
  }

  if (cached && isUsableRate(cached.rate)) {
    return { from, to, rate: cached.rate, asOf: cached.asOf, source: 'fetched' };
  }
  return null;
}
