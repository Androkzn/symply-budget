import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import * as FileSystem from 'expo-file-system/legacy';
import { useCallback } from 'react';

import type { HouseBlobDescriptor } from '@features/house/local/blobs';
import { isHouseLocalFirst } from '@features/house/local/flag';
import { createHouseLocalProxy } from '@features/house/local/localApiProxy';
import { useAuthStore } from '@stores/authStore';
import type {
  HomeProjectAccessGrant,
  HomeProjectAccessView,
  HomeProjectRole,
  HomeProjectVisibility,
  SurfaceScaleBrief,
} from '@symply/contracts';
import {
  normalizeAttachmentImage,
  normalizedAttachmentFilename,
} from '@utils/attachmentImage';
import { formatMoney } from '@utils/money';

import { apiClient } from './client';

export interface HomeProject {
  id: string;
  household_id: string;
  title: string;
  type: string;
  template_key: string | null;
  status: string;
  /**
   * `'draft' | 'published'` (migration 0163) — orthogonal to `status`, which is
   * where the WORK is. A draft is private to `created_by`: no other member
   * lists it, opens it, or is notified about it. Carried by BOTH backends —
   * the Worker's `listProjects` is a bare `.select()`, and the ledger row IS
   * this DTO.
   *
   * Optional because rows written before 0163 have no value; every reader must
   * go through `normalizeHomeProjectVisibility`, which reads absent as
   * `published` — the behaviour those rows already had.
   */
  visibility?: string | null;
  /**
   * `'owner' | 'viewer'` — the role a household member with no explicit grant
   * gets on this project. Absent reads as `owner`, which is what every member
   * had before per-project roles existed.
   */
  default_role?: string | null;
  /**
   * `[{ user_id, role }]` as stored JSON — explicit per-member overrides only,
   * null when there are none. Never parsed by hand: `parseHomeProjectAccessGrants`
   * in `@symply/contracts` is the single reader, shared with the Worker.
   */
  access_json?: string | null;
  /**
   * The CALLER's effective role, resolved by whichever backend answered. Same
   * fail-open rule as `HomeProjectHub.my_role` — see there.
   */
  my_role?: HomeProjectRole;
  summary: string | null;
  goals: string | null;
  constraints: string | null;
  target_budget_cents: number | null;
  currency: string;
  contingency_pct: number;
  target_start_at: string | null;
  target_end_at: string | null;
  cover_attachment_id: string | null;
  /**
   * Resolved by `list` so the card can render a cover without fetching a hub per
   * row. The two backends address the bytes differently and neither can render
   * the other's — a server-backed row carries `cover_url`, a local-first row
   * carries `cover_blob`, the sealed descriptor `HouseBlobImage` opens. Both are
   * null for a project with no cover, which is the placeholder case.
   */
  cover_url?: string | null;
  cover_blob?: HouseBlobDescriptor | null;
  /**
   * The project's own jobs, as stored JSON — `["task_a","task_b"]`, null when
   * there are none (migration 0170).
   *
   * Replaced the `home_project_tasks` join table, which had no primary key and
   * so could not be ledgered: that is why `listTasks` / `linkTask` /
   * `createTask` refused on a local-first household until 0170, and why the
   * Smart Project wizard's "Tasks" tick-box shipped disabled.
   *
   * Never parsed by hand — `parseHomeProjectLinkedTaskIds` in
   * `@symply/contracts` is the single reader, shared with the Worker, exactly
   * as `access_json` goes through `parseHomeProjectAccessGrants`.
   *
   * Optional because rows written before 0170 have no value, and a project with
   * no linked tasks stores null rather than `'[]'`.
   */
  linked_task_ids?: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BudgetRollups {
  estimate_total: number;
  actual_total: number;
  contingency_cents: number;
  target_budget_cents: number | null;
  budget_health: 'ok' | 'watch' | 'over';
}

/** One member-facing spec chip on an option card. */
export interface MaterialSpec {
  label: string;
  value: string;
}

/** 'm2' | 'sqft' — the only two units any area in this feature is expressed in. */
export type AreaUnit = 'm2' | 'sqft';

export interface HomeProjectSelection {
  id: string;
  project_id: string;
  name: string;
  category: string;
  status: string;
  qty: number;
  unit: string | null;
  unit_price_cents: number | null;
  vendor: string | null;
  product_url: string | null;
  notes: string | null;
  /** NULL = a standalone selection rather than one option among several. */
  option_group_id: string | null;
  brand: string | null;
  sku: string | null;
  /** The vendor's photo. The R2 attachment, when it exists, is preferred. */
  image_url: string | null;
  coverage_per_unit: number | null;
  coverage_unit: string | null;
  /** JSON `[{label, value}]`. Parse with `parseSpecs`. */
  specs_json: string | null;
  /**
   * '#rrggbb', lowercase — the dominant product colour (migration 0164).
   *
   * Shared, owned by nobody: the surface preview draws it as the fallback fill
   * before a texture loads, and the material card draws it as the swatch that
   * stands in for a missing photo. Paint is the case that needs it — a colour
   * IS the product, and shops rarely publish a photo worth showing.
   */
  color_hex: string | null;
  /**
   * The rest of what migration 0164 stores about how this material LOOKS, and
   * the reason it is stored at all: `materialFromSelection` turns a selection
   * into a finish the surface renderer can draw, and these three are the
   * inputs it may not invent — a tile drawn at an assumed 300 mm that is
   * really 600 mm shows twice the joints and orders four times the tiles.
   *
   * Optional rather than `| null` on purpose, matching `SelectionFinishInput`
   * in `@symply/contracts`: a row written before these columns existed, or by
   * a backend that does not carry them, is a finish with no stated repeat —
   * which is a real answer, not a missing field.
   */
  grout_color_hex?: string | null;
  /** One repeat's real size, millimetres. Both sides or neither. */
  unit_w_mm?: number | null;
  unit_h_mm?: number | null;
  /**
   * The "was" price, in cents of the same currency as `unit_price_cents`.
   * Set only when the page actually showed it struck through beside a lower
   * price — never inferred from a "50% OFF" banner.
   */
  list_price_cents: number | null;
  /** The discounted price. Mirrors `unit_price_cents` while a sale is on. */
  sale_price_cents: number | null;
  /** 0-100, derived by the importer from the two prices — not off the badge. */
  discount_pct: number | null;
  /** ISO date. NULL = no end date published, NOT "no sale". */
  sale_ends_at: string | null;
  /** 'manual' | 'link_og' | 'link_ai' — shown on the card. */
  extraction_source: string;
  extraction_confidence: string | null;
  version: number;
}

/**
 * A surface being decided — several options compete, one is preferred.
 *
 * `area_value` is what the winner has to cover, and `area_source` says whether
 * the member typed it or it came off a floor plan.
 */
export interface HomeProjectOptionGroup {
  id: string;
  project_id: string;
  name: string;
  category: string;
  area_value: number | null;
  area_unit: string | null;
  area_source: string;
  waste_factor_pct: number;
  preferred_selection_id: string | null;
  version: number;
}

/**
 * Which rung the link import landed on, so the card can label its provenance.
 *
 * `link_og` is server-only — it means a Worker fetched the page and read its
 * OpenGraph tags. `link_url` is the private-mode floor: the page was never
 * fetched and the material was read off the URL itself. They are separate
 * values because "we opened the shop page" and "we read your link" are
 * different claims, and a card that conflated them would overstate what the
 * app knows.
 */
export interface MaterialExtractionOutcome {
  /**
   * `photo_*` is the shelf-tag reader: a member standing in the shop
   * photographs the label rather than hunting for the listing on their phone.
   * It is a separate value from `link_ai` for the same reason `link_og` and
   * `link_url` are separate from each other — "a model read your photo" and
   * "a Worker read the shop's page" are different claims about where a price
   * came from, and the card says which.
   */
  source: 'manual' | 'link_url' | 'link_og' | 'link_ai' | 'photo_ai';
  confidence: string | null;
  error?: string;
  /**
   * True when the page was read but no model looked at it, because this device
   * has no provider key.
   *
   * The import degrades silently by design — a thin card beats no card — and
   * that silence was the defect: the member gets a name and a photo, no price,
   * and nothing on screen saying the one rung that finds prices never ran.
   * Server-backed households never set this; they have a Worker with a key.
   */
  needsAiProvider?: boolean;
}

/** `specs_json` → chips, tolerating anything that is not the shape we wrote. */
export function parseSpecs(specsJson: string | null): MaterialSpec[] {
  if (!specsJson) return [];
  try {
    const parsed: unknown = JSON.parse(specsJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is MaterialSpec =>
        !!s &&
        typeof s === 'object' &&
        typeof (s as MaterialSpec).label === 'string' &&
        typeof (s as MaterialSpec).value === 'string',
    );
  } catch {
    return [];
  }
}

/**
 * What a material card should SHOW where the picture goes.
 *
 * Never "nothing": the materials list is scanned with the eyes, and a card with
 * an empty box in it reads as a row that failed to load rather than as a
 * material with no photo.
 */
export type MaterialVisual =
  /** Local-first sealed bytes — only `HouseBlobImage` can open them. */
  | { kind: 'blob' }
  | { kind: 'image'; uri: string }
  | { kind: 'swatch'; colorHex: string }
  | { kind: 'placeholder' };

/** The durable attachment for a selection, in the two forms it can arrive in. */
export interface MaterialPhotoSource {
  hasBlob?: boolean;
  url?: string | null;
}

/**
 * '#rrggbb'. The column is written normalised, but a card must not hand an
 * unvalidated string to `backgroundColor` — one malformed hex from an importer
 * is a red-box, and falling back to the placeholder costs nothing.
 */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Picture → swatch → placeholder, in that order.
 *
 * The attachment wins over `image_url` because it is the durable copy (the
 * schema says so): a vendor URL rots when the listing is pulled, and a card
 * that 404s months later is how a project loses its photos silently.
 */
export function describeMaterialVisual(
  selection: Pick<HomeProjectSelection, 'image_url' | 'color_hex'>,
  photo?: MaterialPhotoSource | null,
): MaterialVisual {
  if (photo?.hasBlob) return { kind: 'blob' };
  const attachmentUrl = photo?.url?.trim();
  if (attachmentUrl) return { kind: 'image', uri: attachmentUrl };
  const vendorPhoto = selection.image_url?.trim();
  if (vendorPhoto) return { kind: 'image', uri: vendorPhoto };
  const hex = selection.color_hex?.trim();
  if (hex && HEX_COLOR.test(hex)) return { kind: 'swatch', colorHex: hex };
  return { kind: 'placeholder' };
}

/** Everything a card or the detail screen needs to render an offer honestly. */
export interface MaterialSaleFacts {
  /** True only for a sale we can prove from two prices and that has not ended. */
  onSale: boolean;
  /** The price today — the prominent number. Null when nothing is priced. */
  priceCents: number | null;
  /** The struck-through "was". Only ever set when `onSale`. */
  listPriceCents: number | null;
  /** Whole percent off, derived from the two prices. Only when `onSale`. */
  discountPct: number | null;
  /** "−20%" — the badge carries its meaning in text, not in its colour. */
  badgeLabel: string | null;
  /** "Ends Sat". Null when the vendor published no end date. */
  endsLabel: string | null;
  /**
   * A percentage the vendor stated that no pair of prices backs up.
   *
   * Kept separate from `discountPct` and rendered as plain text, because the
   * one thing we must not do with it is reverse it into a "was" price: that
   * invents a number the shop never published and prints it struck through as
   * though it were a fact.
   */
  claimedDiscountPct: number | null;
  /** A sentence, for a member who cannot see the strike-through. */
  accessibilityLabel: string | null;
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_FULL = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * When the offer actually stops, in local milliseconds.
 *
 * A bare `new Date('2026-09-05')` is UTC midnight, which expires the sale up to
 * a day early for every member west of Greenwich — they would see the badge
 * vanish on the morning of a day the shop is still honouring. A date-only
 * value runs to the END of that day, in the member's own timezone.
 *
 * An unparseable value returns null and is treated as "no end date published",
 * not as expired: garbage in the column is not evidence the sale is over.
 */
function saleEndsAtMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (dateOnly) {
    return new Date(
      Number(dateOnly[1]),
      Number(dateOnly[2]) - 1,
      Number(dateOnly[3]),
      23,
      59,
      59,
      999,
    ).getTime();
  }
  const parsed = new Date(iso).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * "Ends Sat" — a weekday inside the coming week, a date beyond it.
 *
 * A weekday is what makes the deadline feel real ("Sat" is a thing a member can
 * picture; "2026-09-05" is a thing they have to work out), but it only reads
 * that way while it is unambiguous — eight days out, "Sat" is the wrong Saturday.
 *
 * Written out rather than taken from `Intl`: Hermes ships a reduced `Intl` that
 * throws rather than degrading (see `@utils/money`), and this app has no i18n.
 */
function formatSaleEnds(endMs: number, nowMs: number, spoken: boolean): string {
  const days = Math.round((startOfDay(endMs) - startOfDay(nowMs)) / 86_400_000);
  if (days <= 0) return 'ends today';
  if (days === 1) return 'ends tomorrow';
  const end = new Date(endMs);
  if (days <= 6) {
    const names = spoken ? WEEKDAY_FULL : WEEKDAY_SHORT;
    return `ends ${names[end.getDay()]}`;
  }
  return `ends ${MONTH_SHORT[end.getMonth()]} ${end.getDate()}`;
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A stated percentage is only worth repeating if it is a percentage. */
function statedDiscount(pct: number | null | undefined): number | null {
  return pct != null && Number.isFinite(pct) && pct >= 1 && pct <= 100
    ? Math.round(pct)
    : null;
}

/**
 * An offer, reduced to what may honestly be drawn.
 *
 * Three rules, and all three exist because a wrong badge is worse than no
 * badge — the member acts on it and finds out at the till:
 *
 *  1. A sale needs BOTH prices, with sale below list. That pair is the whole
 *     claim: it is what the strike-through shows and what the percentage is
 *     computed from, so a percentage on its own never earns a badge.
 *  2. An expired `sale_ends_at` is not a sale. A stale "20% off" on a
 *     full-price item is the single most damaging thing this feature could
 *     render, so expiry drops the badge, the strike-through and the stated
 *     percentage together.
 *  3. The percentage is DERIVED, never copied. Two prices we are showing the
 *     member are a claim we can stand behind; the vendor's own number is the
 *     one that outlives its sale.
 *
 * `now` is a parameter rather than a `Date.now()` inside, because "is this
 * expired" is the behaviour most worth testing and a clock you cannot set is a
 * behaviour you cannot test.
 */
export function describeMaterialSale(
  selection: Pick<
    HomeProjectSelection,
    | 'unit_price_cents'
    | 'list_price_cents'
    | 'sale_price_cents'
    | 'discount_pct'
    | 'sale_ends_at'
  >,
  now: Date | number = Date.now(),
): MaterialSaleFacts {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const endMs = saleEndsAtMs(selection.sale_ends_at);
  const expired = endMs != null && endMs < nowMs;

  const list = selection.list_price_cents;
  const sale = selection.sale_price_cents;
  const derivedPct =
    list != null && sale != null && list > 0 && sale < list
      ? Math.round((1 - sale / list) * 100)
      : null;

  // Under 1% is not an offer, it is rounding. "−0%" beside a strike-through
  // would be the same lie as an expired badge, dressed as arithmetic.
  const onSale = !expired && derivedPct != null && derivedPct >= 1;

  if (!onSale) {
    return {
      onSale: false,
      /**
       * The price today. `unit_price_cents` leads because it is the only money
       * an estimate reads and the only column guaranteed current; the sale
       * columns merely describe the offer around it.
       */
      priceCents:
        selection.unit_price_cents ??
        selection.sale_price_cents ??
        selection.list_price_cents ??
        null,
      listPriceCents: null,
      discountPct: null,
      badgeLabel: null,
      endsLabel: null,
      // An expired sale's percentage is precisely the stale claim rule 2
      // exists to suppress, and a sub-1% one is rule 1's rounding.
      claimedDiscountPct:
        expired || derivedPct != null
          ? null
          : statedDiscount(selection.discount_pct),
      accessibilityLabel: null,
    };
  }

  const listCents = list as number;
  const saleCents = sale as number;
  const pct = derivedPct as number;
  const money = (cents: number) => formatMoney(cents, { decimals: 2 });
  const ends = endMs == null ? null : formatSaleEnds(endMs, nowMs, false);
  const spokenEnds = endMs == null ? '' : `, ${formatSaleEnds(endMs, nowMs, true)}`;

  return {
    onSale: true,
    // The visible number and the spoken one have to be the same number, so the
    // sale price leads here even though `unit_price_cents` mirrors it.
    priceCents: saleCents,
    listPriceCents: listCents,
    discountPct: pct,
    // U+2212, not a hyphen: a hyphen renders as a word-break opportunity and
    // VoiceOver reads it as "dash".
    badgeLabel: `−${pct}%`,
    endsLabel: ends == null ? null : sentenceCase(ends),
    claimedDiscountPct: null,
    accessibilityLabel: `On sale, ${pct} percent off, was ${money(
      listCents,
    )}, now ${money(saleCents)}${spokenEnds}`,
  };
}

/**
 * A shop link a card may actually open.
 *
 * The scheme is checked because `Linking.openURL` hands whatever it is given
 * straight to the OS: a `javascript:` or `intent:` value that reached the
 * column through an importer or a paste would be ACTED on, and the member
 * tapped something labelled with a shop's name. An unrecognised scheme means no
 * button at all — never a button that does something else.
 */
export interface MaterialShopLink {
  url: string;
  /**
   * "Open Capital Tile + Stone" — the shop, not the word "link".
   *
   * The card this replaces read "No price · link", where "link" was inert text
   * that named nothing and did nothing. Every row in the list announced itself
   * as "link", so a member using VoiceOver could not tell one shop from
   * another, and neither could anyone else.
   */
  accessibilityLabel: string;
}

/** The link, or null when there is nothing safe and openable to offer. */
export function describeMaterialShopLink(
  selection: Pick<HomeProjectSelection, 'product_url' | 'vendor' | 'name'>,
): MaterialShopLink | null {
  const url = selection.product_url?.trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const shop = selection.vendor?.trim();
  return {
    url,
    accessibilityLabel: shop
      ? `Open ${shop}`
      : `Open the shop page for ${selection.name}`,
  };
}

/** Everything one material row draws, decided in one place. */
export interface MaterialCardFacts {
  /** Never "nothing". See `describeMaterialVisual`. */
  visual: MaterialVisual;
  sale: MaterialSaleFacts;
  /** The store, trimmed. Null renders no row rather than an empty one. */
  vendor: string | null;
  link: MaterialShopLink | null;
  /**
   * False when nothing at all is priced.
   *
   * Kept as its own fact rather than left to the caller to infer from a null,
   * because "no price" and "£0" are opposite claims about a renovation and the
   * card has to be able to say the first one out loud.
   */
  hasPrice: boolean;
}

/** The columns a card reads. A Pick so a test can state a row in ten lines. */
export type MaterialCardInput = Pick<
  HomeProjectSelection,
  | 'name'
  | 'vendor'
  | 'product_url'
  | 'image_url'
  | 'color_hex'
  | 'unit_price_cents'
  | 'list_price_cents'
  | 'sale_price_cents'
  | 'discount_pct'
  | 'sale_ends_at'
>;

/**
 * One material row, reduced to facts.
 *
 * Pure, and separate from the component, so the rules that decide whether a
 * badge appears can be tested without standing up a 2,500-line screen — the
 * same argument `buildProjectMenuActions` and `MATERIAL_ADD_OPTIONS` make one
 * folder over. The rules themselves live in `describeMaterialSale` and
 * `describeMaterialVisual`; this composes them with the two facts that belong
 * to the row rather than to the offer — where you buy it, and whether that is
 * somewhere the app can send you.
 *
 * `now` is a parameter for the reason it is one in `describeMaterialSale`: an
 * expired sale is the case most worth testing, and a clock you cannot set is a
 * behaviour you cannot test.
 */
export function describeMaterialCard(
  selection: MaterialCardInput,
  now: Date | number = Date.now(),
  photo?: MaterialPhotoSource | null,
): MaterialCardFacts {
  const sale = describeMaterialSale(selection, now);
  return {
    visual: describeMaterialVisual(selection, photo),
    sale,
    vendor: selection.vendor?.trim() || null,
    link: describeMaterialShopLink(selection),
    hasPrice: sale.priceCents != null,
  };
}

export interface HomeProjectBudgetLine {
  id: string;
  project_id: string;
  category: string;
  label: string;
  estimate_cents: number;
  actual_cents: number;
  /**
   * The selection this line was derived from, or null for a hand-typed line.
   *
   * Always been on the wire — the hub's query is a bare `.select()` — but the
   * DTO did not declare it, which is the "present and LOSSY" shape
   * `local/types.ts` warns about. Declared now because an option group finds its
   * one line by this field: that is what makes switching the preferred option an
   * UPDATE rather than an insert, and therefore what stops a switch discarding
   * `actual_cents`.
   */
  selection_id: string | null;
  version: number;
}

export interface HomeProjectPhase {
  id: string;
  project_id: string;
  title: string;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  sort_order: number;
}

export interface HomeProjectBlocker {
  id: string;
  project_id: string;
  title: string;
  severity: string;
  status: string;
  notes: string | null;
  /**
   * Migration 0171 — the member's own order, the same field phases have always
   * had. Declared required rather than optional: both backends write it on
   * every create and the migration backfilled every row that predates it, so a
   * blocker without one does not exist, and making it optional would push an
   * `?? 0` into every list that sorts.
   */
  sort_order: number;
}

/** What a phase's `status` may be — the vocabulary the Timeline offers. */
export type HomeProjectPhaseStatus = 'pending' | 'in_progress' | 'done';

/** What a blocker's `status` may be. */
export type HomeProjectBlockerStatus = 'open' | 'resolved';

// ---------------------------------------------------------------------------
// Smart Project (migration 0166)
// ---------------------------------------------------------------------------

export type AsIsState = 'present' | 'absent' | 'unknown';

/**
 * What already exists on the space.
 *
 * `state: 'unknown'` is not a missing answer — it is the model saying the
 * description did not settle it, which the review screen turns into a question
 * rather than into work.
 */
export interface HomeProjectAsIs {
  id: string;
  project_id: string;
  /** One of `AS_IS_ELEMENTS` in `@symply/contracts`. */
  element: string;
  state: AsIsState;
  evidence: string | null;
  /** `'manual' | 'smart_project'` — a member's own answer reads as manual. */
  source: string;
}

/** One describe-to-draft generation, and its progress. */
export interface HomeProjectSmartDraft {
  id: string;
  project_id: string;
  /** `'generating' | 'completed' | 'failed' | 'cancelled'`. */
  status: string;
  description: string;
  spaces_json: string | null;
  confidence: string | null;
  disclaimer: string | null;
  error_code: string | null;
  /** `[{ title, because }]` — phases skipped because the work is already done. */
  dropped_json: string | null;
  created_at: string;
  updated_at: string;
}

/** What the server returns from `POST /smart-draft/generate`. It stores nothing. */
export interface SmartProjectPlan {
  generation: {
    title: string;
    type: string;
    template_key?: string | null;
    target_use?: string | null;
    summary?: string;
    as_is: Array<{ element: string; state: AsIsState; evidence?: string }>;
    materials: Array<{
      label: string;
      surface_name?: string;
      category: string;
      unit: string;
      coverage_per_unit?: number;
      coverage_unit?: string;
      notes?: string;
      confidence: string;
    }>;
    tasks: Array<{ title: string; rationale?: string }>;
    confidence: string;
  };
  surfaces: Array<{
    name: string;
    kind: 'floor' | 'ceiling' | 'wall';
    category: string;
    area_m2: number;
    waste_factor_pct: number;
    pitched?: boolean;
  }>;
  phases: Array<{ title: string; sort_order: number }>;
  dropped: Array<{ title: string; because: string }>;
  blockers: Array<{ title: string; severity: string; question?: string }>;
  roomModels: unknown[];
  photosRead: number;
}

export interface SmartDraftSpaceInput {
  label: string;
  length_m: number;
  width_m: number;
  /** Height at the WALL, not at the peak. Pair with `ridge_height_m`. */
  height_m: number;
  /**
   * Floor-to-ridge height for a space open to a pitched roof; omitted for a
   * flat ceiling.
   *
   * Measuring a gable as flat under-counts the ceiling (its faces are longer
   * than their footprint) AND the walls (a gable adds a triangle at each end).
   * Both run short, and short is the direction that stops a job.
   */
  ridge_height_m?: number;
}

/**
 * Note what is absent: no area, no quantity, no budget. The member supplies
 * dimensions and the server derives every number from them.
 */
export interface StartSmartDraftInput {
  description: string;
  spaces?: SmartDraftSpaceInput[];
  attachment_ids?: string[];
  /**
   * R2 keys from `uploadSmartDraftPhoto`, in the order the member arranged them
   * — the model receives the image blocks in this order, so a per-photo note in
   * `description` can refer to "photo 3" and mean the third one.
   *
   * Distinct from `attachment_ids`, which name rows on a project that already
   * exists. These name loose objects for a project that does not, and the
   * Worker deletes them as soon as the plan comes back.
   */
  photo_keys?: string[];
  space_id?: string | null;
  /**
   * Which sections the member ticked on the wizard's last step.
   *
   * Omitted means all three, which is what this client sent before the step
   * existed and what the route still defaults to. The server both instructs the
   * model and strips what was not asked for on the way back, so an unticked
   * section never reaches `materializeSmartProjectPlan` at all — there is no
   * second filter on this side to keep in step with it.
   */
  include?: { phases: boolean; tasks: boolean; materials: boolean };
}

/** A phase the draft skipped, and the element that made it unnecessary. */
export interface DroppedPhase {
  title: string;
  because: string;
}

export function parseDroppedPhases(draft: HomeProjectSmartDraft | null): DroppedPhase[] {
  if (!draft?.dropped_json) return [];
  try {
    const raw: unknown = JSON.parse(draft.dropped_json);
    return Array.isArray(raw) ? (raw as DroppedPhase[]) : [];
  } catch {
    return [];
  }
}

export interface HomeProjectGeometry {
  id: string;
  project_id: string;
  source: string;
  status: string;
  payload_json: string | null;
  confidence: string | null;
  disclaimer: string | null;
}

export interface HomeProjectAttachment {
  id: string;
  project_id: string;
  selection_id: string | null;
  kind: string;
  filename: string | null;
  content_type: string | null;
  status: string;
  tags?: string | null;
  /**
   * Local-first only, and the same shape `TaskPhoto.blob` carries (`api/tasks.ts`).
   * On a local-first household the bytes are AES-GCM sealed in the H6 blob
   * channel, so there is no URL that would render — this descriptor is the only
   * address they have, and `resolveHouseBlobUri` is the only thing that can turn
   * it back into something an `<Image>` can show. Absent on a server-backed
   * household, where `r2_key` still does that job.
   */
  blob?: HouseBlobDescriptor | null;
  /**
   * Server-backed households only. The hub query is a bare `.select()`
   * (`home-projects-service.ts`), so D1's `url` has always been on the wire —
   * the DTO simply did not declare it, which is the "present and LOSSY" shape
   * `local/types.ts` warns about. Declared now because the hub renders it.
   */
  url?: string | null;
}

export interface HomeProjectPlanLink {
  id: string;
  project_id: string;
  floor_plan_id: string;
  zone_payload: string | null;
  created_at: string;
}

export interface HomeProjectActivityItem {
  id: string;
  project_id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  meta_json: string | null;
  created_at: string;
}

export interface HomeProjectComment {
  id: string;
  project_id: string;
  selection_id: string | null;
  user_id: string;
  body: string;
  created_at: string;
}

export interface HomeProjectHub {
  project: HomeProject;
  /**
   * The CALLER's effective role (migration 0163) — `owner` may write, `viewer`
   * may only read. Resolved by the backend rather than by the screen, so the
   * control the hub disables is exactly the one the Worker would refuse.
   *
   * Optional because a hub cached before 0163, or served by an older Worker,
   * has no such field; `undefined` is read as `owner`, which is what every
   * household member had before per-project roles existed. Failing OPEN is
   * correct here and only here: the server is still the gate, so the cost of a
   * stale `undefined` is a button that 403s, and the cost of failing closed
   * would be a whole household locked out of its projects by a cache.
   */
  my_role?: HomeProjectRole;
  space_ids: string[];
  rollups: BudgetRollups;
  selections: HomeProjectSelection[];
  option_groups: HomeProjectOptionGroup[];
  budget_lines: HomeProjectBudgetLine[];
  phases: HomeProjectPhase[];
  milestones: unknown[];
  blockers: HomeProjectBlocker[];
  attachments: HomeProjectAttachment[];
  plan_links: HomeProjectPlanLink[];
  geometry: HomeProjectGeometry | null;
}

export interface HomeProjectTemplate {
  key: string;
  title: string;
  type: string;
}

export interface CreateHomeProjectInput {
  id?: string;
  title?: string;
  type?: string;
  templateKey?: string;
  summary?: string;
  targetBudgetCents?: number;
  contingencyPct?: number;
  targetEndAt?: string;
  spaceIds?: string[];
  /** `'draft'` keeps the new project private to its creator until published. */
  visibility?: HomeProjectVisibility;
}

export function isHomeProjectConflict(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 409;
}

const base = (householdId: string) =>
  `/households/${householdId}/home-projects`;

export const homeProjectKeys = {
  all: (householdId: string) => ['home-projects', householdId] as const,
  hub: (projectId: string) => ['home-project', projectId] as const,
  activity: (projectId: string) =>
    ['home-project-activity', projectId] as const,
  access: (projectId: string) => ['home-project-access', projectId] as const,
  templates: () => ['home-project-templates'] as const,
  smartDraft: (projectId: string) =>
    ['home-project-smart-draft', projectId] as const,
  asIs: (projectId: string) => ['home-project-as-is', projectId] as const,
};

const remoteHomeProjectsApi = {
  listTemplates: (householdId: string) =>
    apiClient
      .get<{ templates: HomeProjectTemplate[] }>(
        `${base(householdId)}/templates`,
      )
      .then(res => res.data),

  list: (householdId: string, params?: { status?: string; q?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.q) qs.set('q', params.q);
    const suffix = qs.toString() ? `?${qs}` : '';
    return apiClient
      .get<{ projects: HomeProject[] }>(`${base(householdId)}${suffix}`)
      .then(res => res.data);
  },

  create: (householdId: string, input: CreateHomeProjectInput) =>
    apiClient
      .post<{ project: HomeProject }>(`${base(householdId)}`, input)
      .then(res => res.data),

  getHub: (householdId: string, projectId: string) =>
    apiClient
      .get<HomeProjectHub>(`${base(householdId)}/${projectId}/hub`)
      .then(res => res.data),

  update: (
    householdId: string,
    projectId: string,
    // `targetBudgetCents` is OMITTED from the spread before being re-declared:
    // intersecting `{x?: number}` with `{x?: number | null}` gives `number`, not
    // `number | null` — an intersection narrows. Widening needs the omit.
    patch: Omit<Partial<CreateHomeProjectInput>, 'targetBudgetCents'> & {
      status?: string;
      /** Null clears the cover. */
      coverAttachmentId?: string | null;
      /**
       * Null clears the target back to "no target" — a real state, not a miss:
       * `budget_health` is always `ok` without one. `CreateHomeProjectInput` types
       * this as `number | undefined` because create has nothing to clear.
       */
      targetBudgetCents?: number | null;
      /**
       * Publish (`'published'`) or pull back to a private draft (`'draft'`).
       * Owner-only on both backends — it decides who can see the project at all.
       */
      visibility?: HomeProjectVisibility;
    },
  ) =>
    apiClient
      .patch<{ project: HomeProject }>(
        `${base(householdId)}/${projectId}`,
        patch,
      )
      .then(res => res.data),

  archive: (householdId: string, projectId: string) =>
    apiClient
      .post<{ project: HomeProject }>(
        `${base(householdId)}/${projectId}/archive`,
        {},
      )
      .then(res => res.data),

  /**
   * Permanent — the project and every child row. Archiving is the reversible
   * action; this one is not, which is why the hub confirms twice before calling
   * it and why the service gates it at `manage`.
   */
  remove: (householdId: string, projectId: string) =>
    apiClient
      .delete<void>(`${base(householdId)}/${projectId}`)
      .then(() => undefined),

  /** Every household member with the role they have on THIS project. */
  getAccess: (householdId: string, projectId: string) =>
    apiClient
      .get<{ access: HomeProjectAccessView }>(
        `${base(householdId)}/${projectId}/access`,
      )
      .then(res => res.data.access),

  /**
   * Replaces the whole list in one write. `grants` carries only the members who
   * differ from `defaultRole`; the sheet computes that before saving so a
   * household of twelve does not store twelve identical rows.
   */
  setAccess: (
    householdId: string,
    projectId: string,
    input: { defaultRole: HomeProjectRole; grants: HomeProjectAccessGrant[] },
  ) =>
    apiClient
      .put<{ access: HomeProjectAccessView }>(
        `${base(householdId)}/${projectId}/access`,
        input,
      )
      .then(res => res.data.access),

  createSelection: (
    householdId: string,
    projectId: string,
    input: {
      name: string;
      category?: string;
      unitPriceCents?: number;
      productUrl?: string;
      notes?: string;
      status?: string;
      qty?: number;
      unit?: string;
      vendor?: string;
      optionGroupId?: string;
      brand?: string;
      sku?: string;
      imageUrl?: string;
      coveragePerUnit?: number;
      coverageUnit?: AreaUnit;
      specs?: MaterialSpec[];
      /**
       * Where the material lands in the list. Omit it — every screen does — and
       * the material goes to the TOP, which is what a member who just added one
       * is looking for.
       *
       * Passed only by `materializeSmartProjectPlan`, which writes a whole plan
       * one row at a time and needs the plan's own order to survive that.
       */
      sortOrder?: number;
    },
  ) =>
    apiClient
      .post<{ selection: HomeProjectSelection }>(
        `${base(householdId)}/${projectId}/selections`,
        input,
      )
      .then(res => res.data),

  updateSelection: (
    householdId: string,
    projectId: string,
    selectionId: string,
    input: {
      name?: string;
      status?: string;
      unitPriceCents?: number | null;
      productUrl?: string | null;
      notes?: string | null;
      qty?: number;
      unit?: string | null;
      vendor?: string | null;
      optionGroupId?: string | null;
      brand?: string | null;
      sku?: string | null;
      imageUrl?: string | null;
      coveragePerUnit?: number | null;
      coverageUnit?: AreaUnit | null;
      specs?: MaterialSpec[] | null;
      version?: number;
    },
  ) =>
    apiClient
      .patch<{ selection: HomeProjectSelection }>(
        `${base(householdId)}/${projectId}/selections/${selectionId}`,
        input,
      )
      .then(res => res.data),

  /**
   * Paste a shop link → an option card, with the page read by AI where a key is
   * configured. `extraction` reports which rung it landed on (AI, OpenGraph, or
   * bare URL) so the card can be honest about where its numbers came from.
   */
  /**
   * `DELETE /:projectId/selections/:selectionId`.
   *
   * The route and the service method have existed since the feature shipped and
   * no client ever called them, so a material could be added and never removed
   * — including the shortlists templates used to seed, which every project
   * arrived with and nobody could clear.
   *
   * Answers 204, so there is nothing to read back; the caller invalidates.
   */
  deleteSelection: (
    householdId: string,
    projectId: string,
    selectionId: string,
  ) =>
    apiClient
      .delete<void>(
        `${base(householdId)}/${projectId}/selections/${selectionId}`,
      )
      .then(() => ({ success: true as const })),

  createFromLink: (
    householdId: string,
    projectId: string,
    url: string,
    optionGroupId?: string,
  ) =>
    apiClient
      .post<{
        selection: HomeProjectSelection;
        extraction: MaterialExtractionOutcome;
      }>(`${base(householdId)}/${projectId}/selections/from-link`, {
        url,
        optionGroupId,
      })
      .then(res => res.data),

  createOptionGroup: (
    householdId: string,
    projectId: string,
    input: {
      name: string;
      category?: string;
      areaValue?: number | null;
      areaUnit?: AreaUnit | null;
      wasteFactorPct?: number;
    },
  ) =>
    apiClient
      .post<{ option_group: HomeProjectOptionGroup }>(
        `${base(householdId)}/${projectId}/option-groups`,
        input,
      )
      .then(res => res.data),

  updateOptionGroup: (
    householdId: string,
    projectId: string,
    groupId: string,
    input: {
      name?: string;
      category?: string;
      areaValue?: number | null;
      areaUnit?: AreaUnit | null;
      wasteFactorPct?: number;
      version?: number;
    },
  ) =>
    apiClient
      .patch<{ option_group: HomeProjectOptionGroup }>(
        `${base(householdId)}/${projectId}/option-groups/${groupId}`,
        input,
      )
      .then(res => res.data),

  deleteOptionGroup: (
    householdId: string,
    projectId: string,
    groupId: string,
  ) =>
    apiClient
      .delete<void>(
        `${base(householdId)}/${projectId}/option-groups/${groupId}`,
      )
      .then(res => res.data),

  /** Pick the option that gets built. `null` returns the group to undecided. */
  setPreferredOption: (
    householdId: string,
    projectId: string,
    groupId: string,
    selectionId: string | null,
  ) =>
    apiClient
      .post<{
        option_group: HomeProjectOptionGroup;
        budget_line: HomeProjectBudgetLine | null;
      }>(
        `${base(householdId)}/${projectId}/option-groups/${groupId}/preferred`,
        {
          selectionId,
        },
      )
      .then(res => res.data),

  /**
   * A budget row the member types themselves — a quote from a trade, a permit
   * fee off the city's schedule, a delivery charge.
   *
   * The three budget-line routes have existed on the Worker since the feature
   * shipped and had no client at all: every line on a project was minted by
   * something else (a template seeding the row, a priced material, an option
   * group's winner), so a member could see the money but not touch it. A labour
   * quote had nowhere to go, and a figure the app had derived wrongly could not
   * be corrected.
   *
   * `estimateCents` is what the work is expected to cost and `actualCents` what
   * has been paid. They are separate columns rather than one: the gap between
   * them is the whole point of the Actual figure in the header.
   */
  createBudgetLine: (
    householdId: string,
    projectId: string,
    input: {
      category: 'materials' | 'labor' | 'permits' | 'contingency' | 'other';
      label: string;
      estimateCents?: number;
      actualCents?: number;
      selectionId?: string;
    },
  ) =>
    apiClient
      .post<{ budget_line: HomeProjectBudgetLine }>(
        `${base(householdId)}/${projectId}/budget-lines`,
        input,
      )
      .then(res => res.data),

  updateBudgetLine: (
    householdId: string,
    projectId: string,
    lineId: string,
    input: {
      category?: string;
      label?: string;
      estimateCents?: number;
      actualCents?: number;
      version?: number;
    },
  ) =>
    apiClient
      .patch<{ budget_line: HomeProjectBudgetLine }>(
        `${base(householdId)}/${projectId}/budget-lines/${lineId}`,
        input,
      )
      .then(res => res.data),

  /**
   * Removes the row entirely, including one derived from a material.
   *
   * That case is deliberate and is the reason this is exposed rather than left
   * to zeroing: a line minted from a priced selection is regenerated from the
   * selection, so zeroing it is undone the next time the material is edited.
   * Deleting is the only way to say "this is not part of the budget".
   */
  deleteBudgetLine: (householdId: string, projectId: string, lineId: string) =>
    apiClient
      .delete<void>(`${base(householdId)}/${projectId}/budget-lines/${lineId}`)
      .then(() => undefined),

  createBlocker: (
    householdId: string,
    projectId: string,
    input: { title: string; severity?: string; notes?: string },
  ) =>
    apiClient
      .post<{ blocker: HomeProjectBlocker }>(
        `${base(householdId)}/${projectId}/blockers`,
        input,
      )
      .then(res => res.data),

  updateBlocker: (
    householdId: string,
    projectId: string,
    blockerId: string,
    patch: {
      title?: string;
      severity?: string;
      status?: HomeProjectBlockerStatus;
      notes?: string | null;
    },
  ) =>
    apiClient
      .patch<{ blocker: HomeProjectBlocker }>(
        `${base(householdId)}/${projectId}/blockers/${blockerId}`,
        patch,
      )
      .then(res => res.data),

  deleteBlocker: (householdId: string, projectId: string, blockerId: string) =>
    apiClient
      .delete<void>(`${base(householdId)}/${projectId}/blockers/${blockerId}`)
      .then(() => undefined),

  /**
   * The blockers of this project, in the order the member dropped them.
   *
   * POST rather than PATCH because it addresses the LIST, not a row: there is
   * no `blockerId` in the path and the body is the whole new order. Ids the
   * caller leaves out keep their place at the end — see the Worker's
   * `applyOrder` for why that is forgiving rather than strict.
   */
  reorderBlockers: (
    householdId: string,
    projectId: string,
    blockerIds: string[],
  ) =>
    apiClient
      .post<{ blockers: HomeProjectBlocker[] }>(
        `${base(householdId)}/${projectId}/blockers/reorder`,
        { blockerIds },
      )
      .then(res => res.data),

  createPhase: (
    householdId: string,
    projectId: string,
    input: { title: string },
  ) =>
    apiClient
      .post<{ phase: HomeProjectPhase }>(
        `${base(householdId)}/${projectId}/phases`,
        input,
      )
      .then(res => res.data),

  updatePhase: (
    householdId: string,
    projectId: string,
    phaseId: string,
    patch: {
      title?: string;
      status?: HomeProjectPhaseStatus;
      startsOn?: string | null;
      endsOn?: string | null;
    },
  ) =>
    apiClient
      .patch<{ phase: HomeProjectPhase }>(
        `${base(householdId)}/${projectId}/phases/${phaseId}`,
        patch,
      )
      .then(res => res.data),

  deletePhase: (householdId: string, projectId: string, phaseId: string) =>
    apiClient
      .delete<void>(`${base(householdId)}/${projectId}/phases/${phaseId}`)
      .then(() => undefined),

  /** The phases of this project, in the order the member dropped them. */
  reorderPhases: (householdId: string, projectId: string, phaseIds: string[]) =>
    apiClient
      .post<{ phases: HomeProjectPhase[] }>(
        `${base(householdId)}/${projectId}/phases/reorder`,
        { phaseIds },
      )
      .then(res => res.data),

  putManualGeometry: (
    householdId: string,
    projectId: string,
    payload: unknown,
  ) =>
    apiClient
      .put<{ geometry: HomeProjectGeometry }>(
        `${base(householdId)}/${projectId}/geometry/manual`,
        payload,
      )
      .then(res => res.data),

  putRoomPlanGeometry: (
    householdId: string,
    projectId: string,
    payload: unknown,
  ) =>
    apiClient
      .post<{ geometry: HomeProjectGeometry }>(
        `${base(householdId)}/${projectId}/geometry/roomplan`,
        payload,
      )
      .then(res => res.data),

  enqueueAiSchematic: (
    householdId: string,
    projectId: string,
    attachmentIds?: string[],
  ) =>
    apiClient
      .post<{ geometry: HomeProjectGeometry }>(
        `${base(householdId)}/${projectId}/geometry/ai-schematic`,
        attachmentIds ? { attachmentIds } : {},
      )
      .then(res => res.data),

  cancelGeometry: (
    householdId: string,
    projectId: string,
    geometryId: string,
  ) =>
    apiClient
      .post<{ geometry: HomeProjectGeometry }>(
        `${base(householdId)}/${projectId}/geometry/${geometryId}/cancel`,
        {},
      )
      .then(res => res.data),

  // ---- Smart Project (migration 0166) -----------------------------------

  /**
   * `POST /smart-draft` — describe a project and let AI draft it.
   *
   * Returns 202 with a project that is already `visibility: 'draft'`: it exists
   * so the client has somewhere to navigate and poll, and it is private to its
   * creator until they publish. Generation runs on a queue.
   */
  startSmartDraft: (householdId: string, input: StartSmartDraftInput) =>
    apiClient
      .post<{ project: HomeProject; draft: HomeProjectSmartDraft }>(
        `${base(householdId)}/smart-draft`,
        input,
      )
      .then(res => res.data),

  /**
   * `POST /smart-draft/generate` — the server thinks, and stores nothing.
   *
   * The caller saves the plan through this same api module, so it lands in the
   * device ledger on a local-first household and in D1 on a server-backed one.
   * That split is what lets Smart Project ship on House, which is local-first
   * by default. See `materializeSmartProjectPlan`.
   */
  generateSmartProjectPlan: (
    householdId: string,
    input: StartSmartDraftInput,
  ) =>
    apiClient
      .post<{ plan: SmartProjectPlan }>(
        `${base(householdId)}/smart-draft/generate`,
        input,
        {
          /**
           * Three minutes, not the default thirty seconds.
           *
           * This is a multimodal generation over up to eight photos and it
           * routinely takes longer than half a minute. The endpoint was designed
           * around the WORKER's limits — where 30s is CPU time and waiting on a
           * provider costs none of it — and the client's own request timeout was
           * missed entirely. The member saw "Could not draft that — timeout of
           * 30000ms exceeded" while the server was still working.
           *
           * Matches the 2-minute allowance the upload path already takes for the
           * same reason, with headroom for a slow model day.
           */
          timeout: 180000,
        },
      )
      .then(res => res.data.plan),

  /**
   * `POST /smart-draft/photos` — one photo for a project that does not exist yet.
   *
   * Raw bytes with a `Content-Type` header; the reply is an R2 key to hand to
   * `generateSmartProjectPlan` as `photo_keys`. There is no create-then-PUT pair
   * like `createAttachmentUpload` has, because there is no row to create:
   * `home_project_attachments.project_id` is NOT NULL behind a cascade FK, and
   * at draft time the project is exactly what is being invented.
   *
   * **The object is transient.** The Worker deletes every key it was given as
   * soon as the plan comes back (`purgeSmartDraftPhotos`), so this is a
   * generation input in flight and never a stored document. The member's
   * KEPT copy is a separate write — `uploadSelectionPhoto` against the project
   * that gets materialised — which lands in the encrypted ledger on a
   * local-first household and in R2 on a server-backed one, like every other
   * project photo.
   */
  uploadSmartDraftPhoto: async (
    householdId: string,
    uri: string,
    contentType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg',
  ): Promise<{ key: string; content_type: string; size: number }> => {
    const token = useAuthStore.getState().token;
    const blob = await (await fetch(uri)).blob();
    const res = await apiClient.post<{
      key: string;
      content_type: string;
      size: number;
    }>(`${base(householdId)}/smart-draft/photos`, blob, {
      headers: {
        'Content-Type': contentType,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      // Axios would otherwise JSON-stringify the Blob into `{}` and upload two
      // bytes — the same guard `uploadAttachmentBytes` needs, for the same
      // reason.
      transformRequest: [data => data],
      // A photo upload over a phone connection is not a 30s request. Matches the
      // allowance the attachment path already takes.
      timeout: 120000,
    });
    return res.data;
  },

  getSmartDraft: (householdId: string, projectId: string) =>
    apiClient
      .get<{ draft: HomeProjectSmartDraft | null }>(
        `${base(householdId)}/${projectId}/smart-draft`,
      )
      .then(res => res.data),

  cancelSmartDraft: (
    householdId: string,
    projectId: string,
    draftId: string,
  ) =>
    apiClient
      .post<{ draft: HomeProjectSmartDraft }>(
        `${base(householdId)}/${projectId}/smart-draft/${draftId}/cancel`,
        {},
      )
      .then(res => res.data),

  /**
   * `POST /:projectId/publish` — share a reviewed draft with the household.
   *
   * The only call that makes a Smart Project visible to anyone but its creator,
   * and the only one that turns its held tasks into real House tasks.
   */
  publishProject: (householdId: string, projectId: string) =>
    apiClient
      .post<{ project: HomeProject }>(
        `${base(householdId)}/${projectId}/publish`,
        {},
      )
      .then(res => res.data),

  listAsIs: (householdId: string, projectId: string) =>
    apiClient
      .get<{ as_is: HomeProjectAsIs[] }>(
        `${base(householdId)}/${projectId}/as-is`,
      )
      .then(res => res.data),

  upsertAsIs: (
    householdId: string,
    projectId: string,
    input: { element: string; state: AsIsState; evidence?: string | null },
  ) =>
    apiClient
      .put<{ as_is: HomeProjectAsIs }>(
        `${base(householdId)}/${projectId}/as-is`,
        input,
      )
      .then(res => res.data),

  deleteAsIs: (householdId: string, projectId: string, asIsId: string) =>
    apiClient
      .delete<{ deleted: boolean }>(
        `${base(householdId)}/${projectId}/as-is/${asIsId}`,
      )
      .then(res => res.data),

  /**
   * `POST /:projectId/surfaces/:surfaceId/preview` — the photoreal render.
   *
   * `layoutPngBase64` is the scale-true drawing the member is looking at,
   * captured straight off the on-device canvas with `Svg.toDataURL`. Sending it
   * is what makes the render a picture of *their* wall rather than of a wall:
   * without it the model has the measurements in words but nothing to compose
   * against, and the response says so through `brief`.
   *
   * The `brief` that comes back is the exact text the model was given. It is
   * rendered beside the image, because a generated picture with no statement of
   * its instructions is indistinguishable from one that had none — and this
   * feature's whole claim is that its pictures are to scale.
   */
  generateSurfacePreview: (
    householdId: string,
    projectId: string,
    surfaceId: string,
    layoutPngBase64?: string,
  ) =>
    apiClient
      .post<{
        attachment: HomeProjectAttachment;
        brief: SurfaceScaleBrief;
        model: string;
      }>(
        `${base(householdId)}/${projectId}/surfaces/${surfaceId}/preview`,
        layoutPngBase64 ? { layoutPngBase64 } : {},
      )
      .then(res => res.data),

  exportSummary: (householdId: string, projectId: string) =>
    apiClient
      .post<{ shareText: string; pdfUrl: string | null }>(
        `${base(householdId)}/${projectId}/export.pdf`,
        {},
      )
      .then(res => res.data),

  createPlanLink: (
    householdId: string,
    projectId: string,
    input: { floorPlanId: string; zonePayload?: unknown },
  ) =>
    apiClient
      .post<{ plan_link: HomeProjectPlanLink }>(
        `${base(householdId)}/${projectId}/plan-links`,
        input,
      )
      .then(res => res.data),

  createAttachmentUpload: (
    householdId: string,
    projectId: string,
    input: {
      filename: string;
      file_size: number;
      content_type:
        | 'image/jpeg'
        | 'image/png'
        | 'image/webp'
        | 'application/pdf';
      /**
       * `texture` is the swatch photo a `Material` in the Room Surface Model
       * points at. It is an ordinary attachment on purpose — sealed into the H6
       * blob channel on a local-first household and an R2 object otherwise —
       * so the surface feature needed no new byte mechanism on either backend.
       * It is a distinct `kind` rather than a tagged photo so the hub's photo
       * gallery does not fill up with pictures of grout.
       */
      kind?:
        | 'photo'
        | 'file'
        | 'link'
        | 'plan_ref'
        | 'scan'
        | 'schematic'
        | 'texture'
        /**
         * A room or scheme the member liked IN this material — not a picture of
         * the product. Distinct from `photo` for the same reason `texture` is:
         * the hub's gallery and the project-cover picker both take `photo`
         * only, so references stay on the material they belong to.
         */
        | 'reference';
      selectionId?: string;
      tags?: Array<'before' | 'after'>;
    },
  ) =>
    apiClient
      .post<{
        attachment_id: string;
        upload_url: string;
        attachment: HomeProjectAttachment;
      }>(`${base(householdId)}/${projectId}/attachments/upload-url`, input)
      .then(res => res.data),

  uploadAttachmentBytes: async (
    householdId: string,
    projectId: string,
    attachmentId: string,
    bytes: ArrayBuffer | Blob,
    contentType: string,
  ) => {
    const token = useAuthStore.getState().token;
    const path = `${base(
      householdId,
    )}/${projectId}/attachments/${attachmentId}/upload`;
    const res = await apiClient.put<{ attachment: HomeProjectAttachment }>(
      path,
      bytes,
      {
        headers: {
          'Content-Type': contentType,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        transformRequest: [data => data],
      },
    );
    return res.data;
  },

  /**
   * Pick photo URI → upload-url → PUT bytes; optionally link to a selection /
   * before-after tag.
   *
   * `kind` is trailing and defaults to `'photo'` so every existing caller is
   * unchanged. It exists for the surface feature's material swatches, which are
   * the same upload with a different label — adding a second near-identical
   * method would have duplicated the normalise-fetch-upload body on both
   * backends for one string.
   */
  uploadSelectionPhoto: async (
    householdId: string,
    projectId: string,
    uri: string,
    selectionId?: string,
    tags?: Array<'before' | 'after'>,
    kind: 'photo' | 'texture' | 'reference' = 'photo',
  ): Promise<HomeProjectAttachment> => {
    // Normalise BEFORE the fetch, on both backends. The size argument is not
    // only about the encrypted channel: a 12 MP iPhone original is 3-8 MB, and
    // on a server-backed household every other member still pulls those bytes
    // down R2 to look at a tile edge. The picker also hands us HEIC on iOS,
    // which `<Image>` will not render — so an un-normalised upload produced a
    // row that simply showed nothing. 2048 long edge / JPEG 0.85 is sharp at
    // full screen and roughly a fifth of the bytes. See `attachmentImage.ts`.
    const normalized = await normalizeAttachmentImage(uri);
    const filename = normalizedAttachmentFilename(uri);
    const contentType = normalized.mime;
    const blobRes = await fetch(normalized.uri);
    const blob = await blobRes.blob();
    // The REMOTE parts, deliberately: under local-first this whole method is a
    // throw and is never reached, and going through the Proxy here would make
    // the composite half-local for no benefit.
    const created = await remoteHomeProjectsApi.createAttachmentUpload(
      householdId,
      projectId,
      {
        filename,
        file_size: blob.size || 1,
        content_type: contentType,
        kind,
        selectionId,
        tags,
      },
    );
    const uploaded = await remoteHomeProjectsApi.uploadAttachmentBytes(
      householdId,
      projectId,
      created.attachment_id,
      blob,
      contentType,
    );
    return uploaded.attachment;
  },

  addComment: (
    householdId: string,
    projectId: string,
    input: { body: string; selectionId?: string },
  ) =>
    apiClient
      .post<{ comment: HomeProjectComment }>(
        `${base(householdId)}/${projectId}/comments`,
        input,
      )
      .then(res => res.data),

  listActivity: (householdId: string, projectId: string, cursor?: string) => {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return apiClient
      .get<{ items: HomeProjectActivityItem[]; next_cursor: string | null }>(
        `${base(householdId)}/${projectId}/activity${qs}`,
      )
      .then(res => res.data);
  },

  listTasks: (householdId: string, projectId: string) =>
    apiClient
      .get<{
        tasks: Array<{
          task_id: string;
          title: string | null;
          next_due_date: string | null;
        }>;
      }>(`${base(householdId)}/${projectId}/tasks`)
      .then(res => res.data),

  linkTask: (householdId: string, projectId: string, taskId: string) =>
    apiClient
      .post<{ link: { project_id: string; task_id: string } }>(
        `${base(householdId)}/${projectId}/tasks`,
        { taskId },
      )
      .then(res => res.data),

  createTask: (
    householdId: string,
    projectId: string,
    input: { title: string; description?: string },
  ) =>
    apiClient
      .post<{ link: { project_id: string; task_id: string; title: string } }>(
        `${base(householdId)}/${projectId}/tasks`,
        input,
      )
      .then(res => res.data),

  downloadExportPdf: async (
    projectId: string,
    pdfUrl: string,
  ): Promise<string> => {
    const token = useAuthStore.getState().token;
    const path = `${FileSystem.cacheDirectory}home-project-${projectId}.pdf`;
    const result = await FileSystem.downloadAsync(pdfUrl, path, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (result.status !== 200) throw new Error('Failed to download PDF');
    return result.uri;
  },
};

/**
 * H11 sub-wave C4 — the last Proxy registration in the programme.
 *
 * Seventeen of the 30 methods are local. `getHub` is the one that made leaving
 * this module remote unthinkable: it composes the project, its selections, its
 * budget lines, its phases, its milestones, its blockers, its attachments and
 * its plan links into one document, and computes `rollups` — the estimate, the
 * actual, the contingency and the health badge — out of the budget lines on
 * every request. A Worker holding none of those rows answers `estimate_total: 0`
 * with a 200, so a member looking at a fully specified twelve-thousand-dollar
 * bathroom would be told it costs nothing. `list`, `listActivity` and
 * `exportSummary` are the same argument at smaller scale, and `listTemplates` is
 * local because `create` has to seed a template's rows on device anyway.
 *
 * `remoteMethods` is EMPTY, as in C2 and C3: there is no Tier C surface anywhere
 * in this feature — no catalogue held in D1, no template table, no shared
 * glossary. Every column of all ten tables is the household's own.
 *
 * The ten gaps are PRESENT locally as throws with member-facing copy, in four
 * groups: three are the H6 byte transfer, four are `home_project_geometry`
 * (ledgered since the H13 D-wave; the manual and RoomPlan writes are local now
 * and only the AI schematic is refused), one is the AI scope suggester (a
 * product decision, flagged in the facade rather than taken here), one is the
 * link importer (an egress refusal), and one is `downloadExportPdf`, which is
 * unreachable rather than blocked.
 *
 * It was thirteen in five groups until migration 0170. The fifth group was
 * `listTasks` / `linkTask` / `createTask`, refused because `home_project_tasks`
 * was a PK-less join (hazard S2) that could not be ledgered — the only place in
 * H11 where a member lost a feature to a schema decision. 0170 moved the link
 * onto the project row as `linked_task_ids`, the shape `projects.linked_task_ids`
 * has carried since 0061, and all three became ordinary local writes.
 */
export const homeProjectsApi: typeof remoteHomeProjectsApi =
  createHouseLocalProxy(remoteHomeProjectsApi, {
    moduleName: 'homeProjectsApi',
    /**
     * Remote BY DESIGN, and safe to be.
     *
     * `generateSmartProjectPlan` is the AI call: it needs the model, the
     * provider key and the uploaded photos, none of which exist on device. It
     * is also the one Smart Project method that STORES NOTHING — it returns a
     * plan and the caller saves it through this same module, which lands it in
     * the ledger or in D1 as appropriate.
     *
     * That is exactly why it may route remote where the old write-through
     * methods could not: sending a description to a model does not put a
     * household's project anywhere its owner cannot read it.
     *
     * `uploadSmartDraftPhoto` is the same call's other half and rides on the
     * same reasoning. It is worth stating the local-first objection plainly
     * rather than waving it through: these ARE bytes leaving a sealed
     * household's device, which is the thing H6 exists to prevent. Three
     * properties make it a different act from an attachment upload:
     *
     *  - the member has just chosen an AI feature whose entire purpose is to
     *    show these photos to a model, so the bytes reach a third party either
     *    way — R2 is transit, not a new audience;
     *  - the Worker deletes every key the moment the plan returns, so nothing
     *    accumulates in a bucket no screen lists and no delete reaches;
     *  - the KEPT copy takes the ordinary path. `uploadSelectionPhoto` seals it
     *    into the H6 blob channel on a local-first household, so the photo the
     *    member can still open in a year never went to a server at all.
     */
    remoteMethods: ['generateSmartProjectPlan', 'uploadSmartDraftPhoto'],
    // Narrow require: the barrel would pull the sync orchestrator and status
    // store into every api call from every screen.
    resolveLocal: () =>
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@features/house/local/localHomeProjectsApi')
        .localHomeProjectsApi,
  });

/** What the shelf-tag reader answers: the row it filled in, and how well. */
export interface MaterialPhotoExtraction {
  selection: HomeProjectSelection;
  extraction: MaterialExtractionOutcome;
}

/**
 * Read a photographed shelf tag into the material it describes.
 *
 * ## The route CREATES the material — it does not enrich one
 *
 *   `POST /households/:householdId/home-projects/:projectId/selections/from-shelf-tag`
 *   body `{ photoBase64, mimeType?, optionGroupId?, hint? }` → `{ selection, extraction }`
 *
 * This client originally intended `.../selections/:id/from-photo` with an
 * `{ attachmentId }`, i.e. attach the photo first and patch the fields on
 * afterwards. The endpoint that shipped inverts that, and is right to: reading
 * the tag first means the row is born with the vendor's name and price on it,
 * rather than a "New material" placeholder that a later patch may never reach
 * if the model cannot read the label. It also answers the same
 * `{ selection, extraction }` pair as `createFromLink`, because a shelf tag and
 * a shop link are the same act from the member's side.
 *
 * Consequence for the caller: the photo is uploaded to the selection this
 * returns, AFTER the call — not before it. `addSelectionPhoto` owns that order.
 *
 * ## Why it answers null instead of throwing
 *
 * Extraction is the enrichment, never the write that matters. A Worker without
 * the route, a model that could not read a blurry label under shop lighting,
 * and a local-first household whose rows this Worker has never seen are one
 * outcome here: null, and a caller that falls back to creating the material
 * plainly so the member still leaves the aisle with their photo attached.
 *
 * Still OUTSIDE `remoteHomeProjectsApi` on purpose: `apiParity.test.ts` requires
 * every facade method to have a local counterpart or a declared `remoteOnly`
 * reason, and there is no local half — a sealed local-first household cannot
 * send its bytes to a Worker. Adding it to the facade would teach that guard to
 * tolerate a real gap.
 */
export async function extractMaterialFromShelfTag(
  householdId: string,
  projectId: string,
  photoBase64: string,
  opts?: { mimeType?: 'image/jpeg' | 'image/png' | 'image/webp'; optionGroupId?: string; hint?: string },
): Promise<MaterialPhotoExtraction | null> {
  // A local-first household's rows live on the device and this Worker has never
  // seen the project, so the call could only 404 — and `localApiProxy`'s header
  // is explicit that quietly reaching the server for such a household is the
  // worst failure mode available in this module.
  if (isHouseLocalFirst()) return null;
  try {
    const res = await apiClient.post<MaterialPhotoExtraction>(
      `${base(householdId)}/${projectId}/selections/from-shelf-tag`,
      {
        photoBase64,
        mimeType: opts?.mimeType ?? 'image/jpeg',
        optionGroupId: opts?.optionGroupId,
        hint: opts?.hint,
      },
    );
    return res.data ?? null;
  } catch {
    return null;
  }
}

export function useHomeProjects(
  householdId: string | undefined,
  params?: { status?: string; includeArchived?: boolean },
) {
  return useQuery({
    // `includeArchived` is part of the key, not just the fetcher: the two shapes
    // are different result sets, and sharing one key let the list screen's
    // archived rows land in the home dashboard card's cache (both read `'all'`).
    queryKey: [
      ...homeProjectKeys.all(householdId || ''),
      params?.status || 'all',
      params?.includeArchived ? 'with-archived' : 'active-only',
    ] as const,
    queryFn: async () => {
      const active = await homeProjectsApi
        .list(householdId!)
        .then(r => r.projects);
      if (!params?.includeArchived) {
        return active.filter(p => p.status !== 'archived');
      }
      const archived = await homeProjectsApi
        .list(householdId!, { status: 'archived' })
        .then(r => r.projects);
      const seen = new Set(active.map(p => p.id));
      return [...active, ...archived.filter(p => !seen.has(p.id))];
    },
    enabled: !!householdId,
  });
}

export function useHomeProjectHub(
  householdId: string | undefined,
  projectId: string | undefined,
) {
  return useQuery({
    queryKey: homeProjectKeys.hub(projectId || ''),
    queryFn: () => homeProjectsApi.getHub(householdId!, projectId!),
    enabled: !!householdId && !!projectId,
    refetchOnWindowFocus: true,
  });
}

export function useHomeProjectActivity(
  householdId: string | undefined,
  projectId: string | undefined,
) {
  return useQuery({
    queryKey: homeProjectKeys.activity(projectId || ''),
    queryFn: () =>
      homeProjectsApi.listActivity(householdId!, projectId!).then(r => r.items),
    enabled: !!householdId && !!projectId,
  });
}

export function useCreateHomeProject(householdId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateHomeProjectInput) =>
      homeProjectsApi.create(householdId!, input).then(r => r.project),
    onSuccess: () => {
      if (householdId) {
        void qc.invalidateQueries({
          queryKey: homeProjectKeys.all(householdId),
        });
      }
    },
  });
}

export function useHomeProjectMutation(
  householdId: string | undefined,
  projectId: string | undefined,
) {
  const qc = useQueryClient();
  /**
   * Memoised, and that is load-bearing rather than tidy.
   *
   * A fresh closure on every render propagates: `useRoomSurfaceModel` puts this
   * in its `save` callback's deps, `save` then changes identity every render,
   * and the debounced-autosave effect that depends on `save` tears down and
   * re-arms its timer every render. With `refetchOnWindowFocus` on the hub
   * query, a screen that re-renders more often than the debounce never reaches
   * the end of it — and the member's edits are never written. Nothing errors;
   * the work simply does not persist.
   */
  const invalidate = useCallback(() => {
    if (projectId) {
      void qc.invalidateQueries({ queryKey: homeProjectKeys.hub(projectId) });
      void qc.invalidateQueries({
        queryKey: homeProjectKeys.activity(projectId),
      });
    }
    if (householdId)
      void qc.invalidateQueries({ queryKey: homeProjectKeys.all(householdId) });
    if (projectId)
      void qc.invalidateQueries({
        queryKey: homeProjectKeys.access(projectId),
      });
  }, [qc, householdId, projectId]);
  return { invalidate };
}

/**
 * Who may do what on this project — the manage-permissions sheet's only read.
 *
 * `enabled` also gates on the sheet being open, because this is the one
 * home-project read that joins the household roster and there is no reason to
 * pay for it on every hub open.
 */
export function useHomeProjectAccess(
  householdId: string | undefined,
  projectId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: homeProjectKeys.access(projectId || ''),
    queryFn: () => homeProjectsApi.getAccess(householdId!, projectId!),
    enabled: enabled && !!householdId && !!projectId,
  });
}

// ---------------------------------------------------------------------------
// Smart Project hooks
// ---------------------------------------------------------------------------

/**
 * Poll a running generation.
 *
 * Polls only while the draft says `generating`, and stops the moment it does
 * not. `refetchInterval` returning `false` is what ends it — a fixed interval
 * would keep a timer alive on a hub the member left open for an hour.
 */
export function useSmartDraft(
  householdId: string | undefined,
  projectId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: homeProjectKeys.smartDraft(projectId || ''),
    queryFn: () =>
      homeProjectsApi
        .getSmartDraft(householdId!, projectId!)
        .then(r => r.draft),
    enabled: enabled && !!householdId && !!projectId,
    refetchInterval: query =>
      query.state.data?.status === 'generating' ? 3000 : false,
  });
}

