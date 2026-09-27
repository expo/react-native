# String children: performance optimization plan

> The Rounds below are the lab record — each cites the numbers measured AT
> THE TIME, and later rounds changed them. Canonical current numbers live in
> `string-children-perf-memo.md` and `upstream-pr-verification.md`, measured
> together at frontier `2affd860114`.

Baseline (release-built Fantom tester, medians over 50 iterations, from
`StringChildrenOverhead-benchmark-itest`):

| workload                                  | flag off | flag on | delta       |
| ----------------------------------------- | -------- | ------- | ----------- |
| mount 1365 plain Views                    | 16.05ms  | 16.05ms | free        |
| non-inheritable update, same tree         | 2.12ms   | 2.08ms  | noise       |
| inheritable (color) update at root        | 2.09ms   | 2.30ms  | +10%        |
| inheritable update, 60-deep chain         | 0.37ms   | 0.39ms  | +6%         |
| mount 200 `<Text>` rows                   | 7.97ms   | 8.19ms  | +2.8%       |
| same content as bare strings              | 8.01ms   | 3.31ms  | 2.4× faster |

And one memory number measured statically: the two cascade `TextAttributes`
members are **464 of `ViewShadowNode`'s 1576 bytes (29%)**, stored and copied
for every View whether the flag is on or off.

The targets, in order of importance: the 464 B/node that everyone pays, the
+2.8% on `<Text>`-heavy mounts, and the +10% on inheritable-style updates.

## Where the flag's time actually goes

Three code paths, all in `YogaLayoutableShadowNode`:

1. **Per clone with new props** (`.cpp:209`): two `dynamic_cast`s to
   `BaseViewProps` plus `inheritableTextPropsDiffer` — 11 field compares,
   including a `std::string` compare — to decide whether the cascade must
   re-run. Measured: invisible at -O3 (the non-inheritable-update row).
2. **Per node, per configure pass** (`.cpp:988`): a `dynamic_cast` plus
   `applyInheritedTextAttributes` — 11 branches folding the node's inheritable
   props into its cascade value.
3. **Per child, per configure pass** (`.cpp:1010`): a full
   `TextAttributes` equality (232-byte struct, ~30 fields) against what the
   child received last time, and — when anything upstream changed — two
   232-byte struct copies into the child.

Plus the constant: every shadow-node clone copies the two 232-byte members in
the copy constructor, flag on or off.

## Candidates

### A. Copy-on-write cascade storage — PoC

Replace the two value members with `std::shared_ptr<const TextAttributes>`,
with one process-wide instance for the default cascade. Nodes under an
unstyled ancestor — the overwhelming majority — all point at the same object.

- Memory: 464 B → 16 B per node (−28% of `ViewShadowNode`); the 1365-View
  benchmark tree drops ~610 KB.
- Clone: two pointer copies instead of two 232-byte struct copies.
- The per-child equality in configure becomes a pointer-identity fast path
  (same object ⇒ equal, no field walk); the two per-child copies become
  refcount bumps.
- New cost: one heap allocation per node that *establishes* a distinct cascade
  value (a styled container), once per commit that changes it. That set is
  small in real trees.
- Risk: medium-low. ~17 sites in one file plus a getter that can keep its
  `const TextAttributes&` signature (deref), so the text-side consumers
  (`ParagraphShadowNode`, `InlineContentShadowNode`) don't change.

Expected: kills most of the clone-path cost (helping the 2.8%), the per-child
equality cost, and the memory tax.

**PoC result:** wall-clock UNCHANGED at -O3 — every benchmark row within
cross-run noise — but the memory win is real and verified:
`ViewShadowNode` drops **1576 → 1144 bytes (−27%)**, for every View in every
shadow-tree generation, flag on or off. The struct copies and equality walks
this replaces were simply never the wall-clock bottleneck at -O3. Keep for
memory; claim nothing about speed.

