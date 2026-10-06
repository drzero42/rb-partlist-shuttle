/**
 * Task 0 probe tests (§12).
 *
 * `tools/task0-probe.js` performs authenticated WRITES, so it gets a harness:
 * a fake Rebrickable server inside a vm sandbox. Pinned here:
 *   1. every POST carries exactly the §5.2 fields and never `fix_molds`;
 *   2. cleanup lands the scratch list back on its baseline (no double-subtract);
 *   3. when the server DOES normalize a mold id, the probe reports 0.2 FAIL —
 *      a probe that can only print PASS is worse than no probe.
 */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const SOURCE = readFileSync(new URL('../tools/task0-probe.js', import.meta.url), 'utf8');

const CSRF = 'dom-token-abcdef';
const COOKIE = 'cookie-token-9999';
const SCRATCH = '123';
const BOX = '777';
const BOX2 = '888';
const BASELINE = [
  ['3001,1', 4],
  ['3005,0', 1],
];

/** @returns a fake fetch + the call log + the mutable scratch state */
function server({ normalize = (part) => part, listName = 'Task0 probe', spares = true } = {}) {
  const calls = [];
  const state = new Map(BASELINE);
  // BOX2 is deliberately larger, so the sidebar walk picks it for 0.3 and a
  // scoped run can be told apart from a walk.
  const boxes = {
    [BOX]: Array.from({ length: 25 }, (_, index) => [`900${index}`, '0', '3']),
    [BOX2]: Array.from({ length: 30 }, (_, index) => [`800${index}`, '0', '3']),
  };
  const boxSpares = [['6558', '0', '2'], ['3005', '1', '1']];

  const toCsv = (rows) => ['Part,Color,Quantity', ...rows.map((row) => row.join(','))].join('\r\n') + '\r\n';
  const scratchCsv = () => toCsv([...state].map(([key, qty]) => [...key.split(','), String(qty)]));
  const sidebar = () =>
    `<a href="/users/abo/partlists/">My Part Lists</a>` +
    `<a href="/users/abo/partlists/${SCRATCH}/">Task0 probe</a>` +
    `<a href="/users/abo/partlists/${BOX}/">Bricks box (25 parts)</a>` +
    `<a href="/users/abo/partlists/${BOX2}/">Technic box (30 parts)</a>` +
    `<a href="/users/abo/partlists/999/">Ordered from Lego &amp; Bricklink</a>` +
    `<a href="/users/abo/lists/4242/">A Custom List</a>`;
  const listPage = () =>
    `<html><body><h1 class="d-inline">${listName}</h1>${sidebar()}` +
    `${[...state.keys()].map((key) => `<a href="/p/${key}" data-part_cat_id="1" data-part_cat_name="Bricks"></a>`).join('')}</body></html>`;
  const importPage = () =>
    `<html><body><h1>${listName}</h1><form><input type="hidden" name="csrfmiddlewaretoken" value="${CSRF}"></form>${sidebar()}</body></html>`;

  async function fetchImpl(url, init = {}) {
    const target = new URL(url, 'https://rebrickable.com');
    const { pathname, searchParams } = target;
    const reply = (status, body) => {
      calls.push({ method: init.method || 'GET', url, status });
      return {
        status,
        ok: status >= 200 && status < 300,
        text: async () => body,
        json: async () => JSON.parse(body),
      };
    };

    if (init.method !== 'POST' && pathname === `/users/abo/partlists/${SCRATCH}/importparts/`) return reply(200, importPage());
    if (init.method !== 'POST' && pathname === `/users/abo/partlists/${SCRATCH}/`) return reply(200, listPage());

    const parts = pathname.match(/^\/users\/abo\/partlists\/(\d+)\/parts\/$/);
    if (parts && boxes[parts[1]]) {
      const rows = searchParams.get('inc_spares') === '1' && spares ? [...boxes[parts[1]], ...boxSpares] : boxes[parts[1]];
      return reply(200, toCsv(rows));
    }
    if (parts && parts[1] === SCRATCH) return reply(200, scratchCsv());

    if (init.method === 'POST' && pathname === `/users/abo/partlists/${SCRATCH}/importparts/slow/`) {
      const form = init.body;
      const token = form.get('csrfmiddlewaretoken');
      const action = form.get('action');
      const rows = (await form.get('file').text()).split('\r\n').filter(Boolean).slice(1);
      calls.push({
        method: 'POST',
        url,
        fields: [...form.keys()],
        token,
        action,
        rows,
        importUrl: form.get('import_url'),
        source: form.get('external_source'),
      });

      if (token !== CSRF) return reply(403, '<h1>403 Forbidden</h1>');

      for (const row of rows) {
        const [part, color, qty] = row.split(',');
        const key = `${normalize(part)},${color}`;
        const have = state.get(key) || 0;
        if (action === 'S' && have < Number(qty)) {
          return reply(200, JSON.stringify({ status: 'error', html: `Not enough ${key}`, renders: {} }));
        }
        const next = have + Number(qty) * (action === 'A' ? 1 : -1);
        if (next > 0) state.set(key, next);
        else state.delete(key);
      }
      return reply(
        200,
        JSON.stringify({
          status: 'success',
          html: '<table><tr data-part_cat_id="12">ok</tr></table>',
          renders: { '#user_parts_list': listPage(), '#parts_count': state.size },
        }),
      );
    }

    if (pathname === '/api/v3/lego/parts/') {
      return reply(
        200,
        JSON.stringify({
          count: 2,
          results: [
            { part_num: '3001', part_cat_id: 1, part_cat_name: 'Bricks' },
            { part_num: '48729b', part_cat_id: 392, part_cat_name: 'Technic, Panel' },
          ],
        }),
      );
    }
    throw new Error(`unhandled ${init.method || 'GET'} ${url}`);
  }

  return { fetch: fetchImpl, calls, state };
}

