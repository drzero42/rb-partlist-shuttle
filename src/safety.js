/**
 * Safety layer (spec §7): backup before write, resumable apply, post-write
 * verify, idempotency guard.
 *
 * State policy — read this before adding persistence. The golden rule is "no
 * state outside Rebrickable except the §9 `GM_*` config keys". The apply journal
 * below is therefore **in-memory, for the lifetime of the current run only**.
 * Resumption after an interruption re-derives truth by re-reading the affected
 * lists from Rebrickable (§4.2) and diffing against the plan; it never trusts a
 * stored journal. That keeps §7.4's "continue or roll back cleanly" honest
 * without inventing state the spec forbids.
 */

/** @typedef {import('./reconcile.js').ShuttlePlan} ShuttlePlan */

/**
 * Backup filename for one list (§7.3): timestamped, per affected list.
 *
 * @param {{listId: number|string, listName: string, timestamp: string}} target
 * @returns {string}
 */
export function backupFilename(target) {
  throw new Error(`NotImplemented: safety.backupFilename(${target.listId})`);
}

/**
 * Fetch and download the rbpartscsv of EVERY affected list (each source/
 * destination box plus staging) before any write happens (§7.3, D16). Refuses to
 * let the apply phase start if any backup failed.
 *
 * @param {{username: string, lists: import('./reconcile.js').RbList[], timestamp: string}} opts
 * @returns {Promise<{backedUp: (number|string)[], failed: {listId: number|string, error: string}[]}>}
 */
export async function backupLists(opts) {
  throw new Error(`NotImplemented: safety.backupLists (${opts.lists.length} lists)`);
}

/**
 * One apply step: a single import request against one list.
 *
 * @typedef {object} ApplyStep
 * @property {number} index
 * @property {number|string} listId
 * @property {'A'|'S'} action
 * @property {string} csvText
 * @property {'pending'|'done'|'failed'|'skipped'} status
 * @property {string} [error]
 * @property {number|null} [partsCount]
 */

/**
 * Build the ordered step list for a plan: box writes first, then the staging
 * write (§6.1 step 6, §6.2 step 7). Order matters — the box side must succeed
 * before staging changes, so an interruption never leaves staging holding
 * parts that were not taken out of a box.
 *
 * @param {ShuttlePlan} plan
 * @param {{username: string, csrfToken: string}} ctx
 * @returns {ApplyStep[]}
 */
export function buildApplySteps(plan, ctx) {
  throw new Error(`NotImplemented: safety.buildApplySteps (${plan.direction})`);
}

/**
 * Execute steps strictly sequentially (D15), reporting progress as it goes and
 * stopping at the first failure without rolling forward (§7.4).
 *
 * @param {ApplyStep[]} steps
 * @param {{onStep?: (step: ApplyStep) => void}} [hooks]
 * @returns {Promise<{completed: ApplyStep[], failed: ApplyStep|null}>}
 */
export async function runApplySteps(steps, hooks) {
  throw new Error(`NotImplemented: safety.runApplySteps (${steps.length} steps)`);
}

/**
 * Reconcile live list contents against the plan to find where an interrupted
 * run stopped (§7.4, in-memory journal policy above).
 *
 * @param {{plan: ShuttlePlan, live: import('./reconcile.js').ListContents[]}} opts
 * @returns {{doneListIds: (number|string)[], remaining: ApplyStep[]}}
 */
export function diffAgainstPlan(opts) {
  throw new Error('NotImplemented: safety.diffAgainstPlan');
}

/**
 * Post-write verify (§7.5): compare the response `#parts_count`, and re-fetch
 * the list when the count alone cannot prove the delta. Mismatches are reported
 * loudly, never downgraded to a warning.
 *
 * @param {{username: string, listId: number|string, expectedPartsCount: number|null, expectedRows: import('./csv.js').CsvRow[]}} opts
 * @returns {Promise<{ok: boolean, expected: number|null, actual: number|null, detail: string}>}
 */
export async function verifyWrite(opts) {
  throw new Error(`NotImplemented: safety.verifyWrite(${opts.listId})`);
}
