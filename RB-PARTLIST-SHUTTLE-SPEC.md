# Rebrickable Part List Shuttle — Spec

A **Violentmonkey userscript** for rebrickable.com. From a **Custom List** page
(a MOC's parts), it moves exactly that list's `(Part, Color, Quantity)` rows
between the user's **box lists** and the **used list**, in either direction, with
no manual export/import and no record of where bricks went.

This file is the single source of truth. AGENTS.md is a digest of it.

---

## 1. Problem

The user models physical storage on Rebrickable:

- **Box list**: a Part List representing one **box type** (e.g. `Small storage
  boxes`). It holds the contents of every physical box of that type.
- **Used list**: one Part List (default name `Used for MOCs`) holding the bricks
  currently built into MOCs. It is shared by **all** MOCs. Per-MOC lists are
  rejected because Rebrickable limits how many lists an account may have.
- **Custom List**: the MOC's parts, `(Part, Color, Quantity)`. This is the input
  to every run.

Two operations, mirror images of each other:

| operation | subtract from | append to | what must be worked out |
|-----------|---------------|-----------|-------------------------|
| **Consume** (build a MOC) | box lists | used list | which box list holds each row |
| **Return** (take a MOC apart) | used list | box lists | which box list each row belongs in |

Non-goals:
- No spare parts: every read excludes them (`inc_spares=0`).
- No picking list. Rebrickable's Build feature already says where bricks are.
- No change to Build calculations or list build flags.
- **No provenance.** The tool never records which box a brick came from. Return
  works out each row's home from the rule in §3, every run.

---

## 2. Decisions

| # | Decision |
|---|----------|
| D1 | Violentmonkey userscript. Runs in the page (`@inject-into page`) with the user's own session. No password, no API key. |
| D2 | Input is the Custom List whose page the user is on, read as `rbpartscsv`. |
| D3 | Writes use the site's Part List Import endpoint (Append `A` / Subtract `S`), one request per affected list. Not the v3 API. |
| D4 | The **used list** is the Part List whose name equals `usedListName` exactly. |
| D5 | A **box list** is a Part List whose name matches `boxNamePattern` and is not the used list. Fail-closed: lists that don't match (orders, wishlists, `Unknown placement`, …) are never stock. Build flags are never consulted. |
| D6 | `fix_molds` is never sent. No part id is ever rewritten by the tool. |
| D7 | Matching is exact `(Part, Color)`. No mold, print or assembly substitution. |
| D8 | **All-or-nothing.** Any missing or short row means zero writes and a report of the offenders. |
| D9 | Consume subtracts only from box lists, never from the used list. |
| D10 | Return routes by **category** (§3, §6.2), using Rebrickable's public catalogue dump, which needs no key. |
| D11 | When the tool can't decide (a row in several boxes on consume, or a category with zero or several boxes on return), it **asks** in the preview. The answer applies to that run only. |
| D12 | Requests are strictly sequential. 429 means back off. |
| D13 | Every run: read everything → plan → **preview + explicit confirm** → back up affected lists → write → verify each write by re-reading. |

---

## 3. Storage rule (what the tool assumes)

- Every Rebrickable part category belongs to **exactly one box type**, which is
  exactly one box list. A box list may hold several categories.
- So a part's home box list = the box list that owns its category.
- The category → box list map is **derived each run from live box contents**.
  For every part in every box list, look up its category in the catalogue
  (§4.4). A category seen in exactly one box list maps to that list.
- A category seen in zero box lists (nothing of it stored yet) or in several
  (misfiled part) is unresolved, so the tool asks (D11).
- The same `(Part, Color)` can be split between a box list and the used list
  (some built, some still boxed). It should not be in two box lists; if it is,
  consume asks.

---

## 4. Reads

All site reads are same-origin `fetch(url, { credentials: 'include' })`. A 403
means not logged in. Stop and say so.

### 4.1 Custom List (input)
```
GET /users/<username>/lists/<list_id>/parts/?format=rbpartscsv&inc_spares=0
```
`<username>` and `<list_id>` come from the current page's path. Custom Lists have
no v3 API; this session export is the only way to read them.

### 4.2 Part List contents (box lists and used list)
```
GET /users/<username>/partlists/<list_id>/parts/?format=rbpartscsv&inc_spares=0
```

### 4.3 Part List enumeration
Scrape `/users/<username>/partlists/` for anchors to
`/users/<username>/partlists/<id>/` (root links only, not sub-pages). Each list
appears once, with link text `<name> (<N> parts)`; strip the count to get the
name. Classify by name only (D4, D5).

### 4.4 Catalogue (return only)
Public, keyless, served from `cdn.rebrickable.com` without CORS headers, so it is
fetched with `GM_xmlhttpRequest` (`@connect cdn.rebrickable.com`). Files are gzip;
decompress with the native `DecompressionStream('gzip')`.

| file | header | used for |
|------|--------|----------|
| `https://cdn.rebrickable.com/media/downloads/parts.csv.gz` (~1 MB gz, ~65k rows) | `part_num,name,part_cat_id,part_material` | part → category id |
| `https://cdn.rebrickable.com/media/downloads/part_categories.csv.gz` (<1 KB) | `id,name` | category names for the preview |

Fields can be quoted and contain commas, so the CSV parser must handle quotes.

**Cache** (`catalogCache` in GM storage, §9). It holds `part_num → part_cat_id`,
category names, the files' `ETag`s, and `checkedAt`.
- Checked < 24 h ago: use the cache, no request (the CDN sends
  `cache-control: max-age=86400` and regenerates the dump daily).
- Otherwise: conditional GET with `If-None-Match`. On `304` (verified: empty
  body), keep the cache and bump `checkedAt`. On `200`, rebuild the cache.
- CDN unreachable with a cache present: use the cache and show its age in the
  preview. No cache: the return run stops.

Consume never touches the catalogue.

---

## 5. Writes

### 5.1 Endpoint
```
POST /users/<username>/partlists/<list_id>/importparts/slow/
```
Multipart (`FormData`), header `X-Requested-With: XMLHttpRequest`:

| field | value |
|-------|-------|
| `csrfmiddlewaretoken` | from a page `input[name=csrfmiddlewaretoken]` (the `csrftoken` cookie is HttpOnly) |
| `action` | `A` (append) or `S` (subtract) |
| `import_url` | `""` |
| `external_source` | `RB` |
| `file` | CSV blob, header `Part,Color,Quantity` |
| `fix_molds` | **never sent**; absent means off (D6) |

Rebrickable documents that Subtract **fails if a part in the file is not in the
list**. It does not say whether that failure is per row or the whole file. The
plan therefore only ever subtracts what the latest read shows is present (D8).

### 5.2 Response
JSON: `{ status, msg, html, renders: { "#parts_count", … } }`.
- `status !== "success"` means the write failed. Stop.
- `html` is the human report. It must contain `Using settings: Fix Molds = False`;
  if it doesn't, stop.
- `html` containing `CHANGED during import` means the server rewrote ids
  (e.g. merged `4592` + `4593` into assembly `298c02`). Stop and show it verbatim,
  untruncated.
- `#parts_count` is the list's **total quantity**, not its line count. Don't use
  it for verification.

---

## 6. Algorithms

All planning is a pure function of the reads. No network, no DOM.

### 6.1 Consume
1. Read the Custom List, the Part List index, every box list, and the used list.
2. For each MOC row, find box lists holding that exact `(Part, Color)`:
   - one: that's the source;
   - several: ask which box list (D11);
   - none: **missing**.
3. Per source box list, the summed requested qty must be ≤ held qty, else the row
   is **short**.
4. Any missing or short row: show the offenders and write nothing (D8).
5. Preview, confirm, then apply (§7): subtract from each source box list, then
   append everything to the used list.

### 6.2 Return
1. Read the Custom List, the Part List index, every box list, the used list, and
   the catalogue (§4.4).
2. The used list must hold ≥ the requested qty of every exact `(Part, Color)`.
   Otherwise those rows are offenders and nothing is written (D8).
3. Build category → box lists from live box contents (§3).
4. For each MOC row, look up its category:
   - category maps to one box list: that's the destination;
   - category maps to zero or several box lists, or the part isn't in the
     catalogue: **ask per category** (D11), listing the candidate box lists
     with how many parts of that category each holds.
5. Preview, confirm, then apply (§7): subtract everything from the used list,
   then append to each destination box list.

### 6.3 Preview
The preview shows:
- one expandable section per write, as list → rows → qty;
- the offenders;
- each question, with the candidate lists and their counts. Answered questions
  stay visible and can be changed.
- the box lists and non-box lists, so a wrong `boxNamePattern` is visible;
- for return, the catalogue's age.

Confirm is absent until every question is answered and there are no offenders.

---

## 7. Apply and safety

1. **Backup:** before the first write, save each affected list's `rbpartscsv`
   (from the reads used for the plan) as a download, using a Blob and
   `<a download>`, into the browser's download folder (subfolders aren't
   possible). Name: `rbps-<list name>-<list id>-<UTC timestamp>.csv`. The
   browser gives no failure signal for these downloads, so the contents also
   stay in the panel's preview tables.
