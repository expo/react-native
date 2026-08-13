# Run layout reuse: measure→mount handoff

Goal: make bare strings faster than NativeText by eliminating the quantified
bottleneck (string-children-perf-plan.md, bottleneck findings d9d9ea697b8):
Android rebuilds each run's spannable + StaticLayout **on the UI thread at
mount** (probed 16.3µs/run — ≈ the entire 14.8ms/1k bare-vs-NativeText
marginal gap), after having already built an identical layout **at measure**
on the background thread and thrown it away. NativeText doesn't pay this:
with prepared text layouts, paragraphs receive their measured layout by
reference through state. Runs get the same property here, with a fraction of
the transport surface.

## Design

A **handoff registry**: the measurement path parks the layout it just built,
keyed by the run box's React tag; the mounting path *takes* it (take =
remove) after verifying it is exactly the layout for the content being
mounted.

Wiring (the tag has to travel two routes that meet in Java):

1. `TextLayoutContext` gains `Tag runTag{0}` (0 = not a run).
   `InlineContentShadowNode::measureContent` sets it to `getTag()`.
2. Android `doMeasure` serializes the attributed string with a new top-level
   key `AS_KEY_RUN_TAG = 5` when `runTag != 0` (via an optional-tag parameter
   on `toMapBuffer(AttributedString)`; other callers unchanged).
3. `ViewState::TextRun` gains `runTag` (content runs: box tag; **outside list
   markers: 0** — a marker shares its box's tag with the content run and
   would collide, and its layout is trivial). `ViewState::getMapBuffer`
   serializes the run's attributed string with the same key, so the measure-
   side and mount-side buffers stay byte-comparable.
4. Kotlin `RunLayoutHandoff`: a synchronized LRU (`sizeOf` = character count,
   cap ~32k chars ≈ low single-digit MB worst case, transient in steady
   state because take removes). `TextLayoutManager.measureText` stores
   `{attributedString buffer, layout, density}` after building the
   measurement layout when the buffer carries `AS_KEY_RUN_TAG`.
5. `ReactViewManager` (run mount loop) reads the tag, takes the entry, and
   verifies before reuse:
   - **content**: stored buffer `==` mount buffer (`ReadableMapBuffer`
     equality is content-based — byte compare);
   - **density**: unchanged since the store;
   - **width**: `entry.layout.width == ceil(mount layoutWidth)` → reuse the
     layout as-is. Content matches but width doesn't → rebuild only the
     StaticLayout from the stored spannable (still skips spannable
     construction). Anything else → today's full rebuild.

## Why not the alternatives

- **Content-keyed layout cache (no removal)**: warm-cache hits for repeated
  identical strings would flatter benchmarks (iterations remount the same
  strings) while real apps mount novel text. Take-on-remove only ever reuses
  work *this commit's measure* did — the honest claim.
- **Full prepared-layout state transport** (paragraph's
  `ReferenceStateWrapper`): the right long-term shape, but paragraph state
  carries ONE layout reference and views carry N runs; extending core state
  transport to reference lists is a much larger surface for the same reuse.
  The registry can migrate to it later without changing the Java mount side.
- **Keying by content hash alone**: hash collisions and attribute drift
  become wrong pixels. Tag + full byte-equality verify is exact; every
  failure mode degrades to a rebuild, never to wrong content.

## Edge cases

- **Async mount race**: commit N+1's measure can overwrite the entry before
  commit N's mount takes it → content verify fails → rebuild. Correct by
  construction.
- **Yoga measures a box several times** (different constraints): last write
  wins; the width verify picks the right degree of reuse.
- **Yoga measure cache skips measure entirely**: then content and frame are
  unchanged, `textRuns` compares equal, and no state update reaches mount —
  no entry needed.
- **Density change** (foldables, display switch): density verify → rebuild.
- **Cross-instance tag collision** (two ReactInstances in one process):
  content verify makes it a miss, not a bug.
- **fontWeightAdjustment / paint config drift**: today mount builds with a
  plain `TextPaint(ANTI_ALIAS_FLAG)` while measure uses the measurement
  paint. Reusing the measured layout makes *paint match measurement by
  construction* — an alignment-class correctness improvement (what you see
  is what was measured). Risk: pixel output shifts where the two configs
  disagreed; gated by CDP geometry checks + screenshots.
- **Threading**: store on the background (layout) thread, take on the UI
  thread; the synchronized map is the happens-before edge and StaticLayout
  is immutable after publication.

## Implementation findings (2026-08-13)

- **Every View mounts its runs twice**: the initial mount and the
  state-update mount item of the same commit deliver identical serialized
  state ~10ms apart (probed: first take hits, second finds the consumed
  registry). Fix folded in: `ReactViewGroup.mountedTextRunsState` remembers
  the serialized state the mounted layouts were built from, and
  `updateState` keeps them when the incoming state compares content-equal —
  which also halves the rebuild cost for any path that misses the handoff.
- **`ReadableMapBuffer.equals` is unusable for nested buffers**: a nested
  buffer is a `duplicate()` of its WHOLE parent with an offset, and `equals`
  rewinds and compares entire backing buffers. `contentEquals` walks entries
  instead — and must handle `MAP_BUFFER_LIST` (the runs list), which is not
  a `MAP`; missing it made the dedupe silently never match.
- **The measurement scratch paint is thread-local and mutable**; a parked
  layout retains its paint, so run-tagged measures copy it (`TextPaint().set`).
- **Probed hit rate on the Cascade screen: 100%** — every content run's
  take found a verified entry (`ALIGN_NORMAL`, not-soft-wrapped, layout
  width == mount width), duplicate deliveries deduped.

## Verification

- Fantom full suite (all platforms — `runTag` is inert off-Android).
- Android emulator: cascade + css-display CDP (18/18) on a rebuilt binary,
  plus RNTester screenshot of mixed styled/inline content.
- Perf: StringChildrenCosting (engine, quiet machine) must not regress;
  emulator + release-device DeviceTextBenchmark before/after. Success =
  Android bare-row marginal at or below NativeText; no regression elsewhere.
- Prefab ABI drill applies (ReactCommon header changes).
