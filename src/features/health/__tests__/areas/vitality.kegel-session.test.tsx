/**
 * Symply Health — the guided kegel session: the donor's `KegelWorkoutView`,
 * ported as a pure reducer plus a thin timer component.
 *
 * This whole surface landed with NO tests, and it is the one part of the
 * Vitality tab that makes a promise in seconds. A person doing this exercise has
 * their eyes shut and is following a rhythm; the only things they can check are
 * the haptic tap at a phase flip and the count they are told they finished. So
 * the two properties that matter are:
 *
 *   1. **The rhythm is exactly the advertised one.** The card says
 *      "5s squeeze · 5s relax · 30s in total". If the reducer took 28 ticks or
 *      32, nothing on screen would look wrong — the countdown would simply be
 *      lying, and a person holding a muscle to it would be holding it for the
 *      wrong length of time. The spec below asserts the tick count against the
 *      SAME constants the label is built from, so the two cannot drift apart.
 *   2. **A finished session logs the sets that were actually held, once.** The
 *      donor never wrote the session anywhere and showed a hard-coded "12 this
 *      week"; here the count reaches the day's entry. Double-firing would
 *      inflate it, and a set counted before its release was held would credit
 *      work that did not happen.
 *
 * The reducer is deliberately pure and lives in `healthVitalityStorage`, so most
 * of this file is arithmetic. The component specs cover only what the component
 * owns: the interval, the AppState pause, the once-only completion, and the
 * controls' enabled/disabled shape.
 */

import React from 'react';
import { AppState } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  HealthKegelTimer,
  pluralizeSets,
  sessionMinutes,
  startLabel,
  KEGEL_SET_SECONDS,
} from '../../components/HealthKegelTimer';
import {
  clampSessionSets,
  createKegelSession,
  KEGEL_DEFAULT_SETS,
  KEGEL_PHASE_INSTRUCTIONS,
  KEGEL_PHASE_LABELS,
  KEGEL_PHASES,
  KEGEL_RELAX_SECONDS,
  KEGEL_SET_OPTIONS,
  KEGEL_SQUEEZE_SECONDS,
  kegelPhaseProgress,
  kegelPhaseSeconds,
  kegelProgressLabel,
  pauseKegelSession,
  startKegelSession,
  tickKegelSession,
  type KegelSession,
} from '../../healthVitalityStorage';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success' },
}));

/** Drive the reducer `n` times, returning the resulting session. */
function tick(session: KegelSession, n = 1): KegelSession {
  let next = session;
  for (let i = 0; i < n; i += 1) next = tickKegelSession(next);
  return next;
}

function running(totalSets = KEGEL_DEFAULT_SETS): KegelSession {
  return startKegelSession(createKegelSession(totalSets));
}

/* ------------------------------------------------------------------ */
/* The reducer                                                         */
/* ------------------------------------------------------------------ */

