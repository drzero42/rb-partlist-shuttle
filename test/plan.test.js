import { describe, expect, it } from 'vitest';
import { classifyLists, diffParts, expectedAfter, importProblem, partListName, planConsume, planReturn } from '../src/plan.js';

const config = { usedListName: 'Used for MOCs', boxNamePattern: '\\bbox(?:es)?\\b' };
const r = (part, color, qty) => ({ part, color, qty });
const list = (id, name) => ({ id, name });

const plates = { list: list('1', 'Small storage boxes'), rows: [r('3023', '1', 6), r('3022', '1', 4)] };
const bars = { list: list('2', 'Big storage boxes'), rows: [r('48729b', '0', 5), r('3700', '0', 8)] };
const used = { list: list('9', 'Used for MOCs'), rows: [r('3023', '1', 4), r('48729b', '0', 2)] };

describe('classifyLists', () => {
  const lists = [list('1', 'Small storage boxes'), list('9', 'Used for MOCs'), list('5', 'Bag'), list('6', 'Matchbox cars')];

  it('splits used list, box lists and the rest by name', () => {
    expect(classifyLists(lists, config)).toEqual({
      used: lists[1],
      boxes: [lists[0]],
      others: [lists[2], lists[3]],
    });
  });

  it('refuses when the used list is missing', () => {
    expect(() => classifyLists(lists.slice(0, 1), config)).toThrow(/Used for MOCs/);
  });

  it('refuses an invalid pattern instead of matching everything', () => {
    expect(() => classifyLists(lists, { ...config, boxNamePattern: '(' })).toThrow();
  });
});

describe('planConsume', () => {
  it('subtracts from the holding box, then appends to the used list', () => {
    const plan = planConsume({ moc: [r('3023', '1', 2), r('3023', '1', 1), r('3700', '0', 8)], boxes: [plates, bars], used });
    expect(plan.ready).toBe(true);
    expect(plan.writes).toEqual([
      { listId: '1', action: 'S', rows: [r('3023', '1', 3)] },
      { listId: '2', action: 'S', rows: [r('3700', '0', 8)] },
      { listId: '9', action: 'A', rows: [r('3023', '1', 3), r('3700', '0', 8)] },
    ]);
  });

  it('writes nothing when a row is missing or short', () => {
    const plan = planConsume({ moc: [r('3023', '1', 7), r('9999', '0', 1)], boxes: [plates, bars], used });
    expect(plan.ready).toBe(false);
    expect(plan.writes).toEqual([]);
    expect(plan.offenders).toEqual([
      { ...r('3023', '1', 7), available: 6 },
      { ...r('9999', '0', 1), available: 0 },
    ]);
  });

  it('never pulls from the used list', () => {
    const plan = planConsume({ moc: [r('3023', '1', 7)], boxes: [plates], used });
    expect(plan.offenders).toEqual([{ ...r('3023', '1', 7), available: 6 }]);
  });

  it('matches exact ids only, no mold fallback', () => {
    const plan = planConsume({ moc: [r('48729a', '0', 1)], boxes: [bars], used });
    expect(plan.offenders).toEqual([{ ...r('48729a', '0', 1), available: 0 }]);
  });

  it('asks when a row sits in two boxes, and follows the answer', () => {
    const misfiled = { list: list('3', 'Sorting boxes'), rows: [r('3023', '1', 1)] };
    const input = { moc: [r('3023', '1', 2)], boxes: [plates, misfiled], used };
    const asked = planConsume(input);
    expect(asked.ready).toBe(false);
    expect(asked.questions).toEqual([
      { key: '3023,1', candidates: [{ listId: '1', count: 6 }, { listId: '3', count: 1 }] },
    ]);

    expect(planConsume({ ...input, answers: new Map([['3023,1', '1']]) }).writes[0]).toEqual({
      listId: '1',
      action: 'S',
      rows: [r('3023', '1', 2)],
    });
    expect(planConsume({ ...input, answers: new Map([['3023,1', '3']]) }).offenders).toEqual([
      { ...r('3023', '1', 2), available: 1 },
    ]);
  });
});

