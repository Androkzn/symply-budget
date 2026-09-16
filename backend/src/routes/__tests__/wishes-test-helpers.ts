/**
 * Local D1 table bootstrap for Wishes tests. Mirrors migration 0076_wishes.sql
 * but drops the FK REFERENCES (the shared core helpers own users/households and
 * SQLite FK enforcement is off in the test pool anyway). See
 * budget-test-helpers.ts for the sibling pattern.
 */
export async function createWishTables(db: D1Database): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS wishes (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      title TEXT NOT NULL,
      notes TEXT,
      cover_image_key TEXT,
      estimated_cost_cents INTEGER,
      target_date TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS wish_entries (
      id TEXT PRIMARY KEY,
      wish_id TEXT NOT NULL,
      household_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      body TEXT,
      image_key TEXT,
      url TEXT,
      link_title TEXT,
      price_cents INTEGER,
      parent_entry_id TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  ];
  for (const sql of statements) {
    await db.exec(sql.replace(/\s+/g, ' ').trim());
  }
}

export async function resetWishTables(db: D1Database): Promise<void> {
  for (const t of ['wish_entries', 'wishes']) {
    try {
      await db.exec(`DELETE FROM ${t}`);
    } catch {
      // table may not exist yet in this test file; ignore
    }
  }
}