2. **Order:** all subtracts first, then all appends. A subtract on stale data
   fails before anything is appended.
3. **Sequential:** one request at a time. On 429, wait (`Retry-After` or
   1 s / 2 s / 4 s), then stop after three tries.
4. **Verify every write:** re-read that list and compare its full
   `(Part, Color, Qty)` set to *backup ± this write's rows*. Any difference,
   including an id rewrite, stops the run before the next write.
5. **On stop:** show which writes completed, which didn't, the server `html`, and
   the diff. No automatic resume or rollback. The user restores from the backups
   (Import → Replace) or finishes by hand.
6. **Progress log:** each write takes ~10–15 s at 300 rows, so show which list is
   in flight.

---

## 8. UI

- Runs only on Custom List pages (`/users/<u>/lists/<id>/`, as a path guard at
  runtime). Rebrickable is server-rendered (no SPA routing).
- Three buttons go right after the site's parts Bulk Edit button
  (`.js-bulk-edit[data-bulk_item_type="part"]`), using the site's own
  `rb-btn rb-btn--default` classes, because Rebrickable resets bare `<button>`
  styling. That section loads over AJAX after the page and can be re-rendered,
  so a `MutationObserver` attaches the buttons when Bulk Edit appears and
  re-attaches them if they disappear. The buttons are:
  - **Consume → `<usedListName>`**
  - **Return ← `<usedListName>`**
  - **⚙** (settings)

  Labels use the configured name.
