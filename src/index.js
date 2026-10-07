/**
 * Entry point. Inert everywhere except a Custom List page (spec §8).
 * Flow per run (D13): read → plan → preview + confirm → backup → write + verify.
 */

import { loadCatalogue } from './catalog.js';
import { serializeParts } from './csv.js';
import { loadConfig, saveConfig } from './gm.js';
import { classifyLists, diffParts, expectedAfter, planConsume, planReturn } from './plan.js';
import { csrfToken, importParts, listPartLists, readParts } from './rb.js';
import { downloadText, injectButtons, openPanel } from './ui.js';

/**
 * @param {string} pathname
 * @returns {{username: string, listId: string}|null}
 */
export function matchCustomListPage(pathname) {
  const m = /^\/users\/([^/]+)\/lists\/(\d+)\/?$/.exec(pathname);
  return m ? { username: m[1], listId: m[2] } : null;
}

/**
 * @param {'consume'|'return'} direction
 * @param {{username: string, listId: string}} page
 */
async function run(direction, { username, listId }) {
  const ui = openPanel(direction === 'consume' ? 'Consume: boxes → used list' : 'Return: used list → boxes');
  try {
    const config = loadConfig();
    ui.log('Reading your Part Lists…');
    const lists = await listPartLists(username);
    const { used, boxes, others } = classifyLists(lists, config);
    const nameOf = (id) => lists.find((l) => l.id === id)?.name ?? id;

    ui.log('Reading this Custom List…');
    const moc = await readParts(username, 'lists', listId);
    const contents = new Map();
    for (const list of [used, ...boxes]) {
      ui.log(`Reading ${list.name}…`);
      contents.set(list.id, await readParts(username, 'partlists', list.id));
    }
    const input = {
      moc,
      used: { list: used, rows: contents.get(used.id) },
      boxes: boxes.map((list) => ({ list, rows: contents.get(list.id) })),
      answers: new Map(),
    };

    const notes = [`Box lists: ${boxes.map((l) => l.name).join(', ')}`, `Not boxes: ${others.map((l) => l.name).join(', ') || 'none'}`];
    let plan;
    let questionText;
    if (direction === 'consume') {
      plan = () => planConsume(input);
      questionText = (key) => `Part ${key.replace(',', ' colour ')} is in several box lists. Take it from`;
    } else {
      ui.log('Loading the parts catalogue…');
      const catalogue = await loadCatalogue();
      const categoryOf = new Map(Object.entries(catalogue.categoryOf));
      const hours = Math.round((Date.now() - catalogue.checkedAt) / 3600000);
      notes.push(`Catalogue checked ${hours} h ago${catalogue.error ? ` (refresh failed: ${catalogue.error})` : ''}`);
      plan = () => planReturn({ ...input, categoryOf });
      questionText = (key) =>
        key.startsWith('category:')
          ? `Category "${catalogue.categoryName[key.slice(9)] ?? key}" has no single box list (count = parts of it held). Return it to`
          : `Part ${key.slice(5)} is not in the catalogue. Return it to`;
    }

    const confirmed = await ui.preview({ plan, answers: input.answers, nameOf, questionText, notes });
    if (!confirmed) return ui.log('Cancelled. Nothing was written.');
    await apply(ui, username, confirmed.writes, contents, nameOf, used.id);
  } catch (error) {
    ui.fail(error.message);
  }
}

/** §7: backup, then each write in order, verified by re-reading before the next. */
async function apply(ui, username, writes, contents, nameOf, usedId) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const id of new Set(writes.map((w) => w.listId))) {
    downloadText(`rbps-${nameOf(id)}-${id}-${stamp}.csv`, serializeParts(contents.get(id)));
  }
  ui.log('Backups downloaded. Writing…');
  const token = await csrfToken(username, usedId);
  for (const [i, w] of writes.entries()) {
    const what = `${w.action === 'S' ? 'Subtract from' : 'Append to'} ${nameOf(w.listId)}`;
    try {
      ui.log(`${what} (${w.rows.length} lines; this can take a while)…`);
      await importParts({ username, listId: w.listId, action: w.action, rows: w.rows, token });
      const actual = await readParts(username, 'partlists', w.listId);
      const diff = diffParts(expectedAfter(contents.get(w.listId), w.rows, w.action), actual);
      if (diff.length) {
        throw new Error(`verification failed:\n${diff.map((d) => `${d.part} colour ${d.color}: expected ${d.expected}, found ${d.actual}`).join('\n')}`);
      }
      contents.set(w.listId, actual);
      ui.ok(`${what}: done and verified.`);
    } catch (error) {
      const pending = writes.slice(i + 1).map((p) => `${p.action === 'S' ? 'Subtract from' : 'Append to'} ${nameOf(p.listId)}`);
      ui.fail(
        `${what} stopped: ${error.message}\n\nNot done: ${[what, ...pending].join('; ')}\n` +
          'Restore from the downloaded backups (Import → Replace), or finish by hand.',
      );
      return;
    }
  }
  ui.ok('All writes done and verified.');
}

function settings() {
  const config = loadConfig();
  const usedListName = prompt('Exact name of the used list:', config.usedListName);
  if (usedListName === null) return;
  const boxNamePattern = prompt('Box list name pattern (regex, case-insensitive):', config.boxNamePattern);
  if (boxNamePattern === null) return;
  try {
    new RegExp(boxNamePattern, 'i');
  } catch (error) {
    return alert(`Invalid pattern, nothing saved: ${error.message}`);
  }
  saveConfig({ usedListName, boxNamePattern });
  alert('Saved. Reload the page to update the buttons.');
}

const page = typeof location !== 'undefined' && matchCustomListPage(location.pathname);
if (page) {
  injectButtons({
    usedListName: loadConfig().usedListName,
    onConsume: () => run('consume', page),
    onReturn: () => run('return', page),
    onSettings: settings,
  });
}