describe('kegel session — shape and set count', () => {
  it('HEALTH-VITALITY-300: a new session opens idle on a full squeeze', () => {
    // Idle, not running: the donor's timer started the moment the card appeared,
    // which meant opening the tab began an exercise nobody asked for.
    expect(createKegelSession()).toEqual<KegelSession>({
      status: 'idle',
      phase: 'squeeze',
      secondsLeft: KEGEL_SQUEEZE_SECONDS,
      set: 1,
      totalSets: KEGEL_DEFAULT_SETS,
      completedSets: 0,
    });
  });

  it('HEALTH-VITALITY-301: the set count is clamped, and junk falls back to the default', () => {
    // The count reaches the reducer from a chip today, but it is also the number
    // a resumed/rehydrated session would carry. A 0 would make a session that can
    // never complete; a negative one would make `set < totalSets` false forever.
    expect(clampSessionSets(3)).toBe(3);
    expect(clampSessionSets(1)).toBe(1);
    expect(clampSessionSets(30)).toBe(30);
    expect(clampSessionSets(31)).toBe(30); // the 30-set ceiling
    expect(clampSessionSets(4.6)).toBe(5); // rounded, not truncated
    expect(clampSessionSets(0)).toBe(KEGEL_DEFAULT_SETS);
    expect(clampSessionSets(-4)).toBe(KEGEL_DEFAULT_SETS);
    expect(clampSessionSets(NaN)).toBe(KEGEL_DEFAULT_SETS);
    expect(clampSessionSets(Infinity)).toBe(KEGEL_DEFAULT_SETS);
    // …and it is applied on construction, not only at the chip.
    expect(createKegelSession(99).totalSets).toBe(30);
  });

  it('HEALTH-VITALITY-302: every offered session length is a legal one', () => {
    // The chips and the clamp must agree, or a chip would silently select a
    // different length from the one it is labelled with.
    for (const option of KEGEL_SET_OPTIONS) {
      expect([option, clampSessionSets(option)]).toEqual([option, option]);
      expect([option, createKegelSession(option).totalSets]).toEqual([option, option]);
    }
    expect(KEGEL_PHASES).toEqual(['squeeze', 'relax']);
    for (const phase of KEGEL_PHASES) {
      expect(KEGEL_PHASE_LABELS[phase]).toBeTruthy();
      expect(KEGEL_PHASE_INSTRUCTIONS[phase]).toBeTruthy();
    }
  });
});

describe('kegel session — the rhythm', () => {
  it('HEALTH-VITALITY-303: a squeeze counts down to 1 and only THEN flips', () => {
    // The readout goes 5,4,3,2,1 and the flip happens on the tick that would
    // have shown 0. Flipping at 0 would show a phantom sixth second; flipping at
    // 1 would cut the last second off the hold.
    let s = running();
    expect([s.phase, s.secondsLeft]).toEqual(['squeeze', 5]);

    for (const expected of [4, 3, 2, 1]) {
      s = tick(s);
      expect([s.phase, s.secondsLeft]).toEqual(['squeeze', expected]);
    }

    s = tick(s);
    expect([s.phase, s.secondsLeft]).toEqual(['relax', KEGEL_RELAX_SECONDS]);
    // No set is credited yet — the release has not been held.
    expect(s.completedSets).toBe(0);
  });

  it('HEALTH-VITALITY-304: a set is credited only after its RELEASE', () => {
    // squeeze (5 ticks) + relax (5 ticks) = one set.
    const afterOneSet = tick(running(), KEGEL_SQUEEZE_SECONDS + KEGEL_RELAX_SECONDS);

    expect(afterOneSet.completedSets).toBe(1);
    expect(afterOneSet.set).toBe(2); // on to the next
    expect([afterOneSet.phase, afterOneSet.secondsLeft]).toEqual(['squeeze', KEGEL_SQUEEZE_SECONDS]);
    expect(afterOneSet.status).toBe('running');
  });

  it('HEALTH-VITALITY-305: a session takes EXACTLY the number of seconds the card promises', () => {
    // The invariant that keeps the label honest. `sessionMinutes` derives its
    // figure from the same two constants, so asserting the tick count against
    // `totalSets * KEGEL_SET_SECONDS` pins the label and the reducer together —
    // change one constant and both move, change the reducer and this fails.
    for (const totalSets of KEGEL_SET_OPTIONS) {
      const expectedTicks = totalSets * KEGEL_SET_SECONDS;

      const oneShort = tick(running(totalSets), expectedTicks - 1);
      expect([totalSets, oneShort.status]).toEqual([totalSets, 'running']);

      const done = tick(running(totalSets), expectedTicks);
      expect([totalSets, done.status]).toEqual([totalSets, 'done']);
      expect([totalSets, done.completedSets]).toEqual([totalSets, totalSets]);
      expect([totalSets, done.secondsLeft]).toEqual([totalSets, 0]);
    }
    expect(KEGEL_SET_SECONDS).toBe(KEGEL_SQUEEZE_SECONDS + KEGEL_RELAX_SECONDS);
  });

  it('HEALTH-VITALITY-306: a finished session is inert — extra ticks cannot inflate it', () => {
    // The interval is cleared on `status !== 'running'`, but a late tick already
    // in flight must not add a phantom set to the number that gets LOGGED.
    const done = tick(running(3), 3 * KEGEL_SET_SECONDS);
    const later = tick(done, 25);

    expect(later).toBe(done); // same object — the reducer short-circuits
    expect(later.completedSets).toBe(3);
  });

  it('HEALTH-VITALITY-307: an idle or paused session does not advance', () => {
    const idle = createKegelSession();
    expect(tick(idle, 10)).toBe(idle);

    const paused = pauseKegelSession(tick(running(), 2));
    expect([paused.status, paused.secondsLeft]).toEqual(['paused', 3]);
    expect(tick(paused, 10)).toBe(paused);
  });
});

