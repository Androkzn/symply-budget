import {
  blobManifestSentence,
  formatBytes,
  formatCount,
  pluralRows,
  summaryRows,
  tableLabel,
  totalBlobBytes,
} from '../houseBackupFormat';

/**
 * The numbers a member reads on the Backup screen.
 *
 * Kept out of the screen so they can be asserted without rendering anything —
 * the same split `budgetFormat.test.ts` uses. The one that carries weight is
 * `blobManifestSentence`: Q15 says attachment BYTES are not in the archive, only
 * their descriptors, and a member who believes the file holds their photos and
 * later finds it does not has been misled by this sentence.
 */

describe('tableLabel', () => {
  it('turns a ledger table name into something a member would say', () => {
    expect(tableLabel('tasks')).toBe('Tasks');
    expect(tableLabel('home_projects')).toBe('Home projects');
    expect(tableLabel('householdSpaces')).toBe('Household spaces');
    expect(tableLabel('homeProjectPlanLinks')).toBe('Home project plan links');
  });

  it('leaves a name it cannot improve alone rather than blanking it', () => {
    expect(tableLabel('')).toBe('');
    expect(tableLabel('___')).toBe('___');
  });
});

describe('summaryRows', () => {
  it('drops empty tables and orders the rest biggest first', () => {
    // House registers 60-odd tables and most homes use a handful; a list with
    // fifty "0" rows in it buries the four that matter.
    const rows = summaryRows({ tasks: 12, appliances: 0, spaces: 3, utilities: 5 });
    expect(rows.map((r) => r.table)).toEqual(['tasks', 'utilities', 'spaces']);
  });

  it('breaks a tie by name, so the order is stable between renders', () => {
    const rows = summaryRows({ zebra: 2, alpha: 2 });
    expect(rows.map((r) => r.table)).toEqual(['alpha', 'zebra']);
  });

  it('carries the readable label alongside the raw table name', () => {
    // The raw name is the testID; the label is what is shown.
    const [row] = summaryRows({ home_projects: 4 });
    expect(row).toEqual({ table: 'home_projects', label: 'Home projects', count: 4 });
  });

  it('is empty for a home with nothing in it', () => {
    expect(summaryRows({})).toEqual([]);
    expect(summaryRows({ tasks: 0 })).toEqual([]);
  });
});

describe('counts', () => {
  it('groups thousands so a big number stays readable', () => {
    expect(formatCount(1204)).toBe('1,204');
    expect(formatCount(0)).toBe('0');
  });

  it('never renders NaN or Infinity at somebody', () => {
    expect(formatCount(Number.NaN)).toBe('0');
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe('0');
  });

  it('says "row" for one and "rows" for anything else', () => {
    expect(pluralRows(1)).toBe('1 row');
    expect(pluralRows(0)).toBe('0 rows');
    expect(pluralRows(1204)).toBe('1,204 rows');
  });
});

describe('formatBytes', () => {
  it('scales through the units a phone actually reports', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(4_000_000)).toBe('3.8 MB');
    expect(formatBytes(5_000_000_000)).toBe('4.7 GB');
  });

  it('reads zero and nonsense as "0 KB" rather than an empty gap', () => {
    expect(formatBytes(0)).toBe('0 KB');
    expect(formatBytes(-1)).toBe('0 KB');
    expect(formatBytes(Number.NaN)).toBe('0 KB');
  });
});

describe('totalBlobBytes', () => {
  it('adds up a manifest', () => {
    expect(totalBlobBytes([{ bytes: 1000 }, { bytes: 2000 }])).toBe(3000);
  });

  it('ignores an entry whose size the descriptor never carried', () => {
    expect(totalBlobBytes([{ bytes: 1000 }, { bytes: Number.NaN }])).toBe(1000);
    expect(totalBlobBytes([])).toBe(0);
  });
});

describe('blobManifestSentence — the one thing about a House archive that surprises people', () => {
  it('says plainly that the bytes are NOT in the file, and what that costs', () => {
    const sentence = blobManifestSentence(18, 44_300_000);

    expect(sentence).toContain('18 attachments are');
    expect(sentence).toContain('NOT inside the file');
    expect(sentence).toContain('42.2 MB');
    // The consequence to accept, stated rather than hidden: the fetch only
    // works while the household still exists.
    expect(sentence).toMatch(/only works while the household still exists/i);
    expect(sentence).toMatch(/unavailable/i);
  });

  it('agrees with itself in the singular', () => {
    expect(blobManifestSentence(1, 1024)).toContain('1 attachment is');
    expect(blobManifestSentence(1, 1024)).not.toContain('attachments are');
  });

  it('says there is nothing to fetch back when a home has no attachments', () => {
    const sentence = blobManifestSentence(0, 0);
    expect(sentence).toMatch(/nothing to fetch back later/i);
    // No scary warning about a fetch that will never be attempted.
    expect(sentence).not.toContain('NOT inside the file');
  });
});
