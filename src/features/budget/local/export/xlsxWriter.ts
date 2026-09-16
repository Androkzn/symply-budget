import { strToU8, zipSync } from 'fflate';

/**
 * Minimal SpreadsheetML (.xlsx) writer — enough for flat data tables, nothing more.
 *
 * An .xlsx is a zip of XML parts. We emit only the parts Excel/Numbers/Sheets
 * actually require for plain tabular data, which is why this is ~250 lines
 * instead of a dependency with a file *parser* attached. We never read .xlsx,
 * so none of that surface is worth carrying in a finance app.
 *
 * Deliberately unsupported: formulas, merged cells, images, charts, multiple
 * fonts beyond a bold header. Add them here rather than reaching for a library.
 *
 * Note on CSV injection: `buildBudgetLedgerCsvBundle` has to prefix cells that
 * start with = + - @, because a CSV cell is whatever the spreadsheet decides to
 * parse it as. That does NOT apply here and must not be copied over — a cell is
 * a formula in this format only if it carries an explicit <f> element, and we
 * never emit one. Every string goes out as `t="inlineStr"`, i.e. literal text.
 * Prefixing would corrupt legitimate values like "-500".
 */

/**
 * `money` takes INTEGER CENTS and renders dollars — the ledger stores cents
 * everywhere, so this keeps the conversion in one place instead of at every
 * call site. `date` accepts 'YYYY-MM-DD' or a full ISO timestamp.
 */
export type XlsxColumnType = 'text' | 'number' | 'money' | 'date' | 'datetime';

export interface XlsxColumn {
  header: string;
  type?: XlsxColumnType;
  /** Approximate character width; omitted columns auto-size from the header. */
  width?: number;
}

export interface XlsxSheet {
  name: string;
  columns: XlsxColumn[];
  rows: unknown[][];
}

/** Style indices into `<cellXfs>` below — order here must match that order. */
const STYLE_GENERAL = 0;
const STYLE_HEADER = 1;
const STYLE_MONEY = 2;
const STYLE_DATE = 3;
const STYLE_DATETIME = 4;

const STYLE_FOR_TYPE: Record<XlsxColumnType, number> = {
  text: STYLE_GENERAL,
  number: STYLE_GENERAL,
  money: STYLE_MONEY,
  date: STYLE_DATE,
  datetime: STYLE_DATETIME,
};

/** XML 1.0 forbids the C0 controls (tab/LF/CR excepted); strip them or Excel calls the file corrupt. */
// eslint-disable-next-line no-control-regex
const ILLEGAL_XML = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

