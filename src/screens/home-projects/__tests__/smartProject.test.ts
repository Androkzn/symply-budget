/**
 * Smart Project — the client-side decisions that can silently go wrong.
 *
 * Two of them, and neither shows up in a type error or a lint run:
 *
 *  1. **Who is offered the feature.** Offering it on a local-first household
 *     produces a project on the server that the device can never open, and the
 *     member gets a notification about a draft that does not exist for them.
 *  2. **What the review banner says was skipped.** `dropped_json` is written by
 *     a job and parsed here; a parse that throws on a malformed value would
 *     take down the whole hub for a project whose draft is otherwise fine.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { parseDroppedPhases, type HomeProjectSmartDraft } from '@api/home-projects';

import { isSmartProjectAvailable } from '../CreateHomeProjectWizard';
import {
  SMART_DESCRIPTION_EXAMPLE,
  SMART_DESCRIPTION_TIPS,
  SMART_DRAFT_SECTIONS,
  sanitizeDecimal,
} from '../SmartProjectWizard';

function draft(overrides: Partial<HomeProjectSmartDraft> = {}): HomeProjectSmartDraft {
  return {
    id: 'd1',
    project_id: 'p1',
    status: 'completed',
    description: 'a shed',
    spaces_json: null,
    confidence: 'medium',
    disclaimer: null,
    error_code: null,
    dropped_json: null,
    created_at: '2026-08-31T00:00:00.000Z',
    updated_at: '2026-08-31T00:00:00.000Z',
    ...overrides,
  };
}

describe('who gets offered Describe it', () => {
  it('offers it when the flag is on and the household is server-backed', () => {
    expect(isSmartProjectAvailable(true, false)).toBe(true);
  });

  it('hides it when the flag is off', () => {
    expect(isSmartProjectAvailable(false, false)).toBe(false);
  });

  /**
   * This assertion is INVERTED from what it was, deliberately.
   *
   * It used to require local-first households to be excluded, because
   * generation ran on the Worker and wrote the project into D1 — somewhere a
   * local-first member's encrypted ledger could never read. Since House is
   * local-first by default, that hid the feature from its entire audience.
   *
   * The server now only generates and the client saves through
   * `homeProjectsApi`, which routes to the ledger or to D1 per household. There
   * is no configuration left where a drafted project lands somewhere its owner
   * cannot see it, so local-first is no longer a reason to hide anything.
   */
  it('is offered on a local-first household — the split made that safe', () => {
    expect(isSmartProjectAvailable(true, true)).toBe(true);
  });

  it('stays hidden when the flag is off, local-first or not', () => {
    expect(isSmartProjectAvailable(false, true)).toBe(false);
    expect(isSmartProjectAvailable(false, false)).toBe(false);
  });
});

describe('what the review banner reports as skipped', () => {
  it('reads the phases the draft dropped and why', () => {
    const parsed = parseDroppedPhases(
      draft({
        dropped_json: JSON.stringify([{ title: 'Roofing', because: 'roof' }]),
      }),
    );
    expect(parsed).toEqual([{ title: 'Roofing', because: 'roof' }]);
  });

  it('reads an absent value as nothing skipped', () => {
    expect(parseDroppedPhases(draft())).toEqual([]);
    expect(parseDroppedPhases(null)).toEqual([]);
  });

  /**
   * The hub renders this banner on every draft open. A throw here would blank
   * the whole project over a field that only decorates one section.
   */
  it('survives malformed JSON rather than taking the hub down with it', () => {
    expect(parseDroppedPhases(draft({ dropped_json: 'not json' }))).toEqual([]);
    expect(parseDroppedPhases(draft({ dropped_json: '{"not":"an array"}' }))).toEqual([]);
    expect(parseDroppedPhases(draft({ dropped_json: 'null' }))).toEqual([]);
  });
});

/**
 * The decimal bug, found on a device and not findable anywhere else.
 *
 * The dimension inputs were controlled and numeric: every keystroke went
 * through `Number()` and back to a string. `Number('2.')` is `2`, so the
 * decimal point vanished the moment it was typed and the next digit landed
 * against the whole part — "2.5" became 25.
 *
 * A ten-times-too-big wall height feeds straight into the takeoff. The contract
 * tests could never catch it: they receive numbers that are already parsed.
 */
describe('typing a decimal dimension', () => {
  /** What the old controlled-numeric input did, keystroke by keystroke. */
  function oldRoundTrip(keys: string[]): number {
    let state = 0;
    for (const ch of keys) {
      const shown = state ? String(state) : '';
      state = Number(shown + ch) || 0;
    }
    return state;
  }

  /** What the field does now: the member's text is kept, parsed once at submit. */
  function nowTyping(keys: string[]): string {
    let text = '';
    for (const ch of keys) text = sanitizeDecimal(text + ch);
    return text;
  }

  it('is what the old input broke — kept here so it cannot come back', () => {
    expect(oldRoundTrip(['2', '.', '5'])).toBe(25);
  });

  it('keeps the point the member typed', () => {
    expect(nowTyping(['2', '.', '5'])).toBe('2.5');
    expect(Number(nowTyping(['2', '.', '5']))).toBe(2.5);
  });

  it('leaves a half-typed "2." alone, because that is 2.5 halfway through', () => {
    expect(nowTyping(['2', '.'])).toBe('2.');
  });

  it('handles a comma decimal separator', () => {
    expect(nowTyping(['2', ',', '5'])).toBe('2.5');
  });

  it('keeps whole numbers whole', () => {
    expect(nowTyping(['5'])).toBe('5');
    expect(nowTyping(['1', '2'])).toBe('12');
  });

  it('drops a second decimal point instead of making a non-number', () => {
    expect(nowTyping(['2', '.', '5', '.', '7'])).toBe('2.57');
  });

  it('strips anything a measurement could never contain', () => {
    expect(sanitizeDecimal('2.5m')).toBe('2.5');
    expect(sanitizeDecimal('abc')).toBe('');
  });

  it('parses to the value the takeoff needs', () => {
    // The member's shed: 5 x 3 x 2.5, not 5 x 3 x 25.
    expect(Number(nowTyping(['2', '.', '5']))).toBeCloseTo(2.5, 4);
  });
});

