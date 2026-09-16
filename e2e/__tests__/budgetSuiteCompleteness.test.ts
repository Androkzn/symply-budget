/**
 * BUDGET-CORNER-026 — every Budget Maestro flow on disk must be scheduled.
 *
 * `e2e/maestro/budget/config.yaml` pins an explicit `flowsOrder` (budget-auth
 * clears the Keychain, so it must run last — which is why the order is listed
 * exhaustively rather than globbed). A flow that exists but is absent from that
 * list never runs: invisible coverage. `budget-recover-session.yaml` was in
 * exactly that state until 2026-07-20.
 *
 * Flows tagged `util` are excluded by `excludeTags` in the same config and are
 * therefore legitimately unscheduled.
 *
 * The YAML here is trivial (a flat list of scalars and a `tags:` block), so it
 * is parsed with a few lines rather than pulling in a YAML dependency the
 * mobile package does not declare.
 */
import { readFileSync, readdirSync } from 'fs';
import { basename, join } from 'path';

const BUDGET_DIR = join(__dirname, '../maestro/budget');
const CONFIG_PATH = join(BUDGET_DIR, 'config.yaml');
const configSource = readFileSync(CONFIG_PATH, 'utf8');

/**
 * Items of a simple YAML block sequence — a `key:` line followed by indented
 * `- value` lines.
 *
 * Blank lines and `#` comments INSIDE the block are skipped rather than taken as
 * its end. That single detail is what this suite got wrong: there were three
 * near-identical copies of this loop and only the `flowsOrder` one skipped
 * comments. When the `pair` excludeTag landed (2026-08-10, commit 2e16ba8e) it
 * arrived with an explanatory comment above it —
 *
 *     excludeTags:
 *       - util
 *       # Two-member chat stages (budget-chat-pair-*) …
 *       - pair
 *
 * — so the comment-blind copy stopped reading after `- util`, silently narrowed
 * `excludeTags` to a single entry, and reported all eight `budget-chat-pair-*`
 * flows as unscheduled coverage they are not. One parser, shared by all three
 * call sites, so the copies cannot drift apart again.
 */