export function escapeXml(value: string): string {
  return value
    .replace(ILLEGAL_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 0 → A, 25 → Z, 26 → AA … */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  while (n >= 0) {
    out = String.fromCharCode((n % 26) + 65) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

/**
 * Excel's epoch is 1899-12-30, not 1900-01-01 — the offset absorbs the
 * deliberate 1900-is-a-leap-year bug Lotus shipped and Excel kept.
 */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

export function toExcelSerial(iso: string): number | null {
  const trimmed = iso.trim();
  if (!trimmed) return null;
  const ms = Date.parse(
    // A bare 'YYYY-MM-DD' parses as UTC midnight, which is what we want; a
    // full timestamp keeps its time-of-day fraction.
    /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00Z` : trimmed,
  );
  if (!Number.isFinite(ms)) return null;
  return (ms - EXCEL_EPOCH_MS) / MS_PER_DAY;
}

/**
 * Sheet names: ≤31 chars, none of : \ / ? * [ ], non-empty, and unique —
 * Excel refuses to open the file rather than repairing any of these.
 */
export function sanitizeSheetName(name: string, taken: Set<string>): string {
  let base = name.replace(/[:\\/?*[\]]/g, '-').trim().slice(0, 31) || 'Sheet';
  let candidate = base;
  let n = 2;
  while (taken.has(candidate.toLowerCase())) {
    const suffix = ` (${n})`;
    base = base.slice(0, 31 - suffix.length);
    candidate = `${base}${suffix}`;
    n += 1;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

function cellXml(ref: string, value: unknown, type: XlsxColumnType): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  const style = STYLE_FOR_TYPE[type];
  const styleAttr = style === STYLE_GENERAL ? '' : ` s="${style}"`;

  if (type === 'money') {
    const cents = Number(value);
    if (!Number.isFinite(cents)) return '';
    // Round to whole cents before dividing so 0.1+0.2 float dust never reaches
    // a currency cell.
    return `<c r="${ref}"${styleAttr}><v>${Math.round(cents) / 100}</v></c>`;
  }

  if (type === 'number') {
    const num = Number(value);
    if (!Number.isFinite(num)) return '';
    return `<c r="${ref}"${styleAttr}><v>${num}</v></c>`;
  }

  if (type === 'date' || type === 'datetime') {
    const serial = toExcelSerial(String(value));
    // Unparseable dates fall back to text rather than silently vanishing.
    if (serial === null) {
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(String(value))}</t></is></c>`;
    }
    return `<c r="${ref}"${styleAttr}><v>${serial}</v></c>`;
  }

  const text = escapeXml(String(value));
  // xml:space="preserve" keeps leading/trailing spaces from being collapsed.
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet): string {
  const { columns, rows } = sheet;
  const lastCol = columnLetter(Math.max(0, columns.length - 1));

  const cols = columns
    .map((c, i) => {
      const width = c.width ?? Math.min(40, Math.max(10, c.header.length + 4));
      return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`;
    })
    .join('');

  const headerCells = columns
    .map(
      (c, i) =>
        `<c r="${columnLetter(i)}1" s="${STYLE_HEADER}" t="inlineStr"><is><t>${escapeXml(
          c.header,
        )}</t></is></c>`,
    )
    .join('');

  const bodyRows = rows
    .map((row, r) => {
      const rowNum = r + 2; // row 1 is the header
      const cells = columns
        .map((c, i) => cellXml(`${columnLetter(i)}${rowNum}`, row[i], c.type ?? 'text'))
        .join('');
      return `<row r="${rowNum}">${cells}</row>`;
    })
    .join('');

  const lastRow = rows.length + 1;

  // Element order is schema-significant: sheetViews → cols → sheetData →
  // autoFilter. Emitting autoFilter before sheetData makes Excel declare the
  // workbook corrupt.
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="A1:${lastCol}${lastRow}"/>` +
    '<sheetViews><sheetView workbookViewId="0">' +
    // Freeze the header so it stays put while scrolling.
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '</sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    `<cols>${cols}</cols>` +
    `<sheetData><row r="1">${headerCells}</row>${bodyRows}</sheetData>` +
    `<autoFilter ref="A1:${lastCol}${lastRow}"/>` +
    '</worksheet>'
  );
}

function stylesXml(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="3">' +
    '<numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/>' +
    '<numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd"/>' +
    '<numFmt numFmtId="166" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/>' +
    '</numFmts>' +
    '<fonts count="2">' +
    '<font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
    '</fonts>' +
    // The spec requires these two fills to exist in this order.
    '<fills count="2">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '</fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="5">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>'
  );
}

/** Serialize sheets into .xlsx bytes. Sheet names are sanitized and de-duped. */
export function buildXlsx(sheets: XlsxSheet[]): Uint8Array {
  if (sheets.length === 0) {
    throw new Error('buildXlsx: at least one sheet is required');
  }
  const taken = new Set<string>();
  const named = sheets.map((s) => ({ ...s, name: sanitizeSheetName(s.name, taken) }));

  // Sheets take rId1..rIdN; styles takes the next id so they cannot collide.
  const stylesRid = `rId${named.length + 1}`;

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    named
      .map(
        (_s, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('') +
    '</Types>';

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' +
    named
      .map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('') +
    '</sheets></workbook>';

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    named
      .map(
        (_s, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join('') +
    `<Relationship Id="${stylesRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>';

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRels),
    'xl/styles.xml': strToU8(stylesXml()),
  };
  named.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheet));
  });

  return zipSync(files, { level: 6 });
}
