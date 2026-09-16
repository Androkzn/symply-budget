#!/usr/bin/env node
/**
 * Leave the orphan households piled up on the LOCAL-FIRST (v2) control plane.
 *
 * ## Why this exists beside purge-house-orphan-households.mjs
 *
 * That script deletes via `DELETE /households/:id` — the LEGACY Tier-B plane,
 * which is what `GET /households` lists. Local-first devices do not read that
 * plane at all: they read `GET /v2/households`, served by the household
 * coordinator Durable Object. The two disagree, and badly:
 *
 *     LEGACY /households    →  6 households
 *     V2     /v2/households → 35 households      ← what a device actually syncs
 *
 * Purging the legacy plane therefore looks like it worked and changes nothing a
 * device can see. Measured on staging 2026-09-04: after the legacy purge took
 * the account to 6, a freshly ERASED House-C still pulled 35 properties on
 * login, synced all 35 every heartbeat, and drove the control plane to answer
 * `429 rate_limited` 634 times. The Backup & Restore screen renders one row per
 * home, twice, so `house-backup-status-card` and `house-backup-restore-sources`
 * sat far below the fold and every backup flow failed on an assertion that had
 * nothing to do with backups.
 *
 * ## Why LEAVE rather than delete
 *
 * The v2 plane has no household delete — only `POST /v2/households/:id/leave`.
 * That is enough: leaving ends this account's membership, so the household stops
 * appearing in `GET /v2/households` and devices stop syncing it. The DO record
 * survives for any other member, which is the conservative outcome.
 *
 * The last-owner guard does NOT block a solo household. From the coordinator:
 *
 *     if (actor.role === 'OWNER' && others.length > 0 && !others.some(m => m.role === 'OWNER'))
 *
 * `others.length > 0` — with no other members there is nobody to strand, so the
 * leave succeeds. This script only ever touches solo households, which keeps it
 * on the safe side of that rule by construction rather than by luck.
 *
 * ## The gate, and its ONE genuine weakness
 *
 * Emptiness cannot be probed here. Local-first rows are encrypted and the server
 * cannot count them — a solo household holding a real home looks identical to a
 * solo household holding nothing. The legacy script could probe `/tasks`,
 * `/home-projects`, `/spaces`, `/appliances`; those endpoints do not describe the
 * v2 plane.
 *
 * So the gate is: OWNER + exactly one active member + not on the keep-list.
 * That is weaker than the legacy probe and this script says so rather than
 * implying a safety it does not have. It refuses to run without `--yes`, prints
 * the full plan first, and `--keep-ids` exists so the homes that matter are named
 * explicitly rather than inferred.
 *
 * ## Usage
 *
 *   node scripts/e2e/purge-house-v2-orphans.mjs --pair staging
 *   node scripts/e2e/purge-house-v2-orphans.mjs --pair staging --older-than-days 14
 *   node scripts/e2e/purge-house-v2-orphans.mjs --pair staging --keep-ids id1,id2 --yes
 *
 * Credentials come from `e2e/credentials.local`, never argv.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const API = {
  staging: 'https://simple-house-api-staging.a-tekhtelev.workers.dev',
  production: 'https://simple-house-api.a-tekhtelev.workers.dev',
};

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const pair = flag('pair', 'staging');
const apply = argv.includes('--yes');
const olderThanDays = Number(flag('older-than-days', '7'));
const keepIds = new Set((flag('keep-ids', '') || '').split(',').map(s => s.trim()).filter(Boolean));

const baseUrl = API[pair];
if (!baseUrl) {
  console.error(`--pair must be staging|production (got "${pair}")`);
  process.exit(2);
}

function credentials() {
  const raw = readFileSync(join(ROOT, 'e2e', 'credentials.local'), 'utf8');
  const read = key =>
    raw.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '');
  const email = read('E2E_EMAIL');
  const password = read('E2E_PASSWORD');
  if (!email || !password) throw new Error('e2e/credentials.local is missing E2E_EMAIL / E2E_PASSWORD');
  return { email, password };
}

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json', 'x-symply-local-first': '1' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(payload)?.slice(0, 120)}`);
  return payload;
}

/**
 * Is this household solo, and when did anything last touch it?
 *
 * AGE IS THE GATE THAT MATTERS. "Solo + owner" alone would happily leave the
 * home someone is using right now, because emptiness is invisible here — the
 * rows are encrypted and the server cannot count them. What the server CAN see
 * is when each device last reached the household, and a home nobody has opened
 * in weeks is the one safe thing to identify positively.
 *
 * Last activity is the NEWEST stamp across the household's devices, falling back
 * to `enrolledAt` where a device never synced — the same reasoning as
 * `deviceLiveness`: a device that joined and was never seen again is evidence of
 * abandonment, not of an unknown. Taking the newest (not the oldest) is what
 * makes this conservative: one recently-active device keeps the whole household.
 *
 * A state read that ERRORS counts as NOT safe. A 429 or a 500 is not evidence
 * that a household is stale, and the run that discovered this had every probe
 * rate-limited — silently treating those as "empty and old" would have left
 * every home on the account.
 */
