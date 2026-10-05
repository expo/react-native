# Known limitations: DOM elements and CSS

Every limitation here is marked **at the code that has it**, with a greppable
token, so this file cannot quietly drift out of date:

```
grep -rn "DOM-CSS-LIMITATION(" packages/react-native --include=*.js \
  --include=*.h --include=*.cpp --include=*.mm --include=*.kt
```

That command is the source of truth. This file is an index of what those
markers say and why, for reading before you go looking.

It indexes MARKED divergences, and now indexes all of them — a check runs in
both directions, so neither an entry without a marker nor a marker without an
entry survives. It did not always: the check only ran one way, and the file
read as complete while forty-eight markers had no row at all.

A divergence nobody marked is still invisible to that command and to this file,
and no check can find one — there is nothing to grep for. Two were found by
reading in one sitting (`abbr-underline-is-unconditional` and one since fixed,
both explained in a comment and neither marked), so treat this as complete for
what is marked, not for what exists.

The convention: `DOM-CSS-LIMITATION(slug)` in a comment beside the code, then
a sentence on what does not work and what it would take. Adding a limitation
means adding a marker; the slug is what ties it to the row below.

**Priority.** A limitation is not automatically a defect waiting to be fixed.
Three kinds appear here and it is worth telling them apart:

- **Platform walls** — the OS offers no way to express it. Nothing to schedule.
- **Deliberate** — a `DOM-CSS-DEVIATION`, chosen because the native behaviour
  is the better answer. Not a gap at all.
- **Deferred** — implementable, understood, and not currently wanted. Marked
  *lower priority* below. These are the ones where "we know, and we chose the
  order" is the whole story; nothing about them is fundamental or permanent.

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

DEFERRED, and architectural rather than hard: closing it means the reconciler
telling the host when a display change crosses that boundary, which is an
upstream React concern rather than something this fork decides alone.

**`no-author-facing-em-lengths`** — `text-conformance/cases.js`
`em` and `rem` resolve for `font-size` (`fontSizeEm`, `fontSizeRem`) and for
the user-agent block margin (`uaMarginBlockEm`, `uaMarginBlockRem`), but there
is no way for an AUTHOR to write a relative length on an arbitrary layout
property — `width: '1.5em'` is not a value React Native styles take. A style
value here is a resolved number, and at the moment one is written there is no
font size to resolve against; carrying the unit through would mean a unit in
Yoga's `StyleLength`, which is part of its public C API and reaches the Java
and Objective-C bindings. The corpus translates an author's `margin-block: 1em`
into the user-agent channel, which is a different cascade origin — fine for
geometry, wrong for a case about precedence.

DEFERRED. One of the four that a single relative-length channel would close —
see `no-em-units`. The cost is real (a unit in Yoga's `StyleLength`, which is
public C API), which is why it is one piece of work rather than a quick fix.

**`rem-root-is-the-unstylable-surface-root`** — `Libraries/Text/__tests__/RelativeFontSize-itest.js`
`rem` resolves against the surface root — the node the layout walk starts from
— and everything an app renders is already a child of it. So an app has no way
to state the root's font size the way a page styles `<html>`, and `rem` is the
platform's body size for the life of the surface. The native lever for moving
all text at once is the user's own text-size setting, which arrives as
`fontSizeMultiplier` and scales resolved sizes after the fact rather than
through this base.

**`no-box-decoration-break-clone`** — `.../ios/.../RCTTextLayoutManager.mm`
A wrapped inline box paints with `box-decoration-break: slice` (the CSS
default) — leading edge on the first fragment, trailing on the last. `clone`,
which repeats both edges on every fragment, is not implemented.

DEFERRED and small: the fragment loop already knows which fragment is first
and last, so `clone` is a branch there rather than new machinery. It is a rare
value and nothing here has asked for it.

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

**`no-em-units`** — browsers express UA defaults in `em`; the sheet cannot.
Font sizes and block margins travel as factors (`uaFontSizeEm`,
`uaMarginBlockEm`, `uaMarginBlockRem`) that the renderer multiplies by the
drawn size, so those track the font. Any other `em` length in the web's sheet
is written here as points.

