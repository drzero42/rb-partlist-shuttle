/**
 * Injected UI (spec §8): toolbar buttons on Custom List pages, preview and
 * ambiguity modals, progress log, settings panel.
 *
 * The script is INERT everywhere except a Custom List page
 * (`/users/<u>/lists/<id>/`) — `@match` covers all of `/users/*` (§16.2) and
 * `matchCustomListPage` narrows it at runtime. Part List pages
 * (`/users/<u>/partlists/<id>/`) must NOT match.
 *
 * Naming rule (§16.1): the staging list NAME is data. Button labels interpolate the
 * configured `stagingName`; no code path here may hardcode it or swap in the
 * product name.
 *
 * All styling arrives through `gm.addStyle` from the bundled `styles.css`; every
 * class is prefixed `rbps-` to stay clear of Rebrickable's own markup.
 */

/** @typedef {import('./reconcile.js').ShuttlePlan} ShuttlePlan */

/** CSS class prefix for everything this script injects. */
export const CLASS_PREFIX = 'rbps';

/**
 * Runtime page guard (§8).
 *
 * @param {string} pathname e.g. `location.pathname`
 * @returns {{username: string, listId: string}|null} null ⇒ stay inert
 */
export function matchCustomListPage(pathname) {
  throw new Error(`NotImplemented: ui.matchCustomListPage(${pathname})`);
}

/**
 * Button labels, built from the configured staging name (§8, §16.1).
 *
 * @param {string} stagingName
 * @returns {{consume: string, return: string}}
 */
export function buttonLabels(stagingName) {
  throw new Error(`NotImplemented: ui.buttonLabels(${stagingName})`);
}

/**
 * Inject the two toolbar buttons into the Custom List page.
 *
 * @param {{stagingName: string, onConsume: () => void, onReturn: () => void}} opts
 * @returns {{remove: () => void}}
 */
export function injectShuttleButtons(opts) {
  throw new Error('NotImplemented: ui.injectShuttleButtons');
}

/**
 * Dry-run preview table (§7.1): rows → box → quantity, the missing list, and
 * abort reasons. Renders read-only when `plan.feasible` is false and the confirm
 * control must be absent, not merely disabled.
 *
 * @param {{plan: ShuttlePlan, listNameOf: (listId: number|string) => string, onConfirm?: () => void, onCancel: () => void}} opts
 * @returns {{close: () => void}}
 */
export function renderPreviewModal(opts) {
  throw new Error('NotImplemented: ui.renderPreviewModal');
}

/**
 * Ambiguity modal (D13, §6.2 step 4): a `<select>` of candidate Part Lists per
 * unresolved row, with "remember for this run" scoped to the session only (§8).
 *
 * @param {{items: {row: import('./csv.js').CsvRow, candidateListIds: (number|string)[]}[], lists: import('./reconcile.js').RbList[], onResolve: (resolutions: Map<string, number|string>) => void, onCancel: () => void}} opts
 * @returns {{close: () => void}}
 */
export function renderAmbiguityModal(opts) {
  throw new Error('NotImplemented: ui.renderAmbiguityModal');
}

/**
 * Settings panel for the frozen §9 keys. No password field may ever be added
 * (§10); `apiKey` is labelled as a read-only public catalog key.
 *
 * @param {{config: import('./gm.js').ShuttleConfig, onSave: (patch: Partial<import('./gm.js').ShuttleConfig>) => void, onClose: () => void}} opts
 * @returns {{close: () => void}}
 */
export function renderSettingsModal(opts) {
  throw new Error('NotImplemented: ui.renderSettingsModal');
}

/**
 * Progress log for the sequential apply (§8).
 *
 * @returns {{el: HTMLElement, step: (msg: string) => void, ok: (msg: string) => void, fail: (msg: string) => void, close: () => void}}
 */
export function createProgressLog() {
  throw new Error('NotImplemented: ui.createProgressLog');
}

/**
 * Show the server's own `html` warnings verbatim (§5.3, §7.8) — sanitised for
 * insertion but never paraphrased or dropped.
 *
 * @param {{title: string, warningsHtml: string, onClose: () => void}} opts
 * @returns {{close: () => void}}
 */
export function renderWarningsModal(opts) {
  throw new Error('NotImplemented: ui.renderWarningsModal');
}