export function useStartSmartDraft(householdId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StartSmartDraftInput) =>
      homeProjectsApi.startSmartDraft(householdId!, input),
    onSuccess: () => {
      if (householdId) {
        void qc.invalidateQueries({
          queryKey: homeProjectKeys.all(householdId),
        });
      }
    },
  });
}

export function useCancelSmartDraft(
  householdId: string | undefined,
  projectId: string | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draftId: string) =>
      homeProjectsApi.cancelSmartDraft(householdId!, projectId!, draftId),
    onSuccess: () => {
      if (projectId) {
        void qc.invalidateQueries({
          queryKey: homeProjectKeys.smartDraft(projectId),
        });
      }
    },
  });
}

/**
 * Publish the draft to the household.
 *
 * Invalidates the list as well as the hub: until this succeeds the project was
 * in nobody else's list, and afterwards it must be in everyone's.
 */
/**
 * Publish a draft to the household.
 *
 * Goes through the generic `update` rather than the dedicated `publishProject`
 * endpoint, and that matters: `publishProject` is a Worker route, and
 * `localHomeProjectsApi` throws for it — so on a local-first household, which
 * is every House household by default, publishing a drafted project would have
 * failed outright.
 *
 * `update` is ledgered on both backends and the local implementation already
 * treats a visibility change as its own event, so a publish is recorded as a
 * publish wherever the project lives.
 */