async function inspect(id, token) {
  try {
    const { state } = await api(`/v2/households/${id}/state`, { token });
    const active = (state?.members ?? []).filter(m => m.status === 'active');
    const devices = state?.devices ?? [];
    const stamps = devices
      .map(d => Date.parse(d.lastSeenAt ?? d.enrolledAt ?? ''))
      .filter(n => Number.isFinite(n));
    const lastActivity = stamps.length ? Math.max(...stamps) : null;
    const ageDays =
      lastActivity === null ? null : Math.floor((Date.now() - lastActivity) / 86_400_000);
    return {
      readable: true,
      solo: active.length <= 1,
      members: active.length,
      devices: devices.length,
      ageDays,
      why: `${active.length} member(s), ${devices.length} device(s), last active ${
        ageDays === null ? 'never' : `${ageDays}d ago`
      }`,
    };
  } catch (error) {
    return { readable: false, why: `state unreadable (${String(error.message).slice(0, 60)})` };
  }
}

async function main() {
  const { email, password } = credentials();
  const auth = await api('/auth/login', { method: 'POST', body: { email, password } });
  const token = auth?.access_token;
  if (!token) throw new Error('login returned no access_token');

  const households = (await api('/v2/households', { token }))?.households ?? [];
  console.log(`${pair} v2 plane: account is in ${households.length} household(s)`);
  console.log(`Leaving only households untouched for ${olderThanDays}+ days.`);
  if (keepIds.size) console.log(`Keeping by --keep-ids: ${[...keepIds].join(', ')}`);
  console.log('');

  let left = 0;
  let skipped = 0;
  for (const household of households) {
    const label = `${household.display_name ?? '(unnamed)'} ${household.id}`;
    if (keepIds.has(household.id)) {
      console.log(`  KEEP   ${label} — named on the keep-list`);
      skipped += 1;
      continue;
    }
    if (household.role !== 'OWNER') {
      console.log(`  SKIP   ${label} — role=${household.role}, not mine to clean up`);
      skipped += 1;
      continue;
    }
    const info = await inspect(household.id, token);
    if (!info.readable) {
      console.log(`  SKIP   ${label} — ${info.why}`);
      skipped += 1;
      continue;
    }
    if (!info.solo) {
      console.log(`  SKIP   ${label} — shared: ${info.why}`);
      skipped += 1;
      continue;
    }
    // The age gate. `null` means no device ever carried a stamp, which is older
    // than any threshold rather than younger — but say so out loud rather than
    // letting it fall through a numeric comparison against null.
    if (info.ageDays === null) {
      console.log(`  SKIP   ${label} — no device ever stamped; cannot date it`);
      skipped += 1;
      continue;
    }
    if (info.ageDays < olderThanDays) {
      console.log(`  KEEP   ${label} — in use: ${info.why}`);
      skipped += 1;
      continue;
    }
    if (!apply) {
      console.log(`  WOULD  ${label} — ${why}`);
      left += 1;
      continue;
    }
    try {
      await api(`/v2/households/${household.id}/leave`, { method: 'POST', token });
      console.log(`  LEAVE  ${label}`);
      left += 1;
    } catch (error) {
      console.log(`  FAIL   ${label} — ${String(error.message).slice(0, 90)}`);
      skipped += 1;
    }
  }

  console.log(
    `\n${apply ? 'Left' : 'Would leave'} ${left}, skipped ${skipped}.` +
      (apply ? '' : '\nRe-run with --yes to apply.'),
  );
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
