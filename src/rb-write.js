/**
 * Write side: the site Import endpoint (spec §5, D4). NOT the v3 API for writes;
 * the §13 fallback stays behind a config flag and is not built until the primary
 * path breaks.
 *
 *   POST /users/<username>/partlists/<list_id>/importparts/slow/
 *
 * One synchronous request per affected list. Field set to replay exactly (§5.2):
 *   csrfmiddlewaretoken  hidden input from the CURRENT page, never the cookie
 *   action               'A' (Append/increment) | 'S' (Subtract/decrement)
 *   import_url           '' (the `file` field carries the payload)
 *   external_source      'RB' (matches the rbpartscsv scheme)
 *   file                 the per-list CSV
 *   fix_molds            *** MUST BE ABSENT *** (D9 — omitting the field is the
 *                        OFF state; Task 0.2 verifies the server does not
 *                        normalize part numbers anyway. Never send it.)
 *
 * Required header: `X-Requested-With: XMLHttpRequest`. Cookies ride along
 * same-origin. Responses are parsed and their `html` warnings surfaced verbatim
 * (§5.3, §7.8) — never swallowed.
 */

/** §5.1 mode selector. `R` (Replace) and delete-all exist but are NOT used. */
export const IMPORT_ACTION = Object.freeze({ APPEND: 'A', SUBTRACT: 'S' });

/** Fields that are always sent, verbatim (§5.2). */
export const IMPORT_FIXED_FIELDS = Object.freeze({
  import_url: '',
  external_source: 'RB',
});

/**
 * Fields that must NEVER appear in an import form. Sending `fix_molds` in any
 * shape risks silent part-number rewriting (D9).
 */
export const FORBIDDEN_FIELDS = Object.freeze(['fix_molds']);

/**
 * Build the import endpoint URL.
 *
 * @param {{username: string, listId: number|string}} target
 * @returns {string}
 */
export function importUrl(target) {
  throw new Error(`NotImplemented: rb-write.importUrl(${target.listId})`);
}

/**
 * Read the CSRF token from the page's hidden input (Task 0.4). Django masks the
 * cookie per page, so the cookie is NOT a valid substitute (§5.2). Re-read before
 * each write if a token turns out to be single-use.
 *
 * @param {Document|ParentNode} [root]
 * @returns {string}
 */
export function readCsrfToken(root) {
  throw new Error('NotImplemented: rb-write.readCsrfToken');
}

/**
 * Assemble the multipart form (§5.2). The CSV goes in as a `file` Blob.
 *
 * @param {{action: 'A'|'S', csvText: string, csrfToken: string}} opts
 * @returns {FormData}
 */
export function buildImportForm(opts) {
  throw new Error(`NotImplemented: rb-write.buildImportForm(action=${opts.action})`);
}

/**
 * Parsed §5.3 response.
 *
 * @typedef {object} ImportResult
 * @property {string} status          `success` or the server's own failure value
 * @property {string} warningsHtml    `html` field — shown to the user verbatim
 * @property {number|null} partsCount `renders['#parts_count']`, for §7.5 verify
 * @property {unknown} raw
 */

/**
 * Parse the JSON response, tolerating a missing `renders` block.
 *
 * @param {unknown} payload
 * @returns {ImportResult}
 */
export function parseImportResponse(payload) {
  throw new Error('NotImplemented: rb-write.parseImportResponse');
}

/**
 * Perform one import write. Sequential only (D15); 429 ⇒ backoff and retry
 * (§7.6); any non-success status ⇒ throw with the server's own wording.
 *
 * @param {{username: string, listId: number|string, action: 'A'|'S', csvText: string, csrfToken: string}} opts
 * @returns {Promise<ImportResult>}
 */
export async function importParts(opts) {
  throw new Error(`NotImplemented: rb-write.importParts(${opts.action} → ${opts.listId})`);
}
