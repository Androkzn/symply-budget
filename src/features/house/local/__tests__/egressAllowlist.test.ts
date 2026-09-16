/**
 * The Stage-B egress allowlist (plan §9, DoD H7).
 *
 * The DoD line is *"Stage B **egress allowlist** (ledger fields that may leave
 * the device — do not ship Budget's regex denylist as an 'allowlist') +
 * redaction tested"*. This suite is that checkbox, and it is written to fail on
 * the specific ways an allowlist stops being one:
 *
 *  1. **A forbidden table contributes something.** `households` carries the
 *     address; `householdMembers` carries real people. If either ever projects a
 *     single field, the E2EE promise is void.
 *  2. **A field leaks from an allowed table.** `tasks` is allowlisted, but
 *     `description` and `assigned_to` are not — and `description` is the single
 *     most likely place in the whole ledger for a gate code or a neighbour's
 *     phone number.
 *  3. **A NEW field leaks.** This is the one that actually happens. Nobody adds
 *     `gate_code` to the allowlist on purpose; someone adds it to the schema and
 *     the projection picks it up. The guard below adds a synthetic column to
 *     EVERY allowlisted table and proves none of them carry it, so the property
 *     holds for the whole allowlist rather than for one hand-picked example.
 *
 * The fourth section is the argument for why this file exists at all: values
 * that no redaction regex would ever catch — "the side gate code is four seven
 * nine two", "spare key is with Mrs Delgado at number 14" — and a demonstration
 * that they are excluded anyway, because they live in fields the allowlist does
 * not name. Budget's denylist would have shipped every one of them.
 *
 * Static imports only — `await import()` throws under this Jest config (§6.2).
 */
import {
  HOUSE_AI_EGRESS_ALLOWLIST,
  HOUSE_AI_EGRESS_FORBIDDEN_TABLES,
  isTableAllowedForEgress,
  projectAllowedRows,
  redactContext,
  redactForEgress,
} from '../ai/egressAllowlist';
import { HOUSE_LEDGER_TABLE_NAMES, type HouseLedgerTableName } from '../schema';

/** A task row shaped like the real one — 20-odd columns, most of them excluded. */
function fullTaskRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'task-1',
    household_id: 'hh-1',
    title: 'Replace furnace filter',
    description: 'Filter is behind the panel; the side gate code is four seven nine two.',
    system_category: 'hvac',
    frequency: 'monthly',
    custom_interval_days: null,
    next_due_date: '2026-09-01',
    scheduled_work_date: null,
    last_completed_at: '2026-08-01',
    assigned_to: { id: 'user-9', display_name: 'Sam Delgado' },
    space_id: 'space-3',
    is_active: true,
    source: 'manual',
    reminder_enabled: true,
    reminder_days_before: 3,
    reminder_time: '09:00',
    reminder_repeat: false,
    ai_rationale: 'Neglecting this shortens the furnace life.',
    photos: [{ id: 'p1', url: 'https://example.test/p1.jpg' }],
    created_at: '2026-08-10T00:00:00.000Z',
    updated_at: '2026-08-10T00:00:00.000Z',
    ...overrides,
  };
}

const allowlistedTables = Object.keys(HOUSE_AI_EGRESS_ALLOWLIST) as HouseLedgerTableName[];

describe('the allowlist is a coherent allowlist', () => {
  it('names only real ledger tables', () => {
    // A typo here fails CLOSED for an allowlist entry (the table simply never
    // contributes) but fails OPEN for a forbidden entry — `householdMemebers`
    // would leave the real table governed by nothing but the omission rule.
    for (const table of [...allowlistedTables, ...HOUSE_AI_EGRESS_FORBIDDEN_TABLES]) {
      expect(HOUSE_LEDGER_TABLE_NAMES).toContain(table);
    }
  });

  it('never lists a table as both allowed and forbidden', () => {
    const overlap = allowlistedTables.filter((t) => HOUSE_AI_EGRESS_FORBIDDEN_TABLES.includes(t));
    expect(overlap).toEqual([]);
  });

  it('covers a minority of the ledger, which is the point', () => {
    // If this ever approaches the full table count, someone has been adding
    // tables to make a prompt work rather than deciding what may leave.
    expect(allowlistedTables.length).toBeLessThan(HOUSE_LEDGER_TABLE_NAMES.length / 2);
  });

  it('never allowlists a field whose name says it is a secret or an identity', () => {
    const banned = /serial|password|secret|token|code$|phone|email|address|user_id|created_by|assigned_to|notes?$|description/i;
    for (const [table, fields] of Object.entries(HOUSE_AI_EGRESS_ALLOWLIST)) {
      for (const field of fields ?? []) {
        expect({ table, field, banned: banned.test(field) }).toEqual({
          table,
          field,
          banned: false,
        });
      }
    }
  });
});

