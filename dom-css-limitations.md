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

**`no-grid`** — `ReactCommon/.../components/view/conversions.h`
`display: grid` and `inline-grid` are not handled and fall through to a parse
error. Yoga has no grid engine, so this is a feature to build rather than a
value to map. Astryx uses it in ~22 places.

**`no-box-decoration-break-clone`** — `.../ios/.../RCTTextLayoutManager.mm`
A wrapped inline box paints with `box-decoration-break: slice` (the CSS
default) — leading edge on the first fragment, trailing on the last. `clone`,
which repeats both edges on every fragment, is not implemented.

## Platform

**`android-img-is-a-plain-view`** — `ReactAndroid/src/main/java/com/facebook/react/fabric/mounting/mountitems/FabricNameComponentMapping.kt`
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

## Every other marked divergence

Each remaining marker, with the file that carries it.

- `client-coordinates-are-not-rect-coordinates` — limitation, `ReactAndroid/src/main/java/com/facebook/react/uimanager/events/PointerEvent.kt`
- `glyph-markers-not-painted` — deviation, `ReactCommon/react/renderer/components/view/ListStyle.h`
- `list-style-type-complex-styles` — limitation, `ReactCommon/react/renderer/components/view/ListStyle.h`
- `white-space-break-spaces-hangs` — limitation, `ReactCommon/react/renderer/attributedstring/conversions.h`