/**
 * Step 4 — "What should we draft?".
 *
 * The list is asserted rather than the screen, for the same reason
 * `MATERIAL_ADD_OPTIONS` on the hub is: a row that stops being built is a
 * section that stops being offered, and neither the type checker nor a lint
 * rule would say a word. The member's choice reaches the server as
 * `include`, so an id that drifts here silently stops matching the flag the
 * generator filters on — and the section would come back after they unticked
 * it.
 */
describe('what the last step offers', () => {
  it('offers exactly the three sections the request carries', () => {
    expect(SMART_DRAFT_SECTIONS.map(s => s.id)).toEqual([
      'phases',
      'tasks',
      'materials',
    ]);
  });

  it('says what each one is, in words a member reads rather than a noun', () => {
    for (const section of SMART_DRAFT_SECTIONS) {
      expect(section.label.length).toBeGreaterThan(0);
      // Long enough to be an explanation. "Steps" and "Tasks" are the pair a
      // member confuses, and a bare label is what leaves them guessing.
      expect(section.detail.length).toBeGreaterThan(30);
    }
  });

  /**
   * The one promise on that screen that a member cannot verify for themselves
   * until a minute later: no prices. Smart Project writes materials with no
   * money on them at all (BRD D3), and the copy has to keep saying so.
   */
  it('tells the member up front that materials come without prices', () => {
    const materials = SMART_DRAFT_SECTIONS.find(s => s.id === 'materials');
    expect(materials!.detail.toLowerCase()).toContain('no prices');
  });

  /**
   * The regression this file exists to hold once migration 0170 landed.
   *
   * "Tasks" used to be rendered DISABLED on a local-first household, with copy
   * saying a project could not hold its own tasks on this build. That was true
   * while `home_project_tasks` was a PK-less join the ledger could not key —
   * `createTask` refused on device, so an enabled box would have taken the
   * member's minute and returned a draft with no tasks and nothing saying why.
   *
   * 0170 put the link on the project row as `linked_task_ids` and all three
   * linked-task methods became local writes, so the gate went. Asserted against
   * the SOURCE because the gate was a screen-local `useMemo` on
   * `isHouseLocalFirst()` and nothing in the exported data ever showed it: a
   * reader adding a per-backend branch back would otherwise pass every test in
   * this file.
   */
  it('gates no section on which backend the household is running', () => {
    const source = readFileSync(
      join(__dirname, '..', 'SmartProjectWizard.tsx'),
      'utf8',
    );
    // The flag itself, not just its old call site: a branch on
    // `isLocalHouseSessionOpen()` or the store would read the same to a member.
    expect(source).not.toMatch(/isHouseLocalFirst\s*\(/);
    expect(source).not.toContain('Not on this build yet');
  });
});

/**
 * Step 1 is where a Smart Project is won or lost: everything downstream is the
 * model reading this paragraph. The guidance and the example are the only two
 * things on that screen that change what the member writes, so what they say is
 * worth pinning — and the example is the one piece of copy that gets SENT, not
 * just read, which makes it closer to input than to decoration.
 */
describe('what step 1 tells the member to write', () => {
  it('names the four things the draft actually uses', () => {
    expect(SMART_DESCRIPTION_TIPS).toHaveLength(4);
    for (const tip of SMART_DESCRIPTION_TIPS) {
      expect(tip.lead.length).toBeGreaterThan(0);
      // A lead on its own is a category, not advice. The detail is the half
      // that says what happens if they leave it out.
      expect(tip.detail.length).toBeGreaterThan(20);
    }
  });

  /**
   * The reason this screen exists, per the prompt's hard rule 3: work the
   * description says is finished does not get planned again. If the guidance
   * stops asking for it, members stop writing it, and every draft comes back
   * carrying phases they have to delete.
   */
  it('asks for what is already done, because that suppresses whole phases', () => {
    const joined = SMART_DESCRIPTION_TIPS.map(t =>
      `${t.lead} ${t.detail}`.toLowerCase(),
    ).join(' ');
    expect(joined).toContain('already done');
    expect(joined).toContain('will not plan again');
  });

  /**
   * The example is offered with "Use this as a starting point", which puts it
   * in the description field verbatim. So it has to be a description that would
   * actually draft: past the 20-character minimum the counter enforces, and
   * carrying the as-is state and the target use the model is told to key off.
   */
  it('ships an example that would draft as it stands', () => {
    const example = SMART_DESCRIPTION_EXAMPLE.toLowerCase();
    expect(SMART_DESCRIPTION_EXAMPLE.trim().length).toBeGreaterThan(20);
    // What is already there…
    expect(example).toContain('roof, walls and concrete floor are all done');
    // …what is missing…
    expect(example).toContain('no insulation');
    // …and what it is becoming, which is what `target_use` is derived from.
    expect(example).toContain('woodworking shop');
  });

  /** No numbers a takeoff could act on beyond the size — no prices, ever. */
  it('keeps prices out of the example', () => {
    expect(SMART_DESCRIPTION_EXAMPLE).not.toMatch(/[$£€]\s?\d/);
  });
});
