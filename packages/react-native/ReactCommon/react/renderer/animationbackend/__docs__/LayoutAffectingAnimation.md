# Animating a layout-affecting property

`CSSTransitions` animates opacity, background-color, border-color and
transform. Changing any of these alters what a view paints, never where
anything is, which is what lets a frame be written straight to a mounted view
from the UI thread with no commit and no record of what it wrote.

`height` does not share that property. A view's height decides its siblings'
positions, so it cannot be written to one view in isolation: Yoga has to re-run
and every affected frame has to be re-applied. A `@keyframes` rule from `0` to
a measured height, as Radix's accordion emits, therefore applies instantly.

## Options

**A. Re-run Yoga per frame, on the UI thread.** Set the interpolated height on
the animating node, lay out that subtree and apply the resulting frames to the
mounted views without committing. Spec-faithful and the only option that
animates `height`. Costs a layout pass per frame per animation and adds a class
of failure: a real commit landing mid-flight, and torn frames between the
animated subtree and the rest.

**B. Interpolate `scaleY` instead.** Paint-only, but it squashes the content,
text included, rather than revealing it. The web animates height because
`scaleY` looks like this.

**C. Slide the content inside a clip.** Give the panel its final height in one
commit and animate the content's `translateY` from `-height` to `0` inside
`overflow: hidden`. Paint-only and the content animates, but the surrounding
layout jumps to its final position at once instead of being pushed. Acceptable
for an overlay or a last-in-container panel; wrong in a list of accordion items.

**D. Drive height from JS state per frame.** What `Animated` without the native
driver does, and the thing this engine exists to avoid.

## Recommendation

B reads as an animation and renders as a defect. C is defensible for a single
panel if the demo acknowledges the jump.

A is the answer, scoped deliberately: layout-affecting transitions re-run Yoga
for the animating subtree on the UI thread and apply frames without committing,
behind its own feature flag, with the accordion as the proving case and a
torn-frame test as the gate. It is the same shape of work as the transitions
engine itself. Until then the gap is documented rather than approximated.