- A panel shows the progress log, then the preview with inline `<select>`
  questions (D11) and a confirm button, then the write log.
- Settings use native `prompt()` for the two §9 config keys.
- The script's own CSS classes are prefixed `rbps-`. Styles go in via a `<style>`
  element. All text is inserted as text, never HTML.

---

## 9. Stored data (GM storage)

Only these. Nothing about past moves.

| key | default | purpose |
|-----|---------|---------|
| `usedListName` | `Used for MOCs` | exact name of the used list (D4) |
| `boxNamePattern` | `\bbox(?:es)?\b` | regex source, compiled with `i`, for box lists (D5). An invalid pattern is an error, never "match all". |
| `catalogCache` | none | public catalogue cache (§4.4). Rebrickable reference data, not user state. |

The defaults suit a collection whose box lists are named like `Small storage
boxes` or `Sorting box`. The default pattern doesn't match names like `Matchbox`,
`Bag`, `Ordered from …` or `Unknown placement`. Anyone with other naming sets
both keys in ⚙ settings. Nothing in the code depends on any one account's lists.

---

## 10. Verified facts

Facts about Rebrickable's behaviour that the design relies on. They were
measured with a console probe on a scratch Part List (2026-10-06/07), or
observed during development. The probe's recording isn't fully trusted, so the
implementation re-checks the important ones on every write (response
assertions in §5.2, verify in §7.4). Anything marked *unverified* must be
confirmed before release.