DEFERRED, and the same missing capability as `no-author-facing-em-lengths` and
the shim's `rem-fixed-root` and `unitless-line-height-needs-local-font-size`.
One channel — a relative length that survives to where a font size is known —
closes all four. Worth counting as one piece of work rather than four.

**`no-quirks-mode`** — no `quirks.css` equivalent, there being no quirks mode
to be compatible with. Listed so its absence reads as deliberate.

**`physical-edge-does-not-claim-flow-relative`** — an author's `paddingLeft`
does not cancel the sheet's `paddingInlineStart`, though a browser's would in
a left-to-right box.

`boxEdges.js` stops the sheet outranking an author's box reset: a user-agent
declaration whose edges the author has ENTIRELY claimed is dropped before the
two layers meet, so `padding: 0` cancels `<ol>`'s marker gutter the way it does
on the web. It runs before a direction is resolved, so it cannot know that
`left` and `inlineStart` are the same edge here and different ones in a
right-to-left list, and it treats them as different throughout.

The under-claim is the safe side of that: it leaves a sheet declaration
standing rather than dropping one the author never replaced. Closing it needs
the resolved direction at merge time, which is the same missing channel as the
RTL items — DEFERRED with them.

## Platform

**`android-spellcheck-implies-autocorrect`** — `.../views/view/ElementTextInputView.kt`
HTML defines `spellcheck` and `autocorrect` as separate attributes: one marks
mistakes, the other rewrites them (§6.8.5 and §6.8.8). iOS has a trait for each
— `spellCheckingType` and `autocorrectionType` — so "underline my mistakes but
do not rewrite them" is expressible there. Android has one flag for both:
`TextView.isSuggestionsEnabled()` returns false the moment
`TYPE_TEXT_FLAG_NO_SUGGESTIONS` is set, and that single predicate gates the
spell checker *and* the IME's suggestion strip. So on Android
`spellcheck="false"` takes autocorrection with it. Honouring the attribute the
author actually named, and turning off more than they asked, is the lesser of
the two wrongs available. `autocorrect` on its own is exact on both platforms;
it is only the combination `spellcheck="false" autocorrect="on"` that Android
cannot express.

**`android-no-spellcheck-on-email-or-url`** — same file
Related and from the same predicate: `isSuggestionsEnabled()` also returns
false for any variation other than the plain text ones, so an
`<input type="email">` or `type="url"` is never spell-checked on Android. HTML
lists both among the types a user agent *should* consider checkable.

A platform wall, like the entry above it: the predicate is `TextView`'s and
takes no argument. Nothing to schedule.

## Color

Colors in their own color spaces and HDR, behind `enableColorSpaces`.

- **`DOM-CSS-LIMITATION(missing-color-components-are-zero)` — `none` in a
  color is 0, not missing.** CSS draws `none` as 0, and also lets it take the
  other color's value when two colors interpolate (CSS Color 4 §12.2), so
  `oklch(0.7 0.1 none)` keeps the other end's hue. Here `none` is 0 from
  parsing on, so it turns from hue 0. Deferred: it needs the parsed value to
  keep which channels are missing.
- **`DOM-CSS-LIMITATION(hdr-text-and-gradients-draw-at-sdr-white-on-ios)` —
  on iOS only backgrounds and uniform borders draw brighter than white.**
  Those are layer colors, which Core Animation composites in extended range
  when the layer asks. Text, shadows, gradients and per-edge borders are drawn
  into 8-bit bitmaps, so an HDR color there is clipped to SDR white. Android
  paints every color long into the window, whose HDR mode covers them all.
- **`DOM-CSS-LIMITATION(gradient-interpolation-needs-percent-stops)` — a
  gradient with a length stop or a hint interpolates in sRGB.** Neither
  platform's shader interpolates in a chosen space, so the stretches are
  expanded into computed stops, which can only be placed between percentages.
  A `10px` position or a transition hint leaves the gradient to the platform.
- **`DOM-CSS-LIMITATION(android-text-and-outline-colors-are-srgb)` — on
  Android, text decoration, text shadow, text background, outline, and an
  image's border, overlay and tint colors draw their sRGB approximation.**
  Backgrounds, borders, box shadows, gradients and text foregrounds paint
  color longs; these others still cross the bridge as integers. Deferred:
  color longs through the text MapBuffer's remaining color keys and the
  image and outline setters.
