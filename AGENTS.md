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
                  (metadata banner injected from package.json version)
test/             Vitest + fixture CSVs under test/fixtures/
```

Module import rules (enforce, don't negotiate):

- `csv.js` may import nothing. `reconcile.js` may import only `csv.js`.
- No other `src/` module may be unit-tested without stubs; they are thin I/O
  layers verified on-site during Task 0.
- All `GM_getValue/GM_setValue/GM_addStyle/GM_download` calls go through
  `gm.js`.
- All network is same-origin `fetch` with `credentials: 'include'` — no
  `GM_xmlhttpRequest`, no `@connect` (spec §16.2).

Build artifact: `dist/rb-partlist-shuttle.user.js`, self-contained, installed
by pasting into Violentmonkey. Metadata block lives in `scripts/build.mjs`
(`@version` mirrors `package.json`).

## Toolchain & commands

Dependencies come from **devenv** (`devenv.nix`: `nodejs_26` + `pnpm_12`). Package
manager: **pnpm 12** (pin the same major in `packageManager` in package.json).
Refresh toolchain patches with `devenv update` (bumps `devenv.lock`).

```
pnpm install        # inside `devenv shell`
pnpm test           # vitest run — must stay green; pure logic lives here
pnpm run dev        # esbuild watch → dist/
pnpm run build      # release artifact → dist/rb-partlist-shuttle.user.js
```

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

Pre-implementation. Next up per spec:
1. Scaffold (`devenv.nix`, `package.json`, `src/` stubs, `scripts/build.mjs`, Vitest).
2. Task 0 verification (spec §12) against a scratch Part List; record results
   in the spec before shipping logic.
3. `csv.js` + `reconcile.js` with tests (fixture CSVs), then I/O layers,
   then UI.
