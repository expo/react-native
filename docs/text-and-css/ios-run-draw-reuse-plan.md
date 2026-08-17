# iOS run performance designs (correctness-first)

> **Which benchmark these numbers are.** Performance figures in this directory
> come from five different measurements on different scales — see [text-vs-upstream-benchmarks.md](text-vs-upstream-benchmarks.md) for the
> tags and what each can and cannot tell you. [device-absolute], iOS simulator.

Context: with fair tiers, bare strings win every head-to-head on the engine
and on Android, but trail `<Text>` by ~2µs/line on iOS hardware in the two
tall-block shapes (messages 53.2 vs 51.1ms, article 43.4 vs 41.4ms). Both
paragraphs and runs rebuild their entire TextKit stack at draw time
(`drawAttributedString`: conversion → NSTextStorage build → full shaping via
`glyphRangeForTextContainer` → rasterization), and measurement already built
and laid out an identical stack on the layout thread and discarded it
(`measureNSAttributedString` → `_textStorageAndLayoutManagerWithAttributesString`
→ `ensureLayoutForTextContainer`). Four designs, ordered by
value-per-correctness-risk; #1 is implemented, the rest are recorded.

## 1. Measure->draw TextKit reuse (IMPLEMENTED, v2 after a measured lesson)

Measurement caches the TextKit stack it builds for a run; the run view
draws from it, skipping conversion + storage build + shaping on the main
thread.

**v1 (take-on-remove keyed by run tag, measure cache bypassed — the
literal Android mirror) REGRESSED the tall-block tiers** in the sim A/B
(messages bare 42.0 -> 67.2ms, article 35.8 -> 58.6, while 1k distinct
rows improved 200.6 -> 157.4). Mechanism: bypassing `textMeasureCache_`
converts cache-hot re-measures (repeated content, relayout churn) into
full re-shapes on the layout thread, inside the measured window. Android
got away with the same bypass because its win moved work OFF the UI
thread; on iOS the measure and the measured window sit on the same side.

**v2**: the storage cache is CONTENT-keyed ({AttributedString, container
width}, bounded LRU by character count), and the measure cache stays in
force. This extends the exact caching policy the C++ measure cache
already applies to the same inputs — a measure-cache-hit re-mount still
finds its storage at draw — and is the same policy NativeText's own
measure path enjoys, so tier comparisons stay apples-to-apples.

- **Correctness of a hit is by construction**: the key IS the content
  plus the width wrapping depends on. Container height differs by design
  (CGFLOAT_MAX at measure) and cannot affect glyph layout because runs
  never truncate (no maxNumberOfLines, clipping line-break mode).
  "The content" has to mean `Fragment::isContentEqual`, not a field list
  written out at the key. The first version compared text + text
  attributes and nothing else, which silently omitted the fragment's
  inline box — and an inline element's inline-axis margin/border/padding
  is not decoration the draw adds on top, it becomes kerning and
  `firstLineHeadIndent` on the NSAttributedString
  (`RCTApplyInlineBoxSpacing`), so it moves glyphs and changes where
  lines break. Two rows in a FIXED-width block with the same text and the
  same text attributes but different `<span>` padding were therefore a
  legal cache collision, and rendered identically. (Shrink-to-fit blocks
  hid it: there the padding changes the block's width, so the keys
  differed and the rows never collided — which is why the existing
  `InlineBoxAdvanceCase` demo did not catch it and a fixed-width case was
  added beside it.) Deferring to `isContentEqual` means a new
  layout-affecting field on `Fragment` is covered the day it lands.
- **Only run-tagged measures populate** (`TextLayoutContext.runTag`,
  already set by `InlineContentShadowNode::measureContent`); paragraphs
  keep their existing path. Flag-off apps never reach any of it.
- **Threading**: entries are inserted whole under a mutex and never
  mutated; draws are serial on the main thread; replacement keeps the old
  storage alive via ARC for any in-flight draw.
- **Dynamic colors / appearance**: the parked NSAttributedString holds the
  same UIColor objects the draw-time conversion would produce; dynamic
  colors resolve against the current trait collection at draw time either
  way. The existing `traitCollectionDidChange` invalidation is untouched;
  an appearance-flip redraw rebuilds (entry already consumed) — identical
  to today.
- **Threading contract**: the stack is built and FULLY laid out on the
  layout thread, published under a lock, claimed and used only on the main
  thread, and never touched by the layout thread again (take-on-remove
  makes the main thread the single owner). TextKit is thread-confinable;
  this is a confinement transfer with a happens-before edge, the same
  pattern RN's own off-main measurement relies on.
- **Memory**: bounded registry (count-limited, LRU eviction) + take-on-
  remove; claimed storage is NOT retained after the draw — the rasterized
  layer is already the redraw cache, and retaining TextKit stacks per view
  would regress steady-state memory vs paragraphs for no practical win.
- **Truncation pass**: `processTruncatedAttributedText` is a no-op for
  runs (no maxNumberOfLines); kept in the parked-draw path for symmetry.

## 2. Run-view backing stores for tall blocks (designed, not implemented)

A run view's canvas is its container's content box; a 1,000-line article is
a ~20,000pt drawRect layer. Paragraphs pay the identical cost, so this is
not a bare-vs-Text gap — but it is real memory/rasterization work for both.
Candidate: tile tall text layers (CATiledLayer or manual band-splitting into
per-hard-break run views). Rejected for now: CATiledLayer draws on
background threads (violates the TextKit confinement contract above), and
band-splitting changes the ViewState run shape — a cross-platform change
that needs its own spec pass (fragment rects, hit-testing, decorations
across bands). Recorded as future work for BOTH primitives.

## 3. Run adoption under flattening (designed, not implemented)

A bare string pins its View materialized (runs live on it) while an
identical `<Text>` row's View can flatten — a structural per-row host-view
cost whenever the wrapper is otherwise flattenable. Design: let a
flattenable View's runs be adopted by the nearest materialized ancestor
(re-based run frames, ancestor-space touch mapping, state ownership moves).
Deferred: correctness surface is wide (z-order/document order across
adopted runs, hit-testing, accessibility) and the fair benchmarks show
bare winning even while paying the materialization.

## 4. Prepared-layout state transport on Android (designed, not implemented)

Migrate `RunLayoutHandoff` from a tag-keyed registry to reference-carrying
state (the paragraph `PreparedLayout` pattern) once the multi-run-per-state
transport exists. Pure mechanics change — same reuse, stronger delivery
guarantee (no LRU eviction window); zero behavior change by design.

## Verification (design #1)

- Full Fantom suite (engine untouched — must stay green as a control).
- iOS CDP: cascade + css-display, 18/18 (shadow-tree geometry untouched).
- Pixel check: styled screen screenshot (decorations, spans, lists)
  before/after — parked-stack drawing goes through the same
  `drawBackground`/`drawInlineBoxDecorations`/`drawGlyphs` calls with a
  stack built by the same constructor, so output must be identical.
- Perf: sim DeviceTextBenchmark before/after (messages + article tiers are
  the target); device numbers via the next preview build.
