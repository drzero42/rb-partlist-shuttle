# AGENTS.md — Rebrickable Part List Shuttle

Violentmonkey userscript. From a Rebrickable **Custom List** page (a MOC's
parts) it moves exactly those `(Part, Color, Qty)` rows between the user's **box
lists** and the **used list** (`Used for MOCs`):

- **Consume** subtracts the rows from box lists and appends them to the used list.
- **Return** subtracts them from the used list and appends them to box lists.

**`RB-PARTLIST-SHUTTLE-SPEC.md` is the source of truth.** On any conflict the
spec wins. Update this file to match it, never the other way round.

## Rules (breaking one is a bug)

- **No provenance.** Never record where bricks came from. Return derives each
  row's home every run: part → category (public catalogue) → the box list that
  holds that category (spec §3, §6.2).
- **All-or-nothing.** Any missing or short row means zero writes (D8).
- **Ask, don't guess.** Ambiguous routing becomes a question in the preview; the
  answer is used for that run only (D11).
- **Never send `fix_molds`**, never rewrite ids, exact `(Part, Color)` matching
  only (D6, D7).
- **Every write is verified** by re-reading the list and diffing the full
  `(Part, Color, Qty)` set. `#parts_count` is a total quantity and proves nothing.
  A `CHANGED during import` warning stops the run (§5.2, §7).
- **Sequential requests only**, back off on 429. Back up affected lists before
  the first write. Always preview and confirm first.
- **No API key, no password.** Site requests are same-origin `fetch` with
  `credentials: 'include'`. `GM_xmlhttpRequest` is only for
  `cdn.rebrickable.com` (the catalogue).
- **Stored data** is exactly `usedListName`, `boxNamePattern` and `catalogCache`
  (§9). `Used for MOCs` is data: it appears only in `src/gm.js`'s defaults.
- Classify lists by name only, never by build flags (D4, D5).

## Layout

```
src/index.js    entry + page guard
src/csv.js      CSV parse (quotes, CRLF) + rbpartscsv rows       ┐ pure, imports only
src/plan.js     classify lists, consume/return plans, verify diff ┘ each other; tested
src/rb.js       site reads, Part List index scrape, CSRF token, import POST
src/catalog.js  catalogue CDN fetch, gunzip, daily conditional cache
src/ui.js       button bar, panel (log, preview + questions), backup download
src/gm.js       the only GM_* user: config, catalogCache, xmlhttpRequest
scripts/build.mjs   esbuild → dist/rb-partlist-shuttle.user.js + metadata banner
scripts/release.mjs checks, tag, push (CI gate: --check)
test/           Vitest
```

`rb.js`, `catalog.js`, `ui.js` and `index.js` are thin I/O and are verified on the
site, not in Vitest. Every rule worth testing belongs in `plan.js` or `csv.js`.

## Commands

The toolchain comes from devenv (`nodejs_26`, `pnpm_12`). Only dev dependencies:
`esbuild`, `vitest`. No runtime dependencies.

```
pnpm install            # inside `devenv shell`
pnpm test
pnpm run build          # dist/rb-partlist-shuttle.user.js
pnpm run dev            # watch
pnpm run release [-- --yes]
```

### Releasing

1. Bump `version` in `package.json` (semver) and commit it. `@version` in the
   userscript comes from there. Violentmonkey only offers an update when
   `@version` increases, so an unbumped release reaches nobody.
2. `pnpm run release` is a dry run: it checks and prints the commands.
3. `pnpm run release -- --yes` tags `v<version>` and pushes the tag. It refuses a
   dirty tree or a tag that already exists on origin.

Pushing the tag is what publishes. `.github/workflows/release.yml` tests, builds,
checks that the tag matches `package.json`, and uploads the release asset.
Violentmonkey auto-updates from `releases/latest/download/`.

## Conventions

- Spec vocabulary in code: box list, used list, consume, return, category.
- Commits use short imperative messages.
- Before implementing I/O, read spec §10. Its *unverified* rows must be
  confirmed on the site.

## Next up

Verify on the site (spec §10 *unverified* rows): the Custom List CSV header,
the `/users/<u>/partlists/` scrape, and the CSRF token. Then try a small
consume/return round trip on a test Custom List.
