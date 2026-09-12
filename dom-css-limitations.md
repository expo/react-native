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

**`escaped-margin-walk-approximations`** — `yoga/algorithm/CalculateLayout.cpp`
Two approximations in the walk that folds descendant margins escaping through a
block container's edges. Descendants of self-collapsing boxes are not walked,
so a margin escaping from inside one does not reach the owner's flow; and a
percentage margin resolves against the measured width of the box being walked
rather than against the margin's own containing block, which differ once the
walk has descended a level. Both were documented in the code as deliberate and
carried no marker, so neither reached this file. Recorded rather than measured:
they need nesting deep enough that the corpus has not produced either.

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

**`no-env-inside-calc`** — `ReactCommon/react/renderer/components/view/EnvironmentDependency.h`
`env(safe-area-inset-*)` is recognised only as a whole style value, so
`calc(env(safe-area-inset-bottom) + 8px)` computes to nothing rather than to
something almost right. The common shapes are covered without it — the bare
`env()`, and `env(<name>, <fallback>)` — and a padding that wants a few points
more than the inset can say so with a wrapper or with the fallback argument.

DEFERRED. Closing it needs a `calc()` evaluator for style lengths, which does
not exist here for any value, plus a way to carry the unevaluated expression as
far as layout, where the `env()` is finally known. The second half already
exists — that is what an environment dependency is — so this is mostly the
first half.

## User-agent styles

All in `Libraries/DomElements/uaStyles.js`.

**`no-em-units`** — browsers express UA defaults in `em`; we have no
font-relative units, so the sheet stores points computed against a 16px root.
They therefore do not track the user's font size the way the web does.

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

**`android-run-paragraph-attributes`** — `.../views/view/ReactViewManager.kt`
A painted text run whose layout has to be REBUILT at mount honours only the two
things that live on its attributed string — `text-align` and, from the same
attribute, justification. Break strategy, hyphenation frequency, font padding,
ellipsis and max lines are read from paragraph attributes, which a run's handoff
entry does not carry, so the rebuilt layout differs from the one the measure
pass built. It matters only when the handoff cannot be reused (a different
width, or a stale entry), and never on iOS, where these ride the paragraph
attributes to draw time.

Unfinished rather than blocked, and the fix is upstream of this file: send the
paragraph attributes along with the run.

**`ios-only-native-button`** — `packages/expo-intrinsics/src/NativeButton.js`
`<native:button>` is iOS only, and deliberately so: it is a
`UIButtonConfiguration` and a `UIMenu`, and being the platform's own control
with nothing of ours in it is the whole point of the element — it exists as the
control group for `<button>` with a `<menu>` child. There is nothing here to
port. On Android it renders nothing rather than red-boxing, so an app can write
it unconditionally; the portable spelling is `<button>` with a `<menu>`, which
is a `UIMenu` on iOS and a `PopupMenu` on Android.

**`ios-only-materials`** — `ReactCommon/.../view/ElementBoxShadowNode.h`
`-apple-visual-effect` is drawn on iOS only. The keywords are Apple's and so are
the two classes behind them (`UIBlurEffect`, `UIGlassEffect`); Android ignores
the prop and the box keeps whatever background it was given. Android's nearest
equivalent is a `RenderEffect` blur of what is behind, which is a *different
construction* rather than the same one under another name — which is why the
property is spelled `-apple-` rather than pretending to be portable. A platform
wall by construction, not a gap to schedule.

**`ios-only-balloon-tail`** — same file
`-apple-balloon-tail` is built on iOS only, where the shape is a `CAShapeLayer`
mask rebuilt each layout. Android ignores it and the balloon is a plain rounded
rectangle. Unlike the two above, nothing here is iOS-specific: this one is
unfinished rather than blocked, and closing it is the same path in a `Drawable`.

**`overlay-cannot-cover-the-keys`** — `React/.../KeyboardPanel/EXPKeyboardPanelComponentView.mm`
A panel presented as an overlay CAN cover the keyboard, and this entry used to
say it could not. What it can never do is get there with a window of its own.

Three places a view can be, all measured with `~/Developer/probes/windowprobe`,
which puts a coloured band in each and photographs the result:

- a window the app creates is **clamped** to level 10000000, one below the
  keyboard's `UIRemoteKeyboardWindow` at 10000001. Asked for 10000002 it comes
  back at 10000000 and draws underneath. No obtainable level does it.
- `UITextEffectsWindow` (level 1, where a plain `inputAccessoryView` lives)
  shows *through* the keyboard's translucent backdrop but is drawn under the
  opaque key caps.
- `UIRemoteKeyboardWindow` itself, after its `UIInputSetContainerView`, covers
  the keys completely — which is what the platform's own `+` card does.

So the panel hosts its overlay in the keyboard's own window, and the remaining
limitation is narrow: an overlay panel cannot be a **material**, because a
`UIVisualEffectView` samples what is behind it within its own window and there
is nothing behind it there. A stated colour is the substitute.

What this entry got wrong is worth keeping, because the same mistake is easy to
repeat. It reported "an overlay window at level 100000000 was still behind them,
so no level exists that would have done" — but the window it made was clamped to
10000000, so the experiment measured the clamp and was written up as measuring
the compositing. "No level is high enough" invites trying a higher one; "the
level is clamped, so use the keyboard's own window" is the fact.

**`balloon-tail-clips-box-shadow`** — `ReactCommon/.../view/ElementBoxShadowNode.h`
A `box-shadow` on an element with `-apple-balloon-tail` is clipped away. The
tail's shape is applied as a mask on the view's own layer, and a layer's mask
clips its shadow along with everything else. It came up lifting a balloon out of
a transcript for a reaction picker: the platform's lift carries a shadow and this one
cannot, because a shadow on the box outside the balloon would be a rectangle and
one on the balloon is clipped by its own mask.

