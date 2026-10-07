/**
 * Pure planning (spec §3, §6, §7.4). No network, no DOM, no GM_*.
 *
 * A plan is { ready, offenders, questions, writes }. `writes` is empty unless
 * `ready`: any offender (missing/short, D8) or unanswered question (D11) means
 * zero writes. Writes are ordered subtracts first, then appends (§7.2).
 */

/** @typedef {import('./csv.js').PartRow} PartRow */
/** @typedef {{id: string, name: string}} RbList */
/** @typedef {{list: RbList, rows: PartRow[]}} Contents */

const keyOf = (row) => `${row.part},${row.color}`;

/** Sum rows by exact (Part, Color), keeping first-seen order. */
function totals(rows) {
  const map = new Map();
  for (const row of rows) {
    const seen = map.get(keyOf(row));
    if (seen) seen.qty += row.qty;
    else map.set(keyOf(row), { ...row });
  }
  return map;
}

/**
 * D4/D5: by name only. Throws on a missing/duplicate used list or a bad pattern.
 *
 * @param {RbList[]} lists
 * @param {{usedListName: string, boxNamePattern: string}} config
 */
export function classifyLists(lists, config) {
  const pattern = new RegExp(config.boxNamePattern, 'i');
  const usedLists = lists.filter((l) => l.name === config.usedListName);
  if (usedLists.length !== 1) {
    throw new Error(`expected exactly one Part List named "${config.usedListName}", found ${usedLists.length}`);
  }
  const used = usedLists[0];
  const rest = lists.filter((l) => l !== used);
  return {
    used,
    boxes: rest.filter((l) => pattern.test(l.name)),
    others: rest.filter((l) => !pattern.test(l.name)),
  };
}

/** Finish a plan: drop writes unless nothing blocks it. */
function finish(offenders, questions, writes) {
  const ready = offenders.length === 0 && questions.length === 0;
  return { ready, offenders, questions, writes: ready ? writes.filter((w) => w.rows.length) : [] };
}

/** Group routed rows into one append/subtract per box, in box order. */
function boxWrites(boxes, routed, action) {
  return boxes.map(({ list }) => ({
    listId: list.id,
    action,
    rows: routed.filter((x) => x.listId === list.id).map((x) => x.row),
  }));
}

/**
 * §6.1 Consume: box lists → used list. Never draws from the used list (D9).
 *
 * @param {{moc: PartRow[], boxes: Contents[], used: Contents, answers?: Map<string, string>}} input
 */
export function planConsume({ moc, boxes, used, answers = new Map() }) {
  const boxTotals = boxes.map((b) => ({ listId: b.list.id, held: totals(b.rows) }));
  const offenders = [];
  const questions = [];
  const routed = [];
  for (const [key, row] of totals(moc)) {
    const holders = boxTotals.filter((b) => b.held.has(key));
    let source = holders.length === 1 ? holders[0] : boxTotals.find((b) => b.listId === answers.get(key));
    if (!source && holders.length > 1) {
      questions.push({ key, candidates: holders.map((b) => ({ listId: b.listId, count: b.held.get(key).qty })) });
      continue;
    }
    const available = source?.held.get(key)?.qty ?? 0;
    if (available < row.qty) offenders.push({ ...row, available });
    else routed.push({ listId: source.listId, row });
  }
  const writes = [...boxWrites(boxes, routed, 'S'), { listId: used.list.id, action: 'A', rows: routed.map((x) => x.row) }];
  return finish(offenders, questions, writes);
}

/**
 * §6.2 Return: used list → box lists, routed by category (§3).
 *
 * @param {{moc: PartRow[], boxes: Contents[], used: Contents, categoryOf: Map<string, string>, answers?: Map<string, string>}} input
 */
export function planReturn({ moc, boxes, used, categoryOf, answers = new Map() }) {
  // category → listId → number of distinct parts of that category in the box
  const counts = new Map();
  for (const box of boxes) {
    for (const part of new Set(box.rows.map((row) => row.part))) {
      const category = categoryOf.get(part);
      if (category === undefined) continue;
      if (!counts.has(category)) counts.set(category, new Map());
      const perBox = counts.get(category);
      perBox.set(box.list.id, (perBox.get(box.list.id) ?? 0) + 1);
    }
  }

  const inUse = totals(used.rows);
  const offenders = [];
  const questions = new Map();
  const routed = [];
  for (const [key, row] of totals(moc)) {
    const available = inUse.get(key)?.qty ?? 0;
    if (available < row.qty) {
      offenders.push({ ...row, available });
      continue;
    }
    const category = categoryOf.get(row.part);
    const perBox = counts.get(category) ?? new Map();
    const questionKey = category === undefined ? `part:${row.part}` : `category:${category}`;
    const destination = perBox.size === 1 ? [...perBox.keys()][0] : answers.get(questionKey);
    if (destination !== undefined) routed.push({ listId: destination, row });
    else if (!questions.has(questionKey)) {
      questions.set(questionKey, {
        key: questionKey,
        candidates: boxes.map(({ list }) => ({ listId: list.id, count: perBox.get(list.id) ?? 0 })),
      });
    }
  }
  const writes = [{ listId: used.list.id, action: 'S', rows: [...totals(moc).values()] }, ...boxWrites(boxes, routed, 'A')];
  return finish(offenders, [...questions.values()], writes);
}

/**
 * §7.4: what a list must contain after one write.
 *
 * @param {PartRow[]} before
 * @param {PartRow[]} rows
 * @param {'A'|'S'} action
 */
export function expectedAfter(before, rows, action) {
  const after = totals(before);
  const sign = action === 'A' ? 1 : -1;
  for (const row of rows) {
    const seen = after.get(keyOf(row));
    if (seen) seen.qty += sign * row.qty;
    else after.set(keyOf(row), { ...row, qty: sign * row.qty });
  }
  return [...after.values()].filter((row) => row.qty !== 0);
}

/**
 * Every (Part, Color) whose quantity differs. Empty means the write verified.
 *
 * @param {PartRow[]} expected
 * @param {PartRow[]} actual
 */
export function diffParts(expected, actual) {
  const want = totals(expected);
  const got = totals(actual);
  const diffs = [];
  for (const [key, row] of new Map([...want, ...got])) {
    const e = want.get(key)?.qty ?? 0;
    const a = got.get(key)?.qty ?? 0;
    if (e !== a) diffs.push({ part: row.part, color: row.color, expected: e, actual: a });
  }
  return diffs;
}
