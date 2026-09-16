/**
 * institution-logos.ts — curated popular Canadian financial institutions for the
 * registered/pension account picker, each with a brand color + short monogram so
 * the UI can render a NORMALIZED brand badge (uniform circle) instead of a bare
 * text field. Custom (user-typed) institutions get a deterministic brand-neutral
 * badge derived from the name, so every row looks consistent.
 *
 * (Real wordmark PNGs can be layered on later via the same bundling pattern as
 * `@features/utilities/providers/provider-logos` — this monogram system is the reliable default.)
 */

export interface InstitutionInfo {
  /** Display name (also the value stored on the account). */
  name: string;
  /** 1–3 char monogram drawn on the badge. */
  short: string;
  /** Brand color (badge background). */
  color: string;
}

/** Curated list — banks, online brokers/robo-advisors, credit unions, and insurers. */
export const POPULAR_INSTITUTIONS: InstitutionInfo[] = [
  { name: 'RBC', short: 'RBC', color: '#005DAA' },
  { name: 'TD', short: 'TD', color: '#2E8B2E' },
  { name: 'Scotiabank', short: 'S', color: '#EC111A' },
  { name: 'BMO', short: 'BMO', color: '#0079C1' },
  { name: 'CIBC', short: 'C', color: '#B4131A' },
  { name: 'National Bank', short: 'NB', color: '#E31937' },
  { name: 'Tangerine', short: 'T', color: '#F7941E' },
  { name: 'Simplii Financial', short: 'S', color: '#E4002B' },
  { name: 'EQ Bank', short: 'EQ', color: '#5B2A86' },
  { name: 'HSBC Canada', short: 'H', color: '#DB0011' },
  { name: 'ATB Financial', short: 'ATB', color: '#0075C9' },
  { name: 'Wealthsimple', short: 'W', color: '#1A1A1A' },
  { name: 'Questrade', short: 'Q', color: '#00A4E4' },
  { name: 'Qtrade', short: 'Q', color: '#00539B' },
  { name: 'CI Direct Investing', short: 'CI', color: '#003DA5' },
  { name: 'Scotia iTRADE', short: 'iT', color: '#EC111A' },
  { name: 'TD Direct Investing', short: 'TD', color: '#2E8B2E' },
  { name: 'RBC Direct Investing', short: 'RBC', color: '#005DAA' },
  { name: 'BMO InvestorLine', short: 'BMO', color: '#0079C1' },
  { name: "CIBC Investor's Edge", short: 'C', color: '#B4131A' },
  { name: 'Desjardins', short: 'D', color: '#00874E' },
  { name: 'Vancity', short: 'V', color: '#DA291C' },
  { name: 'Coast Capital', short: 'CC', color: '#00539B' },
  { name: 'Servus Credit Union', short: 'S', color: '#009CA6' },
  { name: 'Meridian', short: 'M', color: '#00A0A0' },
  { name: 'Sun Life', short: 'SL', color: '#FDB913' },
  { name: 'Manulife', short: 'M', color: '#00A758' },
  { name: 'Canada Life', short: 'CL', color: '#C8102E' },
  { name: 'iA Financial', short: 'iA', color: '#003DA5' },
  { name: 'IG Wealth Management', short: 'IG', color: '#C8102E' },
  { name: 'Fidelity', short: 'F', color: '#3C8A2E' },
  { name: 'Vanguard', short: 'V', color: '#96151D' },
  { name: 'Edward Jones', short: 'EJ', color: '#005EB8' },
  { name: 'Raymond James', short: 'RJ', color: '#003DA5' },
];

/** Neutral palette used to color a deterministic badge for custom institutions. */
const CUSTOM_PALETTE = ['#4A6FA5', '#5A7D5A', '#8A5A8A', '#A56A4A', '#4A8A8A', '#7A6AA5'];

const byLowerName = new Map(POPULAR_INSTITUTIONS.map((i) => [i.name.toLowerCase(), i]));

/** Initials from a free-text name, e.g. "Coast Capital" → "CC", "Wealthsimple" → "W". */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Stable index into CUSTOM_PALETTE from a name (so the same custom name keeps its color). */
function hashIndex(name: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % mod;
}

/** Resolve brand info for any institution name — a curated entry, or a derived custom badge. */
export function getInstitutionInfo(name: string | null | undefined): InstitutionInfo | null {
  if (!name || !name.trim()) return null;
  const match = byLowerName.get(name.trim().toLowerCase());
  if (match) return match;
  return {
    name: name.trim(),
    short: initialsOf(name),
    color: CUSTOM_PALETTE[hashIndex(name.trim().toLowerCase(), CUSTOM_PALETTE.length)],
  };
}

/**
 * Readable text color for a badge background, by luminance — keeps the monogram
 * legible on both dark brand colors (→ white) and light ones (→ near-black).
 */
export function badgeTextColor(hex: string): string {
  const c = hex.replace('#', '');
  if (c.length < 6) return '#FFFFFF';
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 165 ? '#1A1A1A' : '#FFFFFF';
}
