import { expect, it } from 'vitest';
import { buildMetadata } from '../scripts/build.mjs';
import { matchCustomListPage } from '../src/index.js';

it('renders the spec §12 metadata block', () => {
  const meta = buildMetadata({ version: '1.2.3' });
  expect(meta.startsWith('// ==UserScript==\n')).toBe(true);
  expect(meta.endsWith('// ==/UserScript==\n')).toBe(true);
  for (const line of [
    '@version     1.2.3',
    '@match       https://rebrickable.com/users/*',
    '@inject-into page',
    '@grant       GM_xmlhttpRequest',
    '@connect     cdn.rebrickable.com',
    '@downloadURL https://github.com/drzero42/rb-partlist-shuttle/releases/latest/download/rb-partlist-shuttle.user.js',
  ]) {
    expect(meta).toContain(`// ${line}\n`);
  }
});

it('runs only on Custom List pages', () => {
  expect(matchCustomListPage('/users/drzero/lists/42/')).toEqual({ username: 'drzero', listId: '42' });
  expect(matchCustomListPage('/users/drzero/partlists/42/')).toBeNull();
  expect(matchCustomListPage('/users/drzero/lists/42/parts/')).toBeNull();
});
