import { describe, expect, it } from 'vitest';
import { parseCatalogue, parseCsv, parseParts, serializeParts } from '../src/csv.js';

describe('parseCsv', () => {
  it('handles quoted fields with commas and escaped quotes', () => {
    expect(parseCsv('a,b\n003383,"Sticker, ""big""",58\n')).toEqual([
      ['a', 'b'],
      ['003383', 'Sticker, "big"', '58'],
    ]);
  });

  it('accepts CRLF and skips blank lines', () => {
    expect(parseCsv('a,b\r\n\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('parseParts', () => {
  it('reads rbpartscsv rows with ids kept verbatim', () => {
    expect(parseParts('Part,Color,Quantity\n48729b,0,2\n003005,15,1\n')).toEqual([
      { part: '48729b', color: '0', qty: 2 },
      { part: '003005', color: '15', qty: 1 },
    ]);
  });

  it('rejects a foreign header', () => {
    expect(() => parseParts('<html>login</html>')).toThrow(/header/);
  });

  it('rejects a bad quantity', () => {
    expect(() => parseParts('Part,Color,Quantity\n3001,4,0\n')).toThrow(/quantity/);
  });
});

it('serializeParts round-trips through parseParts', () => {
  const rows = [{ part: '48729b', color: '0', qty: 2 }];
  expect(serializeParts(rows)).toBe('Part,Color,Quantity\n48729b,0,2\n');
  expect(parseParts(serializeParts(rows))).toEqual(rows);
});

it('parseCatalogue maps part → category id and category id → name', () => {
  const parts = 'part_num,name,part_cat_id,part_material\n003383,"Sticker Sheet, big",58,Plastic\n3023,Plate 1 x 2,14,Plastic\n';
  const categories = 'id,name\n14,Plates\n58,Stickers\n';
  expect(parseCatalogue(parts, categories)).toEqual({
    categoryOf: { '003383': '58', 3023: '14' },
    categoryName: { 14: 'Plates', 58: 'Stickers' },
  });
  expect(() => parseCatalogue('id,name\n', categories)).toThrow(/parts\.csv/);
});
