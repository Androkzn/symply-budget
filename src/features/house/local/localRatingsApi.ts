/**
 * Local `contractor_job_ratings` — the ledger counterpart of
 * `src/api/ratings.ts` (plan §11, sub-wave B4).
 *
 * Six methods, all local, no gap of any kind — rating the plumber who just left
 * needs no server and no model. What makes this the most interesting small
 * module in the sub-wave is that it is where three separate hazards land at
 * once.
 *
 * ## 1. S3b — the deterministic id, and the reason this table has one
 *
 * `contractor_job_ratings_visit_id_idx` is a real D1 `uniqueIndex` on
 * `visit_id`, and `rating-service.ts` raises `A rating already exists for this
 * visit` on top of it. One call-out, one rating.
 *
 * The ledger has no unique index, so the id has to carry that identity instead:
 * `houseDeterministicIds.contractorJobRating(visitId)` mints the same id on
 * every device from the same visit. This is the FIRST live S3b table keyed on a
 * single column, and its double-create is not a race — a post-visit notification
 * asks the household to rate the job, and either member can answer it from a
 * driveway with no signal. With random ids the merge would keep both answers and
 * count one job twice in the contractor's average.
 *
 * The duplicate CHECK is kept as well, because it is a different guarantee: the
 * id makes two offline creates converge, the check makes a second create on the
 * SAME device raise the way the Worker does, instead of silently overwriting the
 * first member's review.
 *
 * ## 2. Every aggregate is recomputed, none is stored
 *
 * `RatingSummary` is eight averages, a percentage and a distribution, all
 * derived from the rows. Storing any of them would be the derived-collection
 * rule's exact failure mode — two members rate two different visits offline,
 * each computes an average that omits the other's, and per-field LWW picks one
 * device's answer, which is then wrong on both.
 *
 * **`contractors.rating` is the trap this creates, and it is deliberately NOT
 * written here.** `rating-service.ts` recomputes that column after every create,
 * update and delete. Reproducing it would be wrong twice over: it is a stored
 * aggregate under LWW, AND the same column is the member's own hand-entered
 * rating on the contractor form — `contractorsApi.create` and `update` both
 * accept `rating`, and B1's facade writes it. A recompute would silently
 * overwrite what the member typed. So the two meanings stay separate: the column
 * is the member's opinion of the company, `getSummary` is the arithmetic over
 * the jobs, and no write here touches a contractor row.
 *
 * ## 3. The client and the Worker disagree about BOTH composed shapes
 *
 * This is the widest DTO divergence in Wave B, and it is not close:
 *
 *  - **`RatingWithDetails`.** The client declares `visit` (`id`, `visit_date`,
 *    `purpose`) and `rated_by_user` (`id`, `name`). The Worker's own interface
 *    of the same name declares `contractor` and `reviewPhotos` and neither of
 *    the client's two. They are different types wearing one name.
 *  - **`RatingSummary`.** The client is snake_case with a `rating_distribution`
 *    histogram; the Worker answers camelCase with a `recentTrend` and no
 *    histogram.
 *
 * This facade emits the **client's** shapes, because that is what `tsc` checks
 * and what a screen reading `summary.rating_distribution['5']` needs. The same
 * call B2 made on `QuoteWithDetails.phone` and B3 on `progress.totalAmount`. Two
 * consequences worth naming:
 *
 *  - **`visit.purpose` has no D1 column.** `contractor_visits` carries
 *    `description`, which is what the visit screens render as the purpose of the
 *    call-out, so that is what fills it. Recorded here rather than corrected,
 *    because correcting it means changing a DTO every screen already reads.
 *  - **`rated_by` is populated, where the Worker leaves it null.**
 *    `createRating` never sets the column, so `rated_by_user` is dead on the
 *    remote path. The device knows who is rating, so it writes it and resolves
 *    the name out of `householdMembers` — a superset that cannot break a screen
 *    and that makes "Ann rated this 5" work in a household of two.
 *
 * **No bulk path and no cascade.** `contractor_job_ratings` is a leaf: nothing
 * references it. It is on the receiving end of two cascades instead — from
 * `contractors` and from `contractorVisits` — both handled in
 * `localContractorsApi`, which is where the parents live.
 */