- **`DOM-CSS-LIMITATION(android-transition-frames-are-srgb)` — on Android a
  transition's frames between wide colors draw their sRGB approximation.**
  A frame's color is read from the 8-bit value, since interning every frame
  would fill the color table; the end state is the exact color. Deferred: a
  rotating table for transient colors.
- **`DOM-CSS-LIMITATION(android-color-table-is-finite)` — Android keeps at
  most 65,535 distinct wide colors per process.** Each color in its own space
  is interned by value in a table a `Color` indexes with 16 bits, and the
  table is never reclaimed; the 65,536th new color draws its sRGB
  approximation. Deferred: reclamation, or owned overflow storage.
- **`DOM-CSS-LIMITATION(android-needs-the-platforms-color-space)` — on
  Android a color in its own space draws only where the OS has that space.**
  Android 8 brought color spaces; before it, and for a predefined space the
  OS doesn't name, the color draws nothing rather than CSS's arithmetic.
  `CSS.supports` says so for the device. Deferred: CSS's arithmetic in
  Kotlin, as the C++ and JS sides have it.
- **`DOM-CSS-LIMITATION(inline-image-limit-waits-for-its-next-revision)` —
  an inline `<img>` takes an inherited `dynamic-range-limit` change at its
  next revision.** The cascade reaches an atomic inline through its anonymous
  box without cloning it, so the already-published node stores the cascade
  but can't publish state until something else clones it. Deferred: cloning atomic
  inlines in the configure pass.
- **`DOM-CSS-LIMITATION(animated-colors-interpolate-in-srgb)` — `Animated`
  interpolates a color in its own space as its sRGB approximation.** The
  animated node mixes 8-bit sRGB channels. Deferred: CSS Color 4 §12
  interpolation in the animated node, as transitions have.
- **`DOM-CSS-LIMITATION(action-sheet-tints-are-srgb)` — `ActionSheetIOS`'s
  tints are sRGB.** Its native module takes integers, so a color in its own
  space goes as its sRGB approximation. Platform wall as the module stands.
- **`DOM-CSS-LIMITATION(media-queries-have-no-or-and-no-nesting)` —
  `matchMedia` parses `and`, commas and `not`, not `or` or nested
  conditions.** A query using them is false. Deferred: the full Media
  Queries 4 grammar.
- **`DOM-CSS-LIMITATION(android-dynamic-range-is-per-window)` — Android's HDR
  is the window's.** A window shows HDR only in its HDR color mode, and its
  headroom is one value, so `constrained` draws as `no-limit`, and a
  `standard` picture beside an HDR one shares the window's headroom. Platform
  wall.

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

---

## Every other marked divergence

The rows above carry the reasoning for the ones worth reading before you go
looking. These are the rest of what `DOM-CSS-LIMITATION(` and
`DOM-CSS-DEVIATION(` currently match, so the file indexes all of them rather
than a subset. Each marker explains itself at the code; this table is how you
find it.

It was written because the consistency check only ran one way — every entry
had a marker, but forty-eight markers had no entry, and the file still read as
complete. The check now runs both ways, so an unindexed marker fails a test
rather than going quiet.

