/**
 * Publish the built userscript as a GitHub Release asset (spec §16.1: the
 * artifact is what gets installed, and `@downloadURL` points at
 * `releases/latest/download/<asset>` so Violentmonkey auto-updates on every tag).
 *
 *   pnpm run release          dry run: checks + prints the commands
 *   pnpm run release --yes    checks, then executes them
 *
 * `dist/` stays gitignored — the release asset is the distribution channel, not
 * the repo. Checks run BEFORE anything is created, so a dirty tree, a moved
 * version, or an existing tag stops the release instead of half-publishing it.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OUTFILE, REPO_URL, SCRIPT_FILENAME } from './build.mjs';

const here = new URL('.', import.meta.url);
const root = fileURLToPath(new URL('..', here));
const execute = process.argv.includes('--yes');

function sh(command, args, opts) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', ...opts }).trim();
}

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(new URL('../package.json', here), 'utf8'));
const tag = `v${pkg.version}`;

if (sh('git', ['status', '--porcelain'])) fail('working tree is not clean — commit first');

const remoteTags = sh('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]);
if (remoteTags) fail(`${tag} already exists on origin — bump the version in package.json`);

sh('node', ['scripts/build.mjs']);

const artifact = fileURLToPath(new URL(`../${OUTFILE}`, here));
if (!existsSync(artifact)) fail(`build produced no ${OUTFILE}`);

const banner = readFileSync(artifact, 'utf8').slice(0, 2000);
if (!banner.startsWith('// ==UserScript==')) fail('artifact does not start with the metadata block');
if (!banner.includes(`@version`) || !banner.includes(pkg.version)) fail('artifact @version != package.json version');
if (!banner.includes(SCRIPT_FILENAME)) fail(`@downloadURL does not name ${SCRIPT_FILENAME}`);

const bytes = statSync(artifact).stat.size;
const commands = [
  ['git', ['tag', '-a', tag, '-m', tag]],
  ['git', ['push', 'origin', tag]],
  ['gh', ['release', 'create', tag, OUTFILE, '--title', tag, '--generate-notes']],
];

console.log(`${tag} — ${OUTFILE} (${bytes} bytes) → ${REPO_URL}/releases/tag/${tag}`);
for (const [command, args] of commands) console.log(`  ${command} ${args.join(' ')}`);

if (!execute) {
  console.log('\ndry run only — re-run with --yes to publish');
  process.exit(0);
}

for (const [command, args] of commands) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const out = sh(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (out) console.log(out);
}
console.log(`\npublished ${tag}`);