// Side-effect BEFORE @symply/local-first — @noble captures globalThis.crypto at
// module load, and this module is a Proxy entry point, so it can be the first
// House module a screen pulls into the graph.
import './cryptoPolyfill';

import type { RatingSummary, RatingWithDetails } from '@api/ratings';

import { getLocalHouseMemberId } from './engine';
import { HouseLocalUnknownPropertyError } from './errors';
import { houseDeterministicIds } from './ids';
import { activeHouseholdId, nowIso, rowsOf, writeLocal } from './localWrite';
import type {
  LocalContractor,
  LocalContractorJobRating,
  LocalContractorVisit,
  LocalHouseholdMember,
} from './types';

// ---------------------------------------------------------------------------
// Input shapes — mirrors of the module-private request types in
// `src/api/ratings.ts`. They are not exported there, so they are restated rather
// than imported; `apiParity.test.ts` catches a method that disappears and `tsc`
// catches a field whose type changed on the DTO.
// ---------------------------------------------------------------------------

export type CreateLocalRatingInput = {
  visit_id: string;
  overall_rating: number;
  quality_rating?: number;
  punctuality_rating?: number;
  communication_rating?: number;
  cleanliness_rating?: number;
  value_rating?: number;
  would_hire_again?: boolean;
  review_text?: string;
  review_photos?: string[];
  is_private?: boolean;
};

export type UpdateLocalRatingInput = Omit<CreateLocalRatingInput, 'visit_id' | 'overall_rating'> & {
  overall_rating?: number;
};

/**
 * The Worker's `ValidationError` — a 400 the screens already render, and NOT a
 * `HouseLocalUnsupportedError`. "A rating already exists for this visit" is true
 * on both backends; "this feature is off in private mode" would not be.
 *
 * The same shape `localQuotesApi.LocalQuoteStateError` takes, and for the same
 * reason: a member-facing error about the state of their data must not be
 * dressed up as a missing capability.
 */
class LocalRatingStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalRatingStateError';
  }
}

/** The five optional dimensions, in the order the rating sheet renders them. */
const OPTIONAL_RATING_FIELDS = [
  'quality_rating',
  'punctuality_rating',
  'communication_rating',
  'cleanliness_rating',
  'value_rating',
] as const;

type OptionalRatingField = (typeof OPTIONAL_RATING_FIELDS)[number];

/** Human labels for the validation messages, matching `rating-service.ts`. */
const RATING_FIELD_LABELS: Record<OptionalRatingField, string> = {
  quality_rating: 'Quality rating',
  punctuality_rating: 'Punctuality rating',
  communication_rating: 'Communication rating',
  cleanliness_rating: 'Cleanliness rating',
  value_rating: 'Value rating',
};

function requireActiveProperty(householdId: string): string {
  const active = activeHouseholdId();
  if (householdId !== active) throw new HouseLocalUnknownPropertyError(householdId);
  return active;
}

function ratingsOf(householdId: string): LocalContractorJobRating[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalContractorJobRating>('contractorJobRatings');
}

function visitsById(householdId: string): Map<string, LocalContractorVisit> {
  requireActiveProperty(householdId);
  return new Map(rowsOf<LocalContractorVisit>('contractorVisits').map((row) => [row.id, row]));
}

/** `checkContractorAccess` — every rating path runs it first. */
function requireContractor(householdId: string, contractorId: string): LocalContractor {
  requireActiveProperty(householdId);
  const found = rowsOf<LocalContractor>('contractors').find((row) => row.id === contractorId);
  if (!found) throw new Error('Contractor not found');
  return found;
}

/** Server order: `created_at` desc — newest review first. */
function byCreatedAtDesc(a: { created_at: string }, b: { created_at: string }): number {
  return b.created_at.localeCompare(a.created_at);
}

