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

**`no-box-decoration-break-clone`** — `.../ios/.../RCTTextLayoutManager.mm`
A wrapped inline box paints with `box-decoration-break: slice` (the CSS
default) — leading edge on the first fragment, trailing on the last. `clone`,
which repeats both edges on every fragment, is not implemented.

**`escaped-margin-walk-approximations`** — `yoga/algorithm/CalculateLayout.cpp`
Two approximations in the walk that folds descendant margins escaping through a
block container's edges. Descendants of self-collapsing boxes are not walked,
so a margin escaping from inside one does not reach the owner's flow; and a
percentage margin resolves against the measured width of the box being walked
rather than against the margin's own containing block, which differ once the
walk has descended a level. Both were documented in the code as deliberate and
carried no marker, so neither reached this file. Recorded rather than measured:
they need nesting deep enough that the corpus has not produced either.

## Performance

**`eager-yoga-node`** — `ReactCommon/.../components/view/YogaLayoutableShadowNode.h`
`yoga::Node` is held by value, so an element that generates *no* box — a
span-like inline that folds into its parent's inline formatting context — still
pays 744 bytes for a node it never uses. Making it lazy would make folding
elements *cheaper than they are now*, which is the argument for doing it. It
changes memory layout for every view in the app, so it wants measuring against
a real screen first. Background in `element-model-design.md`.

---

## Every other marked divergence

Each remaining marker, with the file that carries it.

- `client-coordinates-are-not-rect-coordinates` — limitation, `ReactAndroid/src/main/java/com/facebook/react/uimanager/events/PointerEvent.kt`
- `glyph-markers-not-painted` — deviation, `ReactCommon/react/renderer/components/view/ListStyle.h`
- `list-style-type-additive-scripts` — limitation, `ReactCommon/react/renderer/components/view/ListStyle.h`
- `white-space-break-spaces-hangs` — limitation, `ReactCommon/react/renderer/attributedstring/conversions.h`
