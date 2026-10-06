/**
 * Pins the release pipeline: the tag-triggered workflow is the single publisher
 * (spec §16.4), and `scripts/release.mjs --check` is the gate it verifies with.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OUTFILE, buildMetadata } from '../scripts/build.mjs';

const here = new URL('.', import.meta.url);
const root = fileURLToPath(new URL('..', here));
const workflow = readFileSync(new URL('../.github/workflows/release.yml', here), 'utf8');
const releaseScript = readFileSync(new URL('../scripts/release.mjs', here), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', here), 'utf8'));

/** Run release.mjs, reporting a non-zero exit instead of throwing. */
function run(args) {
  try {
    const stdout = execFileSync(process.execPath, ['scripts/release.mjs', ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    return { status: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

describe('release workflow', () => {
  it('publishes on version tags, and dispatches for a verify-only run', () => {
    expect(workflow).toMatch(/tags:\s*\['v\*'\]/);
    expect(workflow).toMatch(/^\s*workflow_dispatch:/m);
  });

  it('holds the permission it needs to create the release', () => {
    expect(workflow).toMatch(/permissions:\s*\n\s*contents:\s*write/);
    expect(workflow).toMatch(/GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
  });

  it('installs frozen, tests, then builds — in that order', () => {
    const install = workflow.indexOf('pnpm install --frozen-lockfile');
    const test = workflow.indexOf('pnpm test');
    const check = workflow.indexOf('release.mjs --check');
    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(test);
    expect(test).toBeLessThan(check);
  });

  it('gates the tag on the package.json version', () => {
    expect(workflow).toMatch(/release\.mjs --check --expect-tag "\$GITHUB_REF_NAME"/);
  });

  it('publishes only on a tag ref, uploading whatever the build produced', () => {
    expect(workflow).toMatch(/if: github\.ref_type == 'tag'/);
    expect(workflow).toMatch(/gh release create "\$GITHUB_REF_NAME" dist\/\*\.user\.js/);
    // A glob rather than a hardcoded name, so the workflow cannot drift from OUTFILE.
    expect(workflow).not.toContain(`dist/${OUTFILE.split('/')[1]}`);
    expect(OUTFILE).toMatch(/^dist\/.+\.user\.js$/);
  });

  it('re-uploads on a re-run instead of failing on an existing release', () => {
    expect(workflow).toMatch(/gh release view "\$GITHUB_REF_NAME"/);
    expect(workflow).toMatch(/gh release upload "\$GITHUB_REF_NAME" dist\/\*\.user\.js --clobber/);
  });
});

describe('release.mjs', () => {
  it('is not a second publisher — it only tags and pushes', () => {
    expect(releaseScript).not.toMatch(/'gh'/);
    expect(releaseScript).toMatch(/\['git', \['tag', '-a', tag, '-m', tag\]\]/);
    expect(releaseScript).toMatch(/\['git', \['push', 'origin', tag\]\]/);
  });

  it('verifies the banner it is supposed to ship', () => {
    expect(releaseScript).toMatch(/source\.startsWith\(banner\)/);
    expect(releaseScript).toMatch(/DOWNLOAD_URL/);
  });
});

describe('release.mjs --check', () => {
  it('builds and verifies the artifact', () => {
    const { status, stdout } = run(['--check']);
    expect(stdout).toMatch(/check ok/);
    expect(status).toBe(0);
    const artifact = readFileSync(new URL(`../${OUTFILE}`, here), 'utf8');
    expect(artifact.startsWith(buildMetadata())).toBe(true);
  });

  it('accepts the tag that matches package.json', () => {
    expect(run(['--check', '--expect-tag', `v${pkg.version}`]).status).toBe(0);
  });

  it('refuses a tag that disagrees with package.json', () => {
    const { status, stderr } = run(['--check', '--expect-tag', 'v9.9.9']);
    expect(status).toBe(1);
    expect(stderr).toMatch(/does not match package\.json version/);
  });
});
