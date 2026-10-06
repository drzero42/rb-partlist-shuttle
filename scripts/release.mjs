/**
 * Release the built userscript (spec §16.4).
 *
 *   pnpm run release                              dry run: checks + prints commands
 *   pnpm run release -- --yes                     checks, then tag v<version> + push tag
 *   node scripts/release.mjs --check [--expect-tag v1.2.3]
 *                                                 build + verify only, no git writes (CI)
 *
 * Pushing the tag is what publishes: `.github/workflows/release.yml` rebuilds the
 * artifact and attaches it to the release. This script never calls
 * `gh release create`, so there is exactly one publisher and no double-upload
 * race. `dist/` stays gitignored — the release asset is the distribution channel.
 *
 * Checks run BEFORE anything is created, so a dirty tree, a moved version, or an
 * existing tag stops the release instead of half-publishing it.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DOWNLOAD_URL, OUTFILE, REPO_URL, buildMetadata } from './build.mjs';

const here = new URL('.', import.meta.url);
const root = fileURLToPath(new URL('..', here));

const argv = process.argv.slice(2);
const execute = argv.includes('--yes');
const checkOnly = argv.includes('--check');
const expectedTag = flagValue('--expect-tag');

function flagValue(name) {
  const index = argv.indexOf(name);
  return index === -1 ? null : argv[index + 1] ?? null;
}

function sh(command, args, opts) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', ...opts }).trim();
}

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

// Report a broken git/gh call as one line, not a stack trace.
process.on('uncaughtException', (error) => fail(error?.message ?? String(error)));

const pkg = JSON.parse(readFileSync(new URL('../package.json', here), 'utf8'));
const tag = `v${pkg.version}`;

if (expectedTag && expectedTag !== tag) {
  fail(`--expect-tag ${expectedTag} does not match package.json version ${tag}`);
}

if (!checkOnly) {
  if (sh('git', ['status', '--porcelain'])) fail('working tree is not clean — commit first');

  const remoteTags = sh('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]);
  if (remoteTags) fail(`${tag} already exists on origin — bump the version in package.json`);
}

sh('node', ['scripts/build.mjs']);

const artifact = fileURLToPath(new URL(`../${OUTFILE}`, here));
if (!existsSync(artifact)) fail(`build produced no ${OUTFILE}`);

const source = readFileSync(artifact, 'utf8');
const banner = buildMetadata();
if (!source.startsWith(banner)) fail('artifact does not start with the §16.2 metadata block');
if (!source.includes(DOWNLOAD_URL)) fail(`@downloadURL is not ${DOWNLOAD_URL}`);
if (source.includes('//# sourceMappingURL')) fail('artifact embeds a sourcemap reference');

const bytes = statSync(artifact).size;

if (checkOnly) {
  console.log(`check ok — ${tag}, ${OUTFILE} (${bytes} bytes)`);
  process.exit(0);
}

const commands = [
  ['git', ['tag', '-a', tag, '-m', tag]],
  ['git', ['push', 'origin', tag]],
];

console.log(`${tag} — ${OUTFILE} (${bytes} bytes) → ${REPO_URL}/releases/tag/${tag}`);
for (const [command, args] of commands) console.log(`  ${command} ${args.join(' ')}`);

if (!execute) {
  console.log('\ndry run only — re-run with --yes to tag and push; the release workflow publishes');
  process.exit(0);
}

for (const [command, args] of commands) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const out = sh(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (out) console.log(out);
}

console.log(`\ntagged ${tag} — the release workflow is publishing ${DOWNLOAD_URL}`);
