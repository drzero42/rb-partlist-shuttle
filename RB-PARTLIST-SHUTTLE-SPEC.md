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
| D6 | Box identity | Any Part List that is **not** the staging list and **not** on the **ignore-list** is a candidate **box**. The tool is **flag-agnostic** (build-type flags are left to the user for Rebrickable's own build math). |
| D7 | Ignore-list | Name-based list of Part Lists to treat as neither box nor staging (e.g. Spares/Wishlist). Default: empty → every non-staging list is a box. |
| D8 | Category→box map | **Derived live, never hardcoded**, re-built each run from current box contents + resolved categories. Self-updates when a category is re-shelved to a different box type. |
| D9 | Molds | **`fix_molds` OFF (literal)** on every write. The tool must not rewrite part numbers (e.g. must NOT turn `48729b`→`3484`). |
| D10 | Variant matching | **Exact `Part,Color` match only.** No mold/print/alternate fallback. A real variant mismatch surfaces as "missing → abort" (see D11) so the user resolves it, not the tool. |
| D11 | Consume shortfall | **All-or-nothing abort.** If ANY requested `(Part,Color)` qty exceeds what its home box holds, the run makes **zero** writes and reports the offenders. Used for MOCs must end up exactly equal to the MOC list's available subset (no silent partials). |
| D12 | Consume source pool | Consume pulls **only from boxes**, never from `Used for MOCs`. (A part sitting in staging belongs to another MOC.) |
| D13 | Return routing | Live **category inference** → home box by part's category. Ambiguous (0 or ≥2 candidate boxes) → in-page modal **asks** which Part List to use. |
| D14 | Trigger UX | A button injected on the Rebrickable **Custom List** page: "Move → Used for MOCs" / "Move ← Used for MOCs". |
| D15 | Throttle | Rebrickable v3 API is ~1 req/sec (429 → backoff). Import/export site endpoints are user-session, not API-throttled, but requests stay **sequential**. |
| D16 | Safety | Auto CSV backup of every affected list before any write; dry-run/preview; explicit confirm; resumable. |

---

## 3. Domain model

- **Box** = a Part List dedicated to one or more part **categories**. A given
  category lives in **exactly one box type** (invariant). A box may hold multiple
  categories. Within a box, bricks are bagged by part number.
- **Staging** = the single Part List named (by config) `Used for MOCs`. Holds
  bricks currently pulled for assembled/in-progress MOCs. It is **not** a category
  home and must be **excluded** from the category→box map.
- **Custom List** = the MOC's `(Part,Color,Qty)` — the unit of work for a
  consume/return run.
- **Category** = Rebrickable `part_cat_id` / `part_cat_name`. Used only for
  return-direction routing.

Storage invariant (user-stated): one category → one box type; a part+color lives
in at most one box; it can additionally be split between a box and staging
(some committed, some still boxed).

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

### 4.2 Box contents (source lookup + category map)
```
GET https://rebrickable.com/users/<username>/partlists/<list_id>/parts/?format=rbpartscsv&inc_spares=0
```
- Same format, for every candidate box list.

### 4.3 List discovery + staging classification
```
GET https://rebrickable.com/api/v3/users/<user_token>/partlists/?key=<api_key>
```
Returns each list's `list_id`, `descr`, `type` (1=used-in-build, 2=not-used),
`qty`. The tool uses this ONLY to enumerate Part Lists + ids. Classification is by
**name/ignore-list**, not `type` (per D5/D6).
- Alternative (no v3 key): scrape `MY LEGO → My Part Lists` sidebar for links +
  names.

### 4.4 Category resolution (return direction only)
Batch (verified in docs; confirm in Task 0.1):
```
GET https://rebrickable.com/api/v3/lego/parts/?part_nums=<a>,<b>,<c>&inc_part_details=1&key=<api_key>
```
→ per part: `part_num`, `part_cat_id`, `part_cat_name`.
- Public catalog endpoint → needs only the **API key** (free), NOT a user token,
  NOT the password. Still ~1 req/sec; batch via `part_nums`, page with `page_size`
  up to 1000.
- **Keyless fallback:** the rendered Part-List page (and the Import response
  `renders.#user_parts_list`) embeds `data-part_cat_id` / `data-part_cat_name` on
  each part tile → categories can be scraped from HTML instead (many page-loads,
  no API key). Default = API; implement fallback.

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
| `csrfmiddlewaretoken` | hidden input value from the current page | read from DOM, NOT the `csrftoken` cookie (masked per-page in Django) |
| `action` | `A` or `S` | mode selector |
| `import_url` | `""` (empty) | file is used instead |
| `external_source` | `RB` | matches rbpartscsv scheme |
| `fix_molds` | **OMITTED** | checkbox absent → OFF (literal). MUST be absent per D9. Verify (Task 0.2). |
| `file` | the per-list CSV (`Part,Color,Quantity`) | field name `file` |

Required headers: `X-Requested-With: XMLHttpRequest`; browser adds cookies
(session/csrf) automatically same-origin. `Content-Type: multipart/form-data` is
produced by `FormData`.

### 5.3 Response
`application/json`, **synchronous**:
```
{ "status":"success"|"...", "html":"...warnings...", "renders":{ "#user_parts_list":"...", "#parts_count": <int> } }
```
- No polling/progress request observed for a 2-part file.
- Must parse `status` and surface `html` warnings to the user (never silent).
- `#parts_count` gives the post-change line count → use for verification (see 7.5).
- **Task 0.3:** confirm large MOC-sized single files stay synchronous vs becoming
  a multi-step confirm/progress (would change the atomicity model).

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

Note: consume does NOT require categories at all (exact content-match). So consume
works with session cookies only (no API key, minimal throttle exposure).

### 6.2 Return — Used for MOCs → boxes
Input: the same Custom List rows (what this MOC consumed). Steps:
1. Classify lists as above.
2. Read staging contents (for availability check) + all box contents.
3. Resolve `category → box` **live**: for each part+color in each **box**, get its
   category (via 4.4). A category's home box = the box containing parts of that
   category. (If a category appears in ≥2 boxes → ambiguous; if a category appears
   in 0 boxes — fully consumed — cannot infer.)
4. For each MOC row to return: home box = box owning that part's category.
   - clean single box → route there;
   - 0 or ≥2 candidate boxes → **modal ask** (D13).
5. Pre-validate staging holds ≥ requested qty per `(Part,Color)`; if not,
   **abort** (mirror of D11).
6. Preview + confirm.
7. Apply:
   a. For each destination box: `Append` its subset (`action=A`).
   b. For staging: `Subtract` the returned CSV (`action=S`).

### 6.3 Empty-category caveat (honest limitation)
Because state is never persisted, if an entire category currently lives only in
staging (no box holds any part of it), return cannot infer that category's home
box → it must ask. This is the accepted price of "derive live, store nothing"
(the user chose it) and should be surfaced clearly, not guessed.

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
5. **Post-write verify**: compare `#parts_count` / re-fetch a list to confirm the
   intended delta; report mismatches loudly.
6. **Throttle discipline**: no parallel calls; treat 429 as retry-with-backoff.
7. **Idempotency guard**: detect if a run is re-applied (e.g. staging already
   contains the MOC rows) and refuse to double-count without explicit override.
8. **Error surfacing**: show the server `html`/warnings verbatim in the UI.

---

## 8. UI

- Inject a toolbar button on **Custom List** pages (`/users/<u>/lists/<id>/`):
  - "🧱 → Used for MOCs (consume)"
  - "🧱 ← Used for MOCs (return)"
- Small settings panel (persisted via `GM_setValue`) for: staging name, box
  ignore-list, default `dry-run`, and API-key presence toggle for category mode.
- Preview + ambiguity modals (in-page, `GM_addStyle`) with a `<select>` of
  candidate Part Lists; optional "remember for this run" (session-scoped only).
- Progress log for the sequential apply.

---

## 9. Config keys (GM storage)

| key | default | purpose |
|-----|---------|---------|
| `stagingName` | `Used for MOCs` | exact-match staging list name |
| `ignoreLists` | `[]` | Part List names to treat as neither box nor staging |
| `categoryMode` | `api` (else `dom`) | category source for return |
| `apiKey` | (empty) | public catalog key for category batch (return only) |
| `defaultDryRun` | `true` | always preview |

No username/password stored. API key only for return-direction category reads.

---

## 10. Security / ToS notes

- Runs same-origin with the user's own session; performs operations the user can
  already do manually via Import — automated, not elevated.
- Credentials: at most a **read-only public catalog API key** (return only). Never
  the login password. CSRF token is read from the page, not extracted from an
  HttpOnly cookie.
- Flag fragility: internal import/export URLs are undocumented; on breakage, fall
  back to the official v3 API write path (documented, slower, needs user token —
  see 13).

---

## 11. Architecture (suggested modules)

- `reconcile.js` — pure functions: partition MOC rows by box; feasibility/abort;
  category→box; unit-testable with fixture CSVs (no network).
- `rb-read.js` — session export fetch (`lists` + `partlists` `?format=rbpartscsv`),
  list enumeration.
- `rb-write.js` — `importparts/slow/` POST builder (FormData), csrf handling,
  response parse, backoff.
- `rb-category.js` — category resolution: API batch (`/lego/parts/`) with DOM fallback.
- `ui.js` — button injection, preview/ambiguity modals, progress, settings.
- `safety.js` — backup-before-write, resumable journal (session/local), verify.

Keep `reconcile.js` network-free and fully unit-tested — it holds all the risky
logic (abort rules, partitioning, category routing).

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
and call `__task0({ boxListIds: ['<one box id>'] })` — recommended: the account has
15 Part Lists, and without a scope the probe walks every sidebar link (~30 reads)
just to find a large list for 0.3. `__task0()` walks the sidebar; adding
`apiKey` includes the 0.1 v3 check. It Appends, reads back, Subtracts, and prints
a verdict table plus JSON evidence.

- It refuses to write unless the list NAME matches `/^(task\s*0|scratch|probe|test)/i`,
  refuses the staging name outright, and requires a typed `TASK0` gate — the §12
  "never against real boxes" rule enforced in code, not just in prose.
- Box lists are touched **read-only** (for 0.3's row source); the only list written
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

| item | verdict | outcome / adopted alternative | date |
|------|---------|-------------------------------|------|
| 0.1 | pending | | |
| 0.2 | pending | | |
| 0.3 | pending | | |
| 0.4 | pending | | |
| 0.5 | declared | no spare parts in this account (user-declared) → `inc_spares` default **OFF**; not probed | 2026-10-06 |
| 0.6 | pending | | |

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
- Very large MOCs could exceed the site Import's comfort (mitigated by per-box
  partition = bounded files + 0.3 verification).
- Return routing depends on the storage invariant (each category one box). If the
  invariant is ever violated, the tool asks rather than guesses.
- If a category is entirely consumed (no box has it), return can't infer the home
  box → prompts (§6.3).

---

## 15. Definition of done (MVP)

1. Consume a Custom List into `Used for MOCs`, exact quantities, all-or-nothing,
   preview + confirm, backup + verify — no API key needed.
2. Return the same Custom List back to home boxes via live category inference,
   ambiguity prompts, exact quantities, preview + confirm.
3. `fix_molds` provably OFF (0.2). Staging + ignore-list classification provably
   flag-independent and name-based (D5/D6/D7).
4. Resumable + throttle-safe sequential writes. No stored password.

---

## 16. Naming & userscript metadata

### 16.1 The name

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
- `GM_getValue`/`GM_setValue` back the §9 config keys. No password is ever
  stored (§10); `apiKey` is a read-only public catalog key.

### 16.3 Module filenames

§11's module names are unchanged and stand on their own — no `shuttle` prefix
needed inside the repo: `reconcile.js`, `rb-read.js`, `rb-write.js`,
`rb-category.js`, `ui.js`, `safety.js`.

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