export function usePublishProject(
  householdId: string | undefined,
  projectId: string | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      homeProjectsApi
        .update(householdId!, projectId!, { visibility: 'published' })
        .then(r => r.project),
    onSuccess: () => {
      if (householdId) {
        void qc.invalidateQueries({
          queryKey: homeProjectKeys.all(householdId),
        });
      }
      if (projectId) {
        void qc.invalidateQueries({ queryKey: homeProjectKeys.hub(projectId) });
      }
    },
  });
}

export function useProjectAsIs(
  householdId: string | undefined,
  projectId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: homeProjectKeys.asIs(projectId || ''),
    queryFn: () =>
      homeProjectsApi.listAsIs(householdId!, projectId!).then(r => r.as_is),
    enabled: enabled && !!householdId && !!projectId,
  });
}

export function useUpsertAsIs(
  householdId: string | undefined,
  projectId: string | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      element: string;
      state: AsIsState;
      evidence?: string | null;
    }) => homeProjectsApi.upsertAsIs(householdId!, projectId!, input),
    onSuccess: () => {
      if (projectId) {
        void qc.invalidateQueries({ queryKey: homeProjectKeys.asIs(projectId) });
      }
    },
  });
}

/**
 * Save a generated plan as a real project, wherever this household's projects live.
 *
 * This is the half that makes Smart Project work on House at all.
 *
 * The original design had the Worker write the drafted project straight into
 * D1. House is local-first: a household's projects live in the encrypted ledger
 * on the member's own device, and the Worker cannot read or write that. So on
 * the brand's DEFAULT configuration the drafted project landed somewhere the
 * member's phone could never open, and the feature had to be hidden from
 * everyone to avoid producing invisible projects.
 *
 * Splitting it fixes that. The server generates — it has the model, the key and
 * the photos. The client saves, through `homeProjectsApi`, which the local
 * proxy already routes correctly per household. Neither side needs to know
 * which kind of household this is.
 *
 * Created as a DRAFT (`visibility: 'draft'`), so nothing reaches the rest of
 * the household until the member reviews and publishes — the property that made
 * it safe for a model to write these rows in the first place.
 *
 * Best-effort per child: one failed blocker must not cost the member the whole
 * project. The project itself is the only step that throws.
 */
