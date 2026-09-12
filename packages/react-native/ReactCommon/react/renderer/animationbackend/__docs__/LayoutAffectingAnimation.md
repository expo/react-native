# Animating a layout-affecting property

`height` and `padding-bottom` transition. They are the layout-affecting
properties that do, and they take a different path through the engine from the
paint properties — one that costs **no commits at all beyond the author's
own**, and none per frame.

## Why they needed their own path

The four properties the engine started with — opacity, background-color,
border-color and transform — share something these two do not: changing one
alters what a view _paints_ and never where anything _is_. That is what lets a
frame be written straight to a mounted view from the UI thread, with no commit,
no React, and no memory of what it wrote.

A layout property breaks all of it. A view's height decides its siblings'
positions and its ancestors' sizes; a balloon's `padding-bottom` is the reserve
its whole column slides into. A frame of either moves OTHER views.

The shapes that motivated them: shadcn's accordion, which animates `height`
because the web writes it that way (Radix measures the panel and publishes the
number as a custom property *precisely so the height can be animated*); a chat
composer growing a line (the platform's own eases it over about 0.1s); and a chat
balloon's tail, whose reserve is `padding-bottom` and whose outline is drawn
from the mounted padding every frame.

## What it does

The first design interpolated the PROPERTY and committed every frame: a tree
clone, a Yoga pass, a diff and a synchronous mounting transaction, ~fifteen
times over to move a box thirteen points — and each commit dragged the app's
own mounting-transaction observers behind it. Measured in a transcript as the
column falling behind the content it was pinned to and lurching to catch up.

The second design is the one both platforms use for their own layout
animations (`UIView animateWithDuration:` and Android's ChangeBounds alike):
**lay out once at the destination, and glide the mounted views between two
real layouts.**

1. **The author's commit goes through untouched.** Committed trees carry only
   author values, always. When `CSSTransitions::shadowTreeWillCommit` detects
   a transitioned layout change — in author commits only; the promotion that
   merges a react-branch commit re-presents every change mirrored, and the
   commit SOURCE is what tells them apart — it lays out a SCRATCH clone of the
   same tree with the transitioned properties still at their old values, and
   hands `CSSLayoutTransitions` every node's metrics from it: the world in
   which everything else in the commit happened and the transition did not.
   The scratch tree is discarded; only its numbers survive. (Its clones are
   made with runtime shadow node reference updates disabled, the way the
   animation tick does — a clone made on the JS thread otherwise becomes
   React's base for the next render, and a scratch node carries the old world
   by design.)
2. **The commit's transaction is captured at the mounting layer.** Each view
   whose committed metrics differ from its scratch metrics is a flight — from
   the scratch world, to the committed one — and mounts at its starting
   metrics, so nothing on screen jumps. A view whose scratch and committed
   metrics agree was moved only by the commit's other changes and lands
   instantly: an insertion sharing a commit with a transition does not start
   gliding by association. The attribution is per-node exact.
3. **Each frame after, `pump` runs a mount pass with no commit behind it**
   (`ShadowTree::notifyDelegatesOfUpdates`), and `pullTransaction` injects
   `Update` mutations carrying interpolated metrics — frames, content insets,
   border widths — until each flight lands exactly on its committed end.

The cost per transition: the author's own commit (one node-clone, pinned by
test), one scratch Yoga pass, and mounted metrics per frame. No additional
commits at all.

Paint-only frames are unchanged: written with
`synchronouslyUpdateViewOnUIThread`, no tree, no Yoga, no transaction.

Because the frames travel as ordinary mount instructions, a platform view that
DERIVES from its metrics keeps working mid-flight — the chat balloon draws its
tail from each frame's padding. And because the engine is shared C++ at the
mounting seam, both platforms get the same curves from the same solver and the
same answers in the edge cases: a mid-flight re-aim continues from the current
interpolated value on the new clock (css-transitions-1 §3), a passing React
commit has its end-state metrics rewritten to the flight's current value so it
cannot snap the glide (its props and state land as committed), a reorder's
Remove/Insert is followed, and an unmount erases the flight.

`ViewCSSHeightTransition-itest.js` and `ViewCSSPaddingTransition-itest.js`
hold this as assertions rather than claims, reading MOUNTED metrics through
`getRenderedOutput({includeLayoutMetrics: true})`: exactly ONE node-clone per
transition (the author's commit and nothing else), zero commits across the
whole flight, frame 0 held, insets travelling with frames, and knock-on
siblings riding the declaring node's clock.
`ViewCSSLayoutTransitionHandover-itest.js` pins the compound case — a row
closing, a row opening and a tail reserve shrinking in one commit, every
follower monotonic — and `ViewCSSLayoutTransitionRebase-itest.js` pins the
two commit-branching cases: a render that repeats the target must not restart
the flight, and one that reverses it must re-aim from the current value.

## What it gives up

Registered as `DOM-CSS-LIMITATION(layout-transition-endpoints)`:
intermediate frames are geometric interpolations of the endpoints, not real
layouts. Text does not rewrap at an in-between height (the same approximation
UIKit and Android make); `getBoundingClientRect` mid-flight reads the target;
knock-on movement rides the declaring node's clock, the longest one governing
when several start in one commit.

## The traps in doing it this way

**A clone on the JS thread is not free of side effects.** With runtime shadow
node reference updates enabled, every clone becomes React's reference for its
family — and React's next render diffs its own props against whatever node
the reference points at, so a scratch node with the old value handed React a
base from the pre-transition world and the next re-render committed the old
value back verbatim. Measured as the committed tree regressing on a
label-only re-render. The scratch work runs with reference updates off.

**The hook sees the same change more than once.** This fork branches commits:
React's land on their own revision, and the promotion that merges them into
the main revision runs the hooks again — with the trees swapped around the
change, so a transition to 120 arrives a second time as "120 → 20",
indistinguishable by values from a real reversal. The commit source is the
discriminator: only `ShadowTreeCommitSource::React` can carry an author's
change, and the hook ignores everything else.

**A commit runs the commit hooks, and this class is one.** `applyingFrame_`
covers the frames CSS animations still commit (see below), read *before*
`mutex_` is taken: the commit is synchronous and re-enters on the same
thread, and the mutex is not recursive, so a hook that locked first would
deadlock.

**The delegate has to be installed where every surface actually passes.**
`addOnSurfaceStartCallback` forwards through the UIManager's delegate — which
does not exist yet in the Scheduler's constructor, and is never told about a
surface started through `startEmptySurface`, which is how a test harness
starts one. The engine installs itself lazily from the commit hook, by
coordinator identity, which is the one place that reliably sees every
surface.

**Not every pair of values can be interpolated.** `auto`, `max-content` and
`stretch` are keywords with no number in them, and 10% is not on the way from
10px to 20px. css-transitions-1 makes those DISCRETE — the value applies at
once and no transition runs — which is exactly why Radix publishes a pixel
height rather than animating to `auto`. Refused at the start, so the commonest
case of all — a box whose height is `auto` and stays `auto` — costs nothing.

## What was considered and not done

**Interpolating `scaleY` instead.** Free, works with the paint-only path, and
wrong: it squashes the content rather than revealing it, text included. The web
animates height *because* scaleY looks like this.

**Core Animation interpolating the frames.** Cheapest per frame — the render
server does it off the main thread — and it fails three ways at once: it is
iOS-only, so Android needs this engine anyway and the two would disagree in
every edge case; CA's retarget semantics (replace-from-presentation, additive
blending) match nothing Android does; and a view that derives from its layout
is starved mid-flight — the presentation layer is a frame behind, measured.

**Committing interpolated values every frame.** The first design. Correct per
css-transitions-1 — intermediate layouts are real, text rewraps — and priced
wrong by an order of magnitude for what a transcript actually does with it.
The register entry records the trade explicitly.

**Splitting the commit: rewind it, then commit the end values separately.**
The second design's first draft — attribution by construction, since every
metric the end-values commit moved was the transition's. Two ways it fought
the commit model: the rewound value lived on as the react branch's base, so
every later render re-presented the transition as a fresh change and
restarted it (measured as the content size flapping between the two layouts
on alternate frames, forever); and the end-values commit was one React did
not know about, with all of the reference bookkeeping that implies. The
scratch layout gets the same attribution without writing anything into any
committed tree.

**Re-running Yoga on the UI thread without committing.** A subtree laid out
beside the tree would tear against a real commit landing mid-flight, and would
need its own answer to every question — consistency, mounting, revision — that
`ShadowTree::commit` already answers.

**Width, margin and the rest.** Nothing in the mechanism is specific to the
two properties — the hook's divert and `isLayoutAffecting` are a line each.
They are absent because each new one is a number of frames someone will spend,
and these are the two with cases behind them (the accordion and the composer;
the balloon tail). Adding another should mean naming the case.
