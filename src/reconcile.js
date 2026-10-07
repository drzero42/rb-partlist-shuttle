/**
 * Pure reconciliation logic — every risky rule in the spec lives here and
 * nowhere else (spec §6, §11).
 *
 * Import rule (AGENTS.md): this module may import ONLY `./csv.js`. No network,
 * no DOM, no `GM_*`, no `Date.now()`/randomness — it is a pure function of its
 * inputs so it can be unit-tested against fixture CSVs.
 *
 * Rules encoded here:
 *   D5/D6/D7  staging = exact configured name; box = everything not staging and
 *             not ignored; build-type flags are NEVER consulted.
 *   D8/D13    return routes on live box contents — the §6.2 ladder (exact
 *             Part,Color → same Part any colour → same design root, different
 *             mould letter → ask). No categories, no memory (§12.3 items 6/7).
 *   D10       exact `Part,Color` identity only for WRITES; the ladder tiers are
 *             routing hints reported in the preview, never id substitutions.
 *   D11       all-or-nothing: any shortfall ⇒ `feasible: false` ⇒ zero writes.
 *   D12       consume pulls only from boxes, never from staging.
 *   D13       ambiguous return routing (0 or ≥2 candidate boxes) ⇒ ask, never guess.
 *   §7.7      re-apply detection guards against double-counting.
 */

/**
 * A Rebrickable Part List as enumerated by spec §4.3.
 *
 * @typedef {object} RbList
 * @property {number|string} listId
 * @property {string} name
 * @property {string} [descr]
 * @property {number} [type]   build-type flag — present but DELIBERATELY UNUSED (D5/D6)
 * @property {number} [qty]
 */

/**
 * Contents of one Part List, already parsed.
 *
 * @typedef {object} ListContents
 * @property {RbList} list
 * @property {import('./csv.js').CsvRow[]} rows
 */

/**
 * Result of staging/box classification.
 *
 * @typedef {object} Classification
 * @property {RbList|null} staging    exactly one, or null (never guessed from `type`)
 * @property {RbList[]} boxes
 * @property {RbList[]} ignored
 * @property {RbList[]} stagingCollisions   lists matching `stagingName` beyond the first
 * @property {string[]} errors               non-empty ⇒ refuse to plan
 */

/**
 * One resolved move: `quantity` of `row` between `listId` and staging.
 *
 * @typedef {object} Assignment
 * @property {import('./csv.js').CsvRow} row
 * @property {number|string} listId    source box (consume) or destination box (return)
 * @property {number} quantity
 */

/**
 * A complete, locally-simulated run. `feasible: false` means NO write may happen
 * (D11) and `offenders` says why.
 *
 * @typedef {object} ShuttlePlan
 * @property {'consume'|'return'} direction
 * @property {boolean} feasible
 * @property {Assignment[]} assignments
 * @property {{listId: number|string, rows: import('./csv.js').CsvRow[]}[]} boxWrites
 * @property {import('./csv.js').CsvRow[]} stagingRows
 * @property {{row: import('./csv.js').CsvRow}[]} missing
 * @property {{row: import('./csv.js').CsvRow, candidateListIds: (number|string)[]}[]} ambiguous
 * @property {{row: import('./csv.js').CsvRow, listId: number|string, requested: number, available: number}[]} offenders
 */

/**
 * Split Part Lists into staging / boxes / ignored (§4.3, D5/D6/D7).
 *
 * FAIL-CLOSED (D6): a list is a box only when its name matches `boxNamePattern`
 * (the §9 config string, compiled with the `i` flag) AND it is neither the
 * staging list nor on `ignoreLists`. Pending orders, wishlists and half-sorted
 * bags must never be able to satisfy a consume plan. Never by build-type flag.
 *
 * `config.stagingName` is the single source of the staging name: it comes from
 * `gm.CONFIG_DEFAULTS` (§16.1) and is never restated here or in the UI.
 *
 * @param {RbList[]} lists
 * @param {import('./gm.js').ShuttleConfig} config
 * @returns {Classification}
 */
export function classifyLists(lists, config) {
  throw new Error(`NotImplemented: reconcile.classifyLists (${lists.length} lists)`);
}

/**
 * The §6.2 routing ladder for one return row, over live box contents — no
 * categories, no memory. Tier order; stop at the first tier with candidates:
 *   exact (Part,Color) → same Part any colour → same design root, different
 *   mould letter (`48729b` ⇄ `48729a`). Composite ids (`<design>c<num>`,
 *   §12.3 item 5) match only in tier 1. Staging is excluded by the caller.
 *
 * @param {{partNum: string, color: number|string}} row
 * @param {ListContents[]} boxContents
 * @returns {{tier: 'exact'|'anyColor'|'moldFamily'|'none', listIds: (number|string)[]}}
 */
export function routeReturnRow(row, boxContents) {
  throw new Error(`NotImplemented: reconcile.routeReturnRow (${row.partNum})`);
}

/**
 * Plan consume: boxes → staging (spec §6.1).
 *
 * Each MOC row must be met in full by exactly ONE box (D10, D12). A row held by
 * several boxes is `ambiguous`; a row held by none is `missing`; a row whose box
 * holds too few is an `offender`. Any of the latter two ⇒ `feasible: false` and
 * the caller must make zero writes (D11). Before claiming `missing`, the
 * near-miss report expands composite⇄component ids (§12.3 item 5) — a box
 * holding `298c02` is not empty of `4592`+`4593`, and it says so in the preview
 * rather than silently picking an id.
 *
 * @param {{mocRows: import('./csv.js').CsvRow[], boxContents: ListContents[], stagingContents: ListContents|null}} input
 * @returns {ShuttlePlan}
 */
export function planConsume(input) {
  throw new Error('NotImplemented: reconcile.planConsume');
}

/**
 * Plan return: staging → home boxes (spec §6.2), routing via `routeReturnRow`
 * on live box contents. Rows with 0 candidates (whole family boxed-out, §6.3)
 * or ≥2 (invariant tie) go to `ambiguous` for the UI modal (D13); the row's
 * matched tier is recorded for the preview. Staging must hold the requested
 * quantity or the row is an `offender` (mirror of D11).
 *
 * @param {{mocRows: import('./csv.js').CsvRow[], stagingContents: ListContents, boxContents: ListContents[]}} input
 * @returns {ShuttlePlan}
 */
export function planReturn(input) {
  throw new Error('NotImplemented: reconcile.planReturn');
}

/**
 * Idempotency guard (§7.7): detect that this run looks already applied, so a
 * re-run cannot silently double-count.
 *
 * @param {{direction: 'consume'|'return', mocRows: import('./csv.js').CsvRow[], stagingContents: ListContents}} input
 * @returns {{alreadyApplied: boolean, reason: string|null, overlappingKeys: string[]}}
 */
export function detectReapply(input) {
  throw new Error('NotImplemented: reconcile.detectReapply');
}

/**
 * Fold assignments into the per-list CSV payloads that spec §5.2 uploads: one
 * Subtract/Append request per affected list (D4), rows grouped by `listId`.
 *
 * @param {Assignment[]} assignments
 * @returns {{listId: number|string, rows: import('./csv.js').CsvRow[]}[]}
 */
export function groupWrites(assignments) {
  throw new Error(`NotImplemented: reconcile.groupWrites (${assignments.length} assignments)`);
}
