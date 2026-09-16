/**
 * HOUSE-MM — every flow on disk is actually scheduled, and every scheduled flow
 * exists.
 *
 * The two-device suite is driven by a shell runner, not by a manifest: a flow
 * runs because a `single`/`pair` line names it. That makes "wrote the flow,
 * forgot to schedule it" completely silent — the file sits in the directory, the
 * run goes green, and the behaviour it was written for is untested. The
 * mirror-image failure is just as quiet at author time and much louder at run
 * time: a `single` line naming a file that was renamed or deleted fails 30
 * minutes into a device run.
 *
 * Budget and Health each have a suite-completeness guard for exactly this reason
 * (`budgetSuiteCompleteness`, `healthSuiteCompleteness`). House had none, and
 * grew to twenty-odd flows without one.
 *
 * What this deliberately does NOT check: whether a flow PASSES, or whether the
 * phase it sits in is the right one. Those need two simulators. This checks the
 * one thing a static tree can prove — that the set of flows on disk and the set
 * the runner drives are the same set.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '../..');
const FLOW_DIR = join(REPO_ROOT, 'e2e/maestro/house-multi-member');
const RUNNER_PATH = join(REPO_ROOT, 'scripts/e2e/run-house-multi-member-sync.sh');

const runnerSource = readFileSync(RUNNER_PATH, 'utf8');
const flowFiles = readdirSync(FLOW_DIR).filter((file) => file.endsWith('.yaml'));

/**
 * The runner with its comments removed.
 *
 * This file is heavily commented, and several of those comments NAME flows —
 * to explain an ordering, or to say which flow a technique was learned from.
 * Matching over the raw text counts those mentions as schedule entries, which
 * turns every explanatory comment into a false failure and, worse, would let a
 * flow that is only ever MENTIONED pass as scheduled.
 */
function commandsOnly(source: string): string {
  return source
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .join('\n');
}

const runnerCommands = commandsOnly(runnerSource);

/**
 * Flows the runner is not expected to name, because something else does.
 *
 * A `runFlow:` inside another flow is a SUBFLOW — a shared step, not a matrix
 * row — and the runner never invokes one directly. They are recognised by being
 * referenced from another flow rather than by a naming convention, so a subflow
 * that stops being used anywhere still shows up as unscheduled, which is the
 * honest answer.
 */
function isReferencedByAnotherFlow(file: string): boolean {
  return flowFiles.some((other) => {
    if (other === file) return false;
    return readFileSync(join(FLOW_DIR, other), 'utf8').includes(file);
  });
}

/**
 * Every `mm-*.yaml` the runner actually invokes, in any `single`/`pair`
 * position.
 *
 * Scoped to the `mm-` prefix as well as to command lines: the runner also names
 * flows from other suites' directories (the shared `subflows/` helpers), and
 * those are not this directory's business.
 */
function scheduledFlows(): Set<string> {
  const found = new Set<string>();
  const pattern = /(?<![\w/-])(mm-[a-z0-9-]+\.yaml)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(runnerCommands)) !== null) {
    found.add(match[1]!);
  }
  return found;
}

const scheduled = scheduledFlows();

describe('HOUSE-MM — the runner and the flow directory agree', () => {
  it('parses a plausible number of flows, so a shape change cannot make this vacuous', () => {
    // Without a floor, a runner rewritten to build flow names by string
    // concatenation would make every assertion below pass by finding nothing.
    expect(flowFiles.length).toBeGreaterThan(10);
    expect(scheduled.size).toBeGreaterThan(5);
  });

  it('schedules every flow on disk that is not a subflow of another', () => {
    const orphans = flowFiles.filter(
      (file) => !scheduled.has(file) && !isReferencedByAnotherFlow(file),
    );
    expect(orphans).toEqual([]);
  });

  it('names no flow that is missing from disk', () => {
    // A rename that updated the file and not the runner fails 30 minutes into a
    // device run otherwise.
    const onDisk = new Set(flowFiles);
    expect([...scheduled].filter((file) => !onDisk.has(file))).toEqual([]);
  });

  it('declares the app:house tag on every flow, so a tag-filtered run cannot skip one', () => {
    const untagged = flowFiles.filter(
      (file) => !readFileSync(join(FLOW_DIR, file), 'utf8').includes('app:house'),
    );
    expect(untagged).toEqual([]);
  });

  it('runs the backfill setup BEFORE the invite is minted', () => {
    // The whole claim of HOUSE-MM-012 is that the row reached the joiner as
    // HISTORY. If mm-13 ran after mm-02, device B could have been enrolled and
    // online for it as a live op, and mm-12 would silently become a slower
    // duplicate of mm-20.
    const setupAt = runnerCommands.indexOf('mm-13-owner-pre-invite-task.yaml');
    const inviteAt = runnerCommands.indexOf('mm-02-owner-create-invite.yaml');
    const backfillAt = runnerCommands.indexOf('mm-12-member-backfill.yaml');

    expect(setupAt).toBeGreaterThan(-1);
    expect(inviteAt).toBeGreaterThan(-1);
    expect(backfillAt).toBeGreaterThan(-1);
    expect(setupAt).toBeLessThan(inviteAt);
    expect(inviteAt).toBeLessThan(backfillAt);
  });

  it('keeps the backfill assertion free of any manual sync', () => {
    // The absence IS the assertion: a tap on "Sync now" would prove the data can
    // be fetched, not that joining fetches it.
    // Comments stripped: the flow's own header EXPLAINS why it does not pulse,
    // and naming the thing you are refusing to do must not read as doing it.
    const backfill = commandsOnly(
      readFileSync(join(FLOW_DIR, 'mm-12-member-backfill.yaml'), 'utf8'),
    );
    expect(backfill).not.toContain('mm-sync-pulse');
    expect(backfill).not.toContain('house-settings-sync-now');
  });
});
