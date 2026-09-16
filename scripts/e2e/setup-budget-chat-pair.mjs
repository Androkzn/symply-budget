#!/usr/bin/env node
/**
 * Fixture check for the Budget V2 two-member chat E2E run.
 *
 * Budget V2 is local-first: each device owns an encrypted ledger and a single
 * household (`hh_local_…`) registered with the `/v2` control plane. There is no
 * server-side household list to pre-seed and no legacy invite to mint — pairing
 * happens entirely in the app (owner creates an invite code, the invitee types
 * it in, the owner approves an out-of-band phrase), which is exactly what the
 * UI stages drive.
 *
 * So this script does NOT create anything. It only reports the facts the flows
 * cannot discover for themselves:
 *   - both accounts authenticate, and their display names (the chat stages
 *     assert sender attribution by name)
 *   - whether the two are ALREADY paired in one V2 household, so the
 *     orchestrator can skip the pairing stages instead of re-enrolling a device
 *     that is already enrolled
 *
 * Usage (from repo root):
 *   node scripts/e2e/setup-budget-chat-pair.mjs            # human-readable
 *   node scripts/e2e/setup-budget-chat-pair.mjs --emit-env # shell-eval-able
 *
 * Env: E2E_EMAIL / E2E_PASSWORD, E2E_EMAIL_SECONDARY / E2E_PASSWORD_SECONDARY
 * (read from e2e/credentials.local — never commit them).
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const STAGING_BUDGET = 'https://simple-budget-api-staging.a-tekhtelev.workers.dev';
const PRODUCTION_BUDGET = 'https://simple-budget-api.a-tekhtelev.workers.dev';

function loadCredentialsLocal() {
  const path = join(ROOT, 'e2e/credentials.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

function parseArgs(argv) {
  let pair = 'staging';
  let emitEnv = false;
  let ensureRoom = null;
  let sendAs = null;
  let sendRoom = null;
  let sendBody = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--pair') pair = argv[++i];
    else if (argv[i] === '--emit-env') emitEnv = true;
    else if (argv[i] === '--ensure-room') ensureRoom = argv[++i];
    else if (argv[i] === '--send-as') sendAs = argv[++i];
    else if (argv[i] === '--send-room') sendRoom = argv[++i];
    else if (argv[i] === '--send-body') sendBody = argv[++i];
    else throw new Error(`Unknown arg: ${argv[i]}`);
  }
  if (!['staging', 'production'].includes(pair)) throw new Error('--pair staging|production');
  if (sendAs && !['a', 'b'].includes(sendAs)) throw new Error('--send-as a|b');
  return { pair, emitEnv, ensureRoom, sendAs, sendRoom, sendBody };
}

async function jsonFetch(url, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 400) };
  }
  return { ok: res.ok, status: res.status, data };
}

const pickToken = (d) =>
  d.accessToken || d.access_token || d.token || d.tokens?.accessToken || d.tokens?.access_token || null;

async function login(base, email, password, label) {
  const res = await jsonFetch(`${base}/auth/login`, { method: 'POST', body: { email, password } });
  const token = res.ok ? pickToken(res.data) : null;
  if (!token) {
    throw new Error(`${label} login failed (${res.status}): ${JSON.stringify(res.data).slice(0, 200)}`);
  }
  return { token, user: res.data.user ?? {} };
}

async function v2Households(base, token) {
  const res = await jsonFetch(`${base}/v2/households`, { token });
  return res.ok ? res.data.households ?? [] : [];
}

async function main() {
  loadCredentialsLocal();
  const { pair, emitEnv, ensureRoom, sendAs, sendRoom, sendBody } = parseArgs(process.argv);
  const BASE = pair === 'production' ? PRODUCTION_BUDGET : STAGING_BUDGET;
  const log = (...a) => (emitEnv ? console.error(...a) : console.log(...a));

  const primaryEmail = process.env.E2E_EMAIL;
  const primaryPassword = process.env.E2E_PASSWORD;
  const secondaryEmail = process.env.E2E_EMAIL_SECONDARY;
  const secondaryPassword = process.env.E2E_PASSWORD_SECONDARY || process.env.E2E_PASSWORD;

  if (!primaryEmail || !primaryPassword || !secondaryEmail || !secondaryPassword) {
    throw new Error(
      'Need E2E_EMAIL/E2E_PASSWORD and E2E_EMAIL_SECONDARY/E2E_PASSWORD_SECONDARY (e2e/credentials.local)'
    );
  }
  if (primaryEmail === secondaryEmail) {
    throw new Error('Primary and secondary accounts must differ — a two-member test needs two users');
  }

  log(`[pair-setup] Budget V2 ${pair} — A=${primaryEmail}  B=${secondaryEmail}`);

  const a = await login(BASE, primaryEmail, primaryPassword, 'PRIMARY');
  const b = await login(BASE, secondaryEmail, secondaryPassword, 'SECONDARY');
  log(`[pair-setup] A ${a.user.id} "${a.user.display_name}"`);
  log(`[pair-setup] B ${b.user.id} "${b.user.display_name}"`);

  const aHouseholds = await v2Households(BASE, a.token);
  const bHouseholds = await v2Households(BASE, b.token);
  log(`[pair-setup] A v2 households: ${aHouseholds.map((h) => `${h.id}(${h.role})`).join(', ') || '(none yet)'}`);
  log(`[pair-setup] B v2 households: ${bHouseholds.map((h) => `${h.id}(${h.role})`).join(', ') || '(none yet)'}`);

  // Already paired = both accounts active in the SAME v2 household.
  const aIds = new Set(aHouseholds.map((h) => h.id));
  // The accounts can share SEVERAL households (the app mints a new hh_local_… on
  // every ledger reset, so old pairings linger). Only the one the DEVICES are
  // currently bound to is usable, and this script cannot see that — so allow the
  // caller to pin it explicitly rather than take whichever happens to sort first.
  const forced = process.env.PAIR_FORCE_HOUSEHOLD;
  const shared = forced
    ? bHouseholds.find((h) => h.id === forced && aIds.has(h.id))
    : bHouseholds.find((h) => aIds.has(h.id));
  if (forced && !shared) {
    throw new Error(`PAIR_FORCE_HOUSEHOLD=${forced} is not a household BOTH accounts belong to`);
  }
  log(
    shared
      ? `[pair-setup] ALREADY PAIRED in ${shared.id} — orchestrator can skip enrolment stages`
      : '[pair-setup] not paired yet — flows drive invite → join → approve'
  );

  const out = {
    PAIR_A_NAME: a.user.display_name || 'Andrei',
    PAIR_B_NAME: b.user.display_name || 'E2E Secondary',
    PAIR_SHARED_HOUSEHOLD_ID: shared?.id ?? '',
    PAIR_ALREADY_PAIRED: shared ? '1' : '0',
  };

  // --ensure-room: pre-create the room the LIVE (concurrent) run uses.
  //
  // The live pair has both devices enter the SAME room at the same time to test
  // real-time delivery. Having one of them create it first would be a race —
  // and creating a room is not what that test is about (the serial a3 stage
  // already covers creation through the UI). Make it exist up front so both
  // sides only ever navigate into it.
  if (ensureRoom) {
    if (!shared) throw new Error('--ensure-room needs the two accounts paired in one V2 household first');
    const list = await jsonFetch(`${BASE}/households/${shared.id}/budget-chat-rooms`, { token: a.token });
    if (!list.ok) {
      throw new Error(`List rooms failed (${list.status}): ${JSON.stringify(list.data).slice(0, 200)}`);
    }
    const existing = (list.data.rooms ?? []).find((r) => r.name === ensureRoom);
    if (existing) {
      log(`[pair-setup] reusing chat room "${ensureRoom}" (${existing.id})`);
      out.PAIR_ROOM_ID = existing.id;
    } else {
      const created = await jsonFetch(`${BASE}/households/${shared.id}/budget-chat-rooms`, {
        method: 'POST',
        token: a.token,
        body: { name: ensureRoom, ai_enabled: false },
      });
      if (!created.ok) {
        throw new Error(`Create room failed (${created.status}): ${JSON.stringify(created.data).slice(0, 200)}`);
      }
      out.PAIR_ROOM_ID = created.data.room?.id ?? '';
      log(`[pair-setup] created chat room "${ensureRoom}" (${out.PAIR_ROOM_ID})`);
    }
    out.PAIR_ROOM_NAME = ensureRoom;
  }

  // --send-as: post a message into the shared room as one of the two members.
  //
  // Used by the SINGLE-DRIVER live-sync mode. Testing real-time delivery needs
  // one member watching an already-open room while the other sends; running two
  // Maestro/XCUITest drivers at once is the faithful way to do that, but it also
  // starves this machine (load >50, both drivers die). Driving only the WATCHER
  // through the UI and posting the sender's message over the API keeps the
  // property under test intact — the message still has to travel to B's open
  // room over the live ChatRoomDO socket — while halving the load.
  if (sendAs) {
    if (!shared) throw new Error('--send-as needs the two accounts paired in one V2 household');
    if (!sendRoom || !sendBody) throw new Error('--send-as needs --send-room and --send-body');
    const sender = sendAs === 'a' ? a : b;
    const rooms = await jsonFetch(`${BASE}/households/${shared.id}/budget-chat-rooms`, { token: sender.token });
    const room = (rooms.data.rooms ?? []).find((r) => r.name === sendRoom);
    if (!room) throw new Error(`Room "${sendRoom}" not found for sender ${sendAs.toUpperCase()}`);
    const sent = await jsonFetch(
      `${BASE}/households/${shared.id}/budget-chat-rooms/${room.id}/messages`,
      { method: 'POST', token: sender.token, body: { body: sendBody } }
    );
    if (!sent.ok) {
      throw new Error(`Send failed (${sent.status}): ${JSON.stringify(sent.data).slice(0, 200)}`);
    }
    log(`[pair-setup] sent as ${sendAs.toUpperCase()} into "${sendRoom}": ${sendBody}`);
    out.PAIR_SENT_MESSAGE_ID = sent.data.message?.id ?? '';
  }

  if (emitEnv) {
    for (const [k, v] of Object.entries(out)) {
      console.log(`export ${k}=${JSON.stringify(String(v))}`);
    }
  } else {
    console.log(JSON.stringify(out, null, 2));
  }
}

main().catch((err) => {
  console.error(`[pair-setup] FAILED: ${err.message}`);
  process.exit(1);
});