| fact | status |
|------|--------|
| Omitting `fix_molds` keeps ids literal (`48729b` stays `48729b`); response echoes `Fix Molds = False` | measured |
| 300-row Append/Subtract is one synchronous POST (~10.6 s / ~14.2 s), no follow-up requests | measured |
| CSRF token from a Part List page's hidden input works for repeated writes; cookie is HttpOnly | measured |
| `rbpartscsv` ids round-trip byte-for-byte through Append/export | measured |
| Appending `4592,1` + `4593,0` produced one line `298c02,1` with a `CHANGED during import` warning; subtracting the same rows restored the list | measured. Note: `298c0N` encodes the lever colour, so this is not a general colour-preserving equivalence. Handled by stopping (§5.2). |
| Reads use `inc_spares=0`: spare parts are out of scope | decided 2026-10-07. Spare-flagged rows are invisible to the tool, so consume reports them missing and writes nothing. Verification stays consistent because every read uses the same flag. |
| Custom List export URL is `/users/<u>/lists/<id>/parts/?format=rbpartscsv&inc_spares=0` (the page's own Export link) | verified 2026-10-07 |
| Custom List export header is `Part,Color,Quantity` | verified 2026-10-07 (read accepted by the header check) |
| `/users/<u>/partlists/` index lists all Part Lists as root anchors, text `<name> (<N> parts)` | verified 2026-10-07 |
| A usable `csrfmiddlewaretoken` is found (Custom List page, else a Part List page); consume + return round trip wrote and verified cleanly | verified 2026-10-07 |
| Catalogue CDN: no CORS header, `ETag`/`Last-Modified`, 304 on conditional GET | verified 2026-10-07 |

---

## 11. Architecture

Plain JavaScript ESM, bundled by esbuild into one unminified userscript.

```
src/
  index.js     page guard, wiring
  csv.js       CSV parse/serialize (quotes, CRLF), rbpartscsv rows       ┐ pure,
  plan.js      classify lists, consume/return plans, category map,       │ unit-tested
               expected-after-write diff                                 ┘
  rb.js        site reads + import write + CSRF token
  catalog.js   catalogue fetch, gunzip, conditional cache (§4.4)
  ui.js        buttons, preview/questions modal, progress log, settings, backup download
  gm.js        the only module touching GM_* (config + catalogCache + xmlhttpRequest)
```

`csv.js` and `plan.js` import nothing but each other (plan → csv) and hold every
rule worth testing. The I/O modules are thin and get verified on the site.

---

## 12. Userscript metadata

Rendered by `scripts/build.mjs`. `@version`, `@description` and `@author` come
from `package.json`.

```
// ==UserScript==
// @name        Rebrickable Part List Shuttle
// @namespace   https://github.com/drzero42/rb-partlist-shuttle
// @version     <package.json>
// @description <package.json>
// @author      <package.json>
// @match       https://rebrickable.com/users/*
// @run-at      document-idle
// @inject-into page
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_xmlhttpRequest
// @connect     cdn.rebrickable.com
// @downloadURL https://github.com/drzero42/rb-partlist-shuttle/releases/latest/download/rb-partlist-shuttle.user.js
// @homepageURL https://github.com/drzero42/rb-partlist-shuttle
// @supportURL  https://github.com/drzero42/rb-partlist-shuttle/issues
// ==/UserScript==
```

- **`@inject-into page`** keeps site `fetch` in the page's own context, so the
  session cookies, `Origin` and `Referer` behave as on the site. Rebrickable sends
  no CSP, so page mode works. Without this setting, Firefox content-mode fetch
  can drop `Origin`/`Referer`, and Django's CSRF check would reject writes.
- `GM_xmlhttpRequest` is only for the catalogue CDN. Site requests always use
  plain `fetch`.
- Violentmonkey needs `@version` to auto-update. It installs from the GitHub
  `releases/latest/download/…user.js` URL directly.

## 13. Distribution

- The artifact is a GitHub Release asset; `dist/` is gitignored.
- `.github/workflows/release.yml` publishes on `v*` tags. It runs the tests,
  builds, checks that the tag matches `package.json`, and uploads the asset.
- `pnpm run release` checks and prints the commands; `-- --yes` tags and pushes.
- Rollback means installing an older tag's asset URL.
- The bundle stays unminified, so it is readable when pasted and Greasy
  Fork-compatible.

## 14. Definition of done

1. Consume and Return work from a Custom List page with exact quantities,
   all-or-nothing, preview + confirm, backup, and per-write verify.
2. Return routes by category via the cached public catalogue and asks only for
   unresolved categories.
3. No API key, no password, no stored provenance.
4. The *unverified* rows in §10 are confirmed.