- `ancestor-state-selectors` — limitation, `packages/rn-tester/js/astryx/jsx-runtime.js`
- `aria-activedescendant-native` — limitation, `packages/rn-tester/js/astryx/overlay/activeDescendant.js`
- `button-chrome-withdraws-as-a-unit` — deviation, `packages/expo-intrinsics/__tests__/ButtonChromeWithdrawal-itest.js`
- `checkable-label-gap` — deviation, `packages/expo-intrinsics/src/uaStyles.js`
- `checkable-line-centering` — deviation, `packages/expo-intrinsics/__tests__/CheckableLineCentering-itest.js`
- `client-coordinates-are-not-rect-coordinates` — limitation, `ReactAndroid/src/main/java/com/facebook/react/uimanager/events/PointerEvent.kt`
- `color-mix-spaces` — limitation, `packages/rn-tester/js/astryx/colorMix.js`
- `display-on-inline-text-elements` — limitation, `packages/rn-tester/js/astryx/radix/toggles.js`
- `fieldset-legend-position` — deviation, `packages/expo-intrinsics/__tests__/Tier1Elements-itest.js`
- `fieldset-native-surface` — deviation, `packages/expo-intrinsics/__tests__/Tier1Elements-itest.js`
- `glyph-markers-not-painted` — deviation, `ReactCommon/react/renderer/components/view/ListStyle.h`
- `grid-fit-content-limit` — limitation, `ReactCommon/react/renderer/components/view/GridTrackListParser.h`
- `grid-min-content` — limitation, `ReactCommon/react/renderer/components/view/GridTrackListParser.h`
- `headings-use-the-platform-type-scale` — deviation, `packages/expo-intrinsics/src/uaStyles.js`
- `hr-separator-color` — deviation, `packages/expo-intrinsics/src/uaStyles.js`
- `ios-links-are-not-underlined` — deviation, `packages/expo-intrinsics/src/index.js`
- `label-activation` — deviation, `packages/rn-tester/js/examples/HTMLElements/HTMLFormsExample.js`
- `label-activation-is-radio-only` — limitation, `packages/expo-intrinsics/__tests__/RadioGroup-itest.js`
- `link-title-is-not-idn-decoded` — limitation, `React/Fabric/Mounting/ComponentViews/View/EXPTextLinkInteraction.mm`
- `list-style-type-complex-styles` — limitation, `ReactCommon/react/renderer/components/view/ListStyle.h`
- `native-form-widgets` — deviation, `packages/expo-intrinsics/src/uaStyles.js`
- `no-cascade-origins` — limitation, `packages/expo-intrinsics/src/index.js`
- `no-font-on-a-control` — limitation, `React/Fabric/Mounting/ComponentViews/View/EXPElementTextAreaComponentView.mm`
- `no-generic-font-families` — limitation, `packages/expo-intrinsics/src/uaStyles.js`
- `no-groove-border` — limitation, `packages/expo-intrinsics/src/uaStyles.js`
- `no-spellcheck-on-url-email-password` — deviation, `packages/expo-intrinsics/__tests__/textCorrection-test.js`
- `no-visited-links` — deviation, `packages/expo-intrinsics/src/uaStyles.js`
- `paragraph-margin-shorthand-dropped` — limitation, `packages/expo-intrinsics/__tests__/ParagraphMargins-itest.js`
- `position-fixed-as-absolute` — limitation, `packages/rn-tester/js/astryx/stylex-rn.js`
- `press-dim-on-content` — deviation, `React/Fabric/Mounting/ComponentViews/View/EXPElementButtonComponentView.mm`
- `radio-card-needs-a-contrasting-page` — limitation, `React/Fabric/Mounting/ComponentViews/View/EXPRadioRunList.h`
- `rem-fixed-root` — limitation, `packages/rn-tester/js/astryx/stylex-rn.js`
- `root-font-size-is-native-not-16px` — deviation, `Libraries/Text/__tests__/RelativeFontSize-itest.js`
- `rtl-inline-run-not-reordered` — limitation, `ReactCommon/react/renderer/components/text/InlineContentShadowNode.cpp`
- `select-dismissal-ghost` — deviation, `React/Fabric/Mounting/ComponentViews/View/EXPElementSelectComponentView.mm`
- `sibling-combinator-spacing-as-gap` — limitation, `packages/rn-tester/js/astryx/css/index.js`
- `sr-only-not-in-a11y-tree` — limitation, `packages/rn-tester/js/astryx/css/index.js`
- `svg-subset` — limitation, `packages/rn-tester/js/astryx/svg/Svg.js`
- `unitless-line-height-needs-local-font-size` — limitation, `packages/rn-tester/js/astryx/stylex-rn.js`
- `view-style-text-inheritance` — limitation, `packages/rn-tester/js/examples/Lists/ListsExample.js`
- `white-space-break-spaces-hangs` — limitation, `ReactCommon/react/renderer/attributedstring/conversions.h`
