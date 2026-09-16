#!/usr/bin/env node
// Live-API smoke test for the dedicated AI assistant chat room, against the REAL
// deployed Budget staging Worker (not miniflare). Proves the deployed backend:
//   - auto-creates the pinned "AI Budget Assistant" room on first rooms list,
//   - returns it FIRST (is_assistant, pinned above General),
//   - rejects deleting it (undeletable) and rejects setting its participants.
//
// It never triggers an AI reply (no message is posted), so it costs nothing and
// needs no entitlement — it's a structural check of the live contract.
//
// Credentials from env (see e2e/credentials.local; `set -a; source` it):
//   E2E_EMAIL, E2E_PASSWORD
//   LIVE_API_BASE  (default: Budget staging)
//
// Run:  set -a && source ../e2e/credentials.local && set +a && \
//       node scripts/assistant-room-live-smoke.mjs
//
// Exit 0 = all checks passed, 1 = one or more failed.

const BASE =
  process.env.LIVE_API_BASE || 'https://simple-budget-api-staging.a-tekhtelev.workers.dev';
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

let pass = 0;
let fail = 0;
const failures = [];
function check(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${msg}`);
  } else {
    fail++;
    failures.push(msg);
    console.log(`  ❌ ${msg}`);
  }
}

async function req(path, { token, method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json };
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('Missing E2E_EMAIL / E2E_PASSWORD. Source e2e/credentials.local first.');
    process.exit(1);
  }
  console.log(`\nAssistant-room live smoke @ ${BASE}\n`);

  const login = await req('/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  check(login.status === 200, 'POST /auth/login -> 200');
  const token = login.json?.access_token;
  if (!token) {
    console.error('No token; aborting.');
    process.exit(1);
  }

  const hh = await req('/households', { token });
  const list = Array.isArray(hh.json) ? hh.json : hh.json?.households || hh.json?.data || [];
  check(Array.isArray(list) && list.length > 0, `households non-empty (${list.length})`);
  if (!list.length) process.exit(1);
  const householdId = list[0].id;

  // First rooms list auto-creates + returns the assistant room.
  const rooms = await req(`/households/${householdId}/budget-chat-rooms`, { token });
  check(rooms.status === 200, 'GET /budget-chat-rooms -> 200');
  const roomList = rooms.json?.rooms || rooms.json || [];
  const assistant = roomList.filter((r) => r.is_assistant);
  check(assistant.length === 1, `exactly one assistant room (${assistant.length})`);
  check(
    assistant[0]?.name === 'AI Budget Assistant',
    `assistant room named "AI Budget Assistant" (got "${assistant[0]?.name}")`
  );
  check(roomList[0]?.is_assistant === true, 'assistant room is pinned first');
  check(assistant[0]?.ai_enabled === true, 'assistant room has AI enabled');

  const assistantId = assistant[0]?.id;
  if (assistantId) {
    // Undeletable: DELETE must be rejected, and the room must still be there after.
    const del = await req(`/households/${householdId}/budget-chat-rooms/${assistantId}`, {
      token,
      method: 'DELETE',
    });
    // Expect a clean 400 (BadRequestError), NOT a 500 — with the friendly copy.
    check(del.status === 400, `DELETE assistant room -> 400 (got ${del.status})`);
    check(
      /can.t be deleted/i.test(del.json?.error?.message || ''),
      `DELETE returns friendly message (got "${del.json?.error?.message}")`
    );

    // Participant-locked: PUT participants must be a clean 400.
    const part = await req(
      `/households/${householdId}/budget-chat-rooms/${assistantId}/participants`,
      { token, method: 'PUT', body: { participant_ids: [] } }
    );
    check(part.status === 400, `PUT participants -> 400 (got ${part.status})`);
    check(
      /participants can.t be changed/i.test(part.json?.error?.message || ''),
      `PUT participants returns friendly message (got "${part.json?.error?.message}")`
    );

    // Still present after the rejected mutations.
    const after = await req(`/households/${householdId}/budget-chat-rooms`, { token });
    const stillThere = (after.json?.rooms || after.json || []).some((r) => r.id === assistantId);
    check(stillThere, 'assistant room persists after rejected delete');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('Failures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
    process.exit(1);
  }
  console.log('✅ assistant-room live smoke passed\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