describe('planReturn', () => {
  const categoryOf = new Map([
    ['3023', '14'],
    ['3022', '14'],
    ['48729b', '32'],
    ['3700', '8'],
    ['3001', '11'],
  ]);

  it('routes by category, subtracting from the used list first', () => {
    const moc = [r('3023', '1', 4), r('48729b', '0', 2)];
    const plan = planReturn({ moc, boxes: [plates, bars], used, categoryOf });
    expect(plan.ready).toBe(true);
    expect(plan.writes).toEqual([
      { listId: '9', action: 'S', rows: moc },
      { listId: '1', action: 'A', rows: [r('3023', '1', 4)] },
      { listId: '2', action: 'A', rows: [r('48729b', '0', 2)] },
    ]);
  });

  it('routes a part no box holds any more via its category', () => {
    const emptied = { ...plates, rows: [r('3022', '1', 4)] };
    const plan = planReturn({ moc: [r('3023', '1', 4)], boxes: [emptied, bars], used, categoryOf });
    expect(plan.writes.at(-1)).toEqual({ listId: '1', action: 'A', rows: [r('3023', '1', 4)] });
  });

  it('writes nothing when the used list holds too few', () => {
    const plan = planReturn({ moc: [r('3023', '1', 5)], boxes: [plates], used, categoryOf });
    expect(plan.offenders).toEqual([{ ...r('3023', '1', 5), available: 4 }]);
    expect(plan.writes).toEqual([]);
  });

  it('asks per category when it is in several boxes or none', () => {
    const stray = { list: list('3', 'Sorting boxes'), rows: [r('3022', '1', 1)] };
    const moc = [r('3023', '1', 4), r('48729b', '0', 2)];
    const plan = planReturn({ moc, boxes: [plates, stray], used, categoryOf });
    expect(plan.ready).toBe(false);
    expect(plan.questions).toEqual([
      { key: 'category:14', candidates: [{ listId: '1', count: 2 }, { listId: '3', count: 1 }] },
      { key: 'category:32', candidates: [{ listId: '1', count: 0 }, { listId: '3', count: 0 }] },
    ]);

    const answers = new Map([
      ['category:14', '1'],
      ['category:32', '3'],
    ]);
    expect(planReturn({ moc, boxes: [plates, stray], used, categoryOf, answers }).writes.slice(1)).toEqual([
      { listId: '1', action: 'A', rows: [r('3023', '1', 4)] },
      { listId: '3', action: 'A', rows: [r('48729b', '0', 2)] },
    ]);
  });

  it('asks per part when the catalogue does not know it', () => {
    const odd = { ...used, rows: [r('x999', '0', 1)] };
    const plan = planReturn({ moc: [r('x999', '0', 1)], boxes: [plates], used: odd, categoryOf });
    expect(plan.questions.map((q) => q.key)).toEqual(['part:x999']);
  });
});

describe('post-write verification', () => {
  const before = [r('3023', '1', 6), r('3022', '1', 4)];

  it('computes the list after an append or subtract', () => {
    expect(expectedAfter(before, [r('3023', '1', 6)], 'S')).toEqual([r('3022', '1', 4)]);
    expect(expectedAfter(before, [r('3023', '1', 1), r('3001', '4', 2)], 'A')).toEqual([
      r('3023', '1', 7),
      r('3022', '1', 4),
      r('3001', '4', 2),
    ]);
  });

  it('reports a rewritten id even when the totals match', () => {
    const expected = [r('4592', '1', 1), r('4593', '0', 1)];
    const actual = [r('298c02', '1', 2)];
    expect(diffParts(expected, actual)).toEqual([
      { part: '4592', color: '1', expected: 1, actual: 0 },
      { part: '4593', color: '0', expected: 1, actual: 0 },
      { part: '298c02', color: '1', expected: 0, actual: 2 },
    ]);
    expect(diffParts(before, [...before].reverse())).toEqual([]);
  });
});

describe('importProblem', () => {
  const ok = { status: 'success', html: 'Using settings: Fix Molds = False<br>Imported 2 parts' };

  it('accepts a clean response', () => {
    expect(importProblem(ok)).toBeNull();
  });

  it('rejects a failed status, with the server text', () => {
    expect(importProblem({ status: 'error', msg: 'Part 9999 not found' })).toMatch(/Part 9999 not found/);
  });

  it('rejects a response without the Fix Molds = False echo', () => {
    expect(importProblem({ status: 'success', html: 'Using settings: Fix Molds = True' })).toMatch(/Fix Molds/);
  });

  it('rejects a server-side id change', () => {
    const html = `${ok.html}<br>Warnings x1 (some parts were CHANGED during import): Merging 1 x part 4592`;
    expect(importProblem({ status: 'success', html })).toMatch(/CHANGED during import/);
  });
});

it('partListName strips the part count the index page appends', () => {
  expect(partListName('Used for MOCs (6 parts)')).toBe('Used for MOCs');
  expect(partListName('Big storage boxes (10,180 parts)')).toBe('Big storage boxes');
  expect(partListName('Bag (1 part)')).toBe('Bag');
  expect(partListName('Lists (old) ')).toBe('Lists (old)');
  expect(partListName('\n  Used for MOCs\n  (6\n parts)\n')).toBe('Used for MOCs');
});
