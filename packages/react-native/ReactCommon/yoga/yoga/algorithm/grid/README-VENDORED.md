# VENDORED: CSS Grid layout algorithm

Everything in this directory is **vendored from unlanded upstream work** and is
not ours to edit. It is here so that `display: grid-lanes` (css-grid-3) can be
built on top of the Grid track sizing algorithm it needs, without waiting for
the upstream series to land.

## Provenance

| | |
| --- | --- |
| Source | https://github.com/react/yoga/pull/1894 — "CSS Grid 2/9: Grid layout algorithm" |
| Author | Nishan Bende (`intergalacticspacehighway`) |
| Opened | 2026-02-25 (still open as of 2026-08-14) |
| Vendored at | this commit |

Files taken verbatim from that PR:

- `AutoPlacement.h` — css-grid-1 §8.5 auto-placement
- `GridLayout.h` / `GridLayout.cpp` — entry point and implicit track creation
- `GridTrack.h` — per-track layout state (`baseSize`, `growthLimit`, …)
- `TrackSizing.h` — css-grid-2 §12 track sizing algorithm

The PR also deletes those same layout-state fields from `style/GridTrack.h`,
where PR 1/9 had originally put them; that deletion is part of this vendor.

## What we changed

Only the integration points, which the PR could not supply because our
`CalculateLayout.cpp` has diverged (block formatting contexts) and our Yoga is
behind upstream:

- `algorithm/CalculateLayout.cpp` — the `Display::Grid` dispatch, placed next to
  our existing `Display::Block` dispatch.
- `yoga/CMakeLists.txt` — the `algorithm/grid/*.cpp` glob. CMake's `**` matches
  a single level, so this nested directory needs naming explicitly. Android
  builds Yoga through this same file; iOS globs recursively via `Yoga.podspec`
  and needs no change.

We deliberately did **not** take the PR's `YGNodeStyle.cpp` hunk: it silences a
GCC `-Wreturn-type` warning with a fallback `return`, and our tree already
handles those switches better with `fatalWithMessage("Unknown YGGridTrackType")`.

## Local fixes

These correctness fixes have been made inside this directory. They are listed
here so the rebase does not silently drop them, and so they can be reported
upstream.

**`GridLayout.cpp` — content-box vs border-box when sizing the container in an
indefinite axis.** The code bounded the track total with Yoga's `boundAxis`,
which floors its result at the node's padding+border. That floor is correct for
a border-box size, but the track total is a CONTENT-box size, so a padded grid
container came out too large in any indefinite axis: a container with 20px of
padding around a single 20px row measured 80px tall instead of 60px. The fix
clamps in border-box space — which is where Yoga's min/max dimensions live —
and converts back. Caught by `container-box-x-fr` in the conformance corpus,
which is pinned against Safari.

**`TrackSizing.h` — the maximize step under a fit-content constraint.** The
free space for §12.5 Maximize Tracks was infinite only under a max-content
constraint. Under a fit-content constraint with no definite size in the axis
(a grid measured by a flex column that has an available height, which is how
a scrolling page measures the grids inside it) the free space stayed at zero,
so an `auto` track whose items are scroll containers — minimum contribution 0
by css-grid-2 §6.6, growth limit their content — never grew: a column of
`overflow: hidden` cards measured as a stack of gaps, and the container then
laid the grid out at that height. A fit-content size is the max-content size
clamped by the available space, so the tracks now grow as under max-content
and the clamp stays the container's. Pinned by
`Libraries/Components/View/__tests__/GridFitContentRows-itest.js`.

**`GridLayout.cpp` — the fit-content clamp in the inline axis.** That clamp
was never applied: a grid measured under a fit-content width (a flex item in a
centered column, which is not stretched) reported its max-content width, so a
grid of cards whose text runs to one long line came out as wide as the line and
pushed its ancestors past the screen. Its width is now min(max-content,
max(min-content, available)) (css-sizing-3 §5.1): past the available width the
tracks are sized again at it, and what they still need is the min-content.
Pinned by `Libraries/Components/View/__tests__/GridAutoRepeatSizedByContent-itest.js`.

Apart from those fixes, no file in this directory has been modified. Keeping it
that way is what makes the eventual rebase cheap — when the upstream series
lands, this directory should be deleted wholesale and replaced, not merged.

**`TrackSizing.h` — an `auto` block size is not a max-content constraint.**
Three steps of §12.5 give an `auto` minimum an item's limited min-content
contribution when the container is sized under a max-content constraint, and
its minimum contribution otherwise; they asked for Yoga's `MaxContent` sizing
mode, which is also how Yoga lays out an `auto` block size. That size is
indefinite free space, not a constraint, so a `0fr` row over an item with
`min-height: 0` and `overflow: hidden` (the accordion idiom: `0fr` closed,
`1fr` open) stood as tall as the item's content where every browser collapses
it, and Astryx's Top Nav drawer drew each closed section at its open height.
Only the inline axis is measured under a real max-content constraint now
(`sizedUnderMaxContentConstraint`); the maximize step still treats either as
infinite free space, which is how `auto` rows grow to their items. Pinned by
`Libraries/Components/View/__tests__/GridZeroFrRow-itest.js`.

**`TrackSizing.h` — a math function with a percentage is a percentage.** Our
Yoga has a unit the PR does not know, `Unit::Calc`, for `calc()`, `min()`,
`max()` and `clamp()` over a percentage. Track sizing asked `isPercent()` to
treat a percentage track as `auto` in an indefinite axis, so a math track there
was neither, and fell through to a branch that assumes it cannot be reached.
It asks `isRelative()`, which is true of both. Pinned with the auto-repeat
count, which reads such a track the same way (`GridAutoRepeat.h`), by
`Libraries/Components/View/__tests__/ViewCalcLength-itest.js`.

## Upstream status

PR #1894 is being re-split into smaller reviewable pieces after review feedback:

- #1923 — CSS Grid algorithm 1/N: data structures (open)
- #1994 — CSS Grid algorithm 2/N: auto-placement (open)

The track-sizing split has not been posted yet, which is why we vendor the
original PR rather than the series.

## Verifying it

`./verify-grid-vendor.sh` at the repo root builds `yogacore` with this directory
in it and lays out a grid, comparing every coordinate against numbers read out
of real Safari for the identical CSS. See `grid-vendor-verify.cpp`.

Broader coverage lives in `grid-lanes-conformance/`, which replays a corpus of
Safari-pinned cases through Yoga's public API: 71 grid cases and 1,010
coordinate assertions, all matching.
