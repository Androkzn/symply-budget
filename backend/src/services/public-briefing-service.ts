/**
 * Public Aihousekeeper briefing page data (Track A / A4).
 *
 * Gate remains HMAC token verification — no JWT on this path.
 */
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import * as schema from '../db/schema';
import { households } from '../db/schema';
import { assistantBriefings } from '../db/schema-aihousekeeper';
import type { Env } from '../types';

import { renderBriefingHtml } from './aihousekeeper/briefing-html';
import { verifyBriefingToken } from './aihousekeeper/briefing-token';

export type PublicBriefingPageResult =
  | { status: 'unauthorized'; message: string }
  | { status: 'expired'; message: string }
  | { status: 'revoked'; message: string }
  | { status: 'not_found'; message: string }
  | { status: 'ok'; html: string };

function parseBullets(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    // Malformed historical payload — treat as empty list.
  }
  return [];
}

export async function buildPublicBriefingPage(
  token: string,
  env: Env,
): Promise<PublicBriefingPageResult> {
  const db = drizzle(env.DB, { schema });
  const result = await verifyBriefingToken(token, env, db);
  if (!result.ok) {
    if (result.reason === 'expired') {
      return { status: 'expired', message: 'This link has expired.' };
    }
    return { status: 'unauthorized', message: 'Invalid or expired link.' };
  }
  if (result.revoked) {
    return { status: 'revoked', message: 'This link has been revoked.' };
  }

  const briefing = await db
    .select({
      paragraph: assistantBriefings.paragraph,
      bullets_json: assistantBriefings.bullets_json,
      date: assistantBriefings.date,
    })
    .from(assistantBriefings)
    .where(
      and(
        eq(assistantBriefings.household_id, result.hid),
        eq(assistantBriefings.date, result.date),
      ),
    )
    .get();

  if (!briefing) {
    return { status: 'not_found', message: 'Briefing not found.' };
  }

  const household = await db
    .select({ name: households.name })
    .from(households)
    .where(eq(households.id, result.hid))
    .get();

  const html = renderBriefingHtml({
    paragraph: briefing.paragraph || '',
    bullets: parseBullets(briefing.bullets_json),
    date: briefing.date,
    householdName: household?.name ?? 'Household',
  });

  return { status: 'ok', html };
}
