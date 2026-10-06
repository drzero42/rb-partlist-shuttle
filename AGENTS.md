# AGENTS.md — Rebrickable Part List Shuttle

Violentmonkey userscript (`rb-partlist-shuttle`) that moves exact
`(Part, Color, Qty)` amounts between the user's box Part Lists and one staging
Part List (`Used for MOCs`), driven by a Custom List, in both directions.

**`RB-PARTLIST-SHUTTLE-SPEC.md` is the single source of truth.** This file is
the agent-facing digest: architecture, rules, commands. On any conflict, the
spec wins — update this file to match, never the other way.

## Golden rules (violating any = bug, not trade-off)

- **Task 0 first.** Spec §12 (0.1–0.6) are implementer-verification items to
  run on a scratch Part List BEFORE writing shipping logic. Never Task 0
  against the user's real boxes.
- **`fix_molds` is OMITTED from every write** (D9). No part-number rewriting,
  ever.
- **All-or-nothing** (D11): any shortfall → zero writes + offender report. No
  silent partials.
- **Exact `Part,Color` match only** (D10). No variant/mold fallback guessing.
- **`Used for MOCs` is data, not the product name** (spec §16.1). It is the
  default of the `stagingName` config key; never hardcode it in list-matching
  code paths. Staging/box classification is name+ignore-list based, never
  build-type-flag based (D5/D6/D7).
- **Consume pulls only from boxes, never staging** (D12).
- **Sequential requests only**, 429 → backoff (D15). Never parallel writes.
- **Backup before write, dry-run preview before apply, explicit confirm**
  (D16). Surface server warnings verbatim.
- **No password, ever.** Session-cookie reads/writes; at most a read-only
  public catalog API key for category lookups (spec §10).
- **No state outside Rebrickable** except `GM_*` config keys (spec §9).
  Category→box maps and provenance are re-derived every run.

## Architecture

Plain JavaScript ESM. Bundled to one self-contained userscript.

```
src/
  index.js        entry: page guard (Custom List pages only), settings load, wiring
  csv.js          rbpartscsv parse/serialize            ┐ pure: no network,
  reconcile.js    classify/partition/feasibility/abort,  │ no DOM, no GM_*:
                  category→box routing                   ┘ unit-testable as-is
  rb-read.js      session GETs: lists, partlists, ?format=rbpartscsv
  rb-write.js     POST importparts/slow/ (A/S), csrf from DOM, response parse, backoff
  rb-category.js  v3 /lego/parts/ batch + DOM-scrape fallback
  safety.js       auto-backup, resumable journal, post-write verify
  ui.js           injected buttons, preview/ambiguity modals, progress log
  gm.js           the ONLY module allowed to touch GM_* APIs
  styles.css      inlined by bundler, injected via GM_addStyle
scripts/build.mjs esbuild → dist/rb-partlist-shuttle.user.js
                  (renders the §16.2 metadata banner; @version from package.json)
scripts/release.mjs checks + build + tag/push; `--check` is the CI gate (§16.4)
test/             Vitest + fixture CSVs under test/fixtures/
                  (vitest.config.js: fileParallelism off — release.test.js rebuilds dist/)
.github/workflows/release.yml  on tag v*: test, build, verify, publish the asset
```

Module import rules (enforce, don't negotiate):

- `csv.js` may import nothing. `reconcile.js` may import only `csv.js`.
- No other `src/` module may be unit-tested without stubs; they are thin I/O
  layers verified on-site during Task 0.
- All `GM_getValue/GM_setValue/GM_addStyle/GM_download` calls go through
  `gm.js`.
- All network is same-origin `fetch` with `credentials: 'include'` — no
  `GM_xmlhttpRequest`, no `@connect` (spec §16.2).

Build artifact: `dist/rb-partlist-shuttle.user.js`, self-contained, unminified.
`dist/` is gitignored — the artifact ships as a **GitHub Release asset**, and
`@downloadURL` points at `releases/latest/download/<asset>` so Violentmonkey
auto-updates on every tag (spec §16.4). Metadata block lives in
`scripts/build.mjs` (`@version` mirrors `package.json`).

## Toolchain & commands

Dependencies come from **devenv** (`devenv.nix`: `nodejs_26` + `pnpm_12`). Package
manager: **pnpm 12** (pin the same major in `packageManager` in package.json).
Refresh toolchain patches with `devenv update` (bumps `devenv.lock`).

```
pnpm install        # inside `devenv shell`
pnpm test           # vitest run — must stay green; pure logic lives here
pnpm run dev        # esbuild watch → dist/
pnpm run build      # release artifact → dist/rb-partlist-shuttle.user.js
pnpm run release    # dry run: checks + prints the commands
pnpm run release -- --yes   # checks, tag v<version>, push the tag
```

Publishing is done by `.github/workflows/release.yml` on `push: tags: ['v*']` —
it reinstalls, runs the suite, rebuilds, verifies the artifact against the tag,
and creates the release with the asset. `release.mjs` never calls
`gh release create`, so there is one publisher. `workflow_dispatch` runs the same
chain without publishing (spec §16.4).

`pnpm.onlyBuiltDependencies` moved out of package.json in pnpm 12 — the esbuild
build-script approval lives in `pnpm-workspace.yaml` (`allowBuilds`).

Only deps: `esbuild`, `vitest`. Keep it that way — no framework, no runtime
dependencies (they'd all be inlined into the userscript).

## Conventions

- Match spec vocabulary exactly in code: box, staging, box list, consume,
  return, `stagingName`, `ignoreLists`, `categoryMode`, `defaultDryRun`.
- Config keys and defaults are frozen in spec §9 — don't invent new ones
  without a spec update.
- Commit style: short imperative ("Add csv parser", "Fix abort on empty box").
- Fallback v3-API write path (spec §13) stays behind a config flag and only
  gets built if the primary import path breaks.

## Current status

Scaffold done and green: `package.json`, `pnpm-workspace.yaml`, all `src/`
modules as contract-documented stubs (every function throws `NotImplemented:`),
`scripts/build.mjs` + `scripts/release.mjs`, `.github/workflows/release.yml`, and
Vitest suites that pin the §16.2 metadata block, the §5.2/§9 constants, the
module import rules above, the fixture CSV shapes, and the release pipeline.
`pnpm run build` produces an installable artifact.

Next up per spec:
1. Task 0 verification (spec §12) against a scratch Part List; record results
   in the spec before shipping logic.
2. `csv.js` + `reconcile.js` with tests (fixture CSVs already in
   `test/fixtures/`), then I/O layers, then UI — replacing the stubs module by
   module and loosening the export-surface test as each contract settles.

Note: the stub contracts for `rb-category.js`, `safety.js` and `ui.js` were
written before Task 0 ran, so treat their exact signatures as provisional until
0.1–0.6 confirm the response shapes they assume.
