#!/usr/bin/env node
/**
 * Scoped D1 copy: production -> staging, limited to specific accounts.
 *
 * Copies EVERYTHING owned by a set of users (their households + all members +
 * every household-scoped row + transitive children like report chunks/findings/
 * task subtasks) from the production D1 database into the staging D1 database.
 *
 * The table/column/foreign-key graph is discovered live from the source DB via
 * PRAGMA, so new tables/migrations are picked up automatically — nothing is
 * hard-coded to the schema.
 *
 * SAFETY:
 *   - Reads from --source-env (default: production). Never writes there.
 *   - Writes ONLY to --target-env (must NOT be production).
 *   - Dry-run by default. Pass --apply to execute against staging.
 *
 * Usage (run from the `backend/` directory so wrangler.toml resolves):
 *   node <path>/copy-d1-scoped.mjs --emails a@x.com,b@y.com          # dry-run
 *   node <path>/copy-d1-scoped.mjs --emails a@x.com,b@y.com --apply  # execute
 *
 * Options:
 *   --emails <csv>        Required. Seed account emails.
 *   --apply               Execute DELETE+INSERT against the target. Omit = dry-run.
 *   --out <file>          SQL output path (default: ./copy-prod-to-staging.sql).
 *   --source-db <name>    Default: simple-house-db
 *   --source-env <env>    Default: production
 *   --target-db <name>    Default: simple-house-db-staging
 *   --target-env <env>    Default: staging
 *   --mode <replace|upsert>  Default: replace (delete target's scoped rows first).
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// ---------- args ----------
function parseArgs(argv) {
  const args = { mode: 'replace', apply: false, out: 'copy-prod-to-staging.sql',
    sourceDb: 'simple-house-db', sourceEnv: 'production',
    targetDb: 'simple-house-db-staging', targetEnv: 'staging',
    config: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--emails') args.emails = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--source-db') args.sourceDb = argv[++i];
    else if (a === '--source-env') args.sourceEnv = argv[++i];
    else if (a === '--target-db') args.targetDb = argv[++i];
    else if (a === '--target-env') args.targetEnv = argv[++i];
    else if (a === '--mode') args.mode = argv[++i];
    else if (a === '--config' || a === '-c') args.config = argv[++i];
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!args.emails) throw new Error('Missing required --emails a@x.com,b@y.com');
  if (args.targetEnv === 'production' || args.targetDb === 'simple-house-db' || args.targetDb === 'simple-budget-db') {
    throw new Error('Refusing to target production. Target must be staging.');
  }
  return args;
}

// ---------- wrangler d1 helpers ----------
function wranglerBase(args, db, env) {
  const cmd = ['wrangler', 'd1', 'execute', db, '--remote', '--env', env];
  if (args.config) cmd.push('-c', args.config);
  return cmd;
}

function d1Query(db, env, sql, args = {}) {
  const out = execFileSync(
    'npx',
    [...wranglerBase(args, db, env), '--json', '--command', sql],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }
  );
  const start = out.indexOf('[');
  if (start === -1) throw new Error(`Unexpected wrangler output:\n${out.slice(0, 500)}`);
  const parsed = JSON.parse(out.slice(start));
  // wrangler returns an array of result-sets (one per statement).
  return parsed.map((r) => r.results ?? []);
}

function d1File(db, env, file, args = {}) {
  const out = execFileSync(
    'npx',
    [...wranglerBase(args, db, env), '--file', file],
    { encoding: 'utf8', input: 'y\n', maxBuffer: 512 * 1024 * 1024 }
  );
  console.log(out);
}

// ---------- SQL literal helpers ----------
function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replace(/'/g, "''")}'`;
}
const idList = (ids) => ids.map((x) => `'${String(x).replace(/'/g, "''")}'`).join(',');
const qcol = (c) => `"${c}"`;

// ---------- main ----------
const args = parseArgs(process.argv);
const emails = args.emails.split(',').map((e) => e.trim()).filter(Boolean);

const src = (sql) => d1Query(args.sourceDb, args.sourceEnv, sql, args);

console.log(`\n== Scoped copy: ${args.sourceDb}/${args.sourceEnv} -> ${args.targetDb}/${args.targetEnv} ==`);
console.log(`Seed emails: ${emails.join(', ')}`);
console.log(`Mode: ${args.mode} | Apply: ${args.apply ? 'YES (will write to staging)' : 'no (dry-run)'}\n`);

// 1) Resolve scope in BOTH databases ----------------------------------------
// The seed users usually already exist in staging (same emails, DIFFERENT ids)
// with their own data. We must therefore export using the SOURCE ids but DELETE
// the target's existing rows using the TARGET ids — otherwise INSERT OR REPLACE
// collides on the unique email/oauth columns and D1's NO-ACTION foreign keys
// (invited_by / created_by / assigned_to …) block the implied delete.
const tgt = (sql) => d1Query(args.targetDb, args.targetEnv, sql, args);
function resolveScope(q, label) {
  const seed = q(`SELECT id FROM users WHERE email IN (${idList(emails)})`)[0].map((r) => r.id);
  if (seed.length === 0) return { seedUserIds: [], householdIds: [], allUserIds: [] };
  const hh = q(`SELECT DISTINCT household_id AS id FROM household_members WHERE user_id IN (${idList(seed)})`)[0].map((r) => r.id);
  const members = hh.length
    ? q(`SELECT DISTINCT user_id AS id FROM household_members WHERE household_id IN (${idList(hh)})`)[0].map((r) => r.id)
    : [];
  const allUserIds = Array.from(new Set([...seed, ...members]));
  console.log(`[${label}] users(seed)=${seed.length} households=${hh.length} users(incl co-members)=${allUserIds.length}`);
  return { seedUserIds: seed, householdIds: hh, allUserIds };
}

const srcScope = resolveScope(src, 'source');
if (srcScope.seedUserIds.length === 0) throw new Error('No matching users in source DB.');
if (srcScope.householdIds.length === 0) throw new Error('Seed users belong to no households in source.');
const tgtScope = resolveScope(tgt, 'target');
console.log('');

const householdIds = srcScope.householdIds; // for reporting

// 2) Introspect schema (tables, columns, FKs) --------------------------------
// Ephemeral auth/session tables — sensitive token hashes, per-device, and not
// meaningful to replicate. Users are still copied, so password/OAuth login works.
const EXCLUDE_TABLES = new Set(['refresh_tokens', 'email_verifications', 'password_resets']);
// FTS5 virtual tables + their shadow tables (…_data/_idx/_docsize/_config/_content)
// must never be hand-copied — inserting raw rows corrupts the index. The base
// content table is copied normally and FTS is rebuilt by its own triggers.
const EXCLUDE_RE = /_fts($|_)/;

const tableRows = src(
  `SELECT name FROM sqlite_master WHERE type='table'
     AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
     AND name NOT IN ('d1_migrations','__drizzle_migrations')
   ORDER BY name`
)[0];
const tables = tableRows
  .map((r) => r.name)
  .filter((n) => !EXCLUDE_TABLES.has(n) && !EXCLUDE_RE.test(n));

// Batch PRAGMA calls (2 statements per table) into chunks.
const colsByTable = {};
const fksByTable = {};
const pkByTable = {};
const CHUNK = 30;
for (let i = 0; i < tables.length; i += CHUNK) {
  const chunk = tables.slice(i, i + CHUNK);
  const sql = chunk.map((t) => `PRAGMA table_info('${t}'); PRAGMA foreign_key_list('${t}');`).join(' ');
  const sets = src(sql);
  chunk.forEach((t, j) => {
    const info = sets[2 * j];
    colsByTable[t] = info.map((r) => r.name);
    const pkCol = info.find((r) => r.pk && r.pk > 0);
    pkByTable[t] = pkCol ? pkCol.name : info.some((r) => r.name === 'id') ? 'id' : null;
    fksByTable[t] = sets[2 * j + 1].map((r) => ({ from: r.from, to: r.to, table: r.table }));
  });
}

// 3) Derive a WHERE clause per table (memoized, cycle-safe) ------------------
// Returns a SQL predicate string, or null meaning "global reference table:
// copy every row" (e.g. maintenance_templates). Bound to a specific scope
// (household + user id lists) so we can build separate predicates for the
// source export and the target delete.
function makeWhereFor({ hh, us }) {
  const HH = hh || 'NULL'; // empty list -> matches nothing
  const US = us || 'NULL';
  const memo = {};
  function whereFor(table, stack = []) {
    if (table in memo) return memo[table];
    if (stack.includes(table)) return null; // cycle -> treat as global
    const cols = colsByTable[table] || [];
    let result;
    if (table === 'users') result = `${qcol('id')} IN (${US})`;
    else if (table === 'households') result = `${qcol('id')} IN (${HH})`;
    else if (cols.includes('household_id')) result = `${qcol('household_id')} IN (${HH})`;
    else {
      const fks = fksByTable[table] || [];
      const toHh = fks.find((f) => f.table === 'households');
      const toParent = fks.find((f) => f.table !== 'users' && f.table !== table);
      const toUsers = fks.find((f) => f.table === 'users');
      if (toHh) result = `${qcol(toHh.from)} IN (${HH})`;
      else if (toParent) {
        const pw = whereFor(toParent.table, [...stack, table]);
        result = pw === null
          ? null
          : `${qcol(toParent.from)} IN (SELECT ${qcol(toParent.to)} FROM "${toParent.table}" WHERE ${pw})`;
      } else if (toUsers) result = `${qcol(toUsers.from)} IN (${US})`;
      else result = null;
    }
    memo[table] = result;
    return result;
  }
  return whereFor;
}

// Export uses source ids (incl. co-members so their user rows/membership copy).
const whereSrc = makeWhereFor({ hh: idList(srcScope.householdIds), us: idList(srcScope.allUserIds) });
// Delete uses target ids: households the staging accounts belong to, and the
// staging seed users themselves (NOT co-members — we only wipe these accounts).
const whereDel = makeWhereFor({ hh: idList(tgtScope.householdIds), us: idList(tgtScope.seedUserIds) });
const hasTargetScope = tgtScope.seedUserIds.length > 0;

// 4a) Scoped export ----------------------------------------------------------
const rowsByTable = {};      // table -> array of row objects (the copy set)
const includedIds = {};      // table -> Set of PK values already in the copy set
const deletesByTable = {};
const globalTables = [];

for (const table of tables) {
  const where = whereSrc(table);
  if (where === null) globalTables.push(table);
  const sql = `SELECT * FROM "${table}"${where ? ` WHERE ${where}` : ''}`;
  let rows;
  try {
    rows = src(sql)[0];
  } catch (e) {
    console.error(`! Failed exporting ${table}: ${e.message.split('\n')[0]}`);
    rows = [];
  }
  rowsByTable[table] = rows;
  const pk = pkByTable[table];
  includedIds[table] = new Set(pk ? rows.map((r) => r[pk]) : []);
  // Replace mode: clear the TARGET's existing rows for these accounts first
  // (using target ids). Skip global reference tables so we don't wipe shared
  // staging seed data.
  const delWhere = whereDel(table);
  if (args.mode === 'replace' && hasTargetScope && delWhere) {
    deletesByTable[table] = `DELETE FROM "${table}" WHERE ${delWhere};`;
  }
}
const scopedCounts = Object.fromEntries(tables.map((t) => [t, rowsByTable[t].length]));

// 4b) Upward referential closure --------------------------------------------
// A scoped row may reference a parent OUTSIDE the household scope (e.g. an
// expense created_by a user who is no longer a member). D1 enforces foreign
// keys, so every referenced parent must also be copied. Pull those parent rows
// in by primary key, transitively, until nothing new is needed.
let pulled = 0;
for (let pass = 0; pass < 20; pass++) {
  const need = {}; // parentTable -> Set of missing PK ids
  for (const table of tables) {
    for (const fk of fksByTable[table] || []) {
      const parent = fk.table;
      if (!(parent in includedIds) || !pkByTable[parent]) continue;
      for (const row of rowsByTable[table]) {
        const val = row[fk.from];
        if (val != null && !includedIds[parent].has(val)) (need[parent] ||= new Set()).add(val);
      }
    }
  }
  const parents = Object.keys(need).filter((p) => need[p].size);
  if (parents.length === 0) break;
  for (const parent of parents) {
    const ids = [...need[parent]];
    const pk = pkByTable[parent];
    const extra = src(`SELECT * FROM "${parent}" WHERE "${pk}" IN (${idList(ids)})`)[0];
    for (const row of extra) {
      if (!includedIds[parent].has(row[pk])) { rowsByTable[parent].push(row); includedIds[parent].add(row[pk]); pulled++; }
    }
  }
}

// 4b-validate) Check FK integrity of the copy set (uses the actual referenced
// column, which may not be the PK). Reports dangling references so we can see
// exactly what would trip D1's foreign-key enforcement.
const parentIndex = {}; // `${table}:${col}` -> Set of values present in copy set
function parentValues(table, col) {
  const key = `${table}:${col}`;
  if (!parentIndex[key]) parentIndex[key] = new Set((rowsByTable[table] || []).map((r) => r[col]));
  return parentIndex[key];
}
const dangling = [];
for (const table of tables) {
  for (const fk of fksByTable[table] || []) {
    if (!(fk.table in rowsByTable)) continue;
    const present = parentValues(fk.table, fk.to);
    for (const row of rowsByTable[table]) {
      const val = row[fk.from];
      if (val != null && !present.has(val)) {
        dangling.push(`${table}.${fk.from} -> ${fk.table}.${fk.to} = ${JSON.stringify(val)}`);
      }
    }
  }
}
if (dangling.length) {
  const uniq = [...new Set(dangling)];
  console.log(`\n! ${dangling.length} dangling FK reference(s) (${uniq.length} distinct) would break the load:`);
  for (const d of uniq.slice(0, 40)) console.log(`   ${d}`);
}

// 4c) Build INSERT statements -----------------------------------------------
const insertsByTable = {};
const plan = [];
for (const table of tables) {
  const rows = rowsByTable[table];
  const extra = rows.length - scopedCounts[table];
  plan.push({ table, rows: rows.length, extra, scope: globalTables.includes(table) ? 'GLOBAL(all rows)' : 'scoped' });
  if (rows.length === 0) continue;
  const cols = colsByTable[table];
  const colSql = cols.map(qcol).join(',');
  const BATCH = 40;
  const stmts = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const values = rows.slice(i, i + BATCH)
      .map((row) => `(${cols.map((c) => lit(row[c])).join(',')})`)
      .join(',');
    stmts.push(`INSERT OR REPLACE INTO "${table}" (${colSql}) VALUES ${values};`);
  }
  insertsByTable[table] = stmts;
}
if (pulled) console.log(`Upward closure pulled in ${pulled} extra parent row(s) for FK integrity.`);

// Topological order (parents before children) from the FK graph. D1 enforces
// foreign keys and does NOT honor deferral across wrangler's batched execution,
// so INSERTs must run parents-first and DELETEs children-first (reverse).
function topoOrder(allTables) {
  const inSet = new Set(allTables);
  const deps = new Map(allTables.map((t) => [t, new Set()]));
  for (const t of allTables) {
    for (const fk of fksByTable[t] || []) {
      if (fk.table !== t && inSet.has(fk.table)) deps.get(t).add(fk.table); // depend on parent
    }
  }
  const order = [];
  const remaining = new Set(allTables);
  while (remaining.size) {
    const ready = [...remaining].filter((t) => [...deps.get(t)].every((p) => !remaining.has(p))).sort();
    if (ready.length === 0) { order.push(...[...remaining].sort()); break; } // cycle: best-effort
    for (const t of ready) { order.push(t); remaining.delete(t); }
  }
  return order;
}

const order = topoOrder(tables);
const deleteSql = [...order].reverse().filter((t) => deletesByTable[t]).map((t) => deletesByTable[t]);
const insertSql = order.filter((t) => insertsByTable[t]).flatMap((t) => insertsByTable[t]);
const insertStmtCount = insertSql.length;

// 5) Assemble file -----------------------------------------------------------
const header = [
  '-- Auto-generated by copy-d1-scoped.mjs. Do not edit by hand.',
  `-- ${args.sourceDb}/${args.sourceEnv} -> ${args.targetDb}/${args.targetEnv}`,
  `-- Seed emails: ${emails.join(', ')}`,
  `-- Households: ${householdIds.length} | Users: ${srcScope.allUserIds.length} | Mode: ${args.mode}`,
];
const body = [...header, '', '-- DELETES (children-first)', ...deleteSql, '', '-- INSERTS (parents-first)', ...insertSql, ''];
writeFileSync(args.out, body.join('\n'));

// 6) Report ------------------------------------------------------------------
plan.sort((a, b) => b.rows - a.rows);
const totalRows = plan.reduce((s, p) => s + p.rows, 0);
console.log('Rows to copy per table:');
for (const p of plan) if (p.rows > 0) console.log(`  ${String(p.rows).padStart(6)}  ${p.table}${p.scope.startsWith('GLOBAL') ? '  [GLOBAL]' : ''}${p.extra ? `  (+${p.extra} pulled)` : ''}`);
console.log(`\nTotal rows: ${totalRows} across ${plan.filter((p) => p.rows > 0).length} tables`);
if (globalTables.length) console.log(`Global (copied whole, not deleted): ${globalTables.join(', ')}`);
console.log(`SQL written to: ${args.out}  (${deleteSql.length} deletes, ${insertStmtCount} insert stmts)`);

if (!args.apply) {
  console.log('\nDry-run complete. Re-run with --apply to write to staging.');
  process.exit(0);
}

console.log(`\nApplying to ${args.targetDb}/${args.targetEnv} ...`);
d1File(args.targetDb, args.targetEnv, args.out, args);
console.log('Done.');
