import { unzipSync, strFromU8 } from 'fflate';

import {
  buildXlsx,
  columnLetter,
  escapeXml,
  sanitizeSheetName,
  toExcelSerial,
  type XlsxSheet,
} from '../xlsxWriter';

function open(sheets: XlsxSheet[]): Record<string, string> {
  const zip = unzipSync(buildXlsx(sheets));
  return Object.fromEntries(Object.entries(zip).map(([k, v]) => [k, strFromU8(v)]));
}

const SIMPLE: XlsxSheet[] = [
  {
    name: 'Spending',
    columns: [
      { header: 'Date', type: 'date' },
      { header: 'Title' },
      { header: 'Amount', type: 'money' },
    ],
    rows: [['2026-08-10', 'Groceries', 1210]],
  },
];

describe('columnLetter', () => {
  it('rolls over past Z', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
    expect(columnLetter(51)).toBe('AZ');
    expect(columnLetter(52)).toBe('BA');
  });
});

describe('escapeXml', () => {
  it('escapes the five XML entities', () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe(
      'a &amp; b &lt; c &gt; d &quot; e &apos; f',
    );
  });

  it('strips control bytes that would make the part unparseable', () => {
    expect(escapeXml('Cost\x00c\x07o')).toBe('Costco');
  });

  it('keeps a leading = as literal text rather than CSV-style quoting', () => {
    // Inline strings are never formulas, so the CSV `'` prefix must not appear.
    expect(escapeXml('=SUM(A1)')).toBe('=SUM(A1)');
  });
});

describe('toExcelSerial', () => {
  it('uses the 1899-12-30 epoch', () => {
    // Excel's canonical fixture: 1900-01-01 is serial 2.
    expect(toExcelSerial('1900-01-01')).toBe(2);
    expect(toExcelSerial('2026-08-10')).toBe(46244);
  });

  it('returns null for junk so the caller can fall back to text', () => {
    expect(toExcelSerial('not a date')).toBeNull();
    expect(toExcelSerial('')).toBeNull();
  });
});

describe('sanitizeSheetName', () => {
  it('strips characters Excel refuses and caps at 31', () => {
    const taken = new Set<string>();
    expect(sanitizeSheetName('A/B:C?D*E[F]', taken)).toBe('A-B-C-D-E-F-');
    expect(sanitizeSheetName('x'.repeat(50), taken)).toHaveLength(31);
  });

  it('de-duplicates case-insensitively', () => {
    const taken = new Set<string>();
    expect(sanitizeSheetName('Spending', taken)).toBe('Spending');
    expect(sanitizeSheetName('spending', taken)).toBe('spending (2)');
  });
});

describe('buildXlsx', () => {
  it('emits every part Excel requires', () => {
    const files = open(SIMPLE);
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
  });

  it('declares each worksheet in Content_Types, or Excel reports corruption', () => {
    const files = open([
      { ...SIMPLE[0]!, name: 'One' },
      { ...SIMPLE[0]!, name: 'Two' },
    ]);
    expect(files['[Content_Types].xml']).toContain('/xl/worksheets/sheet1.xml');
    expect(files['[Content_Types].xml']).toContain('/xl/worksheets/sheet2.xml');
  });

  it('gives styles a relationship id that cannot collide with a sheet', () => {
    const rels = open([
      { ...SIMPLE[0]!, name: 'One' },
      { ...SIMPLE[0]!, name: 'Two' },
    ])['xl/_rels/workbook.xml.rels']!;
    expect(rels).toContain('Id="rId1"');
    expect(rels).toContain('Id="rId2"');
    // Sheets consumed rId1..2, so styles must be rId3.
    expect(rels).toMatch(/Id="rId3"[^>]*styles\.xml/);
  });

  it('writes money as dollars with the currency style, not raw cents', () => {
    const sheet = open(SIMPLE)['xl/worksheets/sheet1.xml']!;
    // 1210 cents -> 12.1, style 2 (currency). Never the literal 1210.
    expect(sheet).toContain('<c r="C2" s="2"><v>12.1</v></c>');
  });

  it('writes dates as serials with the date style', () => {
    const sheet = open(SIMPLE)['xl/worksheets/sheet1.xml']!;
    expect(sheet).toContain('<c r="A2" s="3"><v>46244</v></c>');
  });

  it('writes strings as inline strings, never as formulas', () => {
    const sheet = open([
      {
        name: 'S',
        columns: [{ header: 'Title' }],
        rows: [['=1+1']],
      },
    ])['xl/worksheets/sheet1.xml']!;
    expect(sheet).toContain('t="inlineStr"');
    expect(sheet).toContain('=1+1');
    expect(sheet).not.toContain('<f>');
  });

  it('orders sheetData before autoFilter', () => {
    const sheet = open(SIMPLE)['xl/worksheets/sheet1.xml']!;
    expect(sheet.indexOf('<sheetData>')).toBeLessThan(sheet.indexOf('<autoFilter'));
  });

  it('skips empty cells instead of emitting empty elements', () => {
    const sheet = open([
      {
        name: 'S',
        columns: [{ header: 'A' }, { header: 'B' }],
        rows: [[null, 'x']],
      },
    ])['xl/worksheets/sheet1.xml']!;
    expect(sheet).not.toContain('r="A2"');
    expect(sheet).toContain('r="B2"');
  });

  it('rejects a workbook with no sheets', () => {
    expect(() => buildXlsx([])).toThrow(/at least one sheet/);
  });
});