describe('kegel session — start, pause and resume', () => {
  it('HEALTH-VITALITY-310: pause keeps its place, resume continues from it', () => {
    const midSqueeze = tick(running(), 2); // 3 seconds left
    const paused = pauseKegelSession(midSqueeze);
    const resumed = startKegelSession(paused);

    expect(resumed.status).toBe('running');
    expect(resumed.secondsLeft).toBe(3);
    expect(resumed.phase).toBe('squeeze');
    expect(resumed.set).toBe(midSqueeze.set);
  });

  it('HEALTH-VITALITY-311: starting from idle or done REWINDS, keeping the chosen length', () => {
    // A half-held squeeze cannot be resumed honestly once the person has let go,
    // so anything that is not a pause starts the set again from the top. The
    // chosen session LENGTH survives, because that is a preference and not
    // progress.
    const done = tick(running(5), 5 * KEGEL_SET_SECONDS);
    const again = startKegelSession(done);

    expect(again).toEqual<KegelSession>({
      status: 'running',
      phase: 'squeeze',
      secondsLeft: KEGEL_SQUEEZE_SECONDS,
      set: 1,
      totalSets: 5, // preserved
      completedSets: 0, // the previous session's count does NOT carry over
    });
  });

  it('HEALTH-VITALITY-312: pausing anything that is not running is a no-op', () => {
    // Returned by identity so a spurious AppState event cannot cause a re-render
    // storm on a screen that is already still.
    const idle = createKegelSession();
    expect(pauseKegelSession(idle)).toBe(idle);

    const done = tick(running(3), 3 * KEGEL_SET_SECONDS);
    expect(pauseKegelSession(done)).toBe(done);
  });
});

