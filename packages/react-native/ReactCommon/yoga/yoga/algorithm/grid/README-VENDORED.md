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

One correctness fix has been made inside this directory. It is listed here so
the rebase does not silently drop it, and so it can be reported upstream.

**`GridLayout.cpp` — content-box vs border-box when sizing the container in an
indefinite axis.** The code bounded the track total with Yoga's `boundAxis`,
which floors its result at the node's padding+border. That floor is correct for
a border-box size, but the track total is a CONTENT-box size, so a padded grid
container came out too large in any indefinite axis: a container with 20px of
padding around a single 20px row measured 80px tall instead of 60px. The fix
clamps in border-box space — which is where Yoga's min/max dimensions live —
and converts back. Caught by `container-box-x-fr` in the conformance corpus,
which is pinned against Safari.

Apart from that fix, no file in this directory has been modified. Keeping it
that way is what makes the eventual rebase cheap — when the upstream series
lands, this directory should be deleted wholesale and replaced, not merged.

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