describe('fail closed — a forbidden table contributes nothing', () => {
  it.each([...HOUSE_AI_EGRESS_FORBIDDEN_TABLES])('%s projects to nothing at all', (table) => {
    const rows = [
      {
        id: 'row-1',
        household_id: 'hh-1',
        // Every one of these is a field the model would find useful, which is
        // exactly why the table is forbidden rather than trimmed.
        address_line1: '14 Alder Street',
        postal_code: 'V5H 1M2',
        display_name: 'Sam Delgado',
        user_id: 'user-9',
        body: 'Spare key is with Mrs Delgado at number 14.',
        title: 'House notes',
        key: 'reminder_time',
        value: '09:00',
      },
    ];
    expect(projectAllowedRows(table, rows)).toEqual([]);
    expect(isTableAllowedForEgress(table)).toBe(false);
  });

  it('households cannot leak the property address even one field at a time', () => {
    const projected = projectAllowedRows('households', [
      { id: 'hh-1', address_line1: '14 Alder Street', city: 'Burnaby', purchase_price: 910000 },
    ]);
    expect(JSON.stringify(projected)).not.toContain('Alder');
    expect(JSON.stringify(projected)).not.toContain('Burnaby');
    expect(JSON.stringify(projected)).not.toContain('910000');
  });
});

describe('fail closed — a table nobody listed contributes nothing', () => {
  it('an unlisted-but-not-forbidden table still projects to nothing', () => {
    // `maintenanceSubtasks` is a real ledger table that is neither allowlisted
    // nor explicitly forbidden. The omission rule is what governs it, and this
    // is the test that the omission rule is real rather than aspirational.
    expect(HOUSE_LEDGER_TABLE_NAMES).toContain('maintenanceSubtasks');
    expect(HOUSE_AI_EGRESS_ALLOWLIST.maintenanceSubtasks).toBeUndefined();
    expect(HOUSE_AI_EGRESS_FORBIDDEN_TABLES).not.toContain('maintenanceSubtasks');
    expect(projectAllowedRows('maintenanceSubtasks', [{ id: 's1', title: 'Buy filter' }])).toEqual(
      [],
    );
    expect(isTableAllowedForEgress('maintenanceSubtasks')).toBe(false);
  });

  it.each(
    HOUSE_LEDGER_TABLE_NAMES.filter(
      (t) => !allowlistedTables.includes(t) && !HOUSE_AI_EGRESS_FORBIDDEN_TABLES.includes(t),
    ),
  )('%s (unlisted) contributes nothing', (table) => {
    expect(projectAllowedRows(table, [{ id: 'x', title: 'y', body: 'z' }])).toEqual([]);
  });
});

