/**
 * Task 0 probe — automates spec §12, items 0.1–0.6, and prints a report.
 *
 * WHY THIS EXISTS: 0.2–0.6 are session reads/writes on rebrickable.com, so they
 * can only run in YOUR logged-in browser — and §12 forbids running them against
 * real boxes. This script runs them against one scratch Part List, pairs every
 * write with the matching undo, and refuses to start unless the list name looks
 * like a scratch list.
 *
 * HOW TO RUN
 *   1. Create a Part List named like `Task0 probe` and put a handful of parts in it.
 *   2. Open its Import page while logged in:
 *        https://rebrickable.com/users/<you>/partlists/<id>/importparts/
 *   3. DevTools → Console → paste this whole file, on ANY tab of that list (the
 *    probe fetches the Import page itself for its CSRF token). Then:
 *        __task0({ boxListIds: ['<one box id>'] })  // recommended: with 15 Part
 *                                                   // Lists, don't walk the sidebar
 *        __task0()                                  // full sidebar walk
 *        __task0({ apiKey: '<catalog key>' })       // also runs 0.1 via the v3 API
 *        __task0({ listUrl: '/users/<you>/partlists/<id>/' })  // run from elsewhere
 *
 * 0.5 (inc_spares) is DECLARED, not probed: this account tracks no spare parts,
 * so reading every box twice proves nothing — see §12 0.5.
 *   4. Type TASK0 at the gate, then paste the printed report back.
 *
 * Not bundled, not shipped: it lives in tools/, touches no userscript-manager
 * API at all, and makes same-origin `fetch` calls with `credentials: 'include'`
 * exactly like §4/§5.
 */

