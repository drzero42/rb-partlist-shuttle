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

/** Spec §4.4 cache: {categoryOf, categoryName, etag, checkedAt}, or undefined. */
export const readCatalogueCache = () => GM_getValue('catalogCache');
export const writeCatalogueCache = (cache) => GM_setValue('catalogCache', cache);

/**
 * Cross-origin GET, only for the catalogue CDN (`@connect cdn.rebrickable.com`).
 *
 * @param {string} url
 * @param {Record<string, string>} headers
 * @returns {Promise<{status: number, etag: string|null, body: ArrayBuffer}>}
 */
export function cdnGet(url, headers) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      url,
      headers,
      responseType: 'arraybuffer',
      onload: (res) =>
        resolve({
          status: res.status,
          etag: /^etag:\s*(.+)$/im.exec(res.responseHeaders)?.[1].trim() ?? null,
          body: res.response,
        }),
      onerror: () => reject(new Error(`could not reach ${url}`)),
      ontimeout: () => reject(new Error(`timed out fetching ${url}`)),
      timeout: 60000,
    });
  });
}