describe('fail closed — an unlisted field is dropped from an ALLOWED table', () => {
  it('keeps the maintenance facts and drops everything else on a task', () => {
    const [projected] = projectAllowedRows('tasks', [fullTaskRow()]);
    expect(projected).toEqual({
      id: 'task-1',
      title: 'Replace furnace filter',
      system_category: 'hvac',
      frequency: 'monthly',
      next_due_date: '2026-09-01',
      last_completed_at: '2026-08-01',
      is_active: true,
    });
  });

  it('drops the free-text field the gate code was hiding in', () => {
    // No redaction regex matches "four seven nine two". A denylist ships it.
    const serialized = JSON.stringify(projectAllowedRows('tasks', [fullTaskRow()]));
    expect(serialized).not.toContain('gate code');
    expect(serialized).not.toContain('four seven nine two');
  });

  it('drops the member on `assigned_to` and the household correlator', () => {
    const serialized = JSON.stringify(projectAllowedRows('tasks', [fullTaskRow()]));
    expect(serialized).not.toContain('Sam Delgado');
    expect(serialized).not.toContain('user-9');
    // `household_id` is not secret, but it correlates every prompt this member
    // ever sends to one home — see the allowlist's own comment.
    expect(serialized).not.toContain('hh-1');
  });

  it('drops attachment identity and AI free text', () => {
    const serialized = JSON.stringify(projectAllowedRows('tasks', [fullTaskRow()]));
    expect(serialized).not.toContain('example.test');
    expect(serialized).not.toContain('shortens the furnace life');
  });

  it('drops an appliance serial number and its price', () => {
    const [projected] = projectAllowedRows('appliances', [
      {
        id: 'app-1',
        household_id: 'hh-1',
        name: 'Furnace',
        category: 'hvac',
        type: 'gas',
        brand: 'Lennox',
        model: 'ML195',
        serial_number: 'LX-88-114-2231',
        purchase_date: '2019-04-02',
        purchase_cost: 6400,
        location: 'Utility room, behind the water heater',
        space_id: 'space-3',
        warranty: { manufacturer: { expiration: '2029-04-02', coverage: 'parts' } },
        total_maintenance_cost: 420,
      },
    ]);
    expect(projected).toEqual({
      id: 'app-1',
      name: 'Furnace',
      category: 'hvac',
      brand: 'Lennox',
      model: 'ML195',
      purchase_date: '2019-04-02',
      space_id: 'space-3',
    });
    // `warranty_expires_at` is allowlisted but does not exist on the DTO, which
    // is harmless precisely BECAUSE the allowlist is positive: a name that
    // matches nothing contributes nothing. On a denylist the same mismatch is a
    // leak, because the rule that would have caught the real field never fires.
    expect(projected).not.toHaveProperty('warranty');
    expect(projected).not.toHaveProperty('warranty_expires_at');
  });

  it('drops the whole shape of a garbage schedule except the pattern fields', () => {
    const [projected] = projectAllowedRows('garbageSchedules', [
      {
        id: 'gs-1',
        household_id: 'hh-1',
        municipality: 'Burnaby',
        schedules: [{ type: 'garbage', frequency: 'weekly', dayOfWeek: 3 }],
        set_out_time: '19:00',
        holiday_shifts: [{ holiday: 'Canada Day', date: '2026-07-01', shiftDays: 1 }],
        reminders: { nightBefore: { enabled: true, time: '19:00' } },
        source: 'manual',
      },
    ]);
    expect(projected).toEqual({ id: 'gs-1', municipality: 'Burnaby' });
  });
});

describe('fail closed — a NEW field on an allowed table does not leak', () => {
  /**
   * The regression this prevents, stated plainly: a migration adds a column, the
   * ledger row grows, and the projection silently starts forwarding it. Testing
   * one table would prove one table; this walks every allowlisted table and
   * spikes each with fields nobody has thought about yet.
   */
  const newColumns = {
    gate_code: '4792',
    contractor_phone: '604-555-0142',
    insurer_policy_no: 'POL-99182736',
    owner_note: 'Spare key is with Mrs Delgado at number 14.',
  };

  it.each(allowlistedTables)('%s ignores a column added tomorrow', (table) => {
    const allowed = HOUSE_AI_EGRESS_ALLOWLIST[table] ?? [];
    const row: Record<string, unknown> = { ...newColumns };
    // Fill the allowed fields too, so the row is realistic and the assertion is
    // about the NEW columns rather than about an empty projection.
    for (const field of allowed) row[field] = `value-${field}`;

    const [projected] = projectAllowedRows(table, [row]);
    expect(Object.keys(projected ?? {}).sort()).toEqual([...allowed].sort());
    for (const added of Object.keys(newColumns)) {
      expect(projected).not.toHaveProperty(added);
    }
    expect(JSON.stringify(projected)).not.toContain('Mrs Delgado');
    expect(JSON.stringify(projected)).not.toContain('4792');
  });

  it('the guard actually projects something (guards the guard)', () => {
    // If `projectAllowedRows` ever returned `[]` for everything, every assertion
    // above would pass vacuously.
    const [projected] = projectAllowedRows('tasks', [fullTaskRow()]);
    expect(Object.keys(projected ?? {}).length).toBeGreaterThan(3);
  });
});