(() => {
  const DEFAULTS = {
    /** §12: never Task 0 against real boxes, so the list NAME must look scratch. */
    scratchPattern: /^(task\s*0|scratch|probe|test)/i,
    /** D6 as the product will implement it: only names matching this count as boxes. */
    boxNamePattern: /\bbox(?:es)?\b/i,
    delayMs: 400,
    backoffs: [1000, 2000, 4000],
    bigRows: 300,
    apiKey: '',
    /** Run from anywhere: point at the scratch list explicitly. */
    listUrl: '',
    /** 0.3 reads these box lists only — with 15 Part Lists, walking the sidebar is ~30 wasted GETs. */
    boxListIds: null,
    /** §12 0.5: this account has no spare parts, so the double read proves nothing. Opt in to compare one list anyway. */
    sparesCheck: false,
    /** D9/D10 pair: a mold-suffixed id and a plain one. */
    mold: ['48729b', '0', 2],
    plain: ['3005', '0', 2],
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const norm = (value) => String(value).trim().toLowerCase();
  const keyOf = ([part, color]) => `${part},${color}`;

  /** rbpartscsv as the site writes it: CRLF, `Part,Color,Quantity` header. */
  function toCsv(rows) {
    return ['Part,Color,Quantity']
      .concat(rows.map(([part, color, qty]) => `${part},${color},${qty}`))
      .join('\r\n')
      .concat('\r\n');
  }

  const decodeEntities = (value) =>
    String(value)
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

  function parseCsv(text) {
    const lines = String(text)
      .replace(/^/, '')
      .split(/\r\n|\r|\n/)
      .filter((line) => line.trim() !== '');
    const head = (lines.shift() || '').trim();
    if (norm(head) !== 'part,color,quantity') throw new Error(`unexpected csv header: ${head}`);
    return lines.map((line) => line.split(',').map((cell) => cell.trim()));
  }

  window.__task0 = async (options = {}) => {
    const cfg = { ...DEFAULTS, ...options };
    const results = [];
    const evidence = {};
    const log = (...args) => console.log('[task0]', ...args);

    function record(id, verdict, summary, extra) {
      results.push({ id, verdict, summary });
      if (extra !== undefined) evidence[id] = extra;
      log(`${id} ${verdict} — ${summary}`);
    }

    /* ---- plumbing ---- */
    async function request(url, init = {}) {
      for (let attempt = 0; ; attempt++) {
        const response = await fetch(url, { credentials: 'include', ...init });
        if (response.status === 429 && attempt < cfg.backoffs.length) {
          log(`429 on ${url} — backing off ${cfg.backoffs[attempt]}ms`);
          await sleep(cfg.backoffs[attempt]);
          continue;
        }
        return response;
      }
    }

    async function importParts(action, rows, token, label) {
      const form = new FormData();
      form.set('csrfmiddlewaretoken', token);
      form.set('action', action);
      form.set('import_url', '');
      form.set('external_source', 'RB');
      // fix_molds is deliberately ABSENT (D9). Asserted, not assumed.
      if ([...form.keys()].includes('fix_molds')) throw new Error('fix_molds leaked into the form');
      form.set('file', new Blob([toCsv(rows)], { type: 'text/csv' }), `${label}.csv`);

      const started = Date.now();
      const response = await request(`/users/${user}/partlists/${listId}/importparts/slow/`, {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        body: form,
      });
      const text = await response.text();
      await sleep(cfg.delayMs);

      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* HTML/403 instead of JSON — itself a finding for 0.4 */
      }
      return {
        label,
        action,
        rows: rows.length,
        httpStatus: response.status,
        ms: Date.now() - started,
        status: json?.status,
        ok: json?.status === 'success' && response.status === 200,
        keys: json ? Object.keys(json) : null,
        renderKeys: json?.renders ? Object.keys(json.renders) : null,
        partsCount: json?.renders?.['#parts_count'],
        catAttributes: ((json?.html || '').match(/data-part_cat_(?:id|name)/g) || []).length,
        html: json?.html ? json.html.replace(/\s+/g, ' ').slice(0, 300) : null,
        notJson: json ? null : text.replace(/\s+/g, ' ').slice(0, 160),
      };
    }

    /**
     * `undo` holds appends that have NOT yet been reversed. Append through
     * `append()` and it registers itself; an explicit Subtract that already
     * reversed an append must call `markUndone()`, so cleanup never double-subtracts.
     */
    const undo = [];
    async function append(rows, token, label) {
      const out = await importParts('A', rows, token, label);
      if (out.ok) undo.push({ label, rows });
      return out;
    }
    function markUndone(label) {
      const index = undo.findIndex((entry) => entry.label === label);
      if (index !== -1) undo.splice(index, 1);
    }
    async function undoAll() {
      for (const entry of undo.slice().reverse()) {
        try {
          const out = await importParts('S', entry.rows, csrf, `undo-${entry.label}`);
          log(`undo ${entry.label}: http ${out.httpStatus} status ${out.status}`);
          if (out.ok) markUndone(entry.label);
        } catch (error) {
          log(`undo ${entry.label} THREW — inspect "${listName}" by hand: ${error.message}`);
        }
      }
      const left = undo.length;
      if (left) log(`${left} write(s) could not be undone — clean "${listName}" manually`);
      return left;
    }

    /* ---- which list? any tab of it will do (§12.1) ---- */
    // Demanding the exact Import URL made the runbook brittle: one wrong tab and
    // the probe refused. Accept any /users/<u>/partlists/<id>/… page (or an
    // explicit listUrl) and FETCH the Import page for its CSRF token.
    const listTarget = (value) => {
      const match = new URL(value, location.href).pathname.match(
        /^\/users\/([^/]+)\/partlists\/(\d+)(?:\/.*)?$/,
      );
      return match ? { user: decodeURIComponent(match[1]), listId: match[2] } : null;
    };
    const target = (cfg.listUrl ? listTarget(cfg.listUrl) : null) || listTarget(location.pathname);
    if (!target) {
      throw new Error(
        `this page (${location.pathname}) is not one of your Part Lists — open ` +
          "/users/<you>/partlists/<id>/ (any tab works) or pass { listUrl: '…' }",
      );
    }
    const { user, listId } = target;
    const importPageUrl = `/users/${user}/partlists/${listId}/importparts/`;
    const cookieToken = (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || '';

    const readScratch = async () => {
      const response = await request(`/users/${user}/partlists/${listId}/parts/?format=rbpartscsv&inc_spares=0`);
      if (!response.ok) throw new Error(`read ${response.status} ${response.statusText}`);
      return parseCsv(await response.text());
    };

    /* ---- scratch-list guard (§12) ---- */
    const page = await (await request(`/users/${user}/partlists/${listId}/`)).text();
    const importHtml = await (await request(importPageUrl)).text();
    const csrf =
      (importHtml.match(/name=["']csrfmiddlewaretoken["']\s+value=["']([^"']+)["']/i) ||
        importHtml.match(/value=["']([^"']+)["']\s+name=["']csrfmiddlewaretoken["']/i) ||
        [])[1] || '';
    if (!csrf) throw new Error(`no csrfmiddlewaretoken on ${importPageUrl} — logged in? list exists?`);
    const listName =
      ((page.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    evidence.target = { user, listId, listName };
    if (!listName) throw new Error('could not read the list name from the page — refusing to write blind');
    log(`target: "${listName}" (#${listId}) as ${user}`);
    if (!cfg.scratchPattern.test(listName)) {
      throw new Error(`"${listName}" does not look like a scratch list — rename it to "Task0 …" (§12)`);
    }
    // no separate staging check: the scratch-pattern gate above already rejects any
    // name the staging list could have, and the probe hardcodes no staging name (§16.1).
    if (window.__task0Ran === listId) throw new Error('this list was already probed this page load — reload first');

    const gate = window.prompt(
      `Writing to "${listName}" (#${listId}) as ${user}.\n` +
        'Appends are subtracted again at the end; box lists are only READ.\n\nType TASK0 to continue.',
    );
    if (gate !== 'TASK0') throw new Error('aborted at the gate — nothing was written');
    window.__task0Ran = listId;

    const baseline = await readScratch();
    const baselineIds = new Set(baseline.map(([part]) => norm(part)));
    evidence.baseline = { rows: baseline.length, ids: baseline.map(keyOf).slice(0, 8) };

    let abort = null;
    try {
      /* ---- 0.4 CSRF on POST: DOM token, token reuse, cookie token ---- */
      const fixture = [cfg.mold, cfg.plain];
      const first = await append(fixture, csrf, '0.4-dom-first');
      const reused = await append([cfg.plain], csrf, '0.4-dom-second');
      const cookie = cookieToken ? await append([cfg.plain], cookieToken, '0.4-cookie') : null;

      if (cookie?.ok) {
        record(
          '0.4',
          'CHECK',
          'the csrftoken COOKIE was accepted by the import POST — §5.2 says read the token from the DOM, not the cookie; re-verify before implementing',
          { domFirst: first, domReuse: reused, cookie },
        );
      } else {
        record(
          '0.4',
          first.ok && reused.ok ? 'PASS' : 'FAIL',
          `DOM token ${first.ok ? 'accepted' : `rejected (${first.httpStatus}${first.notJson ? ', not JSON' : ''})`}; ` +
            `same token reused ${reused.ok ? 'ok' : `rejected (${reused.httpStatus})`} — ` +
            (cookie
              ? 'cookie token rejected as expected (Django masked), one page load is enough for a whole run'
              : 'no csrftoken cookie visible, so masking was not tested'),
          { domFirst: first, domReuse: reused, cookie, sameTokenMasked: csrf !== cookieToken },
        );
      }

      /* ---- 0.2 fix_molds OFF / 0.6 part-id exactness ---- */
      const after = await readScratch();
      // Look for the ids ANYWHERE in the read-back, not only in rows the writes
      // added: the scratch list may already contain the plain test part, and a
      // probe that only sees "new" rows would report FAIL against a healthy server.
      const find = (id) => after.find(([part]) => norm(part) === norm(id));
      const moldRow = find(cfg.mold[0]);
      const plainRow = find(cfg.plain[0]);
      const prefix = norm(cfg.mold[0]).slice(0, 5);
      const rewritten = after.filter(
        ([part]) => norm(part).startsWith(prefix) && norm(part) !== norm(cfg.mold[0]) && !baselineIds.has(norm(part)),
      );
      const literal = Boolean(moldRow && plainRow) && moldRow[0] === cfg.mold[0] && moldRow[1] === cfg.mold[1];

      record(
        '0.2',
        literal && !rewritten.length ? 'PASS' : 'FAIL',
        literal && !rewritten.length
          ? `omitting fix_molds keeps ids literal: appended ${cfg.mold[0]},${cfg.mold[1]} and it reads back as ${JSON.stringify(moldRow)}`
          : `part numbers were rewritten even with fix_molds absent: ${cfg.mold[0]} → ${JSON.stringify(moldRow || rewritten[0] || null)}. ` +
            'Find the explicit OFF value (§12 0.2) — do NOT ship silent merging.',
        { appended: cfg.mold, readBack: moldRow || null, rewrittenTo: rewritten, readBackIds: after.map(keyOf).slice(0, 12) },
      );

      // Re-read the rendered page: the appends above must be visible there, with
      // their literal ids, for the HTML category fallback (§4.4) to be usable.
      const pageAfter = await (await request(`/users/${user}/partlists/${listId}/`)).text();
      const htmlHasMoldId = pageAfter.includes(cfg.mold[0]);
      const pageAttributes = (pageAfter.match(/data-part_cat_(?:id|name)/g) || []).length;

      const sentKeys = [keyOf(cfg.mold), keyOf(cfg.plain)].sort();
      const gotKeys = [moldRow, plainRow].filter(Boolean).map(keyOf).sort();
      const byteExact = sentKeys.join('|') === gotKeys.join('|');
      record(
        '0.6',
        byteExact && literal ? 'PASS' : 'CHECK',
        `sent ${sentKeys.join(' + ')} ↔ exported ${gotKeys.join(' + ') || 'nothing'}; byte-identical=${byteExact}; ` +
          `mold id appears literally in the rendered list page=${htmlHasMoldId}`,
        { sent: sentKeys, exported: gotKeys, htmlContainsMoldId: htmlHasMoldId, listPageAttributes: pageAttributes },
      );

      /* ---- 0.1 categories: v3 API (needs a key) and the HTML fallback ---- */
      const renderProbe = await append([cfg.plain], csrf, '0.1-render');
      if (!cfg.apiKey) {
        record(
          '0.1',
          'SKIP',
          `no apiKey passed, so the v3 field shape is unverified. HTML fallback: ${pageAttributes} data-part_cat_* hits on the list page, ` +
            `${renderProbe.catAttributes} inside the import response's renders html — rerun with __task0({ apiKey }) to test the API path`,
          { apiKey: 'not supplied', listPageAttributes: pageAttributes, importHtmlAttributes: renderProbe.catAttributes },
        );
      } else {
        const response = await request(
          `/api/v3/lego/parts/?part_nums=3001,${cfg.mold[0]}&inc_part_details=1&key=${encodeURIComponent(cfg.apiKey)}`,
        );
        const body = await response.json().catch(() => null);
        const items = body?.results || [];
        const complete = items.length > 0 && items.every((item) => 'part_cat_id' in item && 'part_cat_name' in item);
        const moldServed = items.some((item) => norm(item.part_num) === norm(cfg.mold[0]));
        record(
          '0.1',
          complete ? 'PASS' : 'FAIL',
          `v3 http ${response.status}, ${items.length}/${body?.count ?? '?'} items, part_cat_id+part_cat_name present=${complete}; ` +
            `mold id ${cfg.mold[0]} served by the catalog=${moldServed} (${moldServed ? 'so ids exist upstream' : 'so mold ids are list-local only — D9/D10'}); ` +
            `HTML fallback: ${pageAttributes} page / ${renderProbe.catAttributes} import-response attributes`,
          {
            items: items.map(({ part_num, part_cat_id, part_cat_name }) => ({ part_num, part_cat_id, part_cat_name })),
            listPageAttributes: pageAttributes,
            importHtmlAttributes: renderProbe.catAttributes,
            moldServed,
            httpStatus: response.status,
            count: body?.count,
            error: body && !items.length ? body : null,
          },
        );
      }

      /* ---- 0.3 large-import shape, sourced read-only from a real box ---- */
      const boxLinks = new Map();
      const outOfScope = [];
      if (cfg.boxListIds?.length) {
        for (const id of cfg.boxListIds) {
          if (String(id) !== listId) boxLinks.set(String(id), `#${id}`);
        }
      } else {
        // Scrape the sidebar out of the fetched HTML, so the probe behaves the
        // same whichever page it was pasted on.
        for (const anchor of page.matchAll(/href=["']\/users\/[^/]+\/partlists\/(\d+)\/?[^"']*["'][^>]*>([^<]{1,120})</gi)) {
          const [, id, raw] = anchor;
          if (id === listId || !raw.trim()) continue;
          const name = decodeEntities(raw).replace(/\s+/g, ' ').trim();
          // D6 fail-closed: a list this probe cannot recognise as a box is not a
          // source, even though reading it would be harmless.
          if (cfg.boxNamePattern.test(name)) boxLinks.set(id, name);
          else if (!outOfScope.includes(name)) outOfScope.push(name);
        }
      }

      let largest = [];
      for (const [id, name] of boxLinks) {
        const rows = await (
          await request(`/users/${user}/partlists/${id}/parts/?format=rbpartscsv&inc_spares=0`)
        )
          .text()
          .then(parseCsv);
        if (rows.length > largest.length) largest = rows;
        await sleep(cfg.delayMs);
      }

      evidence.scope = { inScope: [...boxLinks.values()], outOfScope };
      if (largest.length < 20) {
        record(
          '0.3',
          'SKIP',
          `no box list in scope has ≥20 rows (largest ${largest.length}); in scope: ${boxLinks.size}` +
            (outOfScope.length ? `, out of scope by name: ${outOfScope.join(', ')}` : '') +
            ' — if a real box is missing, its name does not match boxNamePattern (D6)',
        );
      } else {
        const rows = largest.slice(0, cfg.bigRows).map(([part, color]) => [part, color, 1]);
        const before = (await readScratch()).length;
        const bigAppend = await append(rows, csrf, '0.3-large');
        const mid = (await readScratch()).length;
        const bigSubtract = await importParts('S', rows, csrf, '0.3-large-subtract');
        if (bigSubtract.ok) markUndone('0.3-large');
        const afterBig = (await readScratch()).length;
        const multiStep = [...(bigAppend.keys || []), ...(bigSubtract.keys || [])].some((key) =>
          /confirm|progress|task|redirect|poll|async|job/i.test(key),
        );
        record(
          '0.3',
          bigAppend.ok && bigSubtract.ok && !multiStep ? 'PASS' : 'CHECK',
          `${rows.length} rows: append ${bigAppend.httpStatus}/${bigAppend.status} in ${bigAppend.ms}ms, ` +
            `subtract ${bigSubtract.httpStatus}/${bigSubtract.status} in ${bigSubtract.ms}ms; ` +
            `csv lines ${before}→${mid}→${afterBig}; response keys ${JSON.stringify(bigAppend.keys)}; multi-step markers=${multiStep}`,
          { rows: rows.length, append: bigAppend, subtract: bigSubtract, lines: { before, mid, after: afterBig } },
        );
      }

      /* ---- 0.5 inc_spares: declared, not probed, unless sparesCheck ---- */
      if (!cfg.sparesCheck) {
        record(
          '0.5',
          'DECLARED',
          'not probed — this account has no spare parts, so inc_spares=1 can only add rows that do not exist; ' +
            'default stays OFF per §4.2 (true box contents only). Pass { sparesCheck: true } to compare one box list anyway.',
        );
      } else {
        const [id] = boxLinks.keys();
        if (!id) {
          record('0.5', 'SKIP', 'no box list in scope to compare — pass { boxListIds: ["<id>"] } or use the sidebar walk');
        } else {
          const read = async (inc) =>
            parseCsv(await (await request(`/users/${user}/partlists/${id}/parts/?format=rbpartscsv&inc_spares=${inc}`)).text());
          const off = await read(0);
          const on = await read(1);
          const extra = on.filter((row) => !off.some((other) => keyOf(other) === keyOf(row)));
          await sleep(cfg.delayMs);
          record(
            '0.5',
            extra.length ? 'PASS' : 'CHECK',
            extra.length
              ? `inc_spares=1 adds ${extra.length} rows on list #${id} (${extra.slice(0, 5).map(keyOf).join(', ')}) → keep the default OFF`
              : `list #${id}: ${off.length} rows with and without the flag — consistent with no spares in this account`,
            { listId: id, off: off.length, on: on.length, extra: extra.slice(0, 5).map(keyOf) },
          );
        }
      }

    } catch (error) {
      abort = error;
      record('abort', 'FAIL', `probe stopped early: ${error.message} — cleanup ran anyway, read the report below`);
    }

    /* ---- cleanup, then net-zero: the drift check is only meaningful post-undo ---- */
    const unUndone = await undoAll();
    const finalRows = await readScratch().catch(() => null);
    if (!finalRows) {
      record('net', 'SKIP', `list could not be re-read after cleanup — check "${listName}" by hand`);
    } else {
      const drift = finalRows.length - baseline.length;
      record(
        'net',
        drift === 0 && !unUndone ? 'PASS' : 'CHECK',
        drift === 0 && !unUndone
          ? `scratch list is back to its ${baseline.length} baseline rows after ${cfg.delayMs}ms-paced sequential writes`
          : `list is ${drift > 0 ? '+' : ''}${drift} rows vs baseline${unUndone ? `, ${unUndone} write(s) not undone` : ''} — tidy "${listName}" by hand before trusting this run`,
        { baseline: baseline.length, final: finalRows.length, unUndone },
      );
    }

    /* ---- report ---- */
    const row = ({ id, verdict, summary }) => `| ${id} | ${verdict} | ${summary.replace(/\|/g, '\\|')} |`;
    const report =
      `### Task 0 — "${listName}" (#${listId}) as ${user}\n\n` +
      '| item | verdict | detail |\n|------|---------|--------|\n' +
      results.map(row).join('\n') +
      `\n\n\`\`\`json\n${JSON.stringify(evidence, null, 2)}\n\`\`\``;

    console.log(report);
    window.__task0Report = report;
    try {
      await navigator.clipboard.writeText(report);
      log('report copied to clipboard');
    } catch {
      log('clipboard blocked — copy console.log(__task0Report) output manually');
    }
    if (abort) throw abort;
    return { results, evidence };
  };

  console.log('[task0] probe loaded — run __task0() or __task0({ apiKey: "<read-only catalog key>" })');
})();