/** `1 ≤ n ≤ 5`, the Worker's own bounds and its own message text. */
function assertInRange(value: number | undefined, label: string): void {
  if (value !== undefined && (value < 1 || value > 5)) {
    throw new LocalRatingStateError(`${label} must be between 1 and 5`);
  }
}

/**
 * `rated_by` → the client's `{ id, name }`, resolved out of `householdMembers`.
 *
 * `display_name` is nullable in the DTO, so the email is the fallback — a name
 * slot that renders "null" is worse than one that renders an address. An id with
 * no member row at all (a member who left) resolves to `null`, which is what the
 * client type already allows for.
 */
function ratedByUser(
  members: readonly LocalHouseholdMember[],
  ratedBy: string | null,
): RatingWithDetails['rated_by_user'] {
  if (!ratedBy) return null;
  const member = members.find((row) => row.user_id === ratedBy);
  if (!member) return null;
  return { id: ratedBy, name: member.display_name || member.email };
}

/**
 * The client's `RatingWithDetails`, rebuilt on every read.
 *
 * `purpose` is filled from the visit's `description` — there is no `purpose`
 * column in D1 and the client type asks for one. See the header.
 */
function enrich(
  rating: LocalContractorJobRating,
  visit: LocalContractorVisit,
  members: readonly LocalHouseholdMember[],
): RatingWithDetails {
  return {
    ...rating,
    visit: {
      id: visit.id,
      visit_date: visit.visit_date,
      purpose: visit.description,
    },
    rated_by_user: ratedByUser(members, rating.rated_by),
  };
}

/**
 * A LIST read drops a rating whose visit is gone; a SINGLE read raises.
 *
 * The split is `localProjectsApi`'s and `localQuotesApi`'s. After B4 a dangling
 * visit should be impossible — `deleteVisit` cascades ratings in the same op —
 * but a peer running an older build can still deliver one, and one broken row
 * must not blank the whole review list.
 */
function enrichAll(
  ratings: readonly LocalContractorJobRating[],
  visits: Map<string, LocalContractorVisit>,
  members: readonly LocalHouseholdMember[],
): RatingWithDetails[] {
  const out: RatingWithDetails[] = [];
  for (const rating of ratings) {
    const visit = visits.get(rating.visit_id);
    if (visit) out.push(enrich(rating, visit, members));
  }
  return out;
}

function requireRating(householdId: string, ratingId: string): LocalContractorJobRating {
  const found = ratingsOf(householdId).find((row) => row.id === ratingId);
  if (!found) throw new Error('Rating not found');
  return found;
}

/** One place builds a single-rating answer, so every write returns one shape. */
function detail(householdId: string, ratingId: string): { rating: RatingWithDetails } {
  const rating = requireRating(householdId, ratingId);
  const visit = visitsById(householdId).get(rating.visit_id);
  if (!visit) throw new Error('Visit not found');
  return {
    rating: enrich(rating, visit, rowsOf<LocalHouseholdMember>('householdMembers')),
  };
}

/** One decimal place, the Worker's rounding — `Math.round(x * 10) / 10`. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Mean of the non-null values, or `null` when nobody answered that dimension. */
function averageOf(values: readonly (number | null)[]): number | null {
  const answered = values.filter((value): value is number => value !== null);
  if (answered.length === 0) return null;
  return round1(answered.reduce((sum, value) => sum + value, 0) / answered.length);
}

