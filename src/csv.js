/**
 * CSV for rbpartscsv (spec §4.1, §5.1) and the catalogue dumps (§4.4).
 * Part and colour ids stay verbatim strings: the tool never rewrites an id (D6).
 */

export const PARTS_HEADER = 'Part,Color,Quantity';

/**
 * RFC 4180-ish: quoted fields, `""` escapes, CRLF or LF, blank lines skipped.
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') field += text[++i];
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      record.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      if (record.length > 1 || record[0] !== '') records.push(record);
      record = [];
      field = '';
    } else field += c;
  }
  record.push(field);
  if (record.length > 1 || record[0] !== '') records.push(record);
  return records;
}

/** @typedef {{part: string, color: string, qty: number}} PartRow */

/**
 * @param {string} text an rbpartscsv export
 * @returns {PartRow[]}
 */
export function parseParts(text) {
  const [header, ...rows] = parseCsv(text);
  if (header?.join(',') !== PARTS_HEADER) {
    throw new Error(`not an rbpartscsv export (header: ${String(header).slice(0, 60)})`);
  }
  return rows.map(([part, color, qty]) => {
    const n = Number(qty);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`bad quantity for ${part},${color}: ${qty}`);
    return { part, color, qty: n };
  });
}

/**
 * @param {PartRow[]} rows
 * @returns {string} the `file` payload for an import POST
 */
export function serializeParts(rows) {
  return `${PARTS_HEADER}\n${rows.map((r) => `${r.part},${r.color},${r.qty}\n`).join('')}`;
}

/**
 * The public catalogue dumps (spec §4.4) → plain objects, so they can be cached
 * in GM storage as JSON.
 *
 * @param {string} partsCsv `parts.csv`
 * @param {string} categoriesCsv `part_categories.csv`
 * @returns {{categoryOf: Record<string, string>, categoryName: Record<string, string>}}
 */
export function parseCatalogue(partsCsv, categoriesCsv) {
  const [partsHeader, ...parts] = parseCsv(partsCsv);
  const [categoriesHeader, ...categories] = parseCsv(categoriesCsv);
  if (partsHeader?.[0] !== 'part_num' || partsHeader[2] !== 'part_cat_id') throw new Error('unexpected parts.csv header');
  if (categoriesHeader?.join(',') !== 'id,name') throw new Error('unexpected part_categories.csv header');
  return {
    categoryOf: Object.fromEntries(parts.map((row) => [row[0], row[2]])),
    categoryName: Object.fromEntries(categories),
  };
}
