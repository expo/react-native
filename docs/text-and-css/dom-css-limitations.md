# Known limitations: DOM elements and CSS

Every limitation here is marked **at the code that has it**, with a greppable
token, so this file cannot quietly drift out of date:

```
grep -rn "DOM-CSS-LIMITATION(" packages/react-native --include=*.js \
  --include=*.h --include=*.cpp --include=*.mm --include=*.kt
```

That command is the source of truth. This file is an index of what those
markers say and why, for reading before you go looking.

The convention: `DOM-CSS-LIMITATION(slug)` in a comment beside the code, then
a sentence on what does not work and what it would take. Adding a limitation
means adding a marker; the slug is what ties it to the row below.

---

## Layout and box generation

**`display-change-needs-remount`** — `Libraries/Renderer/shims/ReactNativeTypes.js`
An element's backing box is chosen at instance creation, so one whose `display`
later crosses the box/no-box boundary (e.g. `inline` → `inline-flex`) keeps its
original backing until it remounts. Browsers destroy and recreate the layout
object at that point. Matching that needs a remount signal the reconciler does
not have. Static display — the overwhelming case, and all of Astryx — is
correct.

**`no-grid`** — `ReactCommon/.../components/view/conversions.h`
`display: grid` and `inline-grid` are not handled and fall through to a parse
error. Yoga has no grid engine, so this is a feature to build rather than a
value to map. Astryx uses it in ~22 places.

**`inline-box-ltr-only`** — `ReactCommon/.../components/text/InlineBoxProps.cpp`
Inline box edge resolution assumes LTR: "leading" means left. RTL needs the
resolved direction threaded through to where the edges are consumed, in both
the advance and the painting.

**`no-box-decoration-break-clone`** — `.../ios/.../RCTTextLayoutManager.mm`
A wrapped inline box paints with `box-decoration-break: slice` (the CSS
default) — leading edge on the first fragment, trailing on the last. `clone`,
which repeats both edges on every fragment, is not implemented.

## User-agent styles

All in `Libraries/DomElements/uaStyles.js`.

**`no-em-units`** — browsers express UA defaults in `em`; we have no
font-relative units, so the sheet stores points computed against a 16px root.
They therefore do not track the user's font size the way the web does.

**`no-list-markers`** — `<ul>`/`<ol>` get the 40pt marker gutter, but no marker
is drawn: there is no `::marker` and no generated content, so a list indents
without bullets.

**`no-native-form-widgets`** — `<button>` and friends get layout defaults but
no platform-drawn appearance. Design systems that restyle controls completely
(Astryx does) are unaffected.

**`no-link-state`** — `<a>` gets no colour or underline, because those depend
on `:link`/`:visited`, which need history state that does not exist here.

**`no-quirks-mode`** — no `quirks.css` equivalent, there being no quirks mode
to be compatible with. Listed so its absence reads as deliberate.

## Platform

**`android-img-is-a-plain-view`** — `.../fabric/mounting/mountitems/FabricNameComponentMapping.kt`
`<img>` mounts as a plain View on Android rather than `RCTImageView`, which
expects a different `source` shape — so an `<img>` lays out but draws nothing
there. iOS renders it through the Image machinery.

## DOM APIs

**`client-coordinates-are-not-rect-coordinates`** — `.../uimanager/events/PointerEvent.kt`
On Android a pointer event's `clientX`/`clientY` are relative to the React root
view — the file says so out loud — while `getBoundingClientRect()` is relative
to the screen. CSSOM-View has both in the same space, and code that mixes them
(hit-testing a rect against a pointer, positioning something under the finger)
is off by wherever the root view sits, which on a phone is the status bar and
anything above the surface. They agree on iOS only because the root view is at
the window origin there, so the bug is invisible on the platform most people
develop on. The event also carries `screenX`/`screenY`, which DO match the
rects, so the mismatch is reachable-around but not obvious. Fixing it means
changing the coordinate space of one of two shipped APIs, which is a decision
about every app rather than about this feature.

## Text selection

**`user-select-auto-is-none`** — `ReactCommon/.../components/view/primitives.h`
On the web, text is selectable everywhere unless something says otherwise, and
`user-select: auto` resolves against the parent's used value. Here `auto` means
*not* selectable, and the value is read on the element that paints the text
rather than inherited. Both deviations exist for the same reason: React Native
has never made text selectable without being asked, and `<Text selectable>` is
per-element too, so this matches what already ships. Turning `auto` into the
web's auto would make every string in every existing app selectable.

**`no-range-selection-on-runs`** — `.../views/view/ReactViewGroup.kt`
A long press on selectable text offers **Copy**, which copies all of the
element's text; the web selects the range you drag over. On iOS this is exactly
what `<Text selectable>` does, so there is no gap there. On Android
`<Text selectable>` does better — it routes to a real `TextView` and gets drag
handles — and matching that here means hosting a `TextView` per run, whose
views land in the child list Fabric mounts into and would need every index
translated.

## Performance

**`eager-yoga-node`** — `ReactCommon/.../components/view/YogaLayoutableShadowNode.h`
`yoga::Node` is held by value, so an element that generates *no* box — a
span-like inline that folds into its parent's inline formatting context — still
pays 744 bytes for a node it never uses. Making it lazy would make folding
elements *cheaper than they are now*, which is the argument for doing it. It
changes memory layout for every view in the app, so it wants measuring against
a real screen first. Background in `element-model-design.md`.