export const localRatingsApi = {
  /** `GET /contractors/:id/ratings` — newest first. */
  getAll: async (householdId: string, contractorId: string) => {
    requireContractor(householdId, contractorId);
    const ratings = ratingsOf(householdId)
      .filter((row) => row.contractor_id === contractorId)
      .sort(byCreatedAtDesc);
    return {
      ratings: enrichAll(
        ratings,
        visitsById(householdId),
        rowsOf<LocalHouseholdMember>('householdMembers'),
      ),
    };
  },

  /**
   * `GET /contractors/:id/ratings/summary` — every figure recomputed from the
   * rows, in the CLIENT's shape.
   *
   * The empty case is the Worker's: zero reviews answer `0` for the overall
   * average and `null` for each dimension, rather than omitting the block. A
   * screen that renders "no reviews yet" needs a summary object to ask.
   *
   * `rating_distribution` is the client-only field with no server counterpart at
   * all — a five-bucket histogram of `overall_rating`. Computed here because the
   * type declares it and the star-bar UI reads it; the remote path renders an
   * empty chart today.
   */
  getSummary: async (householdId: string, contractorId: string) => {
    requireContractor(householdId, contractorId);
    const ratings = ratingsOf(householdId).filter((row) => row.contractor_id === contractorId);

    const distribution: RatingSummary['rating_distribution'] = {
      '1': 0,
      '2': 0,
      '3': 0,
      '4': 0,
      '5': 0,
    };
    for (const rating of ratings) {
      const bucket = String(rating.overall_rating) as keyof typeof distribution;
      if (bucket in distribution) distribution[bucket] += 1;
    }

    const answered = ratings.filter((row) => row.would_hire_again !== null);
    const summary: RatingSummary = {
      contractor_id: contractorId,
      total_ratings: ratings.length,
      // `averageOf` returns null for an empty list; the overall average is the
      // one figure the Worker floors at 0 instead, because it is rendered as a
      // number of stars and `null` stars is not a state the bar can show.
      average_overall: averageOf(ratings.map((row) => row.overall_rating)) ?? 0,
      average_quality: averageOf(ratings.map((row) => row.quality_rating)),
      average_punctuality: averageOf(ratings.map((row) => row.punctuality_rating)),
      average_communication: averageOf(ratings.map((row) => row.communication_rating)),
      average_cleanliness: averageOf(ratings.map((row) => row.cleanliness_rating)),
      average_value: averageOf(ratings.map((row) => row.value_rating)),
      // Over the members who ANSWERED the question, not over every rating — a
      // review that left it blank is not a "no". The Worker's own denominator.
      would_hire_again_percentage:
        answered.length === 0
          ? 0
          : Math.round(
              (answered.filter((row) => row.would_hire_again === true).length / answered.length) *
                100,
            ),
      rating_distribution: distribution,
    };
    return { summary };
  },

  /**
   * `GET /contractors/:id/ratings/:ratingId`.
   *
   * Like the Worker, this resolves the rating by `(id, household)` and ignores
   * the contractor in the path — `getRating` never filters on it. Tightening it
   * here would make a link that works online 404 offline.
   */
  getOne: async (householdId: string, _contractorId: string, ratingId: string) =>
    detail(householdId, ratingId),

  /**
   * `POST /contractors/:id/ratings`.
   *
   * The id is DETERMINISTIC, minted from `visit_id` — see the header. The
   * duplicate check runs first and raises exactly as the Worker does, so a
   * second rating for a visit is an error rather than a silent overwrite of the
   * other member's words.
   *
   * `is_private` defaults to TRUE, matching both the D1 column default and the
   * service: a review is the household's own note about a contractor unless
   * somebody decides otherwise, which is the right default for something that
   * can later be attached to a public share link.
   */
  create: async (householdId: string, contractorId: string, data: CreateLocalRatingInput) => {
    requireContractor(householdId, contractorId);

    if (data.overall_rating < 1 || data.overall_rating > 5) {
      throw new LocalRatingStateError('Overall rating must be between 1 and 5');
    }
    for (const field of OPTIONAL_RATING_FIELDS) {
      assertInRange(data[field], RATING_FIELD_LABELS[field]);
    }

    const existing = ratingsOf(householdId).find((row) => row.visit_id === data.visit_id);
    if (existing) throw new LocalRatingStateError('A rating already exists for this visit');

    const rating: LocalContractorJobRating = {
      // S3b: one rating per visit, so the id IS the visit. Two members answering
      // the same "how did it go?" notification offline converge on one row.
      id: houseDeterministicIds.contractorJobRating(data.visit_id),
      contractor_id: contractorId,
      visit_id: data.visit_id,
      household_id: householdId,
      // The Worker leaves this null; the device knows who is rating. See header.
      rated_by: getLocalHouseMemberId(),
      overall_rating: data.overall_rating,
      quality_rating: data.quality_rating ?? null,
      punctuality_rating: data.punctuality_rating ?? null,
      communication_rating: data.communication_rating ?? null,
      cleanliness_rating: data.cleanliness_rating ?? null,
      value_rating: data.value_rating ?? null,
      would_hire_again: data.would_hire_again ?? null,
      review_text: data.review_text ?? null,
      // Photo KEYS as the JSON text D1 stores; the images move through the H6
      // blob channel, exactly as `review_photos` does on the server.
      review_photos: data.review_photos ? JSON.stringify(data.review_photos) : null,
      is_private: data.is_private ?? true,
      created_at: nowIso(),
    };

    await writeLocal(
      (draft) => {
        draft.contractorJobRatings.push(rating);
      },
      {
        opType: 'CONTRACTOR_RATING_CREATE',
        entityType: 'contractor_rating',
        entityId: rating.id,
        payload: rating,
      },
    );
    return detail(householdId, rating.id);
  },

  /**
   * `PATCH /contractors/:id/ratings/:ratingId`.
   *
   * Validation runs before anything is written, so a rejected edit leaves no
   * partial op. `review_photos` is the one field the Worker writes without an
   * `|| null`: passing an explicit empty array stores `'[]'` rather than NULL,
   * and reproducing that keeps "I removed all the photos" from reading as "I
   * never added any".
   */
  update: async (
    householdId: string,
    _contractorId: string,
    ratingId: string,
    data: UpdateLocalRatingInput,
  ) => {
    requireRating(householdId, ratingId);

    assertInRange(data.overall_rating, 'Overall rating');
    for (const field of OPTIONAL_RATING_FIELDS) {
      assertInRange(data[field], RATING_FIELD_LABELS[field]);
    }

    await writeLocal(
      (draft) => {
        const rating = draft.contractorJobRatings.find(
          (row) => row.id === ratingId && row.household_id === householdId,
        );
        if (!rating) throw new Error('Rating not found');
        if (data.overall_rating !== undefined) rating.overall_rating = data.overall_rating;
        for (const field of OPTIONAL_RATING_FIELDS) {
          const value = data[field];
          if (value !== undefined) rating[field] = value;
        }
        if (data.would_hire_again !== undefined) rating.would_hire_again = data.would_hire_again;
        if (data.review_text !== undefined) rating.review_text = data.review_text;
        if (data.review_photos !== undefined) {
          rating.review_photos = JSON.stringify(data.review_photos);
        }
        if (data.is_private !== undefined) rating.is_private = data.is_private;
        // No `updated_at` — `contractor_job_ratings` has no such column, and
        // adding one on the ledger row would put a field in the op log that the
        // D1 table cannot hold.
      },
      {
        opType: 'CONTRACTOR_RATING_UPDATE',
        entityType: 'contractor_rating',
        entityId: ratingId,
        payload: data,
      },
    );
    return detail(householdId, ratingId);
  },

  /**
   * `DELETE /contractors/:id/ratings/:ratingId` — the row alone.
   *
   * Nothing cascades from this table; it is a leaf. The Worker's second write
   * here — recomputing `contractors.rating` — is deliberately not reproduced,
   * for the reason in the header: that column is the member's own field, and
   * `getSummary` derives the arithmetic on read.
   *
   * Note the S3b consequence: deleting a rating and rating the same visit again
   * mints the SAME id, and the ledger tombstone is absorbing. That is the S3a
   * hazard S3b trades against, and it is the right trade here — re-rating a
   * visit is rare, while two members rating one visit offline is the ordinary
   * flow the notification produces.
   */
  delete: async (householdId: string, _contractorId: string, ratingId: string) => {
    requireRating(householdId, ratingId);
    await writeLocal(
      (draft) => {
        draft.contractorJobRatings = draft.contractorJobRatings.filter(
          (row) => !(row.id === ratingId && row.household_id === householdId),
        );
      },
      {
        opType: 'CONTRACTOR_RATING_DELETE',
        entityType: 'contractor_rating',
        entityId: ratingId,
        payload: { id: ratingId },
      },
    );
  },
};
