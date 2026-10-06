/**
 * rbpartscsv parse/serialize — the wire format for every Rebrickable read and
 * write in this tool (spec §4.1, §4.2, §5.2).
 *
 * Import rule (AGENTS.md): this module imports NOTHING. It is pure text in,
 * pure text out, so it is unit-testable as-is.
 *
 * Format contract (D3):
 *   header  `Part,Color,Quantity`
 *   row     `48729b,0,2`  — RB part id, numeric RB color id, integer quantity
 *
 * Part ids and color ids are kept as VERBATIM STRINGS (never normalized, never
 * lowercased, never rewritten): D9 forbids mold fixing and D10 requires exact
 * `Part,Color` identity, so byte-for-byte fidelity through a parse/serialize
 * round-trip is a correctness property, not a nicety (Task 0.6).
 */

export const CSV_HEADER = 'Part,Color,Quantity';

/**
 * A single rbpartscsv row.
 *
 * @typedef {object} CsvRow
 * @property {string} partNum   RB part id, verbatim (e.g. `48729b`)
 * @property {string} colorId   numeric RB color id, verbatim (e.g. `0` = Black)
 * @property {number} quantity  positive integer
 */

/**
 * Canonical identity key for a `(Part,Color)` pair — the unit of exact matching
 * (D10). Every map in reconcile.js is keyed by this.
 *
 * @param {string} partNum
 * @param {string} colorId
 * @returns {string}
 */
export function rowKey(partNum, colorId) {
  throw new Error(`NotImplemented: csv.rowKey(${partNum},${colorId})`);
}

/**
 * Parse an rbpartscsv document into rows.
 *
 * Must tolerate: CRLF and LF endings, a trailing newline, blank lines, and
 * quoted fields. Must reject: a missing/foreign header, a non-integer or
 * non-positive quantity, a row with the wrong field count.
 *
 * @param {string} text
 * @returns {CsvRow[]}
 */
export function parseRbPartsCsv(text) {
  throw new Error(`NotImplemented: csv.parseRbPartsCsv (${text.length} chars)`);
}

/**
 * Serialize rows back to an rbpartscsv document (header + LF-terminated rows).
 * This is the exact `file` payload for an import POST (spec §5.2).
 *
 * Invariant: `parseRbPartsCsv(serializeRbPartsCsv(rows))` deep-equals `rows`.
 *
 * @param {CsvRow[]} rows
 * @returns {string}
 */
export function serializeRbPartsCsv(rows) {
  throw new Error(`NotImplemented: csv.serializeRbPartsCsv (${rows.length} rows)`);
}

/**
 * Build a `(Part,Color) → quantity` map from rows, summing duplicate keys.
 *
 * @param {CsvRow[]} rows
 * @returns {Map<string, {row: CsvRow, quantity: number}>} keyed by rowKey()
 */
export function indexRows(rows) {
  throw new Error(`NotImplemented: csv.indexRows (${rows.length} rows)`);
}
