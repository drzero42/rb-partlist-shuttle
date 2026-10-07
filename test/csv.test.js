import { describe, expect, it } from 'vitest';
import { parseCsv, parseParts, serializeParts } from '../src/csv.js';

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
