/**
 * Read side: session-cookie GETs against rebrickable.com (spec §4).
 *
 * All requests are same-origin `fetch` with `credentials: 'include'` — plain
 * fetch, no `GM_xmlhttpRequest`, no `@connect` (§16.2). Reads of the user's own
 * lists need the session only, never an API key; the v3 key is used solely to
 * enumerate Part Lists when one is configured (§4.3).
 *
 * Two DIFFERENT URL shapes, easy to confuse:
 *   Custom List parts  /users/<u>/lists/<id>/parts/       (§4.1, the MOC input)
 *   Part List parts    /users/<u>/partlists/<id>/parts/   (§4.2, boxes + staging)
 *
 * Requests stay sequential (D15) and 429 is retried with backoff (§7.6).
 */

/** @typedef {import('./reconcile.js').RbList} RbList */

/** Default for `inc_spares` — Task 0.5 decides; OFF keeps only true box contents. */
export const DEFAULT_INC_SPARES = false;

/**
 * Build an rbpartscsv export URL.
 *
 * @param {{username: string, kind: 'lists'|'partlists', listId: number|string, incSpares?: boolean}} target
 * @returns {string}
 */
export function exportUrl(target) {
  throw new Error(`NotImplemented: rb-read.exportUrl(${target.kind}/${target.listId})`);
}

/**
 * GET an rbpartscsv export and return the raw text (§4.1, §4.2).
 * A 403 means the session is missing/expired — surface it as "log in to
 * Rebrickable", never retry silently.
 *
 * @param {{username: string, kind: 'lists'|'partlists', listId: number|string, incSpares?: boolean}} target
 * @returns {Promise<string>} CSV text
 */
export async function fetchPartsCsv(target) {
  throw new Error(`NotImplemented: rb-read.fetchPartsCsv(${target.kind}/${target.listId})`);
}

/**
 * Read the MOC's Custom List rows — the unit of work for a run (§4.1, D2).
 *
 * @param {{username: string, listId: number|string}} target
 * @returns {Promise<import('./csv.js').CsvRow[]>}
 */
export async function fetchCustomListRows(target) {
  throw new Error(`NotImplemented: rb-read.fetchCustomListRows(${target.listId})`);
}

/**
 * Read one Part List (a box, or staging) (§4.2).
 *
 * @param {{username: string, listId: number|string}} target
 * @returns {Promise<import('./reconcile.js').ListContents['rows']>}
 */
export async function fetchPartListRows(target) {
  throw new Error(`NotImplemented: rb-read.fetchPartListRows(${target.listId})`);
}

/**
 * Enumerate the user's Part Lists (§4.3, session-only DOM scrape). The `type`
 * build flag is carried through untouched but must never drive classification
 * (D5/D6). The v3 endpoint is not used: its user token needs a password (§10).
 *
 * @param {{username: string}} opts
 * @returns {Promise<RbList[]>}
 */
export async function fetchPartLists(opts) {
  throw new Error(`NotImplemented: rb-read.fetchPartLists(${opts.username})`);
}

/**
 * §4.3 primary (and only) enumeration path: scrape `MY LEGO → My Part Lists`
 * for ids + names.
 *
 * @param {Document|ParentNode} [root] defaults to the live document
 * @returns {RbList[]}
 */
export function scrapePartListsFromDom(root) {
  throw new Error('NotImplemented: rb-read.scrapePartListsFromDom');
}

/**
 * Run an async task list strictly one at a time (D15). Never `Promise.all` a
 * write, and never a burst of reads either.
 *
 * @template T
 * @param {(() => Promise<T>)[]} tasks
 * @returns {Promise<T[]>}
 */
export async function runSequentially(tasks) {
  throw new Error(`NotImplemented: rb-read.runSequentially (${tasks.length} tasks)`);
}

/**
 * Sleep helper for 429 backoff (§7.6).
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
export async function delay(ms) {
  throw new Error(`NotImplemented: rb-read.delay(${ms})`);
}
