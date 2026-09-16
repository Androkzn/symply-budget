#!/usr/bin/env node
/**
 * House → Budget/Kaizen/Health D1 scoped migration for seed emails.
 *
 * Never writes to House. Never deletes House rows.
 *
 * Usage (from backend/):
 *   node scripts/migrate-house-to-budget.mjs --emails a@x.com,b@y.com --target budget --pair staging
 *   node scripts/migrate-house-to-budget.mjs --emails a@x.com,b@y.com --target health --pair staging --apply
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(__dirname, '..');

const TARGETS = {
  budget: {
    staging: {
      sourceDb: 'simple-house-db-staging',
      sourceEnv: 'staging',
      sourceConfig: 'wrangler.toml',
      targetDb: 'simple-budget-db-staging',
      targetEnv: 'staging',
      targetConfig: 'wrangler.budget.toml',
    },
    production: {
      sourceDb: 'simple-house-db',
      sourceEnv: 'production',
      sourceConfig: 'wrangler.toml',
      targetDb: 'simple-budget-db',
      targetEnv: 'production',
      targetConfig: 'wrangler.budget.toml',
    },
  },
  kaizen: {
    staging: {
      sourceDb: 'simple-house-db-staging',
      sourceEnv: 'staging',
      sourceConfig: 'wrangler.toml',
      targetDb: 'symply-kaizen-db-staging',
      targetEnv: 'staging',
      targetConfig: 'wrangler.kaizen.toml',
    },
    production: {
      sourceDb: 'simple-house-db',
      sourceEnv: 'production',
      sourceConfig: 'wrangler.toml',
      targetDb: 'symply-kaizen-db',
      targetEnv: 'production',
      targetConfig: 'wrangler.kaizen.toml',
    },
  },
  health: {
    staging: {
      sourceDb: 'simple-house-db-staging',
      sourceEnv: 'staging',
      sourceConfig: 'wrangler.toml',
      targetDb: 'symply-health-db-staging',
      targetEnv: 'staging',
      targetConfig: 'wrangler.health.toml',
    },
    production: {
      sourceDb: 'simple-house-db',
      sourceEnv: 'production',
      sourceConfig: 'wrangler.toml',
      targetDb: 'symply-health-db',
      targetEnv: 'production',
      targetConfig: 'wrangler.health.toml',
    },
  },
};

function parseArgs(argv) {
  const args = { apply: false, out: null, pair: 'staging', mode: 'replace', target: 'budget' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--emails') args.emails = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--pair') args.pair = argv[++i];
    else if (a === '--mode') args.mode = argv[++i];
    else if (a === '--target') args.target = argv[++i];
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!args.emails) throw new Error('Missing --emails');
  if (!TARGETS[args.target]) throw new Error(`--target must be budget|kaizen|health, got ${args.target}`);
  if (!TARGETS[args.target][args.pair]) {
    throw new Error(`--pair must be staging|production, got ${args.pair}`);
  }
  return args;
}

function d1Query(config, db, env, sql) {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', db, '--remote', '--env', env, '-c', config, '--json', '--command', sql],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, cwd: BACKEND }
  );
  const start = out.indexOf('[');
  if (start === -1) throw new Error(`Unexpected wrangler output:\n${out.slice(0, 500)}`);
  return JSON.parse(out.slice(start)).map((r) => r.results ?? []);
}

function d1File(config, db, env, file) {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', db, '--remote', '--env', env, '-c', config, '--file', file],
    { encoding: 'utf8', input: 'y\n', maxBuffer: 512 * 1024 * 1024, cwd: BACKEND }
  );
  console.log(out);
}

function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replace(/'/g, "''")}'`;
}
const idList = (ids) => ids.map((x) => `'${String(x).replace(/'/g, "''")}'`).join(',');
const qcol = (c) => `"${c}"`;

const args = parseArgs(process.argv);
const pair = TARGETS[args.target][args.pair];
const emails = args.emails.split(',').map((e) => e.trim()).filter(Boolean);
args.out =
  args.out || join(BACKEND, `migrate-house-to-${args.target}-${args.pair}.sql`);

const src = (sql) => d1Query(pair.sourceConfig, pair.sourceDb, pair.sourceEnv, sql);
const tgt = (sql) => d1Query(pair.targetConfig, pair.targetDb, pair.targetEnv, sql);

console.log(
  `\n== House→${args.target}: ${pair.sourceDb} -> ${pair.targetDb} (${args.pair}) ==`
);
console.log(`Emails: ${emails.join(', ')} | Apply: ${args.apply ? 'YES' : 'dry-run'}\n`);

function resolveScope(q, label) {
  const seed = q(`SELECT id FROM users WHERE email IN (${idList(emails)})`)[0].map((r) => r.id);
  if (seed.length === 0) return { seedUserIds: [], householdIds: [], allUserIds: [] };
  const hh = q(
    `SELECT DISTINCT household_id AS id FROM household_members WHERE user_id IN (${idList(seed)})`
  )[0].map((r) => r.id);
  const members = hh.length
    ? q(
        `SELECT DISTINCT user_id AS id FROM household_members WHERE household_id IN (${idList(hh)})`
      )[0].map((r) => r.id)
    : [];
  const allUserIds = Array.from(new Set([...seed, ...members]));
  console.log(`[${label}] seed=${seed.length} households=${hh.length} users=${allUserIds.length}`);
  return { seedUserIds: seed, householdIds: hh, allUserIds };
}

const srcScope = resolveScope(src, 'source');
if (!srcScope.seedUserIds.length) throw new Error('No matching users in House source.');
if (!srcScope.householdIds.length) throw new Error('No households for seed users.');
const tgtScope = resolveScope(tgt, 'target');

const EXCLUDE_TABLES = new Set(['refresh_tokens', 'email_verifications', 'password_resets']);
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

const colsByTable = {};
const targetColsByTable = {};
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
// Target may lag House schema (e.g. ad-hoc columns). Only INSERT columns that exist on Budget.
for (let i = 0; i < tables.length; i += CHUNK) {
  const chunk = tables.slice(i, i + CHUNK);
  const sql = chunk.map((t) => `PRAGMA table_info('${t}');`).join(' ');
  let sets;
  try {
    sets = tgt(sql);
  } catch {
    sets = chunk.map(() => []);
  }
  chunk.forEach((t, j) => {
    const info = sets[j] || [];
    targetColsByTable[t] = info.length ? info.map((r) => r.name) : colsByTable[t];
  });
}

function makeWhereFor({ hh, us }) {
  const HH = hh || 'NULL';
  const US = us || 'NULL';
  const memo = {};
  function whereFor(table, stack = []) {
    if (table in memo) return memo[table];
    if (stack.includes(table)) return null;
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
        result =
          pw === null
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

const whereSrc = makeWhereFor({
  hh: idList(srcScope.householdIds),
  us: idList(srcScope.allUserIds),
});
const whereDel = makeWhereFor({
  hh: idList(tgtScope.householdIds),
  us: idList(tgtScope.seedUserIds),
});
const hasTargetScope = tgtScope.seedUserIds.length > 0;

const rowsByTable = {};
const includedIds = {};
const deletesByTable = {};
const globalTables = [];
const scopedCounts = {};

for (const table of tables) {
  const where = whereSrc(table);
  if (where === null) globalTables.push(table);
  let rows;
  try {
    rows = src(`SELECT * FROM "${table}"${where ? ` WHERE ${where}` : ''}`)[0];
  } catch (e) {
    console.error(`! export ${table}: ${e.message.split('\n')[0]}`);
    rows = [];
  }
  rowsByTable[table] = rows;
  scopedCounts[table] = rows.length;
  const pk = pkByTable[table];
  includedIds[table] = new Set(pk ? rows.map((r) => r[pk]) : []);
  const delWhere = whereDel(table);
  if (args.mode === 'replace' && hasTargetScope && delWhere) {
    deletesByTable[table] = `DELETE FROM "${table}" WHERE ${delWhere};`;
  }
}

let pulled = 0;
for (let pass = 0; pass < 20; pass++) {
  const need = {};
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
  if (!parents.length) break;
  for (const parent of parents) {
    const ids = [...need[parent]];
    const pk = pkByTable[parent];
    const extra = src(`SELECT * FROM "${parent}" WHERE "${pk}" IN (${idList(ids)})`)[0];
    for (const row of extra) {
      if (!includedIds[parent].has(row[pk])) {
        rowsByTable[parent].push(row);
        includedIds[parent].add(row[pk]);
        pulled++;
      }
    }
  }
}

function topoOrder(allTables) {
  const inSet = new Set(allTables);
  const deps = new Map(allTables.map((t) => [t, new Set()]));
  for (const t of allTables) {
    for (const fk of fksByTable[t] || []) {
      if (fk.table !== t && inSet.has(fk.table)) deps.get(t).add(fk.table);
    }
  }
  const order = [];
  const remaining = new Set(allTables);
  while (remaining.size) {
    const ready = [...remaining]
      .filter((t) => [...deps.get(t)].every((p) => !remaining.has(p)))
      .sort();
    if (!ready.length) {
      order.push(...[...remaining].sort());
      break;
    }
    for (const t of ready) {
      order.push(t);
      remaining.delete(t);
    }
  }
  return order;
}

const insertsByTable = {};
const plan = [];
for (const table of tables) {
  const rows = rowsByTable[table];
  plan.push({
    table,
    rows: rows.length,
    scope: globalTables.includes(table) ? 'GLOBAL' : 'scoped',
  });
  if (!rows.length) continue;
  const srcCols = colsByTable[table];
  const cols = (targetColsByTable[table] || srcCols).filter((c) => srcCols.includes(c));
  const dropped = srcCols.filter((c) => !cols.includes(c));
  if (dropped.length) console.log(`  ~ ${table}: skip cols missing on Budget: ${dropped.join(', ')}`);
  const colSql = cols.map(qcol).join(',');
  const stmts = [];
  for (let i = 0; i < rows.length; i += 40) {
    const values = rows
      .slice(i, i + 40)
      .map((row) => `(${cols.map((c) => lit(row[c])).join(',')})`)
      .join(',');
    stmts.push(`INSERT OR REPLACE INTO "${table}" (${colSql}) VALUES ${values};`);
  }
  insertsByTable[table] = stmts;
}

const order = topoOrder(tables);
const deleteSql = [...order].reverse().filter((t) => deletesByTable[t]).map((t) => deletesByTable[t]);
const insertSql = order.filter((t) => insertsByTable[t]).flatMap((t) => insertsByTable[t]);

const header = [
  '-- House → Budget migration. Do not edit.',
  `-- ${pair.sourceDb} -> ${pair.targetDb}`,
  `-- emails: ${emails.join(', ')}`,
];
writeFileSync(args.out, [...header, '', ...deleteSql, '', ...insertSql, ''].join('\n'));

plan.sort((a, b) => b.rows - a.rows);
const totalRows = plan.reduce((s, p) => s + p.rows, 0);
console.log('Rows:');
for (const p of plan) if (p.rows > 0) console.log(`  ${String(p.rows).padStart(6)}  ${p.table}`);
console.log(`\nTotal: ${totalRows} | pulled parents: ${pulled}`);
console.log(`SQL: ${args.out}`);

if (!args.apply) {
  console.log('\nDry-run. Re-run with --apply to write Budget D1.');
  process.exit(0);
}

console.log(`\nApplying to ${pair.targetDb}...`);
d1File(pair.targetConfig, pair.targetDb, pair.targetEnv, args.out);
console.log('Done.');