### B. `hasInheritableTextProps` parse-time bit — PoC

`BaseViewProps` computes one boolean at parse time: "any of the 11 inheritable
fields is set". Then:

- Clone path: if neither revision has the bit, skip the 11-field differ
  entirely (two loads instead).
- Configure path 2: skip the fold when the bit is false — most nodes.

- Risk: trivial; the bit is derived state computed where the fields are parsed.
- Expected: shaves path 2 (per-node fold) which runs on every configure of
  every node.

**PoC result:** neutral at -O3 — the fold and differ were already invisible in
release builds (they were only expensive in Debug, which is what made them
look like suspects). Kept anyway: it is one boolean, and it is what gates
A's copy-on-write allocation to just the nodes that carry inheritable props.

### C. Text-content subtree gating — static assessment, PoC only if A+B leave meat

A `SubtreeContainsTextContent` bit maintained bottom-up in
`updateYogaChildren` (set if any child has it, or the node owns anonymous text
content, or it is a Paragraph). Cascade propagation skips writing into — and
equality-checking — children without the bit.

- This is sound because the cascade's only consumers are text: paragraphs
  (`ParagraphShadowNode.cpp:85` reads it) and anonymous runs. A subtree with
  no text has no consumer, and text arriving later necessarily creates new
  parents (`updateYogaChildren` recomputes on the clone path).
- Note `<Text>` *does* consume the cascade, so this cannot skip text-bearing
  subtrees — it targets the text-free regions (navigation shells, decorative
  layers), which is where the +10% inheritable-update cost hurts most.
- Risk: medium — a derived invariant across clones; needs careful tests around
  insertion, state-only clones, and layout-driven clones.
- Expected: inheritable-update cost proportional to text-bearing area rather
  than subtree size.

**BUILT (lever 1 + the `all` boundary), and it worked.** With the
`SubtreeHasCascadeDependents` bit gating the clone-path dirtying and the
configure-pass cascade writes, the inheritable-update penalty is GONE:

| workload                                     | before (on vs off) | after   |
| -------------------------------------------- | ------------------ | ------- |
| inheritable (color) update, 1365-View tree   | +10%               | parity  |
| inheritable update, 60-deep chain            | +6%                | parity  |
| same tree with ONE distant text leaf         | (new row)          | parity  |
| text behind an `all: initial` boundary       | (new row)          | parity  |

