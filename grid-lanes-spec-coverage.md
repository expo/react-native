# CSS Grid Lanes — section-by-section coverage

What of [css-grid-3](https://drafts.csswg.org/css-grid-3/) the `grid-lanes`
branch implements, section by section, and where each claim is checked. A
number on its own is not a compliance statement; this is meant to be audited
against the spec text.

Status is one of:

- **done** — implemented and pinned by a test that fails without it
- **n/a** — the section describes something React Native has no notion of
- **not implemented** — with the reason, and what it would take

Every "done" row names where it is checked. Four harnesses run the same case
list, so a claim holds in the engine, through React Native, and on both
platforms:

| harness | what it proves |
| --- | --- |
| `grid-lanes-conformance/oracle.js` | the expected values are real Safari's, not typed in |
| `replay.cpp` | Yoga's own layout, through the C API |
| `Grid-itest.js` (Fantom) | the whole RN path — style prop, parser, props wiring |
| `grid-conformance-verify.js` | iOS and Android, over CDP, through the real layout pass |

---

## 2. Grid Lanes Layout Model

| § | | |
| --- | --- | --- |
| 2.1 | Reordering and accessibility | **not implemented** — `order` |
| 2.2 | Establishing grid lanes layout | **done** (inner display); outer display below |
| 2.3 | Orienting grid lanes layout | **done** |

`order` does not exist in Yoga or in React Native's style surface, so a lanes
container cannot honour it. The corpus keeps the case (`lanes-order-0113`) and
every harness reports it as unsupported rather than skipping it.

`display: 'grid-lanes'` and `'inline-grid-lanes'` both parse, both produce
lanes layout inside, and the *outer* displays differ as they should: an
inline-level lanes container sits on a line and shrink-wraps to its content.
The inline-level displays never reach Yoga — they are resolved at box
generation in `YogaStylableProps` — so `inline-grid` and `inline-grid-lanes`
are members of `displayInline`/`displayInlineAtomic` there alongside
`inline-block`. The two corpus cases (`inline-level-container-0180/0181`) hold
Safari's numbers and are asserted.

§2.3 is the rule that the grid axis is the inline axis unless **only** rows
were given — the "brick" layout that grows sideways. Covered by
`lanes-brick`, and by every other lanes case implicitly, since getting it
backwards transposes the whole layout.

## 3. Grid Lanes Track Specification

| § | | |
| --- | --- | --- |
| 3.1 | `grid-template-*` | **done** |
| 3.1.1 | Intrinsic tracks and `repeat()` | **done** |
| 3.2 | Subgrids | **not implemented** |
| 3.3 | `repeat()` | **done** |
| 3.3.1 | `repeat(auto-fit)` | **done** |
| 3.4 | Grid axis track sizing | **done** |
| 3.4.1 | Subgrid item contributions | **n/a** — no subgrid |
| 3.4.2 | Optimized track sizing | **n/a** — an optimization, not observable |

Track lists are the CSS you already know, parsed from a string:
`lanes-tracks-fixed`, `-fr`, `-pct`, `-auto`, `-minmax`, `-mixed`, and
`lanes-repeat-forms` for the four `repeat()` shapes. `auto-fill` is swept
across container widths so an off-by-one in the repetition count shows up as a
different layout rather than a small delta.

§3.4 is the sizing rule specific to lanes: an item with a definite grid-axis
position contributes to the tracks it occupies, and an auto-placed one
contributes to **every** position it could occupy. `lanes-tracks-auto` and
`lanes-content-sized` cover it; getting it wrong sizes tracks from one item
instead of all of them.

`subgrid` is not supported in Grid either, and is recorded in
`dom-css-limitations.md`.

## 4. Grid Lanes Item Placement

| § | | |
| --- | --- | --- |
| 4.1 | `grid-column-*` / `grid-row-*` | **done** |
| 4.2 | `flow-tolerance` | **done** |
| 4.3 | `dense` | **done** |
| 4.4 | The placement algorithm | **done** |
| 4.4.1 | Containing block | **done** |
| 4.4.2 | Placement and writing modes | **done** |

This is the heart of the spec and carries the most coverage: 25 of the 57
grid-lanes case groups are placement.

`flow-tolerance` is covered in all four forms — `normal` (1em, so the case's
`font-size` decides it), a length, a percentage, and `infinite` — with a
12-point sweep across the threshold and a 9-case boundary series either side
of it, because the property's whole job is to change which lane an item picks
and a value that never changes the answer proves nothing.

**The percentage form is the one place the oracle cannot be believed.** Safari
parses `flow-tolerance: 5%` — `CSS.supports` returns true — but does not
resolve it: 5%, 10% and 25% produce byte-identical layouts, which is
impossible if the percentage is being applied. Those three cases are marked as
an oracle limitation and pinned instead by
`grid-lanes-conformance/percentage-tolerance-test.cpp`, which derives its
expectations from §4.4 and writes the derivation out.

§4.4.2 (writing modes) is covered by `lanes-direction` under `direction: rtl`,
which React Native has as a style — so the RN and device harnesses run it too,
not just the engine.

## 5. Sizing Grid Containers

**done.** `lanes-fixed-height`, `lanes-intrinsic-height`, `lanes-underfull`,
`lanes-x-container-box` (padding and border), and `lanes-container-min-max`,
which is the interesting half: a `max-height` that bites has to clamp the
container *without* moving the items, and a `min-width` that bites has to widen
the tracks rather than leave them where the content put them.

The container's stacking-axis size is the longest lane, and the trailing gap
is not part of it — a gap sits *between* items, and there is nothing after the
last one. That off-by-one was a real bug during development.

## 6. Alignment and Spacing

| § | | |
| --- | --- | --- |
| 6.1 | Gutters | **done** |
| 6.2 | Grid-axis alignment | **done** |
| 6.3 | Stacking-axis content distribution | **done** |
| 6.4 | Stacking-axis self alignment | **done** |
| 6.5 | Baseline alignment | **partial** — see below |

§6.3 and §6.4 were the last two to land, and **Safari cannot adjudicate
either**:

- **§6.4 it does not implement at all.** `start`, `center`, `end` and
  `stretch` produce byte-identical geometry there, and `align-self` on a single
  item moves nothing. An oracle that agrees with every value cannot tell a
  correct implementation from one that ignores the property — which is exactly
  why the corpus did not catch this for so long.
- **§6.3 it mis-distributes.** The positional values are right, and those
  cases stay pinned to it. But `space-around` shifts the content by 52.5 and
  `space-evenly` by 70, which are the offsets you get by treating the deepest
  lane's *item count* as the number of alignment subjects — the grid
  row-distribution rule leaking into an axis that has no rows. §6.3 says there
  is only ever one subject (the stacking range), so both fall back to `center`,
  which is 105.

Those cases therefore keep Safari's grid-axis measurements — where it is
authoritative — and replace only the stacking-axis position with a
spec-derived value, declared in `cases.js` next to the reason. The derivations
are written out step by step in
`grid-lanes-conformance/stacking-alignment-test.cpp`.

`lanes-brick-stacking-align` runs §6.4 in a brick layout, where the stacking
axis is the *inline* one and the properties are `justify-*` rather than
`align-*`. It has its own branch in the implementation, and a sign error there
would show up nowhere else.

On `normal` and `stretch` in the stacking axis: both are treated as `start`.
§6.3's note says so outright for content distribution — "the behavior of normal
and stretch is identical to start" — and self alignment gets the same reading.
It is also the only reading that keeps a waterfall working: Yoga's default
`align-items` is `stretch`, so filling the void instead of ignoring it would
make every lanes container drag its last items down to the deepest lane
without anyone asking.

**§6.5 is partial.** Baseline alignment inside the grid-axis tracks works as
it does for a regular grid container. What is missing is the container's own
baseline export in the stacking axis — §6.5's "first baseline set … from the
highest alignment baseline among the grid items placed first in each track".
It matters only when a lanes container is itself a baseline-aligned flex or
grid item. Recorded in `dom-css-limitations.md`.

## 7. Fragmentation

**n/a.** React Native has no fragmentation — no pages, no columns, no regions
— so §7.1 and §7.2 describe machinery that does not exist here.

## 8. Absolute Positioning

**done**, and this section found a bug. An absolutely-positioned child takes
no part in placement, so it is skipped when items are collected — which is the
natural way to write it, and leaves the child never laid out at all. It kept
whatever geometry it last had. Grid runs `layoutAbsoluteDescendants` at the end
of its own algorithm; lanes had no such tail.

`lanes-absolute` covers it in all four harnesses, and removing the fix makes it
fail at 0,0 instead of 30,20. `lanes-display-none` covers the neighbouring
case: a hidden child must take no lane and keep no stale box.

Grid areas as containing blocks for out-of-flow children are not supported —
the container's content box is used instead. That is the same TODO Grid
carries.

## 9. Graceful Degradation

**n/a.** This section is about what a browser that does *not* support grid
lanes should do with the declaration.

---

## Where the numbers come from

348 corpus cases, of which 148 are grid-lanes. Per harness:

| | cases | assertions | mismatches |
| --- | --- | --- | --- |
| `replay.cpp` (Yoga) | 340 | 5,898 | 0 |
| Fantom (React Native) | 341 | — | 0 |
| iOS simulator | 341 | 5,916 | 0 |
| Android emulator | 341 | 5,916 | 0 |

The full Fantom suite is unaffected: 3,508 passing, nothing failing.

Seven cases run in no consumer, each for a stated reason: three percentage
`flow-tolerance` cases Safari cannot adjudicate (covered by the C++ test
instead), `order`, and `min-content` as a
*maximum*, which Yoga cannot distinguish from `auto`. Harnesses report these as
UNSUPPORTED with the reason rather than skipping them, because coverage that
shrinks quietly reads as a pass.
