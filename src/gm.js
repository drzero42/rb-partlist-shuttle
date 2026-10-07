/**
 * The only module allowed to touch GM_* APIs (spec §9, §12). Everything else
 * gets config, cache and cross-origin requests through here.
 */

/** Spec §9. The only place the used list's default name is written down. */
export const CONFIG_DEFAULTS = Object.freeze({
  usedListName: 'Used for MOCs',
  boxNamePattern: '\\bbox(?:es)?\\b',
});

/** @returns {{usedListName: string, boxNamePattern: string}} */
export function loadConfig() {
  return Object.fromEntries(
    Object.entries(CONFIG_DEFAULTS).map(([key, fallback]) => [key, GM_getValue(key, fallback)]),
  );
}

/** @param {Partial<typeof CONFIG_DEFAULTS>} patch */
export function saveConfig(patch) {
  for (const [key, value] of Object.entries(patch)) GM_setValue(key, value);
}
