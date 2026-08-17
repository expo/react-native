# String children: the upstream PR sequence

> **Which benchmark these numbers are.** Performance figures in this directory
> come from five different measurements on different scales — see [text-vs-upstream-benchmarks.md](text-vs-upstream-benchmarks.md) for the
> tags and what each can and cannot tell you. Sizes here are lines of diff,
> not timings.

The plan for landing string children in react-native/main, split for the
smallest reviewable units. Grounded in the actual delta against the merge
base (upstream 2026-07-23): the relevant subset is ~6k lines across ~70
files, after excluding the element catalog and UA-stylesheet machinery
(framework territory) and CSS transitions/animations (a separate stack).

Three principles:

- **Each PR is acceptable on its own story** — the early ones require no
  belief in string children at all.
- **Stacked, flag-gated, always-green:** every PR after Yoga's flag lands
  behind `enableStringChildren`; `main` ships zero behavior change with the
  flag off at every step. New node types land with their unit tests one PR
  before they are wired in — normal stacked-diff practice.
- **Nothing lands wrong-then-fixed.** Every bug fix and optimization found
  during development is folded into the PR that introduces the relevant
  code: run building arrives already O(n) (never the quadratic first
  draft), the cascade arrives with copy-on-write storage, consumer-side
  stamping, clone preservation, and dependents-bit gating from day one
  (never the +464-bytes-per-node or walk-the-whole-tree versions), the
  attachment pass arrives with the placement map (never the O(n²) scan),
  and each size guard lands in the same PR as the structure it pins. The
  fork's history of finding these the hard way stays in
  `string-children-perf-plan.md`; upstream only ever sees the corrected
  form.

Twenty-one numbered PRs in eight themes, plus the three unnumbered follow-ups
of theme 8 — twenty-four in all. The largest is ~800 lines; the median is ~250.

---

## Theme 1 — free win (no flag, no belief required)

**1. `TextAttributes` 232 → 168 bytes.** Explicit enum bases in
`attributedstring/primitives.h`, size-ordered fields, a `static_assert`.
Zero behavior change; −28% on a struct copied into every text fragment and
measure-cache key. *~150 lines.*

## Theme 2 — Yoga `display: block` (standalone Yoga value)

**2. The enum and the flag.** `Display::Block` in `yoga/enums/Display.h`,
`Style.h` plumbing, `YGEnums.*`, flag `enableYogaDisplayBlock`. Parses and
stores; layout unchanged. *~100 lines.*

**3. Block layout.** Children stack vertically and fill the inline axis
(`CalculateLayout.cpp`). Yoga-level tests. *~350 lines.*

**4. Margin collapsing.** CSS2 §8.3.1: adjacent siblings collapse,
first/last-child margins, the nested-escape rule. *~250 lines.*

**5. Floats.** `FloatSide.h` + the float placement rules. *~150 lines.*

## Theme 3 — `#text` nodes

**6. The node types.** `TextNodeShadowNode.h`,
`TextNodeComponentDescriptor.h`, unit tests. Not yet reachable. *~200 lines.*

