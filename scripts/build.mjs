/**
 * Release build: bundle src/index.js into the single self-contained userscript
 * `dist/rb-partlist-shuttle.user.js` (spec §16).
 *
 *   pnpm run build           one-shot bundle
 *   pnpm run dev             same, in watch mode
 *
 * Non-negotiables:
 *   - `minify: false`. Greasy Fork rejects minified/obfuscated code, and the
 *     bundle is what a human pastes into Violentmonkey, so it must stay readable.
 *   - The metadata block is the FIRST thing in the file (Violentmonkey requires
 *     it at the very beginning).
 *   - `@version` always mirrors package.json — the artifact and the release tag
 *     can never disagree, because Violentmonkey compares `@version` against
 *     `@downloadURL` to decide whether an update exists.
 *   - `@grant` lists exactly the `GM_*` APIs src/gm.js references — pinned by a
 *     test, not scanned at build time. All network is same-origin fetch ⇒ never
 *     GM_xmlhttpRequest, never `@connect` (§16.2).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { context } from 'esbuild';

export const REPO_URL = 'https://github.com/drzero42/rb-partlist-shuttle';
export const SCRIPT_FILENAME = 'rb-partlist-shuttle.user.js';
export const OUTFILE = `dist/${SCRIPT_FILENAME}`;
export const DOWNLOAD_URL = `${REPO_URL}/releases/latest/download/${SCRIPT_FILENAME}`;

/**
 * `@grant` lines (§16.2). Declared here and pinned by test/build.test.js against
 * the `GM_*` identifiers actually referenced in src/gm.js — the only module
 * allowed to touch them (AGENTS.md) — so the list cannot drift in either
 * direction: no missing grant, no over-granting.
 */
export const GRANTS = Object.freeze(['GM_getValue', 'GM_setValue', 'GM_addStyle', 'GM_download']);

/** @grant lines that must never appear (§16.2: same-origin fetch only). */
export const FORBIDDEN_GRANTS = Object.freeze(['GM_xmlhttpRequest']);

const here = new URL('.', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('../package.json', here), 'utf8'));

/**
 * Metadata block as `[key, value]` pairs; `@grant` repeats per grant.
 *
 * @param {{version?: string, grants?: string[]}} [opts]
 * @returns {[string, string][]}
 */
export function metadataPairs(opts) {
  const version = opts?.version ?? pkg.version;
  const grants = opts?.grants ?? GRANTS;
  return [
    ['@name', 'Rebrickable Part List Shuttle'],
    ['@namespace', REPO_URL],
    ['@version', version],
    ['@description', pkg.description],
    ['@author', pkg.author],
    ['@match', 'https://rebrickable.com/users/*'],
    ['@run-at', 'document-idle'],
    ...grants.map((grant) => ['@grant', grant]),
    ['@downloadURL', DOWNLOAD_URL],
    ['@homepageURL', REPO_URL],
    ['@supportURL', `${REPO_URL}/issues`],
  ];
}

/**
 * The rendered `// ==UserScript== … // ==/UserScript==` banner.
 *
 * @param {{version?: string, grants?: string[]}} [opts]
 * @returns {string}
 */
export function buildMetadata(opts) {
  const pairs = metadataPairs(opts);
  const width = Math.max(...pairs.map(([key]) => key.length)) + 1;
  const body = pairs.map(([key, value]) => `// ${key.padEnd(width)}${value}`).join('\n');
  return `// ==UserScript==\n${body}\n// ==/UserScript==\n`;
}

/**
 * esbuild options. `.css` is inlined as a string so gm.js can hand it to
 * GM_addStyle (§8).
 *
 * @type {import('esbuild').BuildOptions}
 */
export const esbuildOptions = {
  entryPoints: [fileURLToPath(new URL('../src/index.js', here))],
  outfile: fileURLToPath(new URL(`../${OUTFILE}`, here)),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  loader: { '.css': 'text' },
  banner: { js: buildMetadata() },
  logLevel: 'warning',
};

async function run() {
  const ctx = await context(esbuildOptions);
  if (process.argv.includes('--watch')) {
    await ctx.watch();
    console.log(`watching → ${OUTFILE}`);
    return;
  }
  await ctx.rebuild();
  await ctx.dispose();
  console.log(`built ${OUTFILE} (v${pkg.version})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
