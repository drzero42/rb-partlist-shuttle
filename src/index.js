/**
 * Entry point. Inert everywhere except a Custom List page (spec §8).
 */

/**
 * @param {string} pathname
 * @returns {{username: string, listId: string}|null}
 */
export function matchCustomListPage(pathname) {
  const m = /^\/users\/([^/]+)\/lists\/(\d+)\/?$/.exec(pathname);
  return m ? { username: m[1], listId: m[2] } : null;
}

if (typeof location !== 'undefined') matchCustomListPage(location.pathname);
