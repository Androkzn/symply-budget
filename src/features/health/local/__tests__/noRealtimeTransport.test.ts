/**
 * He0 item 6 — no Health code path opens a `/v2` WebSocket or EventSource.
 *
 * This test REPLACES the hibernation/signaling smoke that House owns
 * (Health V2 plan §2 item 6). `ctx.acceptWebSocket`
 * (`backend/src/durable-objects/household-coordinator.ts:503`) serves only the
 * WebRTC **signaling** socket. Health Wave A ships no SSE/EventSource client
 * and keeps `EXPO_PUBLIC_HEALTH_P2P` off (§5 He4), so that socket is never
 * opened — which means the smoke test has nothing to smoke. v1.5 made the Exit
 * satisfiable by "recording that it is blocked", which is not an Exit. Proving
 * the absence by grep is.
 *
 * Why the absence is worth a test rather than a comment: the mailbox relay and
 * a signaling socket are interchangeable-looking at the call site. Someone
 * porting a House sync improvement across would reasonably reach for the
 * realtime path, and nothing else in the suite would go red — the ledger would
 * still converge, just over a transport whose metadata (deposit timing, peer
 * presence) is exactly what an E2EE health surface must not leak. Enabling
 * `EXPO_PUBLIC_HEALTH_P2P=1` is a separate, gated decision (House H0 debt,
 * handoff G9); until then this file is the gate.
 *
 * ASSERTS ON CODE, NOT COMMENTS — the convention this repo settled on in
 * `7584a60f` ("assert import order on code, not comments"). Four files in the
 * Health tree legitimately *discuss* WebSocket/EventSource in prose, each
 * explaining that Health does not use them. A naive grep would fire on exactly
 * the comments that document the invariant, so the check would be reverted or
 * neutered within a week. Comments and strings are stripped first.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const HEALTH_ROOT = join(__dirname, '..', '..');

/**
 * Identifiers that would open a realtime transport. `signaling` is included
 * because the Durable Object route is named for it, so a call site would say
 * `signaling` even where it does not say `WebSocket`.
 */
const FORBIDDEN_TRANSPORTS = [
  'WebSocket',
  'EventSource',
  'RTCPeerConnection',
  'RTCDataChannel',
  'signaling',
] as const;

function sourceFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Tests are excluded on purpose: this file names every forbidden token.
      if (entry === '__tests__' || entry === 'test-utils') continue;
      out.push(...sourceFilesUnder(full));
      continue;
    }
    if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Strip block comments, line comments and string/template literals. Crude by
 * design — it only has to be conservative in the direction that matters, i.e.
 * it may leave code in, never take code out.
 */
function codeOnly(source: string): string {
  return (
    source
      // ONE pass, alternation ordered so whichever delimiter appears FIRST
      // wins. Block-then-line ordering is a real bug, not a style choice: a
      // line comment containing `/*` — e.g. ``// `@noble/*` captures
      // globalThis.crypto`` on line 1 of `ensureSession.ts` — opens a phantom
      // block that swallows every line up to the next `*/`. That deletes real
      // code, and a grep gate over deleted code passes vacuously.
      .replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, (_match, before) =>
        before === undefined ? ' ' : `${before} `,
      )
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
      .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
      .replace(/`(?:[^`\\]|\\.)*`/g, '``')
  );
}

describe('He0 item 6 — Health opens no realtime transport', () => {
  const files = sourceFilesUnder(HEALTH_ROOT);

  it('finds the Health feature tree (guards against a vacuous pass)', () => {
    // If a refactor moves the tree, every assertion below would pass over an
    // empty file list. Pin a floor and one known member.
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith(join('local', 'sync', 'orchestrator.ts')))).toBe(true);
  });

  it.each(FORBIDDEN_TRANSPORTS)('no Health source file references %s in code', (token) => {
    const offenders = files.filter((file) => codeOnly(readFileSync(file, 'utf8')).includes(token));
    expect(offenders.map((f) => f.slice(HEALTH_ROOT.length + 1))).toEqual([]);
  });

  it('the comment-stripper does not hide a real call site', () => {
    // Guards the guard: prose about WebSocket is allowed, a call is not.
    const prose = '/** Health ships no WebSocket at all. */\nexport const x = 1;';
    const call = 'const socket = new WebSocket(url);';
    expect(codeOnly(prose)).not.toContain('WebSocket');
    expect(codeOnly(call)).toContain('WebSocket');
  });

  it('WebRTC peer transport stays opt-in and off by default', () => {
    // The flag is the other half of the invariant: no transport code AND no
    // build that would turn one on. `flag.test.ts` pins the parsing; this pins
    // that the default is off rather than brand-defaulted like the main flag.
    const previous = process.env.EXPO_PUBLIC_HEALTH_P2P;
    delete process.env.EXPO_PUBLIC_HEALTH_P2P;
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isHealthP2PEnabled } = require('../flag') as typeof import('../flag');
    expect(isHealthP2PEnabled()).toBe(false);
    if (previous !== undefined) process.env.EXPO_PUBLIC_HEALTH_P2P = previous;
  });
});
