import type { ImageSourcePropType } from 'react-native';

import { badgeTextColor } from '@utils/institution-logos';

import { LENDER_LOGO_ASSETS } from './lender-logos.generated';

/**
 * lender-logos.ts — curated Canadian mortgage lenders (banks, monolines, credit
 * unions, digital lenders) for the Budget mortgage lender picker. Each entry has
 * a `slug` (asset key), a monogram `short`, a brand `color`, and optional
 * `aliases` so common spellings ("TD Bank", "Royal Bank") resolve to the same
 * lender.
 *
 * Rendering is two-tier (`<LenderLogo>`): if a size-normalized wordmark PNG has
 * been bundled for the slug (via `scripts/normalize-lender-logos.mjs` →
 * `lender-logos.generated.ts`), the real logo renders; otherwise a branded
 * monogram tile does. Custom (user-typed) lenders always get a deterministic
 * neutral monogram, so every row reads consistently.
 *
 * The stored value on the mortgage is the plain display `name` (free text, max
 * 100 chars) — no schema/enum change; the picker is purely a value selector.
 *
 * (Same bundling pattern as `@features/utilities/providers/provider-logos`; monograms borrowed from
 * `@utils/institution-logos`.)
 */

export interface LenderInfo {
  /** Display name — also the value stored on the mortgage. */
  name: string;
  /** 1–4 char monogram drawn on the fallback badge. */
  short: string;
  /** Brand color (monogram badge background). */
  color: string;
  /** Kebab-case asset key for a bundled logo PNG. */
  slug: string;
  /** Alternate spellings that resolve to this lender. */
  aliases?: string[];
}

/**
 * Curated list — the lenders Canadians most commonly hold a mortgage with.
 * Colors are indicative tile colors for the monogram fallback (not official
 * brand specs). Real wordmarks layer on via the bundling pipeline.
 */
export const POPULAR_LENDERS: LenderInfo[] = [
  { name: 'TD', slug: 'td', short: 'TD', color: '#2E8B2E', aliases: ['TD Bank', 'TD Canada Trust'] },
  { name: 'RBC', slug: 'rbc', short: 'RBC', color: '#005DAA', aliases: ['Royal Bank', 'Royal Bank of Canada'] },
  { name: 'Scotiabank', slug: 'scotiabank', short: 'S', color: '#EC111A', aliases: ['Scotia', 'Bank of Nova Scotia'] },
  { name: 'BMO', slug: 'bmo', short: 'BMO', color: '#0079C1', aliases: ['Bank of Montreal'] },
  { name: 'CIBC', slug: 'cibc', short: 'C', color: '#B4131A', aliases: ['Canadian Imperial Bank of Commerce'] },
  { name: 'National Bank', slug: 'national-bank', short: 'NB', color: '#E31937', aliases: ['Banque Nationale', 'BNC'] },
  { name: 'Desjardins', slug: 'desjardins', short: 'D', color: '#00874E', aliases: ['Caisse Desjardins'] },
  { name: 'HSBC Canada', slug: 'hsbc', short: 'H', color: '#DB0011', aliases: ['HSBC'] },
  { name: 'Tangerine', slug: 'tangerine', short: 'T', color: '#F7941E' },
  { name: 'Simplii Financial', slug: 'simplii', short: 'S', color: '#E4002B', aliases: ['Simplii'] },
  { name: 'Equitable Bank', slug: 'equitable-bank', short: 'EQ', color: '#00539B', aliases: ['EQ Bank', 'Equitable'] },
  { name: 'Manulife Bank', slug: 'manulife', short: 'M', color: '#00A758', aliases: ['Manulife'] },
  { name: 'First National', slug: 'first-national', short: 'FN', color: '#003DA5', aliases: ['First National Financial'] },
  { name: 'MCAP', slug: 'mcap', short: 'M', color: '#5B2A86' },
  { name: 'CMLS Financial', slug: 'cmls', short: 'CM', color: '#00539B', aliases: ['CMLS'] },
  { name: 'Merix Financial', slug: 'merix', short: 'MX', color: '#0075C9', aliases: ['Merix'] },
  { name: 'RFA', slug: 'rfa', short: 'RFA', color: '#1A1A1A', aliases: ['RFA Mortgage', 'Radius Financial'] },
  { name: 'Home Trust', slug: 'home-trust', short: 'HT', color: '#E31937', aliases: ['Home Bank', 'Home Trust Company'] },
  { name: 'B2B Bank', slug: 'b2b-bank', short: 'B2B', color: '#004B87' },
  { name: 'Laurentian Bank', slug: 'laurentian', short: 'LB', color: '#00558C', aliases: ['Laurentian'] },
  { name: 'ATB Financial', slug: 'atb', short: 'ATB', color: '#0075C9', aliases: ['ATB'] },
  { name: 'Motusbank', slug: 'motusbank', short: 'M', color: '#00A0DF', aliases: ['Motus Bank'] },
  { name: 'Meridian', slug: 'meridian', short: 'M', color: '#00A0A0', aliases: ['Meridian Credit Union'] },
  { name: 'Vancity', slug: 'vancity', short: 'V', color: '#DA291C' },
  { name: 'Coast Capital', slug: 'coast-capital', short: 'CC', color: '#00539B', aliases: ['Coast Capital Savings'] },
  { name: 'Servus Credit Union', slug: 'servus', short: 'S', color: '#009CA6', aliases: ['Servus'] },
  { name: 'DUCA', slug: 'duca', short: 'DU', color: '#E4002B', aliases: ['DUCA Credit Union'] },
  { name: 'Alterna Savings', slug: 'alterna', short: 'A', color: '#0071CE', aliases: ['Alterna'] },
  { name: 'nesto', slug: 'nesto', short: 'N', color: '#0B1F3A' },
  { name: 'Neo Financial', slug: 'neo', short: 'N', color: '#1A1A1A', aliases: ['Neo'] },
];

