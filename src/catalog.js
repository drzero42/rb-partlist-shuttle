/**
 * Public catalogue: part → category (spec §4.4). Cached in GM storage, checked
 * at most once a day, and re-downloaded only when the CDN says it changed.
 */

import { parseCatalogue } from './csv.js';
import { cdnGet, readCatalogueCache, writeCatalogueCache } from './gm.js';

const BASE = 'https://cdn.rebrickable.com/media/downloads/';
const DAY_MS = 24 * 60 * 60 * 1000;

async function gunzipText(buffer) {
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

async function download(name) {
  const res = await cdnGet(BASE + name, {});
  if (res.status !== 200) throw new Error(`${name}: HTTP ${res.status}`);
  return { etag: res.etag, text: await gunzipText(res.body) };
}

/**
 * Conditional on parts.csv.gz only. part_categories.csv.gz (<1 KB, names for
 * the preview) is refreshed whenever parts.csv.gz changes.
 *
 * @param {number} [now]
 * @returns {Promise<{categoryOf: Record<string, string>, categoryName: Record<string, string>, checkedAt: number, error?: string}>}
 */
export async function loadCatalogue(now = Date.now()) {
  const cache = readCatalogueCache();
  if (cache && now - cache.checkedAt < DAY_MS) return cache;
  try {
    if (cache?.etag) {
      const res = await cdnGet(`${BASE}parts.csv.gz`, { 'If-None-Match': cache.etag });
      if (res.status === 304) {
        const fresh = { ...cache, checkedAt: now };
        writeCatalogueCache(fresh);
        return fresh;
      }
    }
    const parts = await download('parts.csv.gz');
    const categories = await download('part_categories.csv.gz');
    const fresh = { ...parseCatalogue(parts.text, categories.text), etag: parts.etag, checkedAt: now };
    writeCatalogueCache(fresh);
    return fresh;
  } catch (error) {
    if (cache) return { ...cache, error: error.message };
    throw error;
  }
}
