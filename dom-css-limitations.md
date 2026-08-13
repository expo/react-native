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

**`escaped-margin-walk-approximations`** — `yoga/algorithm/CalculateLayout.cpp`
Two approximations in the walk that folds descendant margins escaping through a
block container's edges. Descendants of self-collapsing boxes are not walked,
so a margin escaping from inside one does not reach the owner's flow; and a
percentage margin resolves against the measured width of the box being walked
rather than against the margin's own containing block, which differ once the
walk has descended a level. Both were documented in the code as deliberate and
carried no marker, so neither reached this file. Recorded rather than measured:
they need nesting deep enough that the corpus has not produced either.
