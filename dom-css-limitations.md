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

**`stylex-is-a-layer`** — `packages/rn-tester/js/astryx/jsx-runtime.js`, `css/match.js`

A StyleX style is taken for what it is on the web, a rule in the `astryx-base`
cascade layer (Astryx's theme orders `reset, astryx-base, astryx-theme`). A
stylesheet rule in a layer above it, or unlayered, beats it, as the theme's
`.astryx-heading[data-level="1"]` does on the web; a rule in that layer or
below sits under it; an inline `style` beats them all. A sheet that orders no
`astryx-base` layer leaves every rule under StyleX, whatever its specificity,
which is what StyleX's specificity bump does on the web.

**`scope-limit-ignored`** — `packages/rn-tester/js/astryx/css/parse.js`

`@scope (<root>) to (<limit>) { … }` scopes its rules under the root selector,
`:scope` standing for the root itself, which is how a built Astryx theme
declares its tokens on `[data-astryx-theme="…"]`. The limit is not applied: a
scoped rule still reaches past a nested root (a second theme inside the
first), and a `&` in a scoped selector is not resolved.

**`clearance-on-an-empty-box`** — `yoga/algorithm/CalculateLayout.cpp`
An empty box with `clear` still lets its margins collapse past it, so the
content after it sits higher than in a browser. Boxes with content clear
correctly.

**`new-formatting-context-overlaps-floats`** — `yoga/algorithm/CalculateLayout.cpp`
A flex container or an `overflow: hidden` block beside a float is laid out at
full width underneath it instead of narrowing or moving down. Only text runs
flow around floats.

**`align-content-default-is-normal`** — `yoga/algorithm/CalculateLayout.cpp`
`align-content: flex-start` or `stretch` on a block counts as `normal`, so the
block keeps collapsing margins with its children where a browser would treat it
as a new formatting context.

**`display-change-needs-remount`** — `Libraries/Renderer/shims/ReactNativeTypes.js`
An element's backing box is chosen at instance creation, so one whose `display`
later crosses the box/no-box boundary (e.g. `inline` → `inline-flex`) keeps its
original backing until it remounts. Browsers destroy and recreate the layout
object at that point. Matching that needs a remount signal the reconciler does
not have. Static display — the overwhelming case, and all of Astryx — is
correct.


`display: grid` and `inline-grid` are not handled and fall through to a parse
error. Yoga has no grid engine, so this is a feature to build rather than a
value to map. Astryx uses it in ~22 places.


A wrapped inline box paints with `box-decoration-break: slice` (the CSS
default) — leading edge on the first fragment, trailing on the last. `clone`,
which repeats both edges on every fragment, is not implemented.

**`layout-transition-events`** — `ReactCommon/.../animationbackend/CSSTransitions.cpp`
A transition of a layout property dispatches no `transitionrun`,
`transitionstart`, `transitionend` or `transitioncancel` (css-transitions-1 §6);
a paint property's (`opacity`, the colours, `transform`) dispatches all four.
The layout flight is `CSSLayoutTransitions`', which lands per node and does not
know which declared property moved it, so a page that waits on `transitionend`
for a `height` transition waits on its own fallback timer.

**`layout-transition-endpoints`** — `ReactCommon/.../animationbackend/CSSLayoutTransitions.h`
A transition of a layout property (`height`, `padding-bottom`) lays out ONCE at
the destination and glides the mounted views between the two real layouts —
the model `UIView animateWithDuration:` and Android's `ChangeBounds` share.
css-transitions-1 instead re-lays-out every frame. Three observable
divergences: content whose layout would change at an intermediate value (text
rewrapping at an in-between height) keeps its endpoint geometry throughout;
`getBoundingClientRect` mid-flight reads the target, not the interpolated
value; and knock-on movement — views moved by the transition without declaring
one — rides the declaring node's clock, with the LONGEST clock governing when
several start in one commit. In exchange a transition costs no commits at
all beyond the author's own — attribution comes from a scratch Yoga pass that
never enters the tree — rather than a tree clone, Yoga pass, diff and
mounting transaction per frame, and a view that a mixed commit moved only for
unrelated reasons lands instantly, per node.

DELIBERATE. The per-frame-commit implementation existed and was replaced; the
approximation is the one both platforms make for their own layout animations,
and the receipts (an entire transcript following a 250ms row-close) are why.

## User-agent styles

All in `packages/expo-intrinsics/src/uaStyles.js`.

**`no-em-units`** — browsers express UA defaults in `em`; we have no
font-relative units, so the sheet stores points computed against a 16px root.
They therefore do not track the user's font size the way the web does.

**`no-native-form-widgets`** — `<button>` and friends get layout defaults but
no platform-drawn appearance. Design systems that restyle controls completely
(Astryx does) are unaffected.

**`no-link-state`** — `<a>` gets no colour or underline, because those depend
on `:link`/`:visited`, which need history state that does not exist here.

**`no-quirks-mode`** — no `quirks.css` equivalent, there being no quirks mode
to be compatible with. Listed so its absence reads as deliberate.

## Platform

**`android-img-is-a-plain-view`** — `ReactAndroid/src/main/java/com/facebook/react/fabric/mounting/mountitems/FabricNameComponentMapping.kt`
`<img>` mounts as a plain View on Android rather than `RCTImageView`, which
expects a different `source` shape — so an `<img>` lays out but draws nothing
there. iOS renders it through the Image machinery.

## Performance


`yoga::Node` is held by value, so an element that generates *no* box — a
span-like inline that folds into its parent's inline formatting context — still
pays 744 bytes for a node it never uses. Making it lazy would make folding
elements *cheaper than they are now*, which is the argument for doing it. It
changes memory layout for every view in the app, so it wants measuring against
a real screen first. Background in `element-model-design.md`.

---

## Every other marked divergence

Each remaining marker, with the file that carries it.

- `ancestor-state-selectors` — limitation, `packages/rn-tester/js/astryx/jsx-runtime.js`
- `aria-activedescendant-native` — limitation, `packages/rn-tester/js/astryx/overlay/activeDescendant.js`
- `client-coordinates-are-not-rect-coordinates` — limitation, `ReactAndroid/src/main/java/com/facebook/react/uimanager/events/PointerEvent.kt`
- `color-mix-spaces` — limitation, `packages/rn-tester/js/astryx/colorMix.js`
- `container-query-is-a-media-query` — deviation, `packages/rn-tester/js/astryx/css/__tests__/parse-test.js`
- `display-on-inline-text-elements` — limitation, `packages/rn-tester/js/astryx/radix/toggles.js`
- `glyph-markers-not-painted` — deviation, `ReactCommon/react/renderer/components/view/ListStyle.h`
- `list-style-type-complex-styles` — limitation, `ReactCommon/react/renderer/components/view/ListStyle.h`
- `no-groove-border` — limitation, `packages/expo-intrinsics/src/uaStyles.js`
- `position-fixed-as-absolute` — limitation, `packages/rn-tester/js/astryx/stylex-rn.js`
- `rem-fixed-root` — limitation, `packages/rn-tester/js/astryx/stylex-rn.js`
- `sibling-combinator-spacing-as-gap` — limitation, `packages/rn-tester/js/astryx/css/index.js`
- `sr-only-not-in-a11y-tree` — limitation, `packages/rn-tester/js/astryx/css/index.js`
- `svg-subset` — limitation, `packages/rn-tester/js/astryx/svg/Svg.js`
- `unitless-line-height-needs-local-font-size` — limitation, `packages/rn-tester/js/astryx/stylex-rn.js`

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