function parseBlockList(source: string, key: string): string[] {
  const lines = source.split('\n');
  const start = lines.findIndex(l => l.trim() === `${key}:`);
  if (start === -1) return [];
  const indent = lines[start].length - lines[start].trimStart().length;
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const item = line.trim();
    if (!item || item.startsWith('#')) continue;
    const lineIndent = line.length - line.trimStart().length;
    if (!item.startsWith('- ') || lineIndent <= indent) break;
    out.push(item.slice(2).trim().replace(/^['"]|['"]$/g, ''));
  }
  return out;
}

/** Flow ids listed under `flowsOrder:`, in order. */
function parseFlowsOrder(source: string): string[] {
  return parseBlockList(source, 'flowsOrder');
}

/** Tags declared in a flow's header document. */
function parseTags(source: string): string[] {
  return parseBlockList(source.split('\n---')[0], 'tags');
}

/** Tags listed under `excludeTags:` in the workspace config. */
function parseExcludeTags(source: string): string[] {
  return parseBlockList(source, 'excludeTags');
}

const flowsOrder = parseFlowsOrder(configSource);
const excludeTags = parseExcludeTags(configSource);

const flowFiles = readdirSync(BUDGET_DIR)
  .filter(f => f.endsWith('.yaml') && f !== 'config.yaml')
  .sort();

const flows = flowFiles.map(file => {
  const source = readFileSync(join(BUDGET_DIR, file), 'utf8');
  const tags = parseTags(source);
  return {
    id: basename(file, '.yaml'),
    file,
    tags,
    excluded: tags.some(t => excludeTags.includes(t)),
  };
});

describe('BUDGET-CORNER-026 — the parser itself', () => {
  it('BUDGET-CORNER-026: reads a non-trivial flowsOrder and the util excludeTag', () => {
    expect(flowsOrder.length).toBeGreaterThan(20);
    expect(excludeTags).toContain('util');
    expect(flowFiles.length).toBeGreaterThan(20);
  });

  /**
   * A comment inside a block must not truncate it — the defect that made this
   * suite report the eight `budget-chat-pair-*` flows as unscheduled for four
   * days. Pinned on a literal fixture as well as on the real config, because the
   * real config's comment could be reflowed away and quietly take the only
   * regression cover with it.
   */
  it('BUDGET-CORNER-026: a comment inside a block does not truncate it', () => {
    const fixture = [
      'excludeTags:',
      '  - util',
      '  # why the next one exists',
      '',
      '  - pair',
      'flows:',
      "  - '**'",
    ].join('\n');
    expect(parseBlockList(fixture, 'excludeTags')).toEqual(['util', 'pair']);
    // …and the block still ENDS at the next key rather than swallowing the file.
    expect(parseBlockList(fixture, 'flows')).toEqual(['**']);
  });

  /**
   * The real exclusion set, pinned exactly. `pair` covers the two-device chat
   * stages, which are driven by scripts/e2e/run-budget-chat-two-members.sh and
   * are meaningless in this single-device workspace. A new exclusion is a
   * decision to stop running something, so it should have to be made here too.
   */
  it('BUDGET-CORNER-026: the exclusion set is util + pair + maintenance, nothing else', () => {
    expect([...excludeTags].sort()).toEqual(['maintenance', 'pair', 'util']);
  });

  /**
   * Same shape as the `pair` check below, for the same reason: an exclusion tag
   * that no flow carries is an exclusion nobody made, and one that spreads
   * beyond its intended flows is how a suite quietly stops running things.
   *
   * `maintenance` covers destructive purge flows — they delete rows from the
   * shared E2E household by design, run by name when residue from failed runs
   * has piled up. Firing one inside a regression suite would take real fixtures
   * with it.
   */
  it('BUDGET-CORNER-026: the maintenance-tagged flows are the purge flows', () => {
    const maintenance = flows.filter(f => f.tags.includes('maintenance')).map(f => f.id);
    expect(maintenance.length).toBeGreaterThan(0);
    expect(maintenance.every(id => id.includes('purge'))).toBe(true);
  });

  /**
   * The `pair` exclusion only means anything while the flows actually carry the
   * tag — `parseTags` reads the same block shape, so this proves both halves of
   * the exclusion agree and that the tag parser is not silently returning [].
   */
  it('BUDGET-CORNER-026: the pair-tagged flows are found, and are the chat stages', () => {
    const paired = flows.filter(f => f.tags.includes('pair')).map(f => f.id).sort();
    expect(paired.length).toBeGreaterThan(0);
    expect(paired.every(id => id.startsWith('budget-chat-pair-'))).toBe(true);
    expect(paired.every(id => !flowsOrder.includes(id))).toBe(true);
  });
});

describe('BUDGET-CORNER-026 — every flow on disk is scheduled', () => {
  it('BUDGET-CORNER-026: no flow file is missing from flowsOrder', () => {
    const missing = flows.filter(f => !f.excluded && !flowsOrder.includes(f.id)).map(f => f.file);
    expect(missing).toEqual([]);
  });

  it('BUDGET-CORNER-026: budget-recover-session is scheduled (the flow this row was opened for)', () => {
    expect(flowFiles).toContain('budget-recover-session.yaml');
    expect(flowsOrder).toContain('budget-recover-session');
  });

  it('BUDGET-CORNER-026: flowsOrder has no entry without a file on disk', () => {
    const ids = new Set(flows.map(f => f.id));
    expect(flowsOrder.filter(id => !ids.has(id))).toEqual([]);
  });

  it('BUDGET-CORNER-026: flowsOrder has no duplicates', () => {
    expect(new Set(flowsOrder).size).toBe(flowsOrder.length);
  });

  it('BUDGET-CORNER-026: budget-auth is scheduled last (it clears the Keychain)', () => {
    expect(flowsOrder[flowsOrder.length - 1]).toBe('budget-auth');
  });

  it('BUDGET-CORNER-026: every flow declares the app:budget tag', () => {
    const untagged = flows.filter(f => !f.tags.includes('app:budget')).map(f => f.file);
    expect(untagged).toEqual([]);
  });
});
