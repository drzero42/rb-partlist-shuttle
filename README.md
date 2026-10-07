# Rebrickable Part List Shuttle

A [Violentmonkey](https://violentmonkey.github.io/) userscript for
[Rebrickable](https://rebrickable.com/). When you build a MOC, it moves exactly
that MOC's parts out of your storage-box Part Lists and into a "used" Part List.
When you take the MOC apart, it moves them back, each part to the box it
belongs in. It does this in one click, with no CSV export/import by hand.

## Why

If your Part Lists mirror your physical storage (one Part List per kind of
box), building a MOC leaves Rebrickable out of date: the bricks are in the
model, not in the boxes. Fixing that by hand means subtracting the MOC's parts
from each box list and adding them to a "used" list, then doing the reverse
when the MOC comes apart. This script does both, exactly and safely.

## How it works

You keep:

- **Box lists**: Part Lists for your storage, one per box type, e.g.
  `Small storage boxes`, `Sorting boxes`. A list counts as a box list when its
  name matches a pattern; by default, any name containing the word *box* or
  *boxes*.
- **A used list**: one Part List for bricks that are built into MOCs. By
  default it's named `Used for MOCs`. It's shared by all your MOCs.
- **A Custom List per MOC**, holding that MOC's parts.

On a Custom List's page, the script adds two buttons next to **Bulk Edit**:

- **Consume → Used for MOCs** subtracts every part of this Custom List from
  the box list that holds it, and adds it to the used list.
- **Return ← Used for MOCs** subtracts the parts from the used list and adds
  each one back to its home box list.

For **Return**, a part's home is decided by its Rebrickable **category**. Each
category is expected to live in one box list (e.g. all *Plates* in
`Small storage boxes`). The script looks at what your box lists currently hold
to see which box owns which category. That way a part goes home even if its
box has none of it left. To find each part's category, it uses Rebrickable's
public parts catalogue, downloaded at most once a day and cached.

The script never records where bricks came from. Everything is worked out
fresh from your lists on each run.

## Safety

- **Preview first.** Nothing changes until you've seen exactly what will be
  subtracted from and added to each list, and clicked **Back up and write**
  (or **Write** without a backup).
- **All or nothing.** If any part is missing or short, nothing is written, and
  the preview shows which parts.
- **It asks instead of guessing.** For example, it asks when a part is in two
  box lists, or when a category isn't in exactly one box. Your answer applies
  to that run only.
- **Backups.** Unless you untick **Download a backup of each list first** in
  the preview (it's ticked on every run), it downloads a CSV of every list
  it's about to change to your browser's download folder before writing, named
  `rbps-<list name>-<list id>-<timestamp>.csv`. To undo, open that list on
  Rebrickable and use **Import → Replace** with the file.
- **Every write is checked.** After each change, the list is re-read and
  compared part by part with what it should contain. The run stops on any
  difference, including Rebrickable renaming a part during import, and tells
  you what was and wasn't done.
- **No password, no API key.** It works through your normal logged-in
  Rebrickable session, doing what you could do by hand on the Import page.

## Install

1. Install the [Violentmonkey](https://violentmonkey.github.io/get-it/) browser
   extension.
2. Open
   **[rb-partlist-shuttle.user.js](https://github.com/drzero42/rb-partlist-shuttle/releases/latest/download/rb-partlist-shuttle.user.js)**
   and confirm the install.

The script asks for permission to connect to `cdn.rebrickable.com`. That's
where it downloads the public parts catalogue.

## Update

Violentmonkey checks for new versions automatically. To check now, open the
Violentmonkey dashboard and click **Check for updates**. To go back to an older
version, install the `.user.js` file from that version's
[release](https://github.com/drzero42/rb-partlist-shuttle/releases).

## Use

1. Make sure you have a used list (default name `Used for MOCs`), and box lists
   whose names match the box pattern.
2. Put the MOC's parts in a Custom List and open it on Rebrickable.
3. Click **Consume → Used for MOCs** when you build the MOC, or
   **Return ← Used for MOCs** when you take it apart.
4. Read the preview:
   - Answer any questions.
   - Check the box lists and non-box lists it found.
   - Expand the per-list sections to see every part.
5. Leave **Download a backup of each list first** ticked (recommended), click
   **Back up and write** (or **Write** if unticked) and wait. Each list takes a few seconds, and the
   panel shows progress.

### Settings

Click the **⚙** button next to the others:

- **Used list name**: the exact name of your used list.
- **Box list pattern**: a case-insensitive regular expression; Part Lists whose
  names match are box lists. The default `\bbox(?:es)?\b` matches
  `Small storage boxes` and `Sorting box`, but not `Matchbox cars` or
  `Ordered from LEGO`.

## Limitations

- Exact parts only: a different mould or print (e.g. `48729a` vs `48729b`)
  counts as a different part.
- Spare parts are ignored.
- If Rebrickable merges parts into an assembly during import (e.g. `4592` +
  `4593` → `298c02`), the run stops and reports it rather than working around
  it.
- Tested with Violentmonkey in Firefox. Other userscript managers may work but
  aren't supported.

## Development

Needs Node 26 and pnpm 12; [devenv](https://devenv.sh/) provides both.

```
pnpm install
pnpm test           # unit tests for the CSV and planning logic
pnpm run build      # dist/rb-partlist-shuttle.user.js
pnpm run dev        # rebuild on change
```

The design is described in
[`RB-PARTLIST-SHUTTLE-SPEC.md`](RB-PARTLIST-SHUTTLE-SPEC.md). Releases are
published by GitHub Actions when a `v*` tag is pushed (`pnpm run release`).

## License

[MIT](LICENSE)
