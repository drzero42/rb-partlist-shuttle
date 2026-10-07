/**
 * Injected UI (spec §8). Everything is built with textContent, so list names
 * and server text are shown verbatim but never interpreted as HTML.
 */

const CSS = `
.rbps-panel{position:fixed;inset:5vh 10vw;z-index:10001;overflow:auto;padding:16px 20px;
  background:#fff;color:#222;border:1px solid #888;border-radius:6px;box-shadow:0 8px 32px #0006;font:14px/1.4 sans-serif}
.rbps-panel table{border-collapse:collapse;margin:4px 0 12px}
.rbps-panel td,.rbps-panel th{border:1px solid #ccc;padding:2px 8px;text-align:left}
.rbps-panel pre{white-space:pre-wrap;background:#f6f6f6;padding:8px}
.rbps-ok{color:#170}.rbps-fail{color:#b00;font-weight:600}
`;

/** Create an element: el('td', {}, 'text') or el('tr', {}, [children]). */
function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...[].concat(children));
  return node;
}

/** A button styled like the site's own (Rebrickable resets bare <button>s). */
const button = (text, onclick, icon) =>
  el('button', { type: 'button', className: 'rb-btn rb-btn--default', onclick }, [
    icon ? el('i', { className: `fa ${icon}` }) : '',
    icon && text ? ' ' : '',
    text,
  ]);

const table = (head, rows) =>
  el('table', {}, [el('tr', {}, head.map((h) => el('th', {}, h))), ...rows.map((r) => el('tr', {}, r.map((c) => el('td', {}, String(c)))))]);

/**
 * @param {{usedListName: string, onConsume: () => void, onReturn: () => void, onSettings: () => void}} opts
 */
export function injectButtons({ usedListName, onConsume, onReturn, onSettings }) {
  document.head.append(el('style', { textContent: CSS }));
  const settings = button('', onSettings, 'fa-cog');
  settings.title = 'Part List Shuttle settings';
  const buttons = [
    ' ',
    button(`Consume → ${usedListName}`, onConsume, 'fa-sign-out'),
    ' ',
    button(`Return ← ${usedListName}`, onReturn, 'fa-sign-in'),
    ' ',
    settings,
  ];
  // The parts section (and its Bulk Edit button) loads after the page, and can be
  // re-rendered later, so keep watching and re-attach whenever our buttons are gone.
  const attach = () => {
    const bulkEdit = document.querySelector('.js-bulk-edit[data-bulk_item_type="part"]');
    if (bulkEdit && !settings.isConnected) bulkEdit.after(...buttons);
  };
  new MutationObserver(attach).observe(document.body, { childList: true, subtree: true });
  attach();
}

/** §7.1 backup: save text as a file via Blob + <a download>. */
export function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  el('a', { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * A panel with a progress log, a preview and a close button.
 *
 * @param {string} title
 */
export function openPanel(title) {
  const log = el('div');
  const body = el('div');
  const panel = el('div', { className: 'rbps-panel' }, [
    Object.assign(button('Close', () => panel.remove()), { style: 'float:right' }),
    el('h3', {}, title),
    log,
    body,
  ]);
  document.body.append(panel);
  const line = (text, className = '') => log.append(el('div', { className }, text));

  return {
    log: (text) => line(text),
    ok: (text) => line(text, 'rbps-ok'),
    fail: (text) => log.append(el('pre', { className: 'rbps-fail' }, text)),

    /**
     * §6.3 preview. Re-plans whenever a question is answered. Resolves with the
     * final plan on confirm, or null on cancel.
     *
     * @param {{plan: () => any, answers: Map<string, string>, nameOf: (id: string) => string,
     *   questionText: (key: string) => string, notes: string[]}} opts
     */
    preview({ plan, answers, nameOf, questionText, notes }) {
      return new Promise((resolve) => {
        // Answered questions drop out of the plan; keep showing them so they stay changeable.
        const asked = new Map();
        const render = () => {
          const current = plan();
          const parts = [el('ul', {}, notes.map((n) => el('li', {}, n)))];
          if (current.offenders.length) {
            parts.push(
              el('p', { className: 'rbps-fail' }, 'Not enough parts, so nothing will be written:'),
              table(['Part', 'Color', 'Needed', 'Available'], current.offenders.map((o) => [o.part, o.color, o.qty, o.available])),
            );
          }
          for (const q of current.questions) asked.set(q.key, q);
          for (const q of asked.values()) {
            const select = el('select', { onchange: () => (select.value ? answers.set(q.key, select.value) : answers.delete(q.key), render()) }, [
              el('option', { value: '' }, 'Choose a Part List…'),
              ...q.candidates.map((c) => el('option', { value: c.listId }, `${nameOf(c.listId)} (${c.count})`)),
            ]);
            select.value = answers.get(q.key) ?? '';
            parts.push(el('p', {}, [`${questionText(q.key)}: `, select]));
          }
          for (const w of current.writes) {
            const total = w.rows.reduce((sum, r) => sum + r.qty, 0);
            const verb = w.action === 'S' ? 'Subtract from' : 'Append to';
            parts.push(
              el('details', {}, [
                el('summary', {}, `${verb} ${nameOf(w.listId)}: ${w.rows.length} lines, ${total} parts`),
                table(['Part', 'Color', 'Qty'], w.rows.map((r) => [r.part, r.color, r.qty])),
              ]),
            );
          }
          const done = (result) => (body.replaceChildren(), resolve(result));
          if (current.ready) {
            const changing = [...new Set(current.writes.map((w) => w.listId))].map(nameOf).join(', ');
            parts.push(
              el('p', {}, [
                el('strong', {}, 'Backups: '),
                `confirming first downloads a CSV backup of each list that will change (${changing}) ` +
                  "to your browser's download folder. To undo, open a list and use Import → Replace with its backup.",
              ]),
            );
          }
          parts.push(
            el('p', {}, [
              current.ready ? button('Back up and write', () => done(current), 'fa-check') : '',
              ' ',
              button('Cancel', () => done(null)),
            ]),
          );
          body.replaceChildren(...parts);
        };
        render();
      });
    },
  };
}