describe('projection housekeeping', () => {
  it('drops null and undefined rather than spending tokens on them', () => {
    const [projected] = projectAllowedRows('tasks', [
      { id: 't1', title: 'Bleed radiators', next_due_date: null, last_completed_at: undefined },
    ]);
    expect(projected).toEqual({ id: 't1', title: 'Bleed radiators' });
  });

  it('projects every row, not just the first', () => {
    const rows = [fullTaskRow({ id: 'a' }), fullTaskRow({ id: 'b' })];
    expect(projectAllowedRows('tasks', rows).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('survives an empty table without inventing a row', () => {
    expect(projectAllowedRows('tasks', [])).toEqual([]);
  });
});

describe('redaction is the SECOND layer, over an already narrow payload', () => {
  it('redacts an email a member typed into an allowed field', () => {
    expect(redactForEgress('Ask sam.delgado+home@example.com to book it')).toBe(
      'Ask [redacted] to book it',
    );
  });

  it('redacts a NANP phone number in several shapes', () => {
    expect(redactForEgress('call 604-555-0142')).toBe('call [redacted]');
    // The bracketed and `+1` forms keep their punctuation — the pattern is
    // anchored on `\b`, so it starts at the first digit. What matters is that no
    // digit of the number survives; asserting the exact residue would pin an
    // incidental detail of the regex rather than the property under test.
    for (const raw of ['call (604) 555-0142', 'call +1 604 555 0142']) {
      const redacted = redactForEgress(raw);
      expect(redacted).toContain('[redacted]');
      expect(redacted).not.toContain('604');
      expect(redacted).not.toContain('555');
      expect(redacted).not.toContain('0142');
    }
  });

  it('redacts card-like and SIN-like runs of digits', () => {
    expect(redactForEgress('4111 1111 1111 1111')).toBe('[redacted]');
    expect(redactForEgress('046 454 286')).toBe('[redacted]');
  });

  it('redacts a long account number', () => {
    expect(redactForEgress('account 123456789012')).toBe('account [redacted]');
  });

  it('leaves the maintenance facts alone', () => {
    // Over-redaction is its own failure: an assistant that cannot see "2026" or
    // "ML195" cannot answer anything.
    const text = 'Furnace ML195 serviced 2026-08-01, next due 2026-09-01, 3 days before';
    expect(redactForEgress(text)).toBe(text);
  });

  it('walks nested objects and arrays', () => {
    const redacted = redactContext({
      tasks: [{ title: 'Email sam@example.com', due: '2026-09-01', active: true, cost: 42 }],
    });
    expect(redacted).toEqual({
      tasks: [{ title: 'Email [redacted]', due: '2026-09-01', active: true, cost: 42 }],
    });
  });

  it('leaves non-strings as they were, including null', () => {
    expect(redactContext({ a: null, b: 7, c: false, d: undefined })).toEqual({
      a: null,
      b: 7,
      c: false,
      d: undefined,
    });
  });
});

describe('why this is not Budget’s denylist', () => {
  /**
   * The two halves of the argument, as executable claims rather than prose in a
   * header. Each string below is real household data that a regex denylist
   * passes straight through; each is nonetheless absent from the payload,
   * because the field it lives in is not named in the allowlist.
   */
  const invisibleToAnyRegex = [
    'the side gate code is four seven nine two',
    'spare key is with Mrs Delgado at number 14',
    'alarm panel is by the back door, code is the year the house was built',
    'Dr. Whitfield said the mould has to go before the baby arrives',
  ];

  it.each(invisibleToAnyRegex)('redaction alone would ship: %s', (text) => {
    // Half one: the denylist genuinely does not catch these.
    expect(redactForEgress(text)).toBe(text);
  });

  it.each(invisibleToAnyRegex)('the allowlist drops it anyway: %s', (text) => {
    // Half two: put it where members actually put it — a task description and a
    // household note — and it never reaches the payload.
    const fromTask = projectAllowedRows('tasks', [fullTaskRow({ description: text })]);
    const fromNote = projectAllowedRows('householdNotes', [{ id: 'n1', body: text }]);
    expect(JSON.stringify([fromTask, fromNote])).not.toContain(text);
  });
});
