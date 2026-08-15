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
