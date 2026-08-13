# Animating a layout-affecting property

## The gap

shadcn's accordion opens like this:

```css
@keyframes accordion-down {
  from {
    height: 0;
  }
  to {
    height: var(--radix-accordion-content-height);
  }
}
```

Radix measures the panel and publishes the number as a custom property precisely
so the height can be animated. Our engine cannot run it: `CSSTransitions` writes
**opacity, background-color, border-color and transform** and nothing else.
Those four share a property that `height` does not have — changing one alters
what a view _paints_, never where anything _is_. That is what lets a frame be
written straight to a mounted view from the UI thread, with no commit, no React,
and no memory of what it wrote.

`height` breaks all of it. A view's height decides its siblings' positions, so
it cannot be written to one view in isolation; Yoga has to re-run and every
affected frame has to be re-applied.

So the accordion opens instantly today, and the demo says so. This is a design
question before it is a coding one, which is what this document is for.

## Options

**A. Re-run Yoga per frame, on the UI thread.** Set the interpolated height on
the animating node, lay out that subtree, apply the resulting frames to the
mounted views — all without committing. Spec-faithful and the only option that
actually animates `height`. Cost: a layout pass per frame per animation, and a
new class of failure (a real commit landing mid-flight, torn frames between the
animated subtree and the rest). It also breaks the engine's current contract in
the one place that contract has been load-bearing: "touch no tree, remember
nothing".

**B. Interpolate `scaleY` instead.** Free, works today, and wrong: it squashes
the content rather than revealing it — text included. The web animates height
_because_ scaleY looks like this. Rejecting this is the point of the whole
exercise; it is the shortcut that becomes permanent.

**C. Slide the content inside a clip.** Give the panel its final height in a
single commit and animate the content's `translateY` from `-height` to `0`
inside `overflow: hidden`. Paint-only, cheap, and the content genuinely animates
— but the surrounding layout jumps to its final position immediately instead of
being pushed. Honest for an overlay or a last-in-container panel; visibly wrong
in a list of accordion items.

**D. Drive height from JS state per frame.** What `Animated` with
`useNativeDriver: false` already does. It works, and it is exactly the thing
this engine exists to avoid.

## Recommendation

Do not ship B. It reads as an animation and renders as a defect.

If the motion is wanted soon and the accordion is the only case, C is defensible
_if_ the jump is acknowledged in the demo rather than hidden.

The real answer is A, scoped deliberately: layout-affecting transitions re-run
Yoga for the animating subtree on the UI thread and apply frames without
committing, behind its own feature flag, with the accordion as the proving case
and a torn-frame test as the gate. That is a feature, not a fix, and it should
be planned as one — it is the same shape of work as the transitions engine
itself.

Until then the gap is documented, which is better than approximated.
