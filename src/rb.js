/**
 * Rebrickable site I/O (spec §4, §5): same-origin fetch with the user's session.
 * Strictly sequential; callers await each call (D12).
 */

import { parseParts, serializeParts } from './csv.js';
import { importProblem, partListName } from './plan.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** fetch with session cookies; 429 → back off 1/2/4 s, then give up (§7.3). */
async function send(url, init = {}) {
  for (const backoff of [1000, 2000, 4000, null]) {
    const res = await fetch(url, { credentials: 'include', ...init });
    if (res.status === 429 && backoff !== null) {
      await sleep(Number(res.headers.get('Retry-After')) * 1000 || backoff);
      continue;
    }
    if (res.status === 403) throw new Error(`Rebrickable refused ${url} (403). Are you logged in?`);
    if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url}: HTTP ${res.status}`);
    return res;
  }
}

const page = async (url) => new DOMParser().parseFromString(await (await send(url)).text(), 'text/html');

/**
 * §4.1/§4.2: rbpartscsv of a Custom List (`lists`) or Part List (`partlists`).
 *
 * @param {string} username
 * @param {'lists'|'partlists'} kind
 * @param {string} id
 */
export async function readParts(username, kind, id) {
  const res = await send(`/users/${username}/${kind}/${id}/parts/?format=rbpartscsv&inc_spares=0`);
  return parseParts(await res.text());
}

/**
 * §4.3: Part Lists from the index page's root links, named by their link text
 * minus the part count.
 *
 * @param {string} username
 * @returns {Promise<{id: string, name: string}[]>}
 */
export async function listPartLists(username) {
  const doc = await page(`/users/${username}/partlists/`);
  const byId = new Map();
  for (const a of doc.querySelectorAll(`a[href^="/users/${username}/partlists/"]`)) {
    const id = /^\/users\/[^/]+\/partlists\/(\d+)\/$/.exec(a.getAttribute('href'))?.[1];
    const name = partListName(a.textContent);
    if (id && name && !byId.has(id)) byId.set(id, { id, name });
  }
  return [...byId.values()];
}

/**
 * §5.1: the CSRF token from this page, else from a Part List page (§10).
 *
 * @param {string} username
 * @param {string} partListId any of the user's Part Lists
 */
export async function csrfToken(username, partListId) {
  const selector = 'input[name=csrfmiddlewaretoken]';
  const token =
    document.querySelector(selector)?.value ||
    (await page(`/users/${username}/partlists/${partListId}/`)).querySelector(selector)?.value;
  if (!token) throw new Error('no CSRF token found on the page or the Part List page');
  return token;
}

/**
 * §5.1 import write. Throws with the server's own text on any §5.2 problem.
 *
 * @param {{username: string, listId: string, action: 'A'|'S', rows: import('./csv.js').PartRow[], token: string}} opts
 * @returns {Promise<string>} the server's `html` report
 */
export async function importParts({ username, listId, action, rows, token }) {
  const form = new FormData();
  form.append('csrfmiddlewaretoken', token);
  form.append('action', action);
  form.append('import_url', '');
  form.append('external_source', 'RB');
  form.append('file', new Blob([serializeParts(rows)], { type: 'text/csv' }), 'parts.csv');
  // fix_molds is deliberately never sent (D6).
  const res = await send(`/users/${username}/partlists/${listId}/importparts/slow/`, {
    method: 'POST',
    body: form,
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
  const json = await res.json();
  const problem = importProblem(json);
  if (problem) throw new Error(problem);
  return json.html;
}