/** Boot the probe against a fake server. `window` must be a real object: the probe writes to it. */
function boot(fixtures, options = {}, gate = () => 'TASK0', pathname = `/users/abo/partlists/${SCRATCH}/importparts/`) {
  const logs = [];
  const sandbox = {
    window: {},
    console: { log: (...args) => logs.push(args.join(' ')), warn: vi.fn(), error: vi.fn() },
    location: { pathname, origin: 'https://rebrickable.com', href: `https://rebrickable.com${pathname}` },
    // only `cookie` is read now: the probe takes its token and its sidebar from
    // fetched HTML, so it no longer depends on which tab it was pasted into.
    document: { cookie: `csrftoken=${COOKIE}` },
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: fixtures.fetch,
    URL,
    Blob,
    FormData,
    setTimeout,
    decodeURIComponent,
    Promise,
    JSON,
    Math,
    Set,
    Map,
    Array,
    Object,
    String,
    Number,
    RegExp,
    Error,
    Boolean,
  };
  sandbox.window.prompt = gate;
  sandbox.prompt = gate;
  runInNewContext(SOURCE, sandbox);
  const promise = sandbox.window.__task0({ delayMs: 0, bigRows: 30, ...options });
  return { promise, logs };
}

const verdicts = (results) => Object.fromEntries(results.map((result) => [result.id, result.verdict]));
const posts = (calls) => calls.filter((call) => call.method === 'POST' && call.fields);

