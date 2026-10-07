# Rebrickable Part List Shuttle — Implementation Spec

Target: a **Violentmonkey userscript** named **Rebrickable Part List Shuttle**
(slug `rb-partlist-shuttle`) for rebrickable.com that, given a **Custom
List** (a MOC's parts), moves the listed quantities of each part **between the
user's storage-box Part Lists and a single staging Part List named
`Used for MOCs`** — in both directions — with no manual export/import steps and
no state stored outside Rebrickable.

Status: spec complete, scaffold built. `package.json`, the `src/` module stubs
(with their contracts written out), `scripts/build.mjs`, `scripts/release.mjs`
and the Vitest suite all exist and are green. What remains is Section 12
("Task 0") **implementer-verification** against a scratch Part List, then the §6
logic in `csv.js`/`reconcile.js`. None of Task 0 is an open user-decision.

---

## 1. Problem being solved (and what it is NOT)

Rebrickable lets the user model physical storage as **Part Lists** ("boxes") and
track a MOC as a **Custom List**. When bricks are pulled from boxes to build a
MOC, the box Part Lists no longer match the physical boxes, and nothing moves
them into the "used" state automatically.

The ONLY gap this tool bridges:
> Take a Custom List's `(Part, Color, Quantity)` rows and move exactly those
> quantities of each part between box Part Lists and the `Used for MOCs` Part
> List — and back.

Non-goals (explicitly out of scope):
- **No picking list / bag checklist.** Rebrickable's own "Build" already tells
  the user where to find bricks. This tool does not duplicate that.
- **No build-calculation changes.** The tool never runs or alters build math.
- **No MOC inventory reading.** MOC API endpoints were removed by Rebrickable in
  2020; the input is always a user Custom List.
- **No persisted provenance/state.** Everything is re-derived from Rebrickable on
  each run.

---

## 2. Locked decisions (from research + user Q&A)

| # | Decision | Value |
|---|----------|-------|
| D1 | Medium | **Violentmonkey userscript** (Option A). Reads the private live Custom List via the browser's session; writes via session-based import endpoints. No stored password. |
| D2 | Consume input | Rebrickable **Custom List**, read live via `?format=rbpartscsv`. |
| D3 | Read format | `Part,Color,Quantity` (numeric RB color ids). Confirmed. No category column. |
| D4 | Write path | Rebrickable site **Import** `Subtract`/`Append` endpoints (NOT the v3 API for writes). One synchronous request per affected list. |
| D5 | Staging identity | `Used for MOCs` Part List identified by **exact configured name** (default `Used for MOCs`). NOT by build-type flag (avoids breaking the user's Assembled/Custom-List semantics and avoids guessing if multiple lists share a flag). |
| D6 | Box identity | **Fail-closed.** A Part List is a candidate **box** only if its name matches `boxNamePattern` AND it is not the staging list AND it is not on `ignoreLists`. A list the tool cannot recognise as a box is never treated as stock on hand — that is what keeps pending-order lists and wishlists from satisfying a consume plan. Still **flag-agnostic**: build-type flags stay the user's business (§4.3). |
| D7 | Ignore-list | Name-based exclusion applied **after** `boxNamePattern`, for lists that match the pattern but must not be drawn from (e.g. a future `Boxes — order 4513`). Out-of-scope lists are named in the preview (§8) so a wrong pattern never silently shrinks inventory. |
| D8 | Return routing signal | **Live box contents** (§6.2 ladder), re-read every run — nothing cached, nothing persisted. (Originally "category→box map, derived live"; superseded 2026-10-07: 0.1b proved categories need the keyed v3 API, and the user rejected persisted hints. The storage invariant in §3 is what makes contents stand in for categories.) |
| D9 | Molds | **`fix_molds` OFF (literal)** on every write. The tool must not rewrite part numbers (e.g. must NOT turn `48729b`→`3484`). |
| D10 | Variant matching | **Exact `Part,Color` match only.** No mold/print/alternate fallback. A real variant mismatch surfaces as "missing → abort" (see D11) so the user resolves it, not the tool. |
| D11 | Consume shortfall | **All-or-nothing abort.** If ANY requested `(Part,Color)` qty exceeds what its home box holds, the run makes **zero** writes and reports the offenders. Used for MOCs must end up exactly equal to the MOC list's available subset (no silent partials). |
| D12 | Consume source pool | Consume pulls **only from boxes**, never from `Used for MOCs`. (A part sitting in staging belongs to another MOC.) |
| D13 | Return routing | **Contents ladder** (§6.2): exact `(Part,Color)` → same `Part` any colour → same design root, different mould letter. Exactly one candidate box → route there; 0 (family boxed-out) or ≥2 (tied) → in-page modal **asks** which Part List to use. Never guesses; remembers nothing between runs. |
| D14 | Trigger UX | A button injected on the Rebrickable **Custom List** page: "Move → Used for MOCs" / "Move ← Used for MOCs". |
| D15 | Throttle | Rebrickable v3 API is ~1 req/sec (429 → backoff). Import/export site endpoints are user-session, not API-throttled, but requests stay **sequential**. |
| D16 | Safety | Auto CSV backup of every affected list before any write; dry-run/preview; explicit confirm; resumable. |

---

## 3. Domain model

- **Box** = a Part List dedicated to one or more part **categories**. A given
  category lives in **exactly one box type** (invariant). A box may hold multiple
  categories. Within a box, bricks are bagged by part number.
- **Staging** = the single Part List named (by config) `Used for MOCs`. Holds
  bricks currently pulled for assembled/in-progress MOCs. It is **not** a box and
  must be **excluded** from return-routing candidates (and from consume's pool, D12).
- **Custom List** = the MOC's `(Part,Color,Qty)` — the unit of work for a
  consume/return run.
- **Category** = Rebrickable `part_cat_id` / `part_cat_name`. Reachable only
  behind the keyed v3 API (0.1/0.1b) and therefore **unused by the tool**; the
  invariant it encoded is exploited through live box contents instead (§6.2).

Storage invariant (user-stated): one category → one box type; a part+color lives
in at most one box; it can additionally be split between a box and staging
(some committed, some still boxed). Since categories are unreachable keylessly,
return routing leans on this invariant *via the part's own identity*: the box
currently holding the part (or its colour/mould family) is its home (§6.2).

---

## 4. Read path (verified)

### 4.1 Custom List parts (consume input)
```
GET https://rebrickable.com/users/<username>/lists/<list_id>/parts/?format=rbpartscsv&inc_spares=0
```
- Requires the logged-in **session** (403 without it) → userscript fetch with
  `credentials: 'include'` (same-origin). No API key needed for reads of your own
  lists.
- Response: `text/csv`, header `Part,Color,Quantity`, rows use RB part ids and
  numeric color ids (e.g. `48729b,0,2`; color `0` = Black).
- `?_=<ts>` cache-buster is optional; `inc_spares` optional (see Task 0.5).

### 4.2 Box contents (source lookup + return routing)
```
GET https://rebrickable.com/users/<username>/partlists/<list_id>/parts/?format=rbpartscsv&inc_spares=0
```
- Same format, for every candidate box list.

### 4.3 List discovery + staging classification
**Primary (keyless, session):** scrape the `MY LEGO → My Part Lists` sidebar for
list links + names (the 0.6/Task-0 runs confirmed 15 lists, ids + names).
The documented v3 alternative
`GET /api/v3/users/<user_token>/partlists/?key=<api_key>`
returns `list_id`, `descr`, `type`, `qty` — but it is a **private** endpoint whose
user token comes from username+password, which §10 forbids, so the tool does not
use it (it only matters to the §13 fallback path).
Classification is by **name** either way — `boxNamePattern` for boxes, exact
`stagingName` for staging, then `ignoreLists` — never by `type` (D5/D6/D7).

### 4.4 Category resolution — **RETRACTED** (was return-direction only)
**Withdrawn 2026-10-07** (user chose the contents-ladder mechanism, §6.2/D8;
Task 0.1 and 0.1b are the evidence, §12.2): `part_cat_id` is reachable only via
the keyed v3 API, `part_cat_name` never comes back even keyed with
`inc_part_details=1`, no internal endpoint or page data leaks categories
keylessly, and the user requires Return to work with no key and no persisted
hints. There is no category resolution step in the product; routing reads live
box contents only.

Kept facts in case any future version revisits this:
- `GET /api/v3/lego/parts/?part_nums=<a>,<b>,<c>&inc_part_details=1&key=<api_key>`
  (HTTP 200) returns `part_cat_id` per item but **no `part_cat_name`**;
  `GET /api/v3/lego/part_categories/?key=<api_key>` maps id→name. Batch via
  `part_nums`, `page_size` ≤ 1000, ~1 req/s (D15).
- The public catalog endpoint needs the free **API key**, NOT a user token, NOT
  the password.

---

## 5. Write path (verified via DevTools)

### 5.1 Endpoint
```
POST https://rebrickable.com/users/<username>/partlists/<list_id>/importparts/slow/
```
Same endpoint for **Append and Subtract**; differs only by the `action` field:
- `action = A` → Append (increment)
- `action = S` → Subtract (decrement by listed qty; **fails if a part is absent**)
(`R` = Replace and a delete-all mode exist; **not used** here.)

### 5.2 Multipart form fields (exact set to replay)
| field | value | notes |
|-------|-------|-------|
| `csrfmiddlewaretoken` | hidden input on the **Part-List page itself** (`/users/<u>/partlists/<id>/`) | Task 0.4: the list page already carries a token, so no separate Import-page fetch is needed; the `csrftoken` cookie is **HttpOnly** (JS cannot read it) so the DOM is the only source; one token served 4 appends + 3 subtracts without re-reading |
| `action` | `A` or `S` | mode selector |
| `import_url` | `""` (empty) | file is used instead |
| `external_source` | `RB` | matches rbpartscsv scheme |
| `fix_molds` | **OMITTED** | checkbox absent → OFF. MUST be absent per D9. Task 0.2: verified literal, **and the server echoes `Using settings: Fix Molds = False` in the response `html` — assert that string on every write (§5.3) |
| `file` | the per-list CSV (`Part,Color,Quantity`) | field name `file` |

Required headers: `X-Requested-With: XMLHttpRequest`; browser adds cookies
(session/csrf) automatically same-origin. `Content-Type: multipart/form-data` is
produced by `FormData`.

### 5.3 Response
`application/json`, **synchronous** — measured at 300 rows (Task 0.3, 2026-10-06):
```
{ "status":"success", "msg":"…", "html":"…warnings…",
  "renders":{ "#user_parts_list":"…", "#parts_count": <int>, "#parts_cost_summary":"…" } }
```
- **One request per file, even at 300 rows** — no confirm/progress follow-up and no
  async/task keys in `status`/`msg`/`html`/`renders`, so §6's atomicity model stands.
  Cost: ~10.6s (append) and ~14.2s (subtract) per 300-row file, so per-box pacing of
  ~400ms never hit 429 and the progress log (§8) must expect a long wait per box.
- `html` is the human report, and it carries two machine-useful things: the settings
  echo (`Using settings: Fix Molds = False`) and **warnings**, e.g.
  `Warnings x1 (some parts were CHANGED during import): Merging 1 x part 4592 in
  color 1, 1 x part 4593 in color 0`. Surface verbatim (§7.8) — **untruncated**, the
  first probe run clipped exactly this message — and treat "CHANGED during import"
  as a verification failure (§7.5, §12.3).
- **`#parts_count` is the list's TOTAL QUANTITY, not its line count.** It moved +2 per
  append of qty 2 while lines moved +1. Never verify against it alone — re-read the
  `rbpartscsv` and diff `(Part,Color,Qty)` (§7.5).
- `#parts_cost_summary` is also in `renders`; ignore it (no pricing in scope).

### 5.4 Verified quantity behaviour
Round-trip proved Append then Subtract of `48729b,0,2` + `3005,0,2` moved exactly
2 of each (not whole lines). Subtract decrements by qty; Append increments by qty.
Quantity is honored by construction on both sides.

---

## 6. Algorithms

### 6.1 Consume — boxes → Used for MOCs
Input: Custom List `(Part,Color,Qty)` rows. Steps:
1. Enumerate Part Lists; classify staging (name) / boxes (non-staging, non-ignored).
2. For each box, read its `rbpartscsv` contents → `(Part,Color) → qty` map.
3. For each MOC row, find the box whose contents contain that `(Part,Color)`:
   - exactly one → tentative source for that row;
   - **more than one** → stop, modal asks which box (invariant violation) (D13-style);
   - **none** → mark **missing** (per D12, never pull from staging).
4. Pre-validate feasibility per source box: for each box, the sum of rows assigned
   to it must be ≤ that box's qty per part+color. If **any** row can't be fully met
   by its single box → **ABORT with zero writes**, list offenders (D11).
5. Preview table (rows → box → qty; missing list). Confirm.
6. Apply (sequential, resumable):
   a. For each source box: `Subtract` its assigned subset CSV (`action=S`).
      Only parts the box is known to hold → won't fail.
   b. For staging: `Append` the consumed CSV (`action=A`).
7. Refresh/verify counts; write-back check (7.x).

Note: consume does NOT require categories at all (exact content-match) — and with
§4.4 retracted, neither does return. Both directions work with session cookies
only (no API key, minimal throttle exposure).

### 6.2 Return — Used for MOCs → boxes
Input: the same Custom List rows (what this MOC consumed). The routing signal is
**live box contents**, re-read every run — no categories (§4.4 retracted), no
persisted hints (§12.3 items 6/7). The storage invariant (§3) is what makes "the
box that currently holds parts like this" answer the question the category map
was supposed to answer. Steps:
1. Classify lists as above.
2. Read staging contents (for availability check) + all box contents.
3. For each MOC row to return, find candidate boxes by the **ladder**, stopping at
   the first tier that yields any candidate:
   1. exact `(Part,Color)` present in a box;
   2. same `Part`, any colour, present in a box (absorbs server-side id rewrites
      like `4592,1` → `4593,0`);
   3. same design root with a different mould letter (`48729b` ⇄ `48729a`) present
      in a box — reported in the preview as a mould-family match.
   Composite ids (`<design>c<num>`, §12.3 item 5) match only in tier 1; the
   preview shows the component⇄composite equivalence and lets the user resolve —
   D10 still governs **writes** (never invent or substitute an id).
4. Exactly one candidate box → route there. Zero (the whole family is boxed-out)
   or ≥2 (tied across boxes) → **modal ask** (D13): the user picks the destination
   Part List for that row. Nothing is remembered between runs — the same
   boxed-out row asks again next time; that is the accepted price of statelessness.
5. Pre-validate staging holds ≥ requested qty per `(Part,Color)`; if not,
   **abort** (mirror of D11).
6. Preview — per-box grouping, and **how each row was routed** (exact / any-colour
   / mould-family / asked) — then confirm.
7. Apply:
   a. For each destination box: `Append` its subset (`action=A`).
   b. For staging: `Subtract` the returned CSV (`action=S`).

### 6.3 Boxed-out caveat (honest limitation)
Because state is never persisted, a row whose exact `(Part,Color)`, same-part-any-
colour and mould family are all absent from every box has **no candidate** —
return cannot infer its home and must ask (§6.2 step 4). This replaces the old
empty-category caveat and is the accepted price of "derive live, store nothing"
(the user chose it, again on 2026-10-07) and should be surfaced clearly, not
guessed.

---

## 7. Robustness & safety

1. **Dry-run first**: default mode computes the full plan and prints preview
   (rows→box / staging, missing list, abort reasons) and performs NO writes until
   the user confirms.
2. **Pre-validation = atomicity**: because all needed data is read up front, the
   plan is simulated locally; writes fire only when the whole plan is feasible.
   No partial consume on shortfall (D11).
3. **Auto-backup**: before any write, fetch and download `rbpartscsv` of every
   affected list (each source box + staging), timestamped, via `GM_download`/blob.
4. **Sequential + resumable**: requests one at a time; track per-box completion so
   an interrupted run can continue or roll back cleanly.
5. **Post-write verify, at id level (mandatory)**: after every write re-fetch that
   list's `rbpartscsv` and diff the `(Part,Color)` set *and* quantities against the
   plan — do not trust `#parts_count` (§5.3). Task 0.3 caught the server reporting
   "some parts were CHANGED during import / Merging …" while the line count
   round-tripped perfectly, so a count-only check passes on a corrupted result. Any
   rewritten id or unexpected quantity ⇒ stop the run, report it, offer the exact
   undo; never start the next box on a failed verify.
6. **Throttle discipline**: no parallel calls; treat 429 as retry-with-backoff.
7. **Idempotency guard**: detect if a run is re-applied (e.g. staging already
   contains the MOC rows) and refuse to double-count without explicit override.
8. **Error surfacing**: show the server `html`/warnings verbatim in the UI.

---

## 8. UI

- Inject a toolbar button on **Custom List** pages (`/users/<u>/lists/<id>/`):
  - "🧱 → Used for MOCs (consume)"
  - "🧱 ← Used for MOCs (return)"
- Small settings panel (persisted via `GM_setValue`) for exactly the §9 keys:
  staging name, box name pattern, box ignore-list, default `dry-run`.
- Preview + ambiguity modals (in-page, `GM_addStyle`) with a `<select>` of
  candidate Part Lists; optional "remember for this run" (session-scoped only).
- Progress log for the sequential apply.

---

## 9. Config keys (GM storage)

| key | default | purpose |
|-----|---------|---------|
| `stagingName` | `Used for MOCs` | exact-match staging list name — **the single source of that name** (§16.1) |
| `boxNamePattern` | `\bbox(?:es)?\b` | regex SOURCE (compiled `i`) for the lists that count as boxes; fail-closed (D6). `?` must sit on the `(es)`, not on the `s`: `\bboxes?\b` matches "boxes" but not "box" |
| `ignoreLists` | `[]` | names excluded AFTER `boxNamePattern` matched (D7) |
| `defaultDryRun` | `true` | always preview |

No username/password stored, and **no API key** — the category lookup that once
justified `apiKey`/`categoryMode` is retracted (§4.4); both keys were removed
2026-10-07.
`boxNamePattern` is stored as a **string** because GM storage is JSON; code compiles
it with the `i` flag and must fail loudly on an invalid pattern rather than fall
back to matching everything.

Account facts (2026-10-06, from the user's 15 Part Lists):
- **In scope as boxes** (name matches `boxNamePattern`): `15l storage boxes`,
  `Big storage boxes`, `Large condi boxes`, `Medium condi boxes`,
  `Medium storage boxes`, `Mini storage boxes`, `Small condi boxes`,
  `Small storage boxes`, `Sorting boxes`.
- **Out of scope by design**: `Ordered from Bricklink`, `Ordered from Lego`
  (stock not yet received), `Unknown placement` (parts that cannot be located),
  `Bag` (a working pile, emptied as collection modernization proceeds — user
  chose to ignore it), `Task0 probe` (scratch), staging.
- **Staging rename pending**: the account's list is currently named
  `Used in MOCs`; it will be renamed to match `stagingName`, because the code
  defines that name exactly once and the tool matches it exactly (D5).

---

## 10. Security / ToS notes

- Runs same-origin with the user's own session; performs operations the user can
  already do manually via Import — automated, not elevated.
- Credentials: **none**. Session cookies ride the browser's own login; the
  read-only public catalog API key that the old category lookup (§4.4) wanted is
  gone — 0.1b proved categories need it, and the user requires a keyless tool.
  Never the login password. CSRF token is read from the page, not extracted from
  an HttpOnly cookie.
- Flag fragility: internal import/export URLs are undocumented; on breakage, fall
  back to the official v3 API write path (documented, slower, needs user token —
  see 13).

---

## 11. Architecture (suggested modules)

- `reconcile.js` — pure functions: partition MOC rows by box; feasibility/abort;
  return-routing ladder (§6.2); unit-testable with fixture CSVs (no network).
- `rb-read.js` — session export fetch (`lists` + `partlists` `?format=rbpartscsv`),
  list enumeration.
- `rb-write.js` — `importparts/slow/` POST builder (FormData), csrf handling,
  response parse, backoff.
- `ui.js` — button injection, preview/ambiguity modals, progress, settings.
- `safety.js` — backup-before-write, resumable journal (session/local), verify.

Keep `reconcile.js` network-free and fully unit-tested — it holds all the risky
logic (abort rules, partitioning, routing ladder).

(`rb-category.js` was deleted 2026-10-07 with the §4.4 retraction.)

---

## 12. Task 0 — implementer verification (do FIRST, before writing logic)

Each has a pass criterion; on fail, adopt the stated alternative.

- **0.1 Category fields** — Call `/lego/parts/?part_nums=3001,48729b&inc_part_details=1&key=<k>`;
  PASS if each item has `part_cat_id` + `part_cat_name`. Else parse from list-page HTML.
- **0.2 `fix_molds` OFF** — POST Subtract with `fix_molds` **omitted**; re-check the
  target list: PASS if part numbers are NOT normalized (a known mold-variant keeps
  its literal id). If the server still normalizes when omitted, find the explicit
  OFF value (e.g. `fix_molds=` empty or `0`) — do NOT ship with silent merging.
- **0.3 Large-import shape** — Run an Append then Subtract of a ~200–400-row file
  on a scratch list. PASS if still a single synchronous `importparts/slow/` POST
  returning `status:success` (no confirm/progress follow-ups). If multi-step/async
  is required, adjust the apply loop to drive the extra request(s) and keep the
  pre-validation atomicity model.
- **0.4 CSRF on POST** — Confirm the page's `<input name=csrfmiddlewaretoken>` value
  is accepted by the import POST. If a fresh token is needed per request, re-read
  it (or reuse a cookie token where masked) before each write.
- **0.5 `inc_spares` default** — Decide whether box reads include spare parts.
  ~~Test with and without `inc_spares=1`~~ — **settled by declaration, not probed**:
  this account tracks no spare parts, so the flag can only ever add rows that do
  not exist, and reading all 15 Part Lists twice to prove that is pure cost.
  Default stays **OFF**, so only true box contents are matched (§4.2). The probe
  reports this as `DECLARED` and skips the double read; `{ sparesCheck: true }`
  compares a single box list on demand.
- **0.6 Part-id exactness** — Confirm `rbpartscsv` `Part` ids match box-id strings
  byte-for-byte for the same part+color. Confirm the staging Append stores literal
  ids (ties to 0.2).

Use a scratch Part List / a duplicated Custom List for destructive checks; never
Task-0 on the user's real boxes until 0.1–0.6 pass.

### 12.1 Running it

`tools/task0-probe.js` automates 0.1–0.6. Paste it into the DevTools console on
the **Import page of a scratch Part List** (`/users/<u>/partlists/<id>/importparts/`)
and call `__task0()`. It Appends, reads back, Subtracts, and prints a verdict table
plus JSON evidence.

**Any tab of the scratch list works.** The probe takes the list id from the current
URL (or an explicit `{ listUrl }`) and scrapes the Part-List sidebar out of the
fetched HTML — so it does not depend on which tab it was pasted into, and it
refuses with the pathname and HTTP status it saw rather than a mystery error.

**The CSRF token is discovered, never assumed.** §5.1 verified the *POST endpoint*
(`…/importparts/slow/`); the path of the page hosting the import form was never
checked, and a first run found `…/importparts/` answering **404**. Rebrickable
renders its error pages as full site pages — with their own `csrfmiddlewaretoken`
input — so a token scraped from a non-OK response looks perfectly valid. The probe
therefore only accepts tokens from `response.ok` pages, trying the list page itself
first, then its own `import` links, and records which URL supplied the token in the
report (`target.csrfSource`) — the answer `rb-read.js`/`rb-write.js` need. The scratch-list guard reads the list's own name from the
**sidebar anchor for that exact list id** — `/users/<u>/partlists/<id>/` root links
only, so sub-page links like `…/import/` (text "Import") never masquerade as a name.
Headings and `<title>` are last-resort fallbacks and **cannot satisfy the guard on
site chrome**: a real run's first `h1` was the site title, and refusing on it is
correct. If nothing identifies the list, pass `{ listName: 'Task0 …' }` — the guard
still applies to whatever name is used, and the report records where it came from
(`target.nameSource`, `target.sidebarAnchors`). The box lists it reads come from that scrape filtered
by `boxNamePattern` (D6), and the report's `scope` block names what it put in and
out — which doubles as a check of the pattern against the account's real names.

- It refuses to write unless the list NAME matches `/^(task\s*0|scratch|probe|test)/i`
  and requires a typed `TASK0` gate — the §12 "never against real boxes" rule enforced
  in code, not just in prose. Because that pattern can never match a staging name, the
  probe needs no copy of `stagingName` (§16.1); box candidates are filtered by the same
  `boxNamePattern` rule D6 will ship with, and the report lists what it put out of
  scope so a wrong pattern is visible.
- Box lists are touched **read-only** (for 0.3's row source, filtered by
  `boxNamePattern`, or scoped with `{ boxListIds: ['<id>'] }` to name one explicitly);
  the only list written
  to is the scratch list, and every accepted Append is subtracted again, with a
  net-zero row-count check after cleanup.
- Sequential + 429-backoff (§7.6), 400ms pacing; `fix_molds` is never sent and the
  probe asserts that on its own form (§5.2, D9).
- Not bundled, not shipped, no manager APIs. Behaviour is pinned by
  `test/task0-probe.test.js` against a fake server — including the case where the
  server normalizes `48729b` anyway, which MUST surface as 0.2 FAIL.

### 12.2 Results

Record the probe output here before §6 shipping logic is written; no shipping
logic may land while a row is `pending`.

Run: `tools/task0-probe.js` on Part List **#1125434 `Task0 probe`** (user `drzero`),
2026-10-06. Box reads during the run were read-only; every write was undone and the
net-zero check passed (`4 baseline rows, 0 un-undone`).

Second run, 2026-10-07: read-only subset `__task0({ only: ['0.1','0.1b'] })` — no
gate, no writes; net-zero re-verified against the same 4 baseline rows.

| item | verdict | outcome / adopted alternative | date |
|------|---------|-------------------------------|------|
| 0.1 | **FAIL** | `part_cat_id` is returned, **`part_cat_name` is not**, and the DOM fallback is dead (0 `data-part_cat_*` on the list page and in the import `html`). Follow-up read-only call: items DO carry `name` (`4592` "Lever Small Base", `4593` "Lever Small") and `/lego/part_categories/` maps id→name (`11` Bricks, `32` Bars, Ladders and Fences) — names are reachable, but only with a key. Superseded by §12.3 item 6 | 2026-10-06 |
| 0.1b | **FAIL (no keyless source)** | Read-only hunt for a keyless part→category source. Internal endpoints: `parts/?format=json&inc_spares=0` → 200 but `text/html`, 0 bytes; `parts/json/` → **404**; `parts/?format=json&inc_part_details=1` → 200 `text/html`, 0 bytes; category-looking keys embedded in the page: **none** (`usable: null`). Re-confirmed 0.1 alongside: `part_cat_id` yes / `part_cat_name` no, mold id `48729b` served, 0 HTML attributes. **Category data is reachable only behind the keyed v3 API** → the item-6 premise is settled against category routing | 2026-10-07 |
| 0.2 | **PASS** | omitting `fix_molds` keeps ids literal (`48729b,0` → `48729b,0`, nothing rewritten); the response `html` also echoes `Using settings: Fix Molds = False`, which the tool now asserts per write | 2026-10-06 |
| 0.3b | **CHECK → explained** | appending `4592,1` + `4593,0` **alone** produced one line: `298c02,1`. Rebrickable collapses known components into the **composite design id** (design 298 "Lever" = 4592 base + 4593 lever) while still echoing `Fix Molds = False`. Subtracting the same two rows restored the list (`round-trip restored=true`) → the collapse is symmetric | 2026-10-06 |
| 0.3 | **PASS + warning** | 300 rows stayed **one synchronous POST** each way (10.6s / 14.2s, no confirm/progress keys) → atomicity model holds. But the response warned `some parts were CHANGED during import: Merging 1 x part 4592 in color 1, 1 x part 4593 in color 0` **while Fix Molds = False** → §7.5 id-level verification is now mandatory | 2026-10-06 |
| 0.4 | **PASS** | token read from the Part-List page served 4 appends + 3 subtracts with no re-read; the `csrftoken` cookie is HttpOnly (unreadable from JS), so the DOM is the only possible source (§5.2) | 2026-10-06 |
| 0.5 | declared | no spare parts in this account (user-declared) → `inc_spares` default **OFF**; not probed | 2026-10-06 |
| 0.6 | **PASS** | `3005,0` + `48729b,0` in ⇄ out byte-for-byte. Caveat found: the rendered list page does **not** contain the mold id (client-side rows), which is why 0.1's scrape failed | 2026-10-06 |
| D6 scope | **validated** | in scope (9): `15l/Big/Medium/Mini/Small storage boxes`, `Large/Medium/Small condi boxes`, `Sorting boxes`. Out of scope (5): `Bag`, `Ordered from Bricklink`, `Ordered from Lego`, `Unknown placement`, `Used for MOCs`. Staging rename done: `Used for MOCs` (#1125187) | 2026-10-06 |

### 12.3 What Task 0 changed in the design

1. **Verification is id-level, not count-level (§7.5).** The server can report
   "some parts were CHANGED during import" and still give a clean line count, so the
   apply loop must re-read each written list's `rbpartscsv` and diff
   `(Part,Color,Qty)` against the plan before touching the next box. A `Merging …`
   warning is **not automatically a failed run** (0.3b shows the collapse is benign
   and symmetric) — the rule is: the re-read must be explainable as
   composite⇄component equivalence, otherwise it is a failure and the run stops.
2. **Categories come from ids + one lookup (§4.4).** `part_cat_name` is not in the
   parts response; the DOM scrape has nothing to read. Routing uses `part_cat_id`,
   names use a single cached `/api/v3/lego/part_categories/` call. — **moot for the
   product** since the §4.4 retraction (2026-10-07); kept as the measurement record.
3. **`categoryMode` / `apiKey`: RESOLVED — deleted (§9).** Neither the keyed path
   nor deferring Return won: 0.1b removed categories from the design, and the
   contents ladder (item 6) answers Return keylessly. Both keys were deleted from
   the §9 table and §10 on 2026-10-07.
4. **Budget for slow writes (§8).** ~10-14s per 300-row import means the progress log
   must show which box is in flight; nothing about the plan changes.
5. **Resolved: the server collapses component pairs into composite ids (0.3b).**
   `4592` + `4593` → `298c02`, symmetrically, while `Fix Molds = False`. Ids shaped
   `<design>c<num>` are Rebrickable's composite/assembly ids, inventory-equivalent to
   their component set — a *different* phenomenon from the `48729a/b/c` mould variants
   of D9/D10. Consequences:
   - §6.1 must not declare `missing` when the box holds a composite whose components
     the MOC lists separately, or the reverse; the near-miss report expands the id both
     ways before calling it a shortfall.
   - D10's exact `Part,Color` rule still governs **writes** (never invent an id), but
     the feasibility read treats composite⇄component as an equivalence class it
     **shows** in the preview rather than silently picks. Which pairs collapse is
     catalog data with no keyless source, so the MVP detects the `cNN` shape, warns,
     and lets the user resolve.
   - 0.3 now records `sourceList` — the original warning could not be traced to the
     box rows I assumed it came from.

6. **Return must work without an API key (user decision, 2026-10-06), so category
   routing is dead as the mechanism.** §4.4's inputs are unavailable keylessly —
   0.1 + 0.1b (§12.2) settled it: `part_cat_id` lives only behind the keyed v3
   API, the internal JSON probes return HTML or 404, and no page data embeds
   categories — and the backend rewrites ids regardless. The three-way choice was
   put to the user on 2026-10-07: (a) contents ladder, (b) accept a read-only key
   and keep D8, (c) ship Consume and defer Return. **The user chose (a).** The
   ladder (exact `(Part,Color)` → same `Part` any colour → same design root with
   a different mould letter → prompt; composite ids match only exactly; ties
   across boxes prompt) is now the text of §6.2/D13, and §2, §3, §4.2–§4.4, §6.3,
   §8, §9, §10, §11, §14, §15 and §16 were rewritten to match the same day;
   `rb-category.js` was deleted. (b)/(c) stay off the table unless the §6.3 prompt
   volume proves unbearable in real use — the escape hatch then is revisiting the
   evidence, not reintroducing memory.

7. **Routing memory — WITHDRAWN (2026-10-07).** The user rejected persisting
   anything about where bricks came from, so no GM routing-memory key is added and
   §9 is unchanged beyond the deletions in item 6. Modal answers live only inside
   the current run (§8's session-scoped "remember for this run"); a boxed-out row
   asks again on the next run, by design (§6.3). The invalidate-on-read/flush
   design drafted here is moot while that holds.

---

## 13. Fallback write path (only if internal import breaks)

Official v3 API per-part (documented but slower, ~1 req/sec, many calls for big
MOCs; needs API key + user token via `POST /users/_token/` from username+password
— the only flow that would store a password):
```
PUT    /users/<u>/partlists/<id>/parts/      (increment qty)
DELETE /users/<u>/partlists/<id>/parts/<part>/<color>/
```
Keep behind a config flag. Primary stays the session Import endpoints (D4).

---

## 14. Open technical risks

- Internal import/export URLs undocumented → could change (mitigated by §13).
- Very large MOCs could exceed the site Import's comfort — **measured fine at 300
  rows** (synchronous, ~10-14s), so partitioning stays as design but the UI must
  show the wait (§8).
- **The server can rewrite part ids even with `fix_molds` OFF** (Task 0.3:
  "Merging 1 x part 4592 in color 1, 1 x part 4593 in color 0"). OFF is necessary
  but not sufficient for D9/D10: mitigation is §7.5's id-level diff, and a "missing"
  verdict may really mean "the box stores this under a merged id". Which part pairs
  merge is catalog data we do not have — see §12.3.
- Return routing depends on the storage invariant (§3) *and* on the part's family
  still being present in some box. A violated invariant shows up as a tie across
  boxes → the tool asks rather than guesses.
- If a part's whole mould family is boxed-out (no box holds it in any colour or
  mould variant), return has no candidate box → prompts (§6.3). Prompts repeat
  across runs by design: nothing is remembered (§12.3 item 7 withdrawn).

---

## 15. Definition of done (MVP)

1. Consume a Custom List into `Used for MOCs`, exact quantities, all-or-nothing,
   preview + confirm, backup + verify.
2. Return the same Custom List back to home boxes via the live contents ladder
   (§6.2) — ask-prompts for ties and boxed-out rows (§6.3) — exact quantities,
   preview + confirm. Both directions: session cookies only, no API key, no
   stored state.
3. `fix_molds` provably OFF (0.2 **passed**, with the server's own
   `Fix Molds = False` echo asserted per write) **and** post-write id-level
   verification proving no id was rewritten in practice (0.3 **warned** — see §7.5).
   Staging + ignore-list classification provably flag-independent and name-based
   (D5/D6/D7), with the fail-closed `boxNamePattern` **validated against the 15 real
   lists** (§12.2).
4. Resumable + throttle-safe sequential writes. No stored password.

---

## 16. Naming & userscript metadata

### 16.1 The name and its single source

| Where | Value |
|-------|-------|
| Product / display name | **Rebrickable Part List Shuttle** |
| Slug (repo, dir, npm-style id) | `rb-partlist-shuttle` |
| Userscript `@name` | `Rebrickable Part List Shuttle` |
| Userscript file | `rb-partlist-shuttle.user.js` |
| Repo root | `rb-partlist-shuttle/` |
| This spec | `RB-PARTLIST-SHUTTLE-SPEC.md` |

Rationale:
- Leads with **Rebrickable** so it sorts and searches predictably on Greasy Fork
  / in the Violentmonkey list.
- **"Shuttle"** encodes the bidirectional move (consume §6.1 ↔ return §6.2);
  one-way words like *mover/exporter/collector* would misdescribe it.
- Names the **Rebrickable primitive** (Part List), not the user's staging string
  `Used for MOCs`. `stagingName` is configurable (§9), so the product name stays
  correct if that value changes.

Naming rule going forward: **`Used for MOCs` is data, not the product name.** It is
the default value of the `stagingName` config key (D5/§9) and appears in UI button
labels (§8) — it must never be swapped for "Shuttle" in code paths that match list
names.

**One place to change that data.** The literal lives in exactly one file —
`src/gm.js`, in `CONFIG_DEFAULTS` — and a test asserts that no other `src/` or
`tools/` file restates it. Everything downstream reads it as a value:
`ui.js` builds button labels from the loaded config, `reconcile.js` classifies from
`config.stagingName`, and the §12 probe no longer needs to know it at all. So
retargeting the tool at a differently-named staging list is either a settings
change (preferred) or, to change the shipped default, a single edit in `gm.js`.
§9's table is the documented source of the default; the tests read it from there
instead of repeating it.

### 16.2 Metadata block

`scripts/build.mjs` renders this block and prepends it to the bundle, so it is
always the first thing in the file (Violentmonkey requires the metadata at the
very beginning). `@version`, `@description` and `@author` come from
`package.json` — the artifact can never disagree with the release tag.

```
// ==UserScript==
// @name        Rebrickable Part List Shuttle
// @namespace   https://github.com/drzero42/rb-partlist-shuttle
// @version     0.1.0
// @description Move exact part quantities between your Rebrickable box Part Lists and a staging Part List, in both directions, from a Custom List page.
// @author      Anders Bøgh Bruun
// @match       https://rebrickable.com/users/*
// @run-at      document-idle
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_addStyle
// @grant       GM_download
// @downloadURL https://github.com/drzero42/rb-partlist-shuttle/releases/latest/download/rb-partlist-shuttle.user.js
// @homepageURL https://github.com/drzero42/rb-partlist-shuttle
// @supportURL  https://github.com/drzero42/rb-partlist-shuttle/issues
// ==/UserScript==
```

Notes:
- **`@match`** covers `https://rebrickable.com/users/*`; §8's button injection
  narrows further at runtime by pathname (Custom List pages
  `/users/<u>/lists/<id>/` only), so the script stays inert elsewhere.
- All reads/writes are **same-origin** to rebrickable.com with
  `credentials: 'include'` (§4, §5) → plain `fetch`, no `GM_xmlhttpRequest`, no
  `@connect`. Revisit only if §13's fallback path is ever activated.
- **`@grant` is pinned, not hand-maintained.** AGENTS.md confines `GM_*` to
  `gm.js`, and a test asserts that the `GM_*` identifiers referenced there equal
  this list exactly — so neither a missing grant nor an over-grant can slip in.
  This is what "adjust `@grant` to what the implementation actually uses" means
  in practice: change `gm.js`, and the block follows.
- **`@version` and `@downloadURL` are jointly required for auto-update.**
  Violentmonkey compares the installed `@version` with the one served at
  `@downloadURL`; a script with no `@version` never updates. Violentmonkey has no
  separate `@updateURL` key (that spelling is Tampermonkey's).
- `GM_download` is required by §7.3 (auto-backup). If a target manager lacks it,
  fall back to a blob + programmatic anchor click and drop the grant.
- `GM_getValue`/`GM_setValue` back the §9 config keys. No password and no API key
  is ever stored (§10; the category-lookup key died with §4.4's retraction).

### 16.3 Module filenames

§11's module names are unchanged and stand on their own — no `shuttle` prefix
needed inside the repo: `reconcile.js`, `rb-read.js`, `rb-write.js`, `ui.js`,
`safety.js` (`rb-category.js` was deleted 2026-10-07 with §4.4).

### 16.4 Distribution

The artifact ships as a **GitHub Release asset**; `dist/` stays gitignored.

| concern | decision |
|---------|----------|
| Install / update URL | `…/releases/latest/download/rb-partlist-shuttle.user.js` |
| Why `latest/download` | always resolves to the newest release, so `@downloadURL` needs no edit per version |
| Asset filename | MUST end in `.user.js`, or Violentmonkey saves it as a file instead of offering to install |
| Publisher | `.github/workflows/release.yml`, on `push: tags: ['v*']` — the **only** thing that creates a release |
| Dev side | `pnpm run release` (dry run: checks, then prints the commands) · `pnpm run release -- --yes` (checks, tag `v<version>`, push the tag; the workflow publishes) |
| CI gate | `node scripts/release.mjs --check [--expect-tag <ref>]` — build + verify, no git writes; the workflow runs it with `--expect-tag "$GITHUB_REF_NAME"` so a tag that disagrees with `package.json` cannot publish |
| Rollback | install the version-pinned asset URL from an older tag |
| Minification | `minify: false`, permanently: the bundle is what a human pastes into Violentmonkey, and Greasy Fork rejects minified/obfuscated code |

`release.mjs` refuses to tag when the working tree is dirty or when `v<version>`
already exists on origin; the workflow refuses to publish when the tag does not
match `package.json`, when the suite is red, or when the artifact does not start
with the §16.2 banner and carry `@downloadURL`. Every check runs before anything
is created. Re-running a tag re-uploads the asset (`gh release upload --clobber`)
rather than failing on an existing release.

`workflow_dispatch` runs the same chain minus the publish step, so CI can be
exercised without cutting a release.

A Greasy Fork listing stays possible later with no code change (the unminified
bundle satisfies their readability rule); it would then become the canonical
`@downloadURL`, replacing the release URL.