describe('kegel session — the readouts', () => {
  it('HEALTH-VITALITY-320: phase progress runs 0 → 1 across the CURRENT phase', () => {
    // The ring is redrawn every second, so it is read as motion rather than as a
    // number — but it must start empty and end full within each phase, or the
    // squeeze and the release would look like different lengths.
    let s = running();
    expect(kegelPhaseProgress(s)).toBe(0);
    s = tick(s);
    expect(kegelPhaseProgress(s)).toBeCloseTo(0.2, 5);
    s = tick(s, 3); // 1 second left
    expect(kegelPhaseProgress(s)).toBeCloseTo(0.8, 5);

    // The flip resets the ring rather than continuing it.
    s = tick(s);
    expect(s.phase).toBe('relax');
    expect(kegelPhaseProgress(s)).toBe(0);

    // A finished session shows a full ring regardless of its residual seconds.
    const done = tick(running(3), 3 * KEGEL_SET_SECONDS);
    expect(kegelPhaseProgress(done)).toBe(1);
  });

  it('HEALTH-VITALITY-321: both phases are the same length, so neither ring is faster', () => {
    expect(kegelPhaseSeconds('squeeze')).toBe(KEGEL_SQUEEZE_SECONDS);
    expect(kegelPhaseSeconds('relax')).toBe(KEGEL_RELAX_SECONDS);
    expect(kegelPhaseSeconds('squeeze')).toBe(kegelPhaseSeconds('relax'));
  });

  it('HEALTH-VITALITY-322: the progress label counts SETS, and says when it is over', () => {
    expect(kegelProgressLabel(createKegelSession())).toBe('Set 1 of 3');
    expect(kegelProgressLabel(tick(running(), KEGEL_SET_SECONDS))).toBe('Set 2 of 3');
    expect(kegelProgressLabel(tick(running(3), 3 * KEGEL_SET_SECONDS))).toBe('Session complete');
    expect(kegelProgressLabel(createKegelSession(10))).toBe('Set 1 of 10');
  });

  it('HEALTH-VITALITY-323: the start button names the action it will actually take', () => {
    // Three different things behind one button — a "Start" on a paused session
    // would rewind the person's progress without warning them.
    expect(startLabel(createKegelSession())).toBe('Start');
    expect(startLabel(pauseKegelSession(running()))).toBe('Resume');
    expect(startLabel(tick(running(3), 3 * KEGEL_SET_SECONDS))).toBe('Start again');
  });

  it('HEALTH-VITALITY-324: the session length is stated in plain language', () => {
    // Shown BEFORE the session starts, so the commitment is known. The minute
    // boundary and the exact-minute case are the two that read wrong if the
    // remainder is mishandled ("1 min 0s").
    expect(sessionMinutes(3)).toBe('30s in total');
    expect(sessionMinutes(5)).toBe('50s in total');
    expect(sessionMinutes(6)).toBe('1 min in total'); // exactly 60s — no "0s"
    expect(sessionMinutes(10)).toBe('1 min 40s in total');
    expect(sessionMinutes(30)).toBe('5 min in total');
  });

  it('HEALTH-VITALITY-325: pluralizeSets agrees the singular with the count — "1 set", never "1 sets"', () => {
    // KEGEL_SET_OPTIONS starts at 3, so a completed session can never actually
    // show "1 set" through the shipped picker — this pins the shared helper
    // directly, independent of what the picker currently offers.
    expect(pluralizeSets(1)).toBe('1 set');
    expect(pluralizeSets(0)).toBe('0 sets');
    expect(pluralizeSets(3)).toBe('3 sets');
    expect(pluralizeSets(10)).toBe('10 sets');
  });
});

/* ------------------------------------------------------------------ */
/* The component                                                       */
/* ------------------------------------------------------------------ */

function byTestId(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

function pressable(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function'
  );
}

function tap(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  act(() => pressable(tree, testID).props.onPress());
}

/** Advance the component's 1-second interval `n` times. */
function advance(n: number) {
  act(() => {
    jest.advanceTimersByTime(n * 1000);
  });
}

async function renderTimer(onComplete = jest.fn()) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthKegelTimer onComplete={onComplete} />
      </ThemeProvider>
    );
  });
  return { tree, onComplete };
}

