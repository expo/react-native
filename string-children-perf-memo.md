# String children: performance and memory results

String children is a flag (`enableStringChildren`) that lets you put text
directly inside any component:

```jsx
<View style={{fontSize: 16, color: '#333'}}>Hello world</View>
```

No `<Text>` wrapper needed. Text styles inherit from parent components, like
on the web. This memo answers two questions with measurements:

1. **Does the flag cost apps that don't use it?** About 1.5% on mount for
   trees with no text — half of which disappears on React Native's newer
   push-based props path — and about 84 bytes per View, which the optimization
   work done alongside repaid several times over.
2. **What does it gain?** Component-for-component, bare strings render text
   about 2× faster than `<Text>` — and 2–4× faster than anything when lines
   share a container, which is how the web model writes text anyway.

All numbers are medians on an optimized (-O3) build (50 runs for the
overhead suite, 20 for the others), measured together in one session at
frontier `2affd860114`. To reproduce, run `./bench-string-children.sh` in
the repo.

---

## If you don't use the feature

**Speed: about 1.5% on mount, nothing measurable elsewhere.** This corrects an
earlier version of this memo, which said "no change" on the grounds that every
row fell inside run-to-run noise. With six repetitions on an idle machine, one
row does not: a tree with no text mounts slower with the flag on in six runs
out of six, by 0.6-2.6%. A direction that never flips across six runs is a
signal even when each run sits inside nominal noise. It works out to about
0.15us per view. Style updates and `<Text>` mounts show no difference — three
update workloads actually came out about 1% *ahead* with the flag on, in every
run, which is too small to claim but has a plausible cause: the flag brings the
machinery that lets a style change skip a subtree with nothing to observe it.

**And most of that 1.5% is avoidable today.** It is not layout work; it is the
classic props path, which asks for every key a struct might have, one at a
time, so twelve new keys cost every view whether or not it sets any. The
push-based path behind `enableCppPropsIteratorSetter` visits only the keys
actually present, and this feature already implements the dispatch for all
eleven properties, so it needs no new code:

| mounting 1,365 text-free views | flag off | flag on | overhead |
| --- | --- | --- | --- |
| classic props path | 15.55ms | 15.82ms | 1.85% |
| push-based props path | 12.34ms | 12.45ms | **0.87%** |

The overhead halves, and that path is 21% faster to mount regardless of this
feature — a much larger number than anything string children costs.

**Two dead ends, recorded so nobody repeats them.** Both sounded like the
answer and neither was measurable:

- *The props constructor read the feature flag at twelve probe sites.* That
  getter is a cross-module call ending in a sequentially-consistent atomic
  load. Resolving it once per construction changed nothing, and a sampling
  profile never showed the getter as hot.
- *Node construction reached its props through `dynamic_cast`.* Replacing it
  with a virtual call changed nothing either. The profile does put RTTI casts
  at about 7% of the main thread across React Native as a whole, which is worth
  attention on its own, but our one site is not where the time goes.

Both changes were kept because they are strictly better, not because they paid.

**Still untried:** move the eleven fields behind one shared pointer, the
pattern the CSS Grid work used on this same struct, where it took 112 bytes off
every view. It would cut the 68-byte props cost to about 16. The memory saving
is arithmetic; the speed effect is unknown, since a shared-pointer copy is an
atomic increment and may cost more than copying the fields it replaces.

**A measurement trap worth knowing about.** Absolute times drift about 3%
between rebuilds, so only the flag-on-versus-flag-off gap *within one session*
is comparable — an earlier attempt at attributing this cost compared absolutes
across two rebuilds and reached the wrong answer. The benchmark also cannot
resolve differences below about 0.6%. Anyone continuing should build a
props-construction microbenchmark first; the mount benchmark is too blunt for
what is left.

**Memory: about 84 bytes per View.** Each View pays +68 bytes on its props
object (the inheritable style fields) and +16 bytes on its shadow node (a
change-tracking pointer). These numbers are measured, not estimated: we
removed the feature's fields, recompiled, and compared sizes. The full
ledger, including what the optimization work saved, is in the Memory section
below.

**Your existing `<Text>` code behaves exactly as before.** A `<Text>` does not
inherit styles from parent Views unless you opt in. This is deliberate: many
apps have leftover `color` or `fontSize` keys in View styles that old React
Native silently ignored. Those stay ignored. Nothing on screen changes when
the flag turns on.

Why is there no speed cost? Three reasons, all in the code:

- With the flag off, the inheritable style keys are not even parsed — zero
  extra work per View. With it on, parsing records one bool: "does this View
  set any text style?" For most Views the answer is no, and that one bool
  short-circuits everything else.
- Views that don't set text styles all share a single default style object.
  Comparing them is a pointer compare. Copying them is a pointer copy.
- Each View knows whether anything below it displays text. If nothing does, a
  style change on that View skips the whole subtree — no walk, no work.

---

## If you do use the feature

> **Measured against upstream, 2026-08-16.** The figures below compare bare
> strings with the *branch's own* `<Text>` — which at the time was carrying a
> regression that made every `<Text>` run a second full text layout, since
> fixed. Against **upstream `main`**, which is the comparison that matters to
> anyone deciding whether to adopt this, bare text is 9% faster than `<Text>` on
> 1,000 settings rows, 37% faster on 100 message bodies and 50% faster on one
> 1,000-line article — smaller than the numbers here. See
> `text-vs-upstream-benchmarks.md`, which also explains what makes two different
> binaries comparable at all.


