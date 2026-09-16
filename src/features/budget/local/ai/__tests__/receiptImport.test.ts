import { RECEIPT_IMPORT_SCHEMA, RECEIPT_IMPORT_SYSTEM } from '../prompts/receiptImport';

function node(obj: unknown, ...path: string[]): Record<string, unknown> {
  let cur: unknown = obj;
  for (const key of path) cur = (cur as Record<string, unknown>)?.[key];
  return cur as Record<string, unknown>;
}

describe('receiptImport v2 schema lockstep', () => {
  it('requires raw_code, fees, and name_suggestions on each item', () => {
    const item = node(RECEIPT_IMPORT_SCHEMA, 'properties', 'items', 'items');
    expect(item.required).toEqual(
      expect.arrayContaining(['raw_name', 'raw_code', 'name_suggestions', 'fees']),
    );
    expect(node(item, 'properties', 'raw_code').type).toEqual(['string', 'null']);
    expect(node(item, 'properties', 'name_suggestions').type).toBe('array');
    expect(node(item, 'properties', 'fees').type).toBe('array');
  });

  it('forbids semantic Tomatoes / Alcohol merge in the system prompt', () => {
    expect(RECEIPT_IMPORT_SYSTEM).toMatch(/do not semantically merge/i);
    expect(RECEIPT_IMPORT_SYSTEM).toMatch(/fees attach to the parent/i);
    expect(RECEIPT_IMPORT_SYSTEM).toMatch(/Ice Cream 4l/);
  });
});