The one Fabric wrinkle: children are appended one at a time after
construction, so the bit is OR-ed in on the plain-child append path — full
recomputation happens on any children-changing clone, which is also what
covers removal. The `all: 'initial'` boundary rides the same machinery
(an `InheritanceBoundary` trait derived from props; boundary children are
handed the default cascade and contribute nothing to ancestors' bits).

**Original assessment follows.** A and
B proved the copies, folds and compares are not where the +10% lives — the
cost is the re-configure/re-layout WALK over the dirtied subtree itself. C is
the only candidate that avoids the walk: a text-free subtree would never be
dirtied by an inheritable-prop change in the first place (the clone-path
setDirty gates on the bit). Build next, with the insertion/clone invariant
tests it needs.

### D. Devirtualize the hot-path casts — static assessment only

The `dynamic_cast<const BaseViewProps*>` in paths 1-2 could become a
trait-guarded `static_cast`. Measured cost is below noise at -O3 (the
non-inheritable row), so not worth the type-safety loss. **Verdict: skip.**

### E. Shrink `TextAttributes` itself — out of scope

232 bytes for ~30 mostly-optional fields is a preexisting cost shared with all
of RN text. Packing it helps everything but is invasive; A sidesteps it for
the cascade's copies. **Verdict: note upstream, don't do here.**

### F. Anything on the JS side — nothing needed

Mounting is already free and the feature syntax is 2.4× faster than the
`<Text>` equivalent. No JS-side work is on the critical path.

## Measurement protocol

Each PoC is measured with the existing suite under both flag values, on the
release tester (`build/tester-release`, swapped over `build/tester`), five-run
medians for the rows it targets. A PoC is viable if it moves its target rows
without regressing the others, and correct if the full Fantom suite stays
green (3100+ tests, which exercise the cascade's observable behavior heavily —
CascadeLayoutClone, CascadeSiblingRerender, InlineCascade, StringChildren*).

## Round 2 — found by probing, not by the original plan

### G. The inline-append rebuild was quadratic — FIXED

`appendChild` rebuilt ALL of a container's Yoga children on every inline
append ("O(children) per append; acceptable while runs are small" — it was not
acceptable): O(n²) for a container with n inline children. The rebuild is now
DEFERRED to the next configure pass — one O(n) rebuild — with the
cascade-dependents bit surfaced at append time since ancestors adopt this node
before the deferred rebuild runs.

### H. RTTI dynamic_cast was the top CPU consumer — FIXED where hottest

A release-build `sample` of the 400-inline-children mount put
`__dynamic_cast` machinery above every renderer function. Layout downcasts
child ShadowNodes per child per pass. A `YogaLayoutableKind` trait set by the
class's constructors plus `asYogaLayoutable()` (trait check + static_cast)
replaced ~10 hot sites. This REVISES candidate D's "skip" verdict: dynamic_cast
was below noise for plain View trees, but dominant for inline-heavy content.
The `dynamic_cast<BaseViewProps*>` sites (per child per attributed-string
build) are the remaining RTTI hot spot — same trick applies if profiles
demand it.

### Scaling results (one container, n inline children, release tester)

| n   | before  | after   |
| --- | ------- | ------- |
| 50  | 1.48ms  | 1.11ms  |
| 100 | 3.83ms  | 2.56ms  |
| 200 | 11.52ms | 6.13ms  |
| 400 | 36.40ms | 16.67ms |

−54% at 400, and the curve bends toward linear. The overhead suite now shows
no flag tax on any row.

### I. TextMeasureCache misses on paint-only changes — DEPRIORITIZED

The cache key compares every text attribute, so a color-only cascade change
re-shapes text that cannot have changed size — for classic `<Text>` too, on
every platform. Keying on metric-affecting attributes only (exclude
foregroundColor and friends; keep textTransform, which changes the string)
makes repaint-driven re-measures cache hits.

Deprioritized together with the repaint channel, and for the same reason:
its only win IS the paint-only-change scenario, and changing just the color
of text is uncommon (user call, 2026-08-12). The insight stays as a comment
candidate — the cache key knowingly over-invalidates — but the engineering
is not worth its risk until a real workload shows recolor jank.

## Verification and measurability (invested up front, user call 2026-08-12)

- `./bench-string-children.sh` — one command: builds the release (-O3)
  tester, prints the struct-size probe, runs both benchmark suites under both
  flag values, restores the debug tester. Every number in this document is
  reproducible with it. `--sizes` for the probe alone.
- `static_assert(sizeof(ViewShadowNode) <= 1200)` and
  `sizeof(TextAttributes) <= 240` (ViewShadowNode.cpp, apple/arm64): the
  memory wins cannot silently regress; a legitimate trip means re-measuring
  and moving the bound consciously.
- The cascade's invariants are consolidated in ONE doc block above its
  members in YogaLayoutableShadowNode.h; the developer-facing model and the
  `all: 'initial'` boundary are documented in text-inheritance-boundaries.md.
- Remaining debts: an on-device iOS profile for the attachment-placement map
  (Fantom cannot see placements), and an RSS measurement of a large real tree
  to confirm the sizeof win end-to-end.

### F. The placement lookup in the attachment pass — fixed blind

A linear scan per attachment over the placements list (O(attachments²)) is now
a map. Fantom could not measure it — its deterministic text manager reports no
placements — so this one lands on real-platform reasoning alone.

## Round 3 — the memory work (user call: "do the memory optimizations")

### E. TextAttributes shrink — DONE: 232 → 168 bytes (−28%)

Thirteen `std::optional<enum>` fields at 8 bytes each (default int base) plus
topic-grouped padding. The attributedstring enums now carry explicit small
underlying types (uint8_t; uint16_t for FontWeight; FontVariant keeps int —
a bitmask to 1 << 25) and the fields are grouped by size with a comment
explaining why. Every AttributedString fragment, TextMeasureCache key and
paragraph state shrinks with it. Guard: `sizeof(TextAttributes) <= 176`.

### Lever 2 (storage) — DONE as consumer-side storage: ViewShadowNode 1144 → 1128

The effective cascade is no longer stored on every node: `configureYogaTree`
derives it locally from the 8-byte received memo (which stays — it is the
change-detection channel, and it is what makes reparented subtrees re-cascade
correctly), and only CONSUMERS store it (paragraphs and anonymous IFC boxes,
via setInheritedCascade/getStoredCascade virtuals; their clone constructors
preserve it, because boxes are cloned by state progression and a fresh
default is the "text drops to 14pt black" bug). Views now carry one pointer,
not two. Benchmarks unchanged (all rows parity/noise, 2.5× intact).

Full accounting vs a build without the feature: ViewShadowNode carries the
8-byte received memo plus one deferred-rebuild bool for string children —
under the original +464, and half of the +16 the plan previously reported.

### Where the remaining bytes are

`sizeof(ViewShadowNode)` = 1128: the received memo (8) is the last
string-children cost on plain Views. Going to literal zero requires replacing
the per-node memo with change propagation that still catches reparented
subtrees — possible (e.g. always-descend-on-fresh-parent-clone into
dependent children), but it trades back some of lever 1's walk savings.
Recorded as possible, not planned.

## Round 4 — can bare strings beat NativeText? (the shape analysis)

The question: make bare strings (with this stack's optimizations) outperform
NativeText as it exists on main. Method: a cost-decomposition benchmark
(`StringChildrenCosting-benchmark-itest.js`) that renders the same 1k lines
in every shape, release (-O3), p50 of 20. Methodology rule: every tier
renders inside the SAME plain harness `<View>` — one parent View always
containing the benchmark, never styled or varied per tier — so tiers that
need a container of their own (the web-model shapes) render it as content
and pay for it. Holding the harness constant is what makes the per-line
columns comparable.

| shape (1k lines) | p50 | per line |
| --- | --- | --- |
| empty `<View collapsable={false}>` per line (the View floor) | 10.6ms | 10.6µs |
| two empty Views per line (mounted-child marginal cost) | 22.4ms | +11.7µs/node |
| bare string per line (View + anonymous box + text) | 14.0ms | 14.0µs |
| View + NativeText child per line (same wrapper, component text) | 16.9ms | 16.9µs |
| **one container, 1k `#text` children** (`whiteSpace:'pre-line'`) | **2.0ms** | 2.0µs |
| **100 containers × 10 `#text` lines** (paragraph grouping) | **4.0ms** | 4.0µs |
| empty `<NativeText>` per line (the paragraph floor) | 5.3ms | 5.3µs |
| NativeText per line (the target) | 8.0–8.5ms | ~8.2µs |
| update 1 line: single container / NativeText | 2.2ms / 6.6ms | — |

Findings, in order of importance:

1. **In the per-line-wrapper shape, bare strings cannot beat NativeText
   today — and text is not the reason.** The wrapper View's floor alone
   (10.6µs, no text at all) exceeds an entire NativeText line (8.2µs). Our
   whole text machinery — anonymous box node, run build, whitespace
   collapsing, measurement, state publish — adds 3.3µs/line, nearly parity
   with the paragraph's own text work (8.2 − 5.3 = 2.9µs). The gap is the
   VIEW, not the run.

2. **A mounted empty View costs 2× a mounted empty paragraph** (10.6 vs
   5.3µs) — the real anomaly, and a general react-native question worth its
   own investigation (it is not the stacking-context trait: disabling
   FormsStackingContext on text containers measured no change; not props
   size: ParagraphProps ⊃ ViewProps). Close that gap and per-line bare
   strings land at ≈ NativeText with every feature NativeText strips.

3. **In the web content model, bare strings beat NativeText 2–4× right
   now.** The model's point is that text does not need a host component per
   line: the same `list.map`, emitting one `#text` child per line instead of
   one `<NativeText>` per line, mounts 4.1× faster in one container and 2×
   faster grouped into paragraph-sized containers (a chat message, a
   comment). A `#text` node has no props parse, no yoga node, no mounted
   view — that is the structural win the per-line-wrapper benchmark shape
   deliberately gives away.

4. Updates favor the single container too in Fantom (2.2 vs 6.6ms —
   re-rendering 1k strings diffs cheaper than 1k elements), **with an honest
   caveat**: Fantom's deterministic layout under-costs re-measuring a
   1k-line block; on device, CoreText/StaticLayout re-shapes the whole
   block. Paragraph-sized grouping bounds that cost the way the web does.

5. **Per-line layout: white-space vs `<br>`.** Both give per-line line
   breaks inside one container, but their costs differ by 7×: `\n`
   characters under `whiteSpace:'pre-line'` are just bytes in `#text` nodes
   (2.0ms/1k), while `<br>` as shipped is a catalog inline element backed by
   `inline-text` — a full host component per break (JS element, view-config
   resolution, TextProps parse, shadow node) measuring 13.8ms/1k, worse than
   per-line NativeText. The fix, if `<br>` matters at scale: a break needs
   NO props, so it deserves a `#text`-grade lightweight node path (a
   dedicated break node kind, or break info carried on the adjacent text
   fragment — the run builder already models `forcedBreak` per fragment).
   Recorded as future work; today the guidance is `\n` + `pre-line` for
   bulk line breaks, `<br>` for occasional semantic breaks.

6. Box-construction overhead was already lean: sharing one default-props
   instance across all anonymous boxes (they are synthesized, there is no
   author) landed as the one code change; eliding the box entirely for
   all-inline containers (spec-aligned — CSS 2.1 §9.2.1.1 only requires
   anonymous boxes when block and inline content MIX) would trim ~1–2µs/line
   at real complexity cost (measure-on-self, marker sinks, baselines) and
   still cannot cross the View floor. Deprioritized; the View floor is the
   lever.


## Round 5 — the benchmark redesign (review: understandable and realistic)

Review feedback: NativeText-vs-(View+string) comparisons conflate wrapper
and text; "100 containers × 10" is opaque; tiers should be scenarios a
reader can picture. The costing suite was rewritten scenario-first —
settings list (1k single-line rows, floor-subtracted marginal text cost),
message list (100 rows, 10-line bodies, against today's one-<Text>-per-body
idiom), article (one 1k-line block), and the community shape kept only for
apples-to-apples and labeled "not a real-app shape". Canonical harness
numbers (release, p50 of 20): settings floor 10.6ms, +bare 13.5 (**+2.9µs
text/row**), +NativeText 17.5 (+6.9), +Text 26.6 (+16.0); messages 2.31
bare vs 2.92 Text; article 0.57 bare vs 0.45 Text (**Text wins — pre-line
processing headroom noted**); community shape 8.4. The DeviceTextBenchmark
screen mirrors the same scenarios. Earlier tier names in Round 4 are the
lab record.

Device scenario runs (release RNTester): iOS per-row tiers within ~6%
(platform layout dominates); **Android bare per-row 14–24% behind
Text/NativeText end-to-end** (104 vs 92/84ms per 1k rows) — the Android run
pipeline (MapBuffer → StaticLayout → drawTextRun per container) is the
recorded optimization target; messages/article shapes trade ±10–20% both
ways against today's idioms.
