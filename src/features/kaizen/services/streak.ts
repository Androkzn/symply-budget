import { getKaizenDatabase } from './database';

/** UTC `YYYY-MM-DD` — matches how action logs store their `date` column. */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Consecutive-day "show up" streak: days ending today (with a one-day grace so a
 * fresh morning before the first log still shows yesterday's streak) on which at
 * least one Daily Core action was completed and not skipped.
 *
 * Used to enrich the home-screen widget / Watch snapshot. Returns 0 on any error
 * so the surfaces degrade gracefully instead of throwing.
 */
export async function computeDailyCoreStreak(userId: string): Promise<number> {
  try {
    const db = await getKaizenDatabase();
    const rows = await db.getAllAsync<{ date: string; done: number }>(
      `SELECT date, SUM(CASE WHEN skipped = 0 AND completed_at IS NOT NULL THEN 1 ELSE 0 END) AS done
       FROM kaizen_action_logs
       WHERE user_id = ? AND deleted_at IS NULL
       GROUP BY date
       HAVING done > 0
       ORDER BY date DESC`,
      [userId],
    );
    if (!rows.length) return 0;

    const hitDates = new Set(rows.map(row => row.date));
    const dayMs = 86_400_000;
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    let cursor = new Date(startOfToday);
    if (!hitDates.has(isoDay(cursor))) {
      // Grace: nothing logged yet today — anchor the streak on yesterday instead.
      cursor = new Date(startOfToday.getTime() - dayMs);
      if (!hitDates.has(isoDay(cursor))) return 0;
    }

    let streak = 0;
    while (hitDates.has(isoDay(cursor))) {
      streak += 1;
      cursor = new Date(cursor.getTime() - dayMs);
    }
    return streak;
  } catch {
    return 0;
  }
}
