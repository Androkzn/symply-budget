import { countStreamedReceiptItems } from '../countStreamedReceiptItems';

/**
 * The counter runs against JSON that is still being written, so it must never
 * depend on the text being parseable — and it must count PRODUCTS, not every
 * nested object the schema allows.
 */
describe('countStreamedReceiptItems', () => {
  it('counts items in a half-written object', () => {
    const partial =
      '{"vendor":"Superstore","items":[{"raw_name":"MILK 2%","amount":599},{"raw_nam';
    expect(countStreamedReceiptItems(partial)).toBe(1);
  });

  it('does not count fee or tax rows, which carry no raw_name', () => {
    const partial =
      '{"items":[{"raw_name":"BEER","amount":1299,"fees":[{"kind":"deposit","label":"DEP","amount":120}]}],' +
      '"tax_summary":[{"code":"GST","label":"GST","rate_percent":5,"amount":65}]}';
    expect(countStreamedReceiptItems(partial)).toBe(1);
  });

  it('tolerates whitespace between the key and its colon', () => {
    expect(countStreamedReceiptItems('{"raw_name" : "A"},{"raw_name":"B"}')).toBe(2);
  });

  it('is zero before the first item starts', () => {
    expect(countStreamedReceiptItems('{"vendor":"Costco","items":[')).toBe(0);
    expect(countStreamedReceiptItems('')).toBe(0);
  });
});