Replacing `<Text>` with bare strings makes the same content mount much
faster:

| workload | `<Text>` | bare strings | speedup |
| --- | --- | --- | --- |
| 200 styled rows | 6.7ms | 3.3ms | **2.0×** |
| 1,000 plain lines | 23.3ms | 15.1ms | **1.5×** |
| 15,000 plain lines | 354ms | 228ms | **1.6×** |

(The `<Text>` column is today's `<Text>`, which this work also made
faster — it was 452 ms / 15k lines when we started. Bare strings are
measured against the improved baseline, not the old one.)

Why: each `<Text>` costs a JavaScript component, a native Paragraph shadow
node, and a state object. A bare string skips all three — the parent View
renders the text itself.

This can happen incrementally, one component at a time. Nothing forces a
migration.

### What text costs in real shapes — and the fast-text comparison

The costing benchmark renders scenarios instead of abstract tiers. In a
settings-style list of 1,000 rows (rows exist regardless — they carry
press handlers and padding), the marginal cost of the text inside each
row, measured against the empty-rows floor: bare string **+2.9µs/row**,
NativeText +6.9µs, `<Text>` +16.0µs. In a message list (100 rows, 10-line
bodies), bare bodies beat today's one-`<Text>`-per-body idiom 2.31ms to
2.92ms. For one long article-style block, `<Text>` currently wins (0.45 vs
0.57ms) — the run pipeline's CSS white-space processing has headroom there.

fast-text and react-native-boost swap `<Text>` for the lower-level
`NativeText` and report ~40–50% improvements on a specific shape: thousands
of sibling text components with no row containers. We keep that shape in
the benchmark for apples-to-apples (their tier measures 8.4ms per 1,000
lines, the fastest per-line-component number) — but it is not a shape real
apps render. Real apps always have containers; the per-line-component
premise only existed because text could not be a child. In the container
shapes above, a bare string beats a NativeText in the same row, with none
of NativeText's feature stripping (press handling, accessibility, layout
events).

One behavioral note when moving strings out of `<Text>`: classic `<Text>`
preserves `\n`; bare strings follow CSS, where the default
`white-space: normal` collapses a newline to a space and `'pre-line'`
preserves it.

---

## Memory: the full ledger

One table, both directions: what the feature adds, and what the optimization
work done alongside removed. Every number comes from compiling a build with
and without the fields in question and comparing sizes
(`./bench-string-children.sh --sizes`).

| where | change | detail |
| --- | --- | --- |
| every View's props object | **+68 B** | the eleven inheritable style fields plus two flags (1796 → 1864) |
| every View's shadow node | **+16 B** | one change-tracking pointer (1112 → 1128) |
| every `<Text>` and every bare-text run node | **+8–16 B** | its stored copy of the inherited style |
| each View that sets a text style | **+168 B** | one style object, allocated only when the style is actually written |
| every text fragment and measure-cache entry | **−64 B** | `TextAttributes` shrank from 232 to 168 — for all text, feature user or not |
| every View's shadow node, from the optimization work | **−448 B** | 1576 at the start of this work → 1128 now |

Adding it up: a View costs about **84 bytes more** than it would without the
feature — but the optimization work done alongside removed **448 bytes** from
every View and **64 bytes** from every piece of text, so apps end up far
smaller than where this started. The 1,365-View benchmark tree measured
~2.15 MB of shadow nodes per tree copy at the start of this work and ~1.54 MB
now, with the feature's cost included. The cost is real and paid whether or
not you use the feature; we report it so the trade is visible.

In the future, when a screen renders text as bare strings instead of
`<Text>`, memory drops further: each bare-text run costs one 1208-byte run
node plus 168 bytes per fragment, while the `<Text>` it replaces costs a
1472-byte Paragraph node, 2176 bytes of props, a JavaScript component
instance, and a state object.

All three changed structures (ViewShadowNode, ViewProps, TextAttributes) have
compile-time size checks. If a change grows any of them, the build fails
until someone raises the limit on purpose.

---

## Style inheritance and `all`

With the flag on, text styles (`color`, `fontSize`, `fontFamily`, etc.)
inherit down the tree into bare text, like CSS. Two controls:

- `style={{all: 'initial'}}` on any element makes it an **isolation
  boundary**: nothing inherits into it. This is the standard CSS `all`
  property. Root `<Text>` has this by default — that's how old behavior is
  preserved.
- `style={{all: 'unset'}}` on a `<Text>` opts it into inheritance.

Boundaries are also a performance tool: the engine skips style propagation
into any subtree behind one. If a style change happens above a boundary, the
subtree isn't even visited.

Changing an inherited style only touches subtrees that contain text —
everything else is skipped. Update benchmarks show parity with the flag off.

---

## How to trust these numbers

- One command reproduces everything: `./bench-string-children.sh`.
- The benchmark suites are committed and run in CI as regular tests
  (`StringChildrenOverhead`, `TextAlternatives`, `InlineAppendScaling`,
  `StringChildrenCosting`).
- ~250 tests cover the feature's behavior (inheritance, boundaries, inline
  layout, whitespace, block layout).
- Struct sizes are compile-time asserts, so memory can't regress silently.

More detail: `string-children-perf-plan.md` records every optimization we
tried, including the ones that didn't work and why.
