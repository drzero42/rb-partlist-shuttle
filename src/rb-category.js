/**
 * Category resolution — used ONLY by the return direction (spec §4.4, §6.2).
 * Consume never needs categories: it matches box contents exactly (§6.1 note),
 * which is why consume works with session cookies and no API key.
 *
 * Two modes, selected by the `categoryMode` config key (§9):
 *   'api'  GET /api/v3/lego/parts/?part_nums=<a>,<b>,<c>&inc_part_details=1&key=<k>
 *          Public catalog endpoint ⇒ needs the read-only API key, NOT a user
 *          token, NOT a password (§10). ~1 req/sec; batch via `part_nums`,
 *          page with `page_size` up to 1000.
 *   'dom'  Keyless fallback: the rendered Part-List page (and the import
 *          response `renders['#user_parts_list']`) carries `data-part_cat_id` /
 *          `data-part_cat_name` per part tile. Many page loads, no key.
 *
 * Task 0.1 confirms the API fields exist before this is relied upon.
 */

/** Max part numbers per batched API request. */
export const API_BATCH_SIZE = 50;

/** §4.4 paging ceiling. */
export const API_PAGE_SIZE = 1000;

/**
 * A part's category, as returned by either mode.
 *
 * @typedef {object} PartCategory
 * @property {string} partNum      verbatim, as requested (D9: never rewritten)
 * @property {number} partCatId
 * @property {string} partCatName
 */

/**
 * Batched v3 catalog lookup (§4.4). Chunks `partNums` by API_BATCH_SIZE and
 * issues the requests sequentially (D15).
 *
 * @param {{partNums: string[], apiKey: string}} opts
 * @returns {Promise<Map<string, PartCategory>>}
 */
export async function fetchCategoriesByApi(opts) {
  throw new Error(`NotImplemented: rb-category.fetchCategoriesByApi (${opts.partNums.length} parts)`);
}

/**
 * Keyless DOM-scrape fallback (§4.4).
 *
 * @param {{username: string, listId: number|string}} target  a Part List page
 * @returns {Promise<Map<string, PartCategory>>}
 */
export async function scrapeCategoriesFromListPage(target) {
  throw new Error(`NotImplemented: rb-category.scrapeCategoriesFromListPage(${target.listId})`);
}

/**
 * Extract `data-part_cat_id` / `data-part_cat_name` from an HTML fragment — the
 * import response's `renders['#user_parts_list']` or a scraped page.
 *
 * @param {string} html
 * @returns {Map<string, PartCategory>}
 */
export function parseCategoryDataFromHtml(html) {
  throw new Error(`NotImplemented: rb-category.parseCategoryDataFromHtml (${html.length} chars)`);
}

/**
 * Resolve categories per the configured mode, falling back to `dom` when
 * `apiKey` is empty. Unknown parts resolve to `null` so reconcile.js can report
 * them instead of guessing (D13, §6.3).
 *
 * @param {{partNums: string[], mode: 'api'|'dom', apiKey: string, username: string, boxListIds: (number|string)[]}} opts
 * @returns {Promise<(partNum: string) => PartCategory|null>} the `categoryOf` callback reconcile.js wants
 */
export async function resolveCategories(opts) {
  throw new Error(`NotImplemented: rb-category.resolveCategories (${opts.partNums.length} parts, mode=${opts.mode})`);
}