---

## CSS Grid

- **`DOM-CSS-LIMITATION(grid-fit-content-limit)` — `fit-content(x)` drops its
  `x` ceiling.** The value is `max(min-content, min(max-content, x))`; Yoga's
  FitContent sizing function takes no argument, so the max-content clamp is
  honoured and the ceiling is not. The alternative mapping, `minmax(auto, x)`,
  keeps the ceiling but loses the clamp, which is worse — the track would grow
  to `x` whenever there is free space, however narrow the content. The ceiling
  can only bind when min-content < x < max-content, i.e. for content that
  reflows, which is also why the conformance corpus cannot catch it: every case
  there is a fixed-size box, deliberately, so that no case depends on a font.
- **`DOM-CSS-LIMITATION(grid-min-content)` — `min-content` as a MAXIMUM sizing
  function behaves as `auto`.** Yoga has no min-content sizing function. Its
  `auto` minimum IS the automatic minimum size, which is min-content for a
  non-scrollable box, so `min-content` as a minimum is correct; only the
  maximum position is approximated.
- **`grid-auto-flow` is fully implemented** — `row`, `column`, and either with
  `dense`. Column flow runs the row algorithm in transposed space rather than
  duplicating it: every axis-specific read is swapped on the way in and the
  resulting placements swapped back on the way out, so nothing in between knows
  which flow it is running.
- **`grid-template-areas` is implemented; NAMED GRID LINES are not.** An item
  is placed by area name (`gridArea: 'header'`) or by line number, but a track
  list cannot declare `[names]` and `grid-column: main-start / main-end` will
  not resolve.
- **`DOM-CSS-LIMITATION(grid-unknown-area-name)` — an item naming an area that
  does not exist falls back to auto placement.** css-grid-2 §8.3 places it
  against IMPLICIT lines carrying that name, which creates implicit tracks and
  puts the item outside the grid. Auto placement is the friendlier reading of a
  typo, and the spec behaviour is obscure enough that it is more likely to be
  read as a bug than as conformance — but it is a divergence, recorded here
  rather than asserted as correct in the corpus.
- **`subgrid` is not implemented.**

## CSS Grid Lanes

Section-by-section coverage is in `grid-lanes-spec-coverage.md`; these are the
divergences.

- **`DOM-CSS-LIMITATION(lanes-order)` — `order` is not supported.** css-grid-3
  §2.1 reorders items before placement. Neither Yoga nor React Native's style
  surface has `order`, so this is not a lanes limitation so much as an engine
  one, and it applies equally to flex and grid.
- **`DOM-CSS-LIMITATION(lanes-inline-level)` — `inline-grid-lanes` is
  block-level.** The INNER display is right — it lays out as lanes — but the
  outer one is not, so the container fills its parent instead of shrink-
  wrapping. The inline-level displays are resolved at box generation in
  `YogaStylableProps` and never reach Yoga; closing this means adding
  `inline-grid` and `inline-grid-lanes` to `displayInline`/`displayInlineAtomic`
  alongside `inline-block`. Deliberately left for the `display: 'inline'` work
  rather than done here, since it changes box generation that the grid branch
  otherwise does not touch. `inline-grid` has the same gap.
- **`DOM-CSS-LIMITATION(lanes-baseline-export)` — a lanes container does not
  export a baseline.** Baseline alignment *inside* the grid-axis tracks works
  as it does for a regular grid container (css-grid-3 §6.5). What is missing is
  the container's own first/last baseline set in the stacking axis — "the
  highest alignment baseline among the grid items placed first in each track" —
  which matters only when a lanes container is itself a baseline-aligned flex
  or grid item.
- **`DOM-CSS-LIMITATION(lanes-abspos-containing-block)` — a grid area cannot be
  the containing block for an out-of-flow child.** css-grid-3 §8 lets
  `grid-column`/`grid-row` on an absolutely-positioned child pick out a grid
  area; the container's content box is used instead. Grid carries the same TODO,
  and the two should be fixed together.
- **Safari is not the oracle for §6.3 and §6.4.** It does not implement
  stacking-axis self alignment at all, and it distributes the stacking axis as
  though the lanes had rows. The affected cases keep Safari's grid-axis
  measurements and take spec-derived stacking positions, declared in `cases.js`
  and derived in `stacking-alignment-test.cpp`. Recorded here because a future
  Safari that fixes either one will make those cases look like regressions.

---

## Not limitations, though they look like ones

Recorded because each has been mistaken for a bug at least once:

- **Block-axis padding on an inline box does not grow the line box.** That is
  CSS2 §10.6.1 — it overflows instead. The painting paths widen only their
  drawing surface to avoid clipping it.
- **`<b>` and `<strong>` render identically.** They are separate elements with
  separate `tagName`s; identical rendering is what the UA sheet specifies.
- **Fantom cannot observe a font-size change.** Its measurer is a fixed width
  per character, so heading sizes must be checked on device — see
  `packages/rn-tester/scripts/inline-metrics-verify.js`.
- **12 LogBox Fantom suites fail.** Pre-existing upstream stale snapshots;
  `frontier` fails identically under a clean-snapshot protocol. Note that the
  runner **rewrites snapshots on failure**, so re-running masks it and
  invalidates any comparison made afterwards — restore them first.