/** Neutral palette used to color a deterministic badge for custom lenders. */
const CUSTOM_PALETTE = ['#4A6FA5', '#5A7D5A', '#8A5A8A', '#A56A4A', '#4A8A8A', '#7A6AA5'];

/** Lookup by lowercased display name AND every alias → the curated entry. */
const lenderByKey = new Map<string, LenderInfo>();
for (const l of POPULAR_LENDERS) {
  lenderByKey.set(l.name.toLowerCase(), l);
  for (const a of l.aliases ?? []) lenderByKey.set(a.toLowerCase(), l);
}

/** Initials from a free-text name, e.g. "Home Capital" → "HC", "Pine" → "PI". */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Stable index into CUSTOM_PALETTE from a name (same custom name keeps its color). */
function hashIndex(name: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % mod;
}

/** The curated lender for a name/alias, or `null` if it's a custom (unknown) one. */
export function matchLender(name: string | null | undefined): LenderInfo | null {
  if (!name || !name.trim()) return null;
  return lenderByKey.get(name.trim().toLowerCase()) ?? null;
}

/** Whether a query hits a curated lender by name, alias, or monogram. */
export function lenderMatchesQuery(lender: LenderInfo, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (lender.name.toLowerCase().includes(q)) return true;
  if (lender.short.toLowerCase().includes(q)) return true;
  return (lender.aliases ?? []).some((a) => a.toLowerCase().includes(q));
}

/** Resolve brand info for any lender name — a curated entry, or a derived custom badge. */
export function getLenderInfo(name: string | null | undefined): LenderInfo | null {
  if (!name || !name.trim()) return null;
  const match = matchLender(name);
  if (match) return match;
  const trimmed = name.trim();
  return {
    name: trimmed,
    short: initialsOf(trimmed),
    color: CUSTOM_PALETTE[hashIndex(trimmed.toLowerCase(), CUSTOM_PALETTE.length)],
    slug: '',
  };
}

/**
 * Bundled wordmark logo for a lender name, or `undefined` when none is bundled
 * (→ caller falls back to the monogram badge). Only curated lenders can have a
 * real logo; custom names never do.
 */
export function getLenderLogo(name: string | null | undefined): ImageSourcePropType | undefined {
  const entry = matchLender(name);
  if (!entry) return undefined;
  return LENDER_LOGO_ASSETS[entry.slug];
}

export { badgeTextColor };
