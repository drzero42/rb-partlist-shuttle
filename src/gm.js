/**
 * The ONLY module in `src/` allowed to touch `GM_*` APIs (AGENTS.md). Everything
 * else receives config, styles and downloads through this seam, which keeps the
 * rest of the code runnable under Vitest without a userscript manager.
 *
 * Config keys and defaults are FROZEN by spec §9 — do not add keys without a
 * spec update. No password is ever stored (§10); `apiKey` is a read-only public
 * catalog key used only for return-direction category reads (§4.4).
 *
 * `GM_download` is the §7.3 backup sink. Where a manager lacks it, `download()`
 * falls back to a blob + programmatic anchor click (§16.2 note) — and the
 * `@grant` line is then droppable.
 */

/**
 * Resolve the manager's API once, here. `undefined` means "not granted", and
 * callers must degrade (§16.2: without `GM_download`, back up via a blob +
 * anchor click). The name deliberately avoids a `GM_` prefix: test/scaffold.test.js
 * asserts the set of `GM_*` identifiers in this file equals the `@grant` list, so
 * a stray prefix would look like an ungranted API call.
 */
export const MANAGER_API = Object.freeze({
  getValue: typeof GM_getValue === 'function' ? GM_getValue : undefined,
  setValue: typeof GM_setValue === 'function' ? GM_setValue : undefined,
  addStyle: typeof GM_addStyle === 'function' ? GM_addStyle : undefined,
  download: typeof GM_download === 'function' ? GM_download : undefined,
});

/**
 * Config schema, spec §9.
 *
 * @typedef {object} ShuttleConfig
 * @property {string} stagingName     exact-match staging Part List name (D5) — the
 *                                    single source of that name (§16.1)
 * @property {string} boxNamePattern  regex SOURCE for lists that count as boxes (D6)
 * @property {string[]} ignoreLists   names excluded after the pattern matched (D7)
 * @property {'api'|'dom'} categoryMode category source for the return direction (§4.4)
 * @property {string} apiKey          public catalog key; empty ⇒ `dom` mode is forced
 * @property {boolean} defaultDryRun  always preview before writing (§7.1)
 */

export const CONFIG_DEFAULTS = Object.freeze({
  stagingName: 'Used for MOCs',
  boxNamePattern: '\\bbox(?:es)?\\b',
  ignoreLists: Object.freeze([]),
  categoryMode: 'api',
  apiKey: '',
  defaultDryRun: true,
});

/** @returns {keyof ShuttleConfig[]} */
export function configKeys() {
  return Object.keys(CONFIG_DEFAULTS);
}

/**
 * Read one GM storage value, falling back to the §9 default.
 *
 * @param {keyof ShuttleConfig} key
 * @returns {*}
 */
export function getValue(key) {
  throw new Error(`NotImplemented: gm.getValue(${key})`);
}

/**
 * Write one GM storage value.
 *
 * @param {keyof ShuttleConfig} key
 * @param {*} value
 * @returns {void}
 */
export function setValue(key, value) {
  throw new Error(`NotImplemented: gm.setValue(${key})`);
}

/**
 * Load the whole config, applying §9 defaults for anything unset or malformed.
 *
 * @returns {ShuttleConfig}
 */
export function loadConfig() {
  throw new Error('NotImplemented: gm.loadConfig');
}

/**
 * Persist a partial config patch.
 *
 * @param {Partial<ShuttleConfig>} patch
 * @returns {ShuttleConfig} the config after the patch
 */
export function saveConfig(patch) {
  throw new Error('NotImplemented: gm.saveConfig');
}

/**
 * Inject the bundled stylesheet (inlined by scripts/build.mjs as a string).
 *
 * @param {string} css
 * @returns {void}
 */
export function addStyle(css) {
  throw new Error(`NotImplemented: gm.addStyle (${css.length} chars)`);
}

/**
 * Save a backup file (§7.3). Uses `GM_download` when granted, else a blob +
 * anchor click.
 *
 * @param {{text: string, filename: string}} payload
 * @returns {Promise<void>}
 */
export function download(payload) {
  throw new Error(`NotImplemented: gm.download(${payload.filename})`);
}

/**
 * True when the running manager granted `GM_download`; drives the §16.2 fallback.
 *
 * @returns {boolean}
 */
export function hasDownloadGrant() {
  return MANAGER_API.download !== undefined;
}