describe('task0 probe', () => {
  it('is console code, not shipped code', () => {
    expect(SOURCE).not.toMatch(/\bGM_/);
    expect(SOURCE).not.toMatch(/set\(\s*['"]fix_molds/);
    expect(SOURCE).toContain("credentials: 'include'");
    expect(SOURCE).toMatch(/scratchPattern\.test\(listName\)/);
  });

  it('sends exactly the §5.2 field set on every write', async () => {
    const fixtures = server();
    const { promise } = boot(fixtures);
    await promise;
    const writes = posts(fixtures.calls);
    expect(writes.length).toBeGreaterThan(4);
    for (const post of writes) {
      expect(post.fields).toEqual(['csrfmiddlewaretoken', 'action', 'import_url', 'external_source', 'file']);
      expect(post.importUrl).toBe('');
      expect(post.source).toBe('RB');
      expect(['A', 'S']).toContain(post.action);
    }
  });

  it('undoes what it appended and lands on the baseline', async () => {
    const fixtures = server();
    const { promise } = boot(fixtures);
    const { results } = await promise;
    expect(verdicts(results).net).toBe('PASS');
    expect([...fixtures.state]).toEqual(BASELINE);
    expect(fixtures.calls.filter((call) => call.action === 'S').length).toBeGreaterThan(0);
  });

  it('reports PASS across the probed items for a server that behaves', async () => {
    const fixtures = server();
    const { results } = await boot(fixtures).promise;
    const seen = verdicts(results);
    expect(seen['0.2']).toBe('PASS');
    expect(seen['0.3']).toBe('PASS');
    expect(seen['0.4']).toBe('PASS');
    expect(seen['0.6']).toBe('PASS');
    expect(seen['0.5']).toBe('DECLARED');
    // the default walk reads every box link in the sidebar
    expect(fixtures.calls.filter((call) => call.url.includes(`/partlists/${BOX2}/parts/`)).length).toBeGreaterThan(0);
  });

  it('boxListIds scopes the reads instead of walking the sidebar', async () => {
    const fixtures = server();
    const { results, evidence } = await boot(fixtures, { boxListIds: [BOX] }).promise;
    expect(verdicts(results)['0.3']).toBe('PASS');
    expect(evidence['0.3'].rows).toBe(25);
    expect(fixtures.calls.filter((call) => call.url.includes(`/partlists/${BOX2}/`))).toHaveLength(0);
  });

  it('sparesCheck compares one box list on request', async () => {
    const { results, evidence } = await boot(server(), { sparesCheck: true, boxListIds: [BOX] }).promise;
    expect(verdicts(results)['0.5']).toBe('PASS');
    expect(evidence['0.5'].extra).toEqual(['6558,0', '3005,1']);
  });

  it('uses a non-DOM token exactly once — the deliberate cookie probe', async () => {
    const fixtures = server();
    await boot(fixtures).promise;
    const foreign = fixtures.calls.filter((call) => call.token && call.token !== CSRF);
    expect(foreign).toHaveLength(1);
    expect(foreign[0].token).toBe(COOKIE);
    expect(foreign[0].action).toBe('A');
  });

  it('reports FAIL when the server normalizes the mold id anyway', async () => {
    const fixtures = server({ normalize: (part) => (part === '48729b' ? '48729a' : part) });
    const { results, evidence } = await boot(fixtures).promise;
    const check = results.find((result) => result.id === '0.2');
    expect(check.verdict).toBe('FAIL');
    expect(check.summary).toMatch(/explicit OFF value/);
    expect(evidence['0.2'].readBack).toBeNull();
    expect(evidence['0.2'].rewrittenTo).toEqual([['48729a', '0', '2']]);
    expect(verdicts(results)['0.6']).toBe('CHECK');
  });

  it('flags a cookie token that the server accepts (§5.2 assumption breaks)', async () => {
    const fixtures = server();
    const real = fixtures.fetch;
    fixtures.fetch = async (url, init) => {
      if (init?.body && init.body.get?.('csrfmiddlewaretoken') === COOKIE) init = { ...init, body: swapToDom(init.body) };
      return real(url, init);
    };
    const { results } = await boot(fixtures).promise;
    expect(verdicts(results)['0.4']).toBe('CHECK');
  });

  it('verifies the v3 category shape when an apiKey is supplied', async () => {
    const { results, evidence } = await boot(server(), { apiKey: 'public-catalog-key' }).promise;
    expect(verdicts(results)['0.1']).toBe('PASS');
    expect(evidence['0.1'].moldServed).toBe(true);
    expect(evidence['0.1'].items).toHaveLength(2);
  });

  it('skips 0.1 with the HTML fallback counted when no apiKey is given', async () => {
    const { results, evidence } = await boot(server()).promise;
    expect(verdicts(results)['0.1']).toBe('SKIP');
    expect(evidence['0.1'].listPageAttributes).toBeGreaterThan(0);
    expect(evidence['0.1'].importHtmlAttributes).toBeGreaterThan(0);
  });

  it('runs from any tab of the list, not just the Import page', async () => {
    for (const pathname of [`/users/abo/partlists/${SCRATCH}/`, `/users/abo/partlists/${SCRATCH}/parts/`]) {
      const fixtures = server();
      const { results } = await boot(fixtures, {}, () => 'TASK0', pathname).promise;
      expect(verdicts(results)['0.2']).toBe('PASS');
      expect(fixtures.calls.some((call) => call.url.includes('/importparts/'))).toBe(true);
    }
  });

  it('accepts an explicit listUrl from an unrelated page', async () => {
    const fixtures = server();
    const { results } = await boot(fixtures, { listUrl: `/users/abo/partlists/${SCRATCH}/` }, () => 'TASK0', '/mocs/search/').promise;
    expect(verdicts(results).net).toBe('PASS');
  });

  it('names the page it refused when the URL is not a Part List', async () => {
    const fixtures = server();
    const { promise } = boot(fixtures, {}, () => 'TASK0', '/settings/api/');
    await expect(promise).rejects.toThrow(/this page \(\/settings\/api\/\) is not one of your Part Lists/);
    expect(posts(fixtures.calls)).toHaveLength(0);
  });

  it('scrapes box links by name and puts the rest out of scope (D6)', async () => {
    const { evidence } = await boot(server()).promise;
    expect([...evidence.scope.inScope].sort()).toEqual(['Bricks box (25 parts)', 'Technic box (30 parts)']);
    expect(evidence.scope.outOfScope).toContain('Ordered from Lego & Bricklink');
  });

  it('refuses a list that is not a scratch list, without writing', async () => {
    const fixtures = server({ listName: 'My bricks box' });
    const { promise } = boot(fixtures);
    await expect(promise).rejects.toThrow(/does not look like a scratch list/);
    expect(posts(fixtures.calls)).toHaveLength(0);
    expect([...fixtures.state]).toEqual(BASELINE);
  });

  it('stops at the typed gate without writing', async () => {
    const fixtures = server();
    const { promise } = boot(fixtures, {}, () => null);
    await expect(promise).rejects.toThrow(/aborted at the gate/);
    expect(posts(fixtures.calls)).toHaveLength(0);
    expect([...fixtures.state]).toEqual(BASELINE);
  });

  it('reports the drift it caused when a write cannot be undone', async () => {
    const fixtures = server();
    const real = fixtures.fetch;
    fixtures.fetch = async (url, init) => {
      // every Subtract is refused: cleanup can never succeed
      if (init?.body && init.body.get?.('action') === 'S') {
        return { status: 200, ok: true, text: async () => JSON.stringify({ status: 'error', html: 'no', renders: {} }), json: async () => ({}) };
      }
      return real(url, init);
    };
    const { results } = await boot(fixtures).promise;
    const net = results.find((result) => result.id === 'net');
    expect(net.verdict).toBe('CHECK');
    expect(net.summary).toMatch(/not undone/);
    expect(fixtures.state.get('48729b,0')).toBe(2);
  });
});

function swapToDom(form) {
  form.set('csrfmiddlewaretoken', CSRF);
  return form;
}