Unfinished rather than blocked: the path is already built where the mask is, so
casting the shadow from it on a layer that is not the masked one is work in that
one place.

**`ios-only-contextmenu`** — `packages/expo-intrinsics/src/index.js`
`contextmenu` — a long press — is fired on iOS only. It is timed from the
touches the box already receives rather than from a gesture recogniser, which is
what makes a hold that turns into a scroll not fire: the platform cancels the
touch first. Android has the same seam in `ElementInteractiveBoxView`, which
already tracks a press through the platform's own dispatch, but only for boxes
it makes interactive — and a plain `<div>` deliberately is not one, since every
paragraph on every screen would otherwise become clickable and focusable.

Unfinished rather than blocked: closing it is the same timer on the Android side
plus a decision about which boxes get it there.

**`background-attachment-single-layer`** — same file
CSS takes a comma-separated list for `background-attachment`, one entry per
background layer, and `local` is a third value — the positioning area is the
element's *scrolled* content. Neither has come up, and a bool keeps the
per-frame work on the paint path down to one branch.

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

- `abbr-underline-is-unconditional` — deviation, `packages/expo-intrinsics/src/uaStyles.js`
- `ancestor-state-selectors` — limitation, `packages/rn-tester/js/astryx/jsx-runtime.js`
- `aria-activedescendant-native` — limitation, `packages/rn-tester/js/astryx/overlay/activeDescendant.js`
- `backdrop-under-background` — limitation, `React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm`
- `button-chrome-withdraws-as-a-unit` — deviation, `packages/expo-intrinsics/__tests__/ButtonChromeWithdrawal-itest.js`
- `button-padding-unresolved` — limitation, `packages/expo-intrinsics/src/uaStyles.js`
- `checkable-label-gap` — deviation, `packages/expo-intrinsics/src/uaStyles.js`
- `checkable-line-centering` — deviation, `packages/expo-intrinsics/__tests__/CheckableLineCentering-itest.js`
- `client-coordinates-are-not-rect-coordinates` — limitation, `ReactAndroid/src/main/java/com/facebook/react/uimanager/events/PointerEvent.kt`
- `color-mix-spaces` — limitation, `packages/rn-tester/js/astryx/colorMix.js`
- `corner-shape-clips-border-and-shadow` — limitation, `React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm`
- `corner-shape-ios-only` — limitation, `React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm`
- `display-on-inline-text-elements` — limitation, `packages/rn-tester/js/astryx/radix/toggles.js`
- `fieldset-legend-position` — deviation, `packages/expo-intrinsics/__tests__/Tier1Elements-itest.js`
- `fieldset-native-surface` — deviation, `packages/expo-intrinsics/__tests__/Tier1Elements-itest.js`
- `glass-surface-press-is-the-platforms` — deviation, `React/Fabric/Mounting/ComponentViews/View/EXPMaterialSurface.mm`
- `glyph-markers-not-painted` — deviation, `ReactCommon/react/renderer/components/view/ListStyle.h`
- `grid-fit-content-limit` — limitation, `ReactCommon/react/renderer/components/view/GridTrackListParser.h`
- `grid-min-content` — limitation, `ReactCommon/react/renderer/components/view/GridTrackListParser.h`
- `grid-unknown-area-name` — limitation, `ReactCommon/yoga/yoga/algorithm/grid/AutoPlacement.h`
- `headings-use-the-platform-type-scale` — deviation, `packages/expo-intrinsics/src/uaStyles.js`
- `hr-separator-color` — deviation, `packages/expo-intrinsics/src/uaStyles.js`
- `ios-links-are-not-underlined` — deviation, `packages/expo-intrinsics/src/index.js`
- `label-activation` — deviation, `packages/rn-tester/js/examples/HTMLElements/HTMLFormsExample.js`
- `label-activation-is-radio-only` — limitation, `packages/expo-intrinsics/__tests__/RadioGroup-itest.js`
- `lanes-abspos-containing-block` — limitation, `ReactCommon/yoga/yoga/algorithm/GridLanesLayout.cpp`
- `lanes-baseline-export` — limitation, `ReactCommon/yoga/yoga/algorithm/GridLanesLayout.cpp`
- `lanes-order` — limitation, `ReactCommon/yoga/yoga/algorithm/GridLanesLayout.cpp`
- `link-title-is-not-idn-decoded` — limitation, `React/Fabric/Mounting/ComponentViews/View/EXPTextLinkInteraction.mm`
- `list-style-type-additive-scripts` — limitation, `ReactCommon/react/renderer/components/view/ListStyle.h`
- `native-form-widgets` — deviation, `packages/expo-intrinsics/src/uaStyles.js`
- `no-cascade-origins` — limitation, `packages/expo-intrinsics/src/index.js`
- `no-font-on-a-control` — limitation, `React/Fabric/Mounting/ComponentViews/View/EXPElementTextAreaComponentView.mm`
- `no-generic-font-families` — limitation, `packages/expo-intrinsics/src/uaStyles.js`
- `no-groove-border` — limitation, `packages/expo-intrinsics/src/uaStyles.js`
- `no-spellcheck-on-url-email-password` — deviation, `packages/expo-intrinsics/__tests__/textCorrection-test.js`
- `no-visited-links` — deviation, `packages/expo-intrinsics/src/uaStyles.js`
- `paragraph-margin-shorthand-dropped` — limitation, `packages/expo-intrinsics/__tests__/ParagraphMargins-itest.js`
- `peek-outruns-the-scroll` — limitation, `React/Fabric/Mounting/ComponentViews/View/EXPPeekInteraction.h`
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
