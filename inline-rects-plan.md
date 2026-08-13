# getBoundingClientRect for every inline-level element — IMPLEMENTED

> Both plans below shipped: the stamp gate is widened (tests flipped and
> extended, atomic/blockified controls green) and the SWAR white-space
> fast path landed (article bare at statistical parity with <Text>:
> 368 vs 358µs; portable plain-C SWAR, no intrinsics, memcpy loads —
> identical code on physical arm64 devices).

## What already works, and the one missing gate

Fragment-rect geometry is fully built for the TEXT vocabulary — `<span>`,
`<b>`, nested `<Text>` (StringChildrenInlineMetrics pins it): the text
engine reports a rect per fragment, fragments carry their owning element
(`parentShadowView`), and after layout the owner runs
`stampInlineElementMetrics` (InlineElementMetrics.cpp): a post-order walk
that unions each element's own fragments with its inline descendants' —
a `<span>` wrapping a `<b>` covers both, per CSSOM View — and stamps the
union as the element's layout metrics, relative to the owner plus content
origin. Both owners call it (ParagraphShadowNode for Text trees, the run
path for anonymous IFCs).

`display:'inline'` Views already participate in everything EXCEPT the last
step: the fold tags their fragments (`parentShadowView` — that is why taps
already resolve to them, RunsEventsGeometry pins the bubbling), their rects
land in `boxesByTag`, the union walk visits them — and then the stamp gate
`dynamic_cast<const TextShadowNode*>(&node)` skips them. The pinned KNOWN
GAP test (zero rect) is exactly this line.

## The change

1. **Widen the stamp gate** from `is TextShadowNode` to "inline-level
   content of this run": `TextShadowNode` OR
   `YogaLayoutableShadowNode::isInlineFlowContent(node)` (the same
   predicate the fold uses to decide span-like folding — single source of
   truth, so an element folds and stamps under the same definition).
2. **Do not stamp what Yoga laid out.** Atomic inlines (sized inline
   Views, inline-block/inline-flex, replaced elements) get REAL frames from
   attachment placement; blockified inline Views in flex containers get
   real Yoga metrics. `isInlineFlowContent` is false for all of these, so
   the gate above already excludes them — assert it with a
   flex-container control test.
3. **Sealing/timing:** the stamp runs inside the owner's layout pass, the
   same unsealed-commit window in which Text-vocabulary virtual nodes are
   stamped today; inline-flow Views are real nodes excluded from the Yoga
   tree, so their metrics are otherwise zero and the stamp is the sole
   writer. No new ordering.
4. **onLayout bonus:** `setLayoutMetrics` on a node wired for layout events
   emits onLayout — verify inline Views get exactly one event per change,
   matching web expectations for element geometry updates.

## Tests (flip + extend)

- Flip the RunsEventsGeometry KNOWN GAP test to its written expectations
  (x = 4ch, width = 4ch, height = 1 line).
- Nested: inline View wrapping `<b>` — union covers both (mirror of the
  span/b nesting case).
- Wrapped: a mid-run inline View broken across two lines — union spans
  both fragments (multi-line union rule, CSSOM View getBoundingClientRect).
- Controls: sized inline View (atomic — attachment frame, not stamp);
  inline View in a flex container (blockified — Yoga metrics, not stamp).
- CDP: add an inline-View rect check to `cascade-cdp-verify`'s screen or
  the display screens so both real platforms verify the same relations
  (CoreText/StaticLayout supply platform fragment rects through the same
  stamping rules).

## Size: ~15 lines of engine change + ~80 lines of tests.

## Related follow-up recorded in the same investigation

The article-shape bare-vs-Text harness gap is now precisely attributed:
`collapseWhitespace`'s per-byte state machine (~163µs on a 37KB block,
33.8% of the tier) — a pass `<Text>` never runs. Two probe designs
measured WORSE (libc++ `find_first_of` degrades to a per-char loop;
space-anchored two-byte `find`s degrade into ~13k short memchr calls at
~3× the machine's cost — spaces occur every ~6 bytes in prose, so probes
must never anchor on frequent bytes). The principled fix is SWAR/SIMD
block classification: process 8–16 bytes per step, compute a
"needs-work" mask (tab/CR/FF anywhere, space adjacent to space or
newline, mode-dependent newline handling) with register ops, bulk-advance
clean blocks in the lazy COW state, fall back byte-wise only inside dirty
blocks. Expected ~10×, closing the article gap to parity. UTF-8 byte
scanning remains legal throughout (self-synchronizing encoding — the
contract and multi-byte tests are in place).

## Bottlenecks: making bare strings beat NativeText everywhere (measured)

Engine-side, bare already wins (+2.8 vs +5.3µs marginal per row). The
residual platform gaps are ONE bottleneck class on both platforms: **the
run mount/paint path re-does platform text layout that measurement
already did**, which NativeText avoids by reusing its prepared layout.

- **Android (quantified; explains the whole gap):** `setTextRunLayouts`
  rebuilds the spannable and a `StaticLayout` per run ON THE UI THREAD at
  mount — probed at **16.3µs/run** (464ms across 28,500 runs). The
  bare-vs-NativeText marginal gap measured 14.8ms/1k rows in the same
  session — the rebuild IS the gap. Fix: reuse the measurement-time
  prepared layout (the PreparedLayoutTextView pattern): carry the
  prepared layout through ViewState instead of re-deriving it from the
  attributed-string MapBuffer, or at minimum construct off the UI thread
  and cache keyed by (attributed string, width).
- **iOS (profiled):** post-alignment, the bare tier still shows CoreText
  SHAPING symbols (OTL coverage lookups, variation-store deltas) inside
  the draw window plus heavy objc_msgSend — the run draw path re-lays-out
  text at paint time instead of reusing the measured layout. Same fix
  class: cache the platform text layout created at measure and draw from
  it. Also open: run-view canvases sized to the container's content box
  (tall single-run containers imply proportionally tall layer backing
  stores).

With layout reuse on both platforms, bare rows should beat NativeText
end-to-end everywhere: hardware already shows it (iPhone 15 Pro: 137 vs
223), and the remaining emulator/sim deficits equal the duplicated-
layout cost now measured.
