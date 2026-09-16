/**
 * HOUSE — `optional: true` on a Maestro tap does not mean "tap only if needed".
 *
 * It means "do not fail the flow if this element is absent". When the element
 * IS present it is tapped, every single time. The two readings are identical on
 * a selector that exists only in the case you meant to handle, and opposite on
 * one that also exists in the success path — which is why this is so easy to
 * write and so hard to see.
 *
 * THE REAL FAILURE. `households/property-notice-import.yaml` closed the import
 * sheet with a dismiss chain:
 *
 *     - tapOn: {text: 'Cancel', optional: true}
 *     - tapOn: {id: 'nav-back-button', optional: true}
 *
 * read as "close the sheet if it is still open". But `nav-back-button` is
 * present on the property detail screen ALWAYS — it is the screen's own header
 * button — so once `Cancel` had already closed the sheet the second tap popped
 * the screen, and the flow ended one screen further back than it thought. It
 * went red several commands later on `assertVisible: property-detail-screen`,
 * pointing at the wrong thing entirely. The fix was to guard the hop on having
 * actually left:
 *
 *     - runFlow:
 *         when: {notVisible: {id: 'property-detail-screen'}}
 *         commands: [- tapOn: {id: 'nav-back-button', optional: true}]
 *
 * WHAT THIS TEST FLAGS, AND WHY IT IS THIS NARROW. A single unguarded
 * `optional: true` back tap is ordinary and correct — it is how nearly every
 * read-only flow leaves the screen it just inspected, and `optional` there is
 * doing its real job (the screen may legitimately have no back button, e.g. a
 * tab root). Flagging those would put ~11 healthy flows in the report, and a
 * guard that cries wolf gets deleted rather than heeded.
 *
 * The shape that is actually wrong is narrower, and it is the shape above:
 *
 *   1. TWO OR MORE CONSECUTIVE unguarded `optional: true` dismiss taps — one
 *      deliberate exit is written as one tap; a chain can only mean "however
 *      deep we are, get out", which is the mistaken reading of `optional`;
 *   2. at least one of them being `nav-back-button`, the selector that exists
 *      on nearly every screen and therefore never behaves conditionally; and
 *   3. the flow afterwards asserting it is on a particular screen, with no
 *      absolute re-navigation (`openLink`, `launchApp`, a `go-*-tab` subflow)
 *      in between to make the overshoot moot.
 *
 * All three together are the property-notice-import defect exactly, and they
 * were also true of `floor-plans/floor-plans-mutations.yaml`, which unwound
 * with two bare back taps into `assertVisible: floor-plans-screen` while the
 * branches above it could legitimately leave the flow zero or one screen deep.
 * Both are now guarded; this keeps them that way.
 *
 * "Not nested inside a `runFlow.when`" is read off the indentation, which is
 * exact for these files: a guard is always expressed as a nested `runFlow`, so
 * a command starting at column 0 in the command document is by definition
 * ungated.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { basename, join } from 'path';

const MAESTRO_DIR = join(__dirname, '../maestro');
const REPO_ROOT = join(__dirname, '../..');
const REGISTRY_PATH = join(REPO_ROOT, 'scripts/e2e/maestro-fleet-brand.sh');

/* ------------------------------------------------------------------ */
/* Which flows are House flows                                         */
/* ------------------------------------------------------------------ */

/**
 * The House feature directories, read from the one registry the runners read
 * (`maestro_house_flow_dirs()`), so a new House feature directory is covered
 * the day it is added rather than the day someone remembers this file.
 */
