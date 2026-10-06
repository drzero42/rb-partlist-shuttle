import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Scaffold invariants: the module surface, the AGENTS.md import rules, and the
 * spec constants that are frozen before any behaviour exists. These are the
 * guard rails the real csv.js/reconcile.js tests get built inside of.
 */

const SRC = new URL('../src/', import.meta.url);
const FIXTURES = new URL('./fixtures/', import.meta.url);

const MODULES = [
  'csv.js',
  'reconcile.js',
  'rb-read.js',
  'rb-write.js',
  'rb-category.js',
  'safety.js',
  'ui.js',
  'gm.js',
  'index.js',
];

const SURFACE = {
  'csv.js': ['CSV_HEADER', 'rowKey', 'parseRbPartsCsv', 'serializeRbPartsCsv', 'indexRows'],
  'reconcile.js': [
    'classifyLists',
    'buildCategoryBoxMap',
    'planConsume',
    'planReturn',
    'detectReapply',
    'groupWrites',
  ],
  'rb-read.js': [
    'DEFAULT_INC_SPARES',
    'exportUrl',
    'fetchPartsCsv',
    'fetchCustomListRows',
    'fetchPartListRows',
    'fetchPartLists',
    'scrapePartListsFromDom',
    'runSequentially',
    'delay',
  ],
  'rb-write.js': [
    'IMPORT_ACTION',
    'IMPORT_FIXED_FIELDS',
    'FORBIDDEN_FIELDS',
    'importUrl',
    'readCsrfToken',
    'buildImportForm',
    'parseImportResponse',
    'importParts',
  ],
  'rb-category.js': [
    'API_BATCH_SIZE',
    'API_PAGE_SIZE',
    'fetchCategoriesByApi',
    'scrapeCategoriesFromListPage',
    'parseCategoryDataFromHtml',
    'resolveCategories',
  ],
  'safety.js': [
    'backupFilename',
    'backupLists',
    'buildApplySteps',
    'runApplySteps',
    'diffAgainstPlan',
    'verifyWrite',
  ],
  'ui.js': [
    'CLASS_PREFIX',
    'matchCustomListPage',
    'buttonLabels',
    'injectShuttleButtons',
    'renderPreviewModal',
    'renderAmbiguityModal',
    'renderSettingsModal',
    'createProgressLog',
    'renderWarningsModal',
  ],
  'gm.js': [
    'MANAGER_API',
    'CONFIG_DEFAULTS',
    'configKeys',
    'getValue',
    'setValue',
    'loadConfig',
    'saveConfig',
    'addStyle',
    'download',
    'hasDownloadGrant',
  ],
  'index.js': ['runConsume', 'runReturn', 'main'],
};

/** Remove comments while leaving string/template literals intact. */
function stripComments(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      out += ' ';
      continue;
    }
    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        if (source[j] === c) {
          j += 1;
          break;
        }
        j += 1;
      }
      out += source.slice(i, j);
      i = j;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function code(moduleName) {
  return stripComments(readFileSync(new URL(moduleName, SRC), 'utf8'));
}