**7. The wiring.** `createTextNode` through `uimanager/`, flag-gated.
RawText stays — deletion waits until the flag defaults on (out-of-tree
platforms depend on it; the fork's deletion is not upstreamed yet).
*~200 lines.*

## Theme 4 — anonymous inline content (the core, in six steps)

**8. Traits and cheap downcasts.** The new `ShadowNodeTraits` bits and the
`YogaLayoutableKind` trait + `asYogaLayoutable()` helper. The devirt is
independently valuable: RTTI `dynamic_cast` dominated inline-heavy profiles.
*~150 lines.*

**9. Inline box props.** `InlineBoxProps.*` + the `BaseTextProps` parsing —
inline margin/border/padding as data. Inert until consumed. Ships
direction-aware from the first commit: `RawProps` is a cursor that may read
each name only once, and the resolved inline direction is a layout result the
parser cannot know, so the parse produces BOTH physical resolutions and the
consumer picks. Border has no logical shorthands in RN, so the second
resolution is four numbers rather than a second copy of the struct. The
LTR-only version is not a thing upstream ever sees. *~350 lines.*

**10. The run node.** `AnonymousTextContent.*`, `InlineContentShadowNode.*`,
`InlineElementMetrics.*` — the anonymous IFC box class, with unit tests.
Registered nowhere yet. *~800 lines, the largest single PR.*

**11. Run building.** `YogaLayoutableShadowNode` integration: inline-content
detection, the rebuild deferred to configure so construction is O(n) from
the first commit, `UIManagerCommitHook`. Bare strings now produce runs;
Fantom structure tests plus the `InlineAppendScaling` benchmark as the
scaling receipt. *~550 lines.*

**12. Measure and whitespace.** The `textlayoutmanager` fragment-rect
support and css-text-3 whitespace collapsing. Runs measure correctly;
Fantom layout tests. *~400 lines.*

**13. Paint state and attachments.** `ViewState.h`, `ViewShadowNode` run
publishing and attachment layout, looked up through a family-keyed map from
the start (never the linear scan). The `StringChildrenOverhead`,
`TextAlternatives`, and `StringChildrenCosting` benchmark suites land here —
the receipts: zero cost unused, ~2× vs `<Text>` component-for-component and
2–4× when lines share a container, with the costing suite's shape
decomposition telling the honest NativeText story. *~600 lines.*

## Theme 5 — platform mounting

**14. iOS.** `RCTAnonymousTextRunView` + `RCTViewComponentView` painting.
Ships pixel-aligned from day one: the `containerFrame` accessor — the
single geometry paint and hit-testing share — rounds to the device pixel
grid (fractional draw origins defeat the CoreGraphics glyph cache;
measured 224 -> 131ms on 1k sim rows). *~15 files.*

**15. Android.** The span/view path. Ships with mount-time layout reuse
and pixel alignment integrated, not as follow-ups:
- `TextRunLayout` origins round at dp->px construction (the last moment
  paint and touch share), keeping hinted glyphs on the pixel grid and 1px
  decorations from anti-aliasing into a 2px band;
- the measure->mount layout handoff (`TextLayoutContext.runTag`,
  `AS_KEY_RUN_TAG`, `RunLayoutHandoff`): measurement parks the
  spannable+StaticLayout it already built, mount claims it after deep
  content-equality/density/width verification instead of rebuilding on
  the UI thread (probed 16.3us/run — the entire bare-vs-NativeText
  marginal gap; 100% reuse hit rate; every mismatch degrades to a
  rebuild, never wrong content);
- mount-level state dedupe (Fabric delivers identical run state twice
  per commit) and run-layout clearing on view recycle;
- and `overflow` clips inline-box ink like CSS2 §11.1.1 says, matching iOS,
  where the extra drawing room is a wider *subview* canvas the container still
  clips. Widening the clip instead defeats the property it is implementing.
Measured on release emulator: bare 63.7ms vs NativeText 78.4 vs <Text>
93.6 on 1k settings rows — bare strings are the fastest text primitive
on Android in every scenario. *~14 files.* (14 and 15 are siblings.)

## Theme 6 — inline-level display on Views

**16. `display: 'inline'` span-flow.** Unsized all-inline Views fold into
the surrounding run. *~250 lines.*

**17. Atomic inlines.** `inline-block`/`inline-flex` atomicity + baseline
alignment. The baseline rule arrives complete: CSS2 §10.8.1 is "the last line
box in the normal flow", and line boxes live in descendant blocks too, so the
search descends rather than looking only at the box's own anonymous IFC. Every
branch is pinned to Safari — nesting at any depth equals direct text, the LAST
line box wins even when it overflows the box, a child with no line box is
skipped rather than fatal, `position: absolute` and `float` never contribute, a
clipped descendant offers its own bottom margin edge but only if it has a line
box at all, and offsets accumulate through padding and margins. Answering
"no baseline here" is what makes the descent possible, and is why this is one
PR and not a fix on top of one. *~350 lines.*

**18. `display: contents` interactions.** *~100 lines.*

## Theme 7 — style inheritance and `all`

**19. The inheritable props.** The eleven fields on `BaseViewProps` +
`hasInheritedTextProps` (the parse-time bit that gates every later hot
path), the JS style-attribute keys, the `ViewProps` size guard. Parsed,
stored, read by nothing yet — inert, and the +68 B props cost arrives
visibly in its own PR. Two hard-won parse constraints ship in this PR's
initial form, never as fixes: the probes are flag-gated per-field IN
declaration order (RawPropsParser optimizes monotonic key access; hoisting
the probes measured +26% on `<Text>`-row mounts), and text-vocabulary props
never probe these keys at all — `BaseParagraphProps` copies the values from
its already-parsed `textAttributes` (the double parse measured +33% on
`<Text>`-heavy mounts against a probe-free baseline). *~350 lines.*

**20. The cascade, complete.** Propagation in `configureYogaTree`, arriving
in its final form: copy-on-write storage shared through a default instance,
effective values stored only on consumers (`ParagraphShadowNode`,
`InlineContentShadowNode`, with clone constructors preserving them — the
class of bug that once showed up as "text drops to 14pt black"), the
dependents bit gating both dirtying and descent so a style change never
walks a subtree that cannot observe it, and the append-path bit surfacing
that the deferred rebuild requires. Inheritance works AND costs parity on
day one; the M4 suite and the inheritable-update benchmark rows land
together as proof. *~700 lines — the price of never landing the slow or
leaky intermediate versions, and worth it.*

**21. `all` boundaries.** `cascadeReset` parsing (`initial`/`revert`/
`unset`/`inherit`), boundary traits, the inline-fold reset (an `all` on a
mid-run `<span>` or nested `<Text>` works from the first commit — the fork
found this gap by audit, upstream never has it), and root `<Text>`'s
default boundary as `ParagraphShadowNode`'s `UACascadeBoundary` trait —
the cascade's native UA origin, which `revert` resolves against
(boundary on root Text, unset → inherit everywhere else) and `unset`/
`inherit` defeat. The fork now implements exactly this design, so the PR
is a lift, not an adaptation. The compatibility keystone: enabling
inheritance changes zero existing pixels. Boundary test suite, including
the revert-vs-initial contrast on both Views and Text. *~400 lines.*

## Theme 8 — DOM surface for inline elements *(after theme 4)*

Three follow-ups, any order: fragment-rect `getBoundingClientRect` (*~250*),
pointer events resolving to fragment emitters (*~200*), and **`user-select` on a
View's own text** (*~200 across the property, iOS and Android*). The last one
depends on the platform painting of theme 5 and nothing depends on it, so it can
land last or be dropped without disturbing the rest. It is what makes a bare
string selectable the way the text inside a `<Text>` is, and it carries the
`user-select-auto-is-none` limitation: CSS `auto` computes to `none` here rather
than to "inherit unless it is a text control", because the renderer has no
notion of which elements are text controls.

The geometry one ships with three properties that are easy to get wrong and
were all found the hard way, so upstream only ever sees the corrected form.
The first is the one that matters for performance:
- **it does not measure a run that has no element to stamp.** Obtaining
  fragment rects costs a full text layout, and their only consumer is the
  per-element box built from them — so for a View whose text children carry no
  `<b>`/`<span>`, which is the ordinary shape, that layout is computed and
  discarded in its entirety. Whether a run has a stampable element is
  decidable from the attributed string alone (`hasStampableInlineElements`),
  before measuring. Skipping is provably behaviour-identical, not merely
  equivalent: the measurement's only use is as the VALUES of `boxesByTag`, and
  when that map is empty the stamp returns having performed no side effect.
  Measured on the iOS simulator: 100 ten-line bare bodies 81.7ms -> 56.4ms,
  1k bare-string rows 149.3 -> 97.5 (±1%), a 1k-line bare block 70.3 -> 48.6.
  The engine benchmarks barely move (article -21%, messages -6%) because a
  deterministic measurer makes the discarded layout nearly free — which is
  exactly why this is invisible until a real text engine runs it, and why the
  benchmark suites alone would never have caught it;
- an element's frame is stamped **relative to its nearest stamped ancestor**,
  because `getBoundingClientRect` sums frame origins up the node tree while
  every box is computed in the run's space. Stamp run-space coordinates and a
  nested element gets its ancestor's offset twice — invisible whenever the
  outer element sits at x=0, which is exactly what a first test looks like;
- a **sealed** element is not skipped. Its metrics come from the run's layout,
  not its content, so an element that never changes still moves when the run
  rewraps around it; the owner clones the path to it, as it already does for
  inline `<img>` attachments. Skipping was measured as a `<b>` reporting x=110
  after a 400 → 120 resize where a fresh tree gives x=0.

---

## Explicitly not in this sequence

- The element catalog, `uaStyle`/`recordNodeName`/`resolveUIViewClassName`,
  the fallback view-config resolver, `defineReactElement` — framework
  territory (`packages/expo-intrinsics`).
- CSS transitions/animations (`renderer/animationbackend`).
- The `InlineReplaced` trait and `<img>` machinery — rides with the catalog.

## Why this ordering is the easiest to accept

Nothing before PR 8 requires believing in the feature. The one big review of
the old plan (~3,000 lines) is now six PRs of 150–800, each with its own
tests. Dependency chains stay linear inside each theme, themes 2/3 are
independent of each other, and at every step `main` with the flag off is
bit-identical in behavior — the flag-off benchmark columns ride along from
PR 13 onward. Where a fix or optimization would once have been a follow-up,
it is folded into the introducing PR instead: a reviewer never approves
code we already know to be slow or wrong.
