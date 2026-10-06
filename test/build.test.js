import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DOWNLOAD_URL,
  FORBIDDEN_GRANTS,
  GRANTS,
  OUTFILE,
  REPO_URL,
  SCRIPT_FILENAME,
  buildMetadata,
  esbuildOptions,
} from '../scripts/build.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const metadata = buildMetadata();

function parseMetadata(text) {
  const values = new Map();
  for (const line of text.split('\n').slice(1, -2)) {
    const [, key, value] = line.match(/^\/\/ (\S+) +(\S.*)$/);
    values.set(key, [...(values.get(key) ?? []), value]);
  }
  return values;
}

describe('userscript metadata block (§16.2)', () => {
  it('is the whole file header, with exactly one space after //', () => {
    expect(metadata.startsWith('// ==UserScript==\n')).toBe(true);
    expect(metadata.endsWith('// ==/UserScript==\n')).toBe(true);
    for (const line of metadata.trimEnd().split('\n')) {
      expect(line).toMatch(/^\/\/ (?:==\/?UserScript==|@\S+ .*)$/);
    }
  });

  it('carries the §16.1 identity', () => {
    const values = parseMetadata(metadata);
    expect(values.get('@name')).toEqual(['Rebrickable Part List Shuttle']);
    expect(values.get('@namespace')).toEqual([REPO_URL]);
    expect(values.get('@author')).toEqual([pkg.author]);
    expect(values.get('@description')).toEqual([pkg.description]);
  });

  it('mirrors the package version so auto-update can compare it', () => {
    expect(parseMetadata(metadata).get('@version')).toEqual([pkg.version]);
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('matches /users/* and defers narrowing to the runtime guard', () => {
    const values = parseMetadata(metadata);
    expect(values.get('@match')).toEqual(['https://rebrickable.com/users/*']);
    expect(values.get('@run-at')).toEqual(['document-idle']);
  });

  it('points @downloadURL at the latest release asset', () => {
    expect(DOWNLOAD_URL).toBe(`${REPO_URL}/releases/latest/download/${SCRIPT_FILENAME}`);
    const values = parseMetadata(metadata);
    expect(values.get('@downloadURL')).toEqual([DOWNLOAD_URL]);
    expect(values.get('@homepageURL')).toEqual([REPO_URL]);
    expect(values.get('@supportURL')).toEqual([`${REPO_URL}/issues`]);
  });

  it('grants exactly the §16.2 GM_* set and nothing more', () => {
    const values = parseMetadata(metadata);
    expect(values.get('@grant').sort()).toEqual([...GRANTS].sort());
    for (const forbidden of FORBIDDEN_GRANTS) {
      expect(values.get('@grant')).not.toContain(forbidden);
    }
    expect(values.has('@connect')).toBe(false);
  });
});

describe('bundle options', () => {
  it('stays readable — Greasy Fork rejects minified userscripts', () => {
    expect(esbuildOptions.minify).toBe(false);
    expect(esbuildOptions.sourcemap).toBe(false);
  });

  it('produces one self-contained iife at dist/<slug>.user.js', () => {
    expect(esbuildOptions.bundle).toBe(true);
    expect(esbuildOptions.format).toBe('iife');
    expect(esbuildOptions.platform).toBe('browser');
    expect(esbuildOptions.outfile.endsWith(`dist/${SCRIPT_FILENAME}`)).toBe(true);
    expect(OUTFILE).toBe(`dist/${SCRIPT_FILENAME}`);
  });

  it('inlines styles.css as a string for GM_addStyle', () => {
    expect(esbuildOptions.loader['.css']).toBe('text');
    expect(esbuildOptions.banner.js).toBe(metadata);
  });
});

const artifactUrl = new URL(`../${OUTFILE}`, import.meta.url);

describe.skipIf(!existsSync(artifactUrl))('built artifact', () => {
  it('begins with the metadata block Violentmonkey parses', () => {
    expect(readFileSync(artifactUrl, 'utf8').startsWith(metadata)).toBe(true);
  });

  it('is self-contained — no imports left to resolve', () => {
    const artifact = readFileSync(artifactUrl, 'utf8');
    expect(artifact).not.toMatch(/^\s*import\s/m);
    expect(artifact).not.toMatch(/require\(['"]\.\//);
  });
});