function houseFlowDirsFromRegistry(): string[] {
  const source = readFileSync(REGISTRY_PATH, 'utf8');
  const body = /maestro_house_flow_dirs\(\)\s*\{[\s\S]*?<<'HOUSE_FLOW_DIRS_EOF'\n([\s\S]*?)\nHOUSE_FLOW_DIRS_EOF/.exec(
    source,
  );
  return body ? body[1]!.split('\n').map((l) => l.trim()).filter(Boolean) : [];
}

/** Subflows are shared, so the other fleet apps' copies live here too. */
const OTHER_APP_SUBFLOW = /^(budget|kaizen|health|language)-/;

function houseFlowFiles(): string[] {
  const dirs = [...houseFlowDirsFromRegistry(), 'house-multi-member'];
  const out: string[] = [];
  for (const dir of dirs) {
    const full = join(MAESTRO_DIR, dir);
    if (!existsSync(full)) continue;
    for (const entry of readdirSync(full)) {
      if (entry.endsWith('.yaml') && entry !== 'config.yaml') out.push(join(full, entry));
    }
  }
  const subflows = join(MAESTRO_DIR, 'subflows');
  for (const entry of readdirSync(subflows)) {
    if (entry.endsWith('.yaml') && !OTHER_APP_SUBFLOW.test(entry)) {
      out.push(join(subflows, entry));
    }
  }
  return out.sort();
}

/* ------------------------------------------------------------------ */
/* Command blocks                                                      */
/* ------------------------------------------------------------------ */

interface Block {
  /** 1-based line number of the `- ` that opens the command. */
  line: number;
  text: string;
}

/**
 * The top-level commands of a flow: everything from the `---` separator on,
 * split at each column-0 `- `.
 *
 * Column 0 is the whole point. Anything a `runFlow.when` gates is indented
 * under `commands:`, so a block that starts here is ungated by construction —
 * no YAML parser needed, and no dependency this repo does not already declare.
 */
function topLevelCommands(source: string): Block[] {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => l.trimEnd() === '---');
  if (start === -1) return [];

  const blocks: Block[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.startsWith('- ')) blocks.push({ line: i + 1, text: line });
    else if (blocks.length > 0) blocks[blocks.length - 1]!.text += `\n${line}`;
  }
  return blocks;
}

const isOptional = (b: Block) => /^\s+optional:\s*true\s*$/m.test(b.text);
const isTap = (b: Block) => b.text.startsWith('- tapOn:');
const tapsBack = (b: Block) => /^\s+id:\s*'nav-back-button'\s*$/m.test(b.text);

/**
 * Selectors whose purpose is "make this go away". Deliberately not every
 * selector: a chain of two ordinary taps is a flow doing its job, and only a
 * chain of DISMISSALS encodes the "close whatever is open" belief.
 */
const DISMISS_SELECTOR =
  /^\s+(?:id:\s*'(?:nav-back-button|bottom-sheet-close|bottom-sheet-overlay|[a-z0-9-]*-(?:cancel|close|dismiss))'|text:\s*'\^?(?:Cancel|Close|Done|Dismiss|Skip|Back|Leave|Discard|Not Now|Later)\$?')\s*$/m;

const isUnguardedDismissTap = (b: Block) => isTap(b) && isOptional(b) && DISMISS_SELECTOR.test(b.text);

/** `assertVisible` / `extendedWaitUntil` naming a screen — "I am still here". */
const isScreenAssertion = (b: Block) =>
  (b.text.startsWith('- assertVisible:') || b.text.startsWith('- extendedWaitUntil:')) &&
  /^\s+id:\s*'[a-z0-9$}{_-]*screen'\s*$/m.test(b.text) &&
  !isOptional(b);

/**
 * A command that puts the app somewhere absolute, which makes any overshoot
 * above it irrelevant. Tab switches and deep links both qualify; `open-*`
 * subflows deliberately do not — several of them push relative to wherever
 * they are called from.
 */
const isAbsoluteNavigation = (b: Block) =>
  b.text.startsWith('- openLink:') ||
  b.text.startsWith('- launchApp') ||
  /^-\s+runFlow:.*\b(?:go-[a-z-]+-tab|launch-[a-z-]+|[a-z-]*recover[a-z-]*)\.yaml/.test(b.text) ||
  /^\s+file:\s*\S*\b(?:go-[a-z-]+-tab|launch-[a-z-]+|[a-z-]*recover[a-z-]*)\.yaml/m.test(b.text);

/* ------------------------------------------------------------------ */
/* The defect                                                          */
/* ------------------------------------------------------------------ */

export interface Violation {
  line: number;
  chain: number;
  assertedAt: number;
}

/**
 * Chains of >= 2 consecutive ungated `optional: true` dismiss taps that include
 * `nav-back-button` and are followed, before any absolute re-navigation, by an
 * assertion that the flow is on a named screen.
 */