export interface MaterializeProgress {
  /** Rows attempted so far, successful or not. */
  done: number;
  /** Rows this plan will attempt in total. Known before the first write. */
  total: number;
  /** How many of `done` did not land. Zero is the expected value. */
  failed: number;
}

export async function materializeSmartProjectPlan(
  householdId: string,
  plan: SmartProjectPlan,
  spaceIds?: string[],
  options?: {
    /**
     * Called after every child row.
     *
     * Exists because this stopped being a quick tail-end to generation. A draft
     * that names the consumables an installation needs carries thirty-odd
     * materials, and on a server-backed household every one of those is a round
     * trip — so a member watches an unchanging "Drafting your project" for a
     * minute after the model has already finished, and concludes it has hung.
     * The wizard turns these counts into the same `n of m` line the photo
     * stages use.
     */
    onProgress?: (progress: MaterializeProgress) => void;
  },
): Promise<HomeProject> {
  const { project } = await homeProjectsApi.create(householdId, {
    title: plan.generation.title,
    type: plan.generation.type,
    templateKey: plan.generation.template_key ?? undefined,
    summary: plan.generation.summary,
    visibility: 'draft',
    spaceIds,
  });

  const total =
    plan.phases.length +
    plan.surfaces.length +
    plan.generation.materials.length +
    plan.generation.tasks.length +
    plan.blockers.length +
    (plan.roomModels.length ? 1 : 0);
  let done = 0;
  let failed = 0;

  const settle = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      // Logged, not thrown: a project with nine of its ten phases is worth far
      // more to the member than an error and nothing.
      failed += 1;
      if (__DEV__) console.warn(`[smart-project] ${label} failed`, err);
    }
    done += 1;
    options?.onProgress?.({ done, total, failed });
  };

  for (const phase of plan.phases) {
    await settle('phase', () =>
      homeProjectsApi.createPhase(householdId, project.id, { title: phase.title }),
    );
  }

  // Surfaces first, then the materials that hang off them, so a material can be
  // attached to the group it belongs to rather than left loose.
  const groupIdByName = new Map<string, string>();
  for (const surface of plan.surfaces) {
    await settle('surface', async () => {
      const { option_group } = await homeProjectsApi.createOptionGroup(
        householdId,
        project.id,
        {
          name: surface.name,
          category: surface.category,
          areaValue: surface.area_m2,
          areaUnit: 'm2',
          wasteFactorPct: surface.waste_factor_pct,
        },
      );
      groupIdByName.set(surface.name.toLowerCase(), option_group.id);
    });
  }

  for (const [index, material] of plan.generation.materials.entries()) {
    await settle('material', () =>
      homeProjectsApi.createSelection(householdId, project.id, {
        name: material.label,
        category: material.category,
        unit: material.unit,
        /**
         * The plan's own order, stated rather than left to the loop.
         *
         * `createSelection` PREPENDS by default, because a material a member
         * adds by hand belongs at the top of the list. That rule applied to
         * this loop would hand the member the plan backwards — every row
         * inserted above the one before it — so the seed path names its
         * positions. Matches the Worker's smart-draft job, which writes the
         * same indexes when it seeds the materials server-side.
         */
        sortOrder: index,
        // No price. The member or their contractor supplies every number —
        // see BRD D3.
        optionGroupId: material.surface_name
          ? groupIdByName.get(material.surface_name.toLowerCase())
          : undefined,
        notes: material.notes,
        /**
         * Coverage is what turns a material into a QUANTITY.
         *
         * `priceOption` needs `coverage_per_unit` and an area unit together
         * with the group's area to answer "how many sheets" — with either
         * missing it reports `no_coverage` and the card shows a material with
         * no number against it. The model is asked for coverage precisely
         * because it is a property of the product rather than a calculation
         * about this room, and dropping it here spent that for nothing: the
         * server derived 42.1 m² of wall and the member still had to work out
         * how many boards that is.
         *
         * Only the two AREA units are passed on. `lm` and `each` are legitimate
         * answers from the model for skirting and for a window, and neither is
         * an area — writing one into `coverage_unit` would make
         * `isHomeProjectAreaUnit` reject it downstream anyway, but as a stored
         * value that looks meaningful and is not.
         */
        ...(material.coverage_per_unit != null &&
        (material.coverage_unit === 'm2' || material.coverage_unit === 'sqft')
          ? {
              coveragePerUnit: material.coverage_per_unit,
              coverageUnit: material.coverage_unit,
            }
          : {}),
      }),
    );
  }

  /**
   * The actions inside the phases — "foam the perimeter gap", not "fit the
   * window" — created only when the member asked for them.
   *
   * The plan has carried these since the first version and nothing ever wrote
   * them: the member ticked nothing, so nothing was missing, and a generated
   * task list that existed only in a JSON payload was invisible either way.
   * Now that the wizard asks outright, an unticked section is an empty array
   * (the server strips it) and a ticked one has to land somewhere the member
   * can see it, which is the project's own Tasks tab.
   *
   * `rationale` becomes the description rather than being dropped, because it
   * is usually the ordering constraint — "before the walls close up" — and that
   * is the part a member reading the task a week later needs.
   */
  for (const task of plan.generation.tasks) {
    await settle('task', () =>
      homeProjectsApi.createTask(householdId, project.id, {
        title: task.title,
        description: task.rationale,
      }),
    );
  }

  for (const blocker of plan.blockers) {
    await settle('blocker', () =>
      homeProjectsApi.createBlocker(householdId, project.id, {
        title: blocker.title,
        severity: blocker.severity,
        notes: blocker.question,
      }),
    );
  }

  // One room model per measured space. Only the first is stored: the geometry
  // row is per project, and a second would overwrite the first rather than sit
  // beside it.
  if (plan.roomModels.length) {
    await settle('geometry', () =>
      homeProjectsApi.putManualGeometry(householdId, project.id, plan.roomModels[0]),
    );
  }

  return project;
}