function specifiers(moduleName) {
  return [...code(moduleName).matchAll(/from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
    (m) => m[1] ?? m[2],
  );
}

describe('module surface', () => {
  for (const name of MODULES) {
    it(`${name} exports its documented contract`, async () => {
      const module = await import(new URL(name, SRC).href);
      expect(Object.keys(module).sort()).toEqual([...SURFACE[name]].sort());
    });
  }
});

describe('unimplemented stubs announce themselves', () => {
  it('csv.js', async () => {
    const csv = await import('../src/csv.js');
    expect(() => csv.rowKey('3001', '4')).toThrow(/^NotImplemented: /);
    expect(() => csv.parseRbPartsCsv('Part,Color,Quantity\n')).toThrow(/^NotImplemented: /);
    expect(() => csv.serializeRbPartsCsv([])).toThrow(/^NotImplemented: /);
    expect(() => csv.indexRows([])).toThrow(/^NotImplemented: /);
  });

  it('reconcile.js', async () => {
    const reconcile = await import('../src/reconcile.js');
    expect(() =>
      reconcile.classifyLists([], { stagingName: 'Used for MOCs', ignoreLists: [] }),
    ).toThrow(/^NotImplemented: /);
    expect(() => reconcile.planConsume({})).toThrow(/^NotImplemented: /);
    expect(() => reconcile.planReturn({})).toThrow(/^NotImplemented: /);
    expect(() => reconcile.groupWrites([])).toThrow(/^NotImplemented: /);
  });

  it('gm.js', async () => {
    const gm = await import('../src/gm.js');
    expect(() => gm.getValue('stagingName')).toThrow(/^NotImplemented: /);
    expect(() => gm.loadConfig()).toThrow(/^NotImplemented: /);
    expect(() => gm.addStyle('')).toThrow(/^NotImplemented: /);
  });

  it('rb-read.js', async () => {
    const rbRead = await import('../src/rb-read.js');
    expect(() => rbRead.exportUrl({ username: 'u', kind: 'lists', listId: 1 })).toThrow(
      /^NotImplemented: /,
    );
    await expect(rbRead.fetchPartsCsv({ username: 'u', kind: 'lists', listId: 1 })).rejects.toThrow(
      /^NotImplemented: /,
    );
  });

  it('rb-write.js', async () => {
    const rbWrite = await import('../src/rb-write.js');
    expect(() => rbWrite.readCsrfToken()).toThrow(/^NotImplemented: /);
    expect(() => rbWrite.buildImportForm({ action: 'A', csvText: '', csrfToken: 't' })).toThrow(
      /^NotImplemented: /,
    );
  });
});

describe('import rules (AGENTS.md)', () => {
  it('csv.js imports nothing', () => {
    const source = code('csv.js');
    expect(source).not.toMatch(/\bimport\b/);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(specifiers('csv.js')).toEqual([]);
  });

  it('reconcile.js imports only ./csv.js', () => {
    expect(specifiers('reconcile.js').filter((s) => s !== './csv.js')).toEqual([]);
  });

  it('only gm.js touches GM_*', async () => {
    const { GRANTS } = await import('../scripts/build.mjs');
    for (const name of MODULES) {
      const identifiers = [...code(name).matchAll(/\bGM_[A-Za-z][A-Za-z0-9_]*/g)].map((m) => m[0]);
      if (name === 'gm.js') {
        expect([...new Set(identifiers)].sort()).toEqual([...GRANTS].sort());
      } else {
        expect(identifiers, `${name} must not reference GM_* directly`).toEqual([]);
      }
    }
  });

  it('every src module is listed in the surface table', () => {
    const onDisk = readdirSync(SRC).filter((f) => f.endsWith('.js'));
    expect(onDisk.sort()).toEqual([...MODULES].sort());
  });
});

describe('frozen spec constants', () => {
  it('§9 config keys and defaults', async () => {
    const gm = await import('../src/gm.js');
    expect(gm.CONFIG_DEFAULTS).toEqual({
      stagingName: 'Used for MOCs',
      ignoreLists: [],
      categoryMode: 'api',
      apiKey: '',
      defaultDryRun: true,
    });
    expect(gm.configKeys().sort()).toEqual(Object.keys(gm.CONFIG_DEFAULTS).sort());
  });

  it('§5.2 import form fields — fix_molds is forbidden (D9)', async () => {
    const rbWrite = await import('../src/rb-write.js');
    expect(rbWrite.IMPORT_ACTION).toEqual({ APPEND: 'A', SUBTRACT: 'S' });
    expect(Object.values(rbWrite.IMPORT_ACTION)).not.toContain('R');
    expect(rbWrite.IMPORT_FIXED_FIELDS).toEqual({ import_url: '', external_source: 'RB' });
    expect(rbWrite.FORBIDDEN_FIELDS).toContain('fix_molds');
  });

  it('§4 read path defaults', async () => {
    const rbRead = await import('../src/rb-read.js');
    expect(rbRead.DEFAULT_INC_SPARES).toBe(false);
  });
});

describe('fixture CSVs are rbpartscsv (D3)', () => {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.csv'));

  it('the set is present', () => {
    expect(files.sort()).toEqual(
      [
        'box-bars.csv',
        'box-bricks.csv',
        'box-invariant-violation.csv',
        'box-plates.csv',
        'box-shortfall.csv',
        'custom-list-small-moc.csv',
        'export-crlf-trailing-blank.csv',
        'staging-used-for-mocs.csv',
      ].sort(),
    );
  });

  for (const file of files) {
    it(`${file}: header, three fields per row, positive integer quantity`, () => {
      const lines = readFileSync(new URL(file, FIXTURES), 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '');
      expect(lines[0]).toBe('Part,Color,Quantity');
      for (const line of lines.slice(1)) {
        const [part, color, quantity] = line.split(',');
        expect(line.split(',')).toHaveLength(3);
        expect(part).toMatch(/^\S+$/);
        expect(color).toMatch(/^\d+$/);
        expect(Number.isInteger(Number(quantity)) && Number(quantity) > 0).toBe(true);
      }
    });
  }

  it('pins the exactness fixtures the reconcile tests depend on', () => {
    const read = (file) =>
      readFileSync(new URL(file, FIXTURES), 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '')
        .slice(1);
    const moc = read('custom-list-small-moc.csv');
    const bars = read('box-bars.csv');
    const staging = read('staging-used-for-mocs.csv');

    // D9/D10: both mold variants coexist in the box; the MOC asks for one, by
    // its literal id — a fallback to 48729a or a rewrite to 3484 is a bug.
    expect(bars.some((line) => line.startsWith('48729b,'))).toBe(true);
    expect(bars.some((line) => line.startsWith('48729a,'))).toBe(true);
    expect(moc.filter((line) => line.startsWith('48729b,'))).toHaveLength(1);

    // D12/§7.7: staging already holds a part the MOC lists, so consume must not
    // pull it from there and a re-run must be detected.
    expect(staging).toContain('3005,0,4');
    expect(moc).toContain('3005,0,4');
  });
});