export function findUnconditionalDismissChains(source: string): Violation[] {
  const blocks = topLevelCommands(source);
  const found: Violation[] = [];

  for (let i = 0; i < blocks.length; ) {
    if (!isUnguardedDismissTap(blocks[i]!)) {
      i += 1;
      continue;
    }
    let end = i;
    while (end + 1 < blocks.length && isUnguardedDismissTap(blocks[end + 1]!)) end += 1;

    const chain = blocks.slice(i, end + 1);
    if (chain.length >= 2 && chain.some(tapsBack)) {
      for (let k = end + 1; k < blocks.length; k += 1) {
        if (isAbsoluteNavigation(blocks[k]!)) break;
        if (isScreenAssertion(blocks[k]!)) {
          found.push({ line: chain[0]!.line, chain: chain.length, assertedAt: blocks[k]!.line });
          break;
        }
      }
    }
    i = end + 1;
  }
  return found;
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

const flows = houseFlowFiles();

describe('House Maestro flows: `optional: true` is not a conditional', () => {
  it('reads the House flow directories and finds flows (guard against a vacuous suite)', () => {
    // If the registry function is renamed, or the directories move, every
    // it.each below silently disappears and this file passes by checking
    // nothing — the exact failure mode houseV2SuiteCompleteness.test.ts was
    // written to catch in the runners.
    expect(houseFlowDirsFromRegistry().length).toBeGreaterThanOrEqual(20);
    expect(flows.length).toBeGreaterThan(150);
  });

  it.each(flows.map((f) => [`${basename(f)}`, f] as const))(
    '%s does not pop past the screen it then asserts',
    (_name, file) => {
      const hits = findUnconditionalDismissChains(readFileSync(file, 'utf8'));
      // Each hit reads: N consecutive ungated `optional: true` dismiss taps at
      // line X, one of them `nav-back-button`, and line Y still expecting a
      // particular screen. Wrap the hops that must not always fire:
      //   - runFlow:
      //       when: {notVisible: {id: '<the screen>'}}
      //       commands: [- tapOn: {id: 'nav-back-button', optional: true}]
      expect(hits).toEqual([]);
    },
  );
});

describe('the detector itself', () => {
  // Positive controls. A guard whose detector has quietly stopped detecting is
  // worse than no guard, and both of these are transcriptions of code that
  // really shipped and really failed on a device.
  const HEADER = "appId: com.symply.house\ntags:\n  - app:house\n---\n";

  it('catches the property-notice-import shape that started this', () => {
    const flow = `${HEADER}- tapOn:
    text: 'Cancel'
    optional: true
- tapOn:
    id: 'nav-back-button'
    optional: true
- assertVisible:
    id: 'property-detail-screen'
`;
    expect(findUnconditionalDismissChains(flow)).toHaveLength(1);
  });

  it('catches the floor-plans-mutations shape (two bare back taps into an assert)', () => {
    const flow = `${HEADER}- tapOn:
    id: 'nav-back-button'
    optional: true
- tapOn:
    id: 'nav-back-button'
    optional: true
- assertVisible:
    id: 'floor-plans-screen'
`;
    expect(findUnconditionalDismissChains(flow)).toHaveLength(1);
  });

  // Negative controls, one per exoneration, so that narrowing this test to
  // avoid noise cannot be quietly widened back into noise.
  it('leaves a single deliberate back tap alone', () => {
    const flow = `${HEADER}- tapOn:
    id: 'nav-back-button'
    optional: true
- extendedWaitUntil:
    visible:
      id: 'utilities-screen'
    timeout: 15000
`;
    expect(findUnconditionalDismissChains(flow)).toEqual([]);
  });

  it('leaves a chain alone once an absolute re-navigation follows it', () => {
    const flow = `${HEADER}- tapOn:
    text: 'Cancel'
    optional: true
- tapOn:
    id: 'nav-back-button'
    optional: true
- runFlow: ../subflows/go-home-tab.yaml
- assertVisible:
    id: 'home-screen'
`;
    expect(findUnconditionalDismissChains(flow)).toEqual([]);
  });

  it('leaves a chain alone once each hop carries its own `when:` guard', () => {
    const flow = `${HEADER}- tapOn:
    text: 'Cancel'
    optional: true
- runFlow:
    when:
      notVisible:
        id: 'property-detail-screen'
    commands:
      - tapOn:
          id: 'nav-back-button'
          optional: true
- assertVisible:
    id: 'property-detail-screen'
`;
    expect(findUnconditionalDismissChains(flow)).toEqual([]);
  });

  it('ignores a dismiss chain with no `nav-back-button` in it', () => {
    // `bottom-sheet-close` / `Discard` exist only while the thing they close is
    // open, so they really are conditional and need no guard.
    const flow = `${HEADER}- tapOn:
    id: 'bottom-sheet-close'
    optional: true
- tapOn:
    text: '^Discard$'
    optional: true
- assertVisible:
    id: 'tasks-screen'
`;
    expect(findUnconditionalDismissChains(flow)).toEqual([]);
  });
});