describe('HealthKegelTimer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('HEALTH-VITALITY-330: it opens idle and does NOT start counting on its own', async () => {
    // Opening the Vitality tab must not begin an exercise. The donor's timer
    // did, which is why this is asserted rather than assumed.
    const { tree } = await renderTimer();

    expect(allText(byTestId(tree, 'health-kegel-timer-seconds')[0])).toBe('5');
    expect(allText(byTestId(tree, 'health-kegel-timer-phase')[0])).toBe('SQUEEZE');
    expect(allText(byTestId(tree, 'health-kegel-timer-progress')[0])).toBe('Set 1 of 3');

    advance(6);
    expect(allText(byTestId(tree, 'health-kegel-timer-seconds')[0])).toBe('5');
    // Reset only exists once there is something to reset.
    expect(byTestId(tree, 'health-kegel-timer-reset').length).toBe(0);
  });

  it('HEALTH-VITALITY-331: Start runs the clock at one tick a second', async () => {
    const { tree } = await renderTimer();
    tap(tree, 'health-kegel-timer-start');

    advance(1);
    expect(allText(byTestId(tree, 'health-kegel-timer-seconds')[0])).toBe('4');
    advance(3);
    expect(allText(byTestId(tree, 'health-kegel-timer-seconds')[0])).toBe('1');
    advance(1);
    expect(allText(byTestId(tree, 'health-kegel-timer-phase')[0])).toBe('RELAX');
    expect(allText(byTestId(tree, 'health-kegel-timer-seconds')[0])).toBe('5');
    // Reset is now offered.
    expect(byTestId(tree, 'health-kegel-timer-reset').length).toBe(1);
  });

  it('HEALTH-VITALITY-332: Pause stops the clock and Resume continues from the same second', async () => {
    const { tree } = await renderTimer();
    tap(tree, 'health-kegel-timer-start');
    advance(2);
    expect(allText(byTestId(tree, 'health-kegel-timer-seconds')[0])).toBe('3');

    tap(tree, 'health-kegel-timer-start'); // the same button is Pause while running
    advance(10);
    expect(allText(byTestId(tree, 'health-kegel-timer-seconds')[0])).toBe('3');

    tap(tree, 'health-kegel-timer-start'); // Resume
    advance(1);
    expect(allText(byTestId(tree, 'health-kegel-timer-seconds')[0])).toBe('2');
  });

  it('HEALTH-VITALITY-333: leaving the app PAUSES rather than counting sets nobody held', async () => {
    // The whole reason the reducer is pure. A backgrounded phone would otherwise
    // keep crediting completed sets while it sat in a pocket.
    const addListener = jest.spyOn(AppState, 'addEventListener');
    const { tree } = await renderTimer();
    tap(tree, 'health-kegel-timer-start');
    advance(2);

    const handler = addListener.mock.calls.find(([event]) => event === 'change')?.[1] as (
      s: string
    ) => void;
    expect(handler).toBeDefined();

    act(() => handler('background'));
    advance(10);
    expect(allText(byTestId(tree, 'health-kegel-timer-seconds')[0])).toBe('3');
    // …and the button now offers to resume rather than to pause.
    expect(pressable(tree, 'health-kegel-timer-start').props.accessibilityLabel).toBe(
      'Resume'
    );

    // Returning to the foreground does NOT auto-resume: the person restarts when
    // they are ready to hold again.
    act(() => handler('active'));
    advance(3);
    expect(allText(byTestId(tree, 'health-kegel-timer-seconds')[0])).toBe('3');
    addListener.mockRestore();
  });

  it('HEALTH-VITALITY-334: finishing reports the completed sets EXACTLY once', async () => {
    // The count that reaches the day's entry. Firing twice would double the
    // number logged; firing on every subsequent render would multiply it.
    const { tree, onComplete } = await renderTimer();
    tap(tree, 'health-kegel-timer-start');

    advance(3 * KEGEL_SET_SECONDS);

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(3);
    expect(allText(byTestId(tree, 'health-kegel-timer-progress')[0])).toBe('Session complete');

    // Idle ticks after the fact change nothing.
    advance(20);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('HEALTH-VITALITY-335: a second session reports its OWN count, not a running total', async () => {
    const { tree, onComplete } = await renderTimer();
    tap(tree, 'health-kegel-timer-start');
    advance(3 * KEGEL_SET_SECONDS);
    expect(onComplete).toHaveBeenLastCalledWith(3);

    tap(tree, 'health-kegel-timer-start'); // "Start again"
    advance(3 * KEGEL_SET_SECONDS);

    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenLastCalledWith(3);
  });

  it('HEALTH-VITALITY-336: abandoning a session part-way reports NOTHING', async () => {
    // Reset must not credit the sets already held — the screen adds whatever it
    // is handed, so a partial report would be a permanent over-count.
    const { tree, onComplete } = await renderTimer();
    tap(tree, 'health-kegel-timer-start');
    advance(2 * KEGEL_SET_SECONDS); // two full sets held

    tap(tree, 'health-kegel-timer-reset');

    expect(onComplete).not.toHaveBeenCalled();
    expect(allText(byTestId(tree, 'health-kegel-timer-progress')[0])).toBe('Set 1 of 3');
    expect(allText(byTestId(tree, 'health-kegel-timer-seconds')[0])).toBe('5');
    expect(byTestId(tree, 'health-kegel-timer-reset').length).toBe(0); // idle again
  });

  it('HEALTH-VITALITY-337: the length chips are locked mid-session', async () => {
    // Changing the length while a session is in flight would silently redefine
    // what "complete" meant — and the completed count is what gets logged.
    const { tree } = await renderTimer();
    for (const option of KEGEL_SET_OPTIONS) {
      expect([option, pressable(tree, `health-kegel-timer-sets-${option}`).props.disabled]).toEqual([
        option,
        false,
      ]);
    }

    tap(tree, 'health-kegel-timer-start');
    advance(2);

    for (const option of KEGEL_SET_OPTIONS) {
      const chip = pressable(tree, `health-kegel-timer-sets-${option}`);
      expect([option, chip.props.disabled]).toEqual([option, true]);
      expect([option, chip.props.accessibilityState.disabled]).toEqual([option, true]);
    }
    // The session is unaffected by a tap that the disabled state should swallow.
    expect(allText(byTestId(tree, 'health-kegel-timer-progress')[0])).toBe('Set 1 of 3');
  });

  it('HEALTH-VITALITY-338: choosing a length REWINDS to a fresh session of that length', async () => {
    // Picking 10 while paused half-way through a 3 must not leave the person
    // "on set 2 of 10" — they chose a different exercise.
    const { tree, onComplete } = await renderTimer();
    tap(tree, 'health-kegel-timer-start');
    advance(KEGEL_SET_SECONDS + 2);
    tap(tree, 'health-kegel-timer-start'); // pause

    tap(tree, 'health-kegel-timer-sets-10');

    expect(allText(byTestId(tree, 'health-kegel-timer-progress')[0])).toBe('Set 1 of 10');
    expect(allText(byTestId(tree, 'health-kegel-timer-seconds')[0])).toBe('5');
    expect(pressable(tree, 'health-kegel-timer-sets-10').props.accessibilityState.selected).toBe(
      true
    );
    expect(pressable(tree, 'health-kegel-timer-sets-3').props.accessibilityState.selected).toBe(
      false
    );

    // …and the new length is what the completion reports.
    tap(tree, 'health-kegel-timer-start');
    advance(10 * KEGEL_SET_SECONDS);
    expect(onComplete).toHaveBeenCalledWith(10);
  });

  it('HEALTH-VITALITY-339: the summary line states the rhythm and the total length', async () => {
    // The only place a person is told what they are committing to before they
    // start. Read as the whole string, the way it renders.
    const { tree } = await renderTimer();
    expect(allText(tree.toJSON())).toContain('5s squeeze · 5s relax · 30s in total');

    tap(tree, 'health-kegel-timer-sets-10');
    expect(allText(tree.toJSON())).toContain('5s squeeze · 5s relax · 1 min 40s in total');
  });

  it('HEALTH-VITALITY-340: the timer describes the movement and claims nothing about outcomes', async () => {
    // The donor's framing ("improve erection quality, orgasm intensity, and
    // endurance") is a clinical claim about something this app cannot observe,
    // and was deliberately NOT ported — the same call the injury screen made
    // about recovery tips. What ships is technique only.
    const { tree } = await renderTimer();
    const text = allText(tree.toJSON());

    expect(text).toContain('Tighten your pelvic floor muscles as if stopping urination.');
    for (const claim of [
      'testosterone',
      'erection quality',
      'orgasm intensity',
      'endurance',
      'improve',
      'boost',
    ]) {
      expect([claim, text.toLowerCase().includes(claim)]).toEqual([claim, false]);
    }
  });
});
