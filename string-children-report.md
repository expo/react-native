# Text as a first-class child in React Native

*A plain-language report on the string-children project: what changed, what
it looks like in code at each stage, and what it costs and saves. No prior
context assumed. All performance numbers are medians from optimized (-O3)
release builds, measured together in one session at commit `2affd860114`,
reproducible with `./bench-string-children.sh`.*

---

## The one-paragraph version

React Native has always required text to live inside a `<Text>` component —
putting a string anywhere else was a crash. This project makes text a
first-class child of any component, the way it is on the web:

```jsx
// Before: crashes ("Text strings must be rendered within a <Text> component")
<View style={{padding: 12}}>Hello world</View>

// After (flag on): renders, and text styles inherit from parents like CSS
<View style={{padding: 12, fontSize: 16, color: '#333'}}>Hello world</View>
```

Everything ships behind one flag, `enableStringChildren`. With the flag off,
nothing changes: not pixels, not speed, and existing `<Text>` code behaves
identically even with the flag on. With it on, text gets faster (about 2×
component-for-component, 2–4× when lines share a container) and the layout
engine gains the web's text model: inheritance, block layout, inline flow,
and white-space handling.

The work is staged as 21 reviewable pieces in eight groups. This report
walks the groups in order — each is independently useful, and each was
verified on both iOS and Android.

---

## Stage 1 — shrink the text data structures (no new feature)

Every piece of styled text in React Native carries a `TextAttributes` struct
(its font, color, spacing, and so on), and that struct is copied and
compared constantly — once per text fragment, once per measurement-cache
entry. It was 232 bytes mostly out of habit: fields declared in historical
order (padding holes), enums defaulting to 4 bytes each.

Reordering fields by size and giving enums explicit small storage shrank it
to **168 bytes (−28%)** with zero behavior change. A compile-time check now
fails the build if it silently grows again. This stage requires no belief in
any of the rest — it is a free win for every app.

## Stage 2 — real block layout in Yoga

React Native's layout engine (Yoga) speaks flexbox. The web's default for
documents is *block layout*: children stack vertically, fill the line, and
their vertical margins collapse. Emulating that with a flex column gets the
stacking right but not the margins — and margins are where documents get
their rhythm.

```jsx
<View style={{display: 'block'}}>
  <View style={{height: 10, marginBottom: 20}} />
  <View style={{height: 10, marginTop: 30}} />
</View>
// Block layout: the 20 and 30 margins COLLAPSE to max(20, 30) = 30.
// Total height 50 — exactly what a browser does.
// A flex column would add them: 20 + 30 = 50 between, total 70.
```

`display: 'block'` is now a first-class Yoga display value, with CSS2 margin
collapsing (including the subtle cases: margins collapsing through empty
blocks, and a child's margin "escaping" through its parent's edge). Floats
exist as an optional extension. Verified against real browsers: the layout
assertions in the platform test suites are checked on-device, and the
trickier rules were pinned against live Safari during development.

## Stage 3 — text becomes a real node

On the web, the string inside `<p>hello</p>` is itself a node in the
document — a *text node*, `nodeName: "#text"`. React Native's DOM APIs
(`ReadOnlyText`, nodeType 3) already model this on the JavaScript side; this
stage gives the native tree the matching thing. A string child becomes a
lightweight `#text` node: no styles of its own, no layout box, no mounted
view — just character data with an identity.

```
<View>                         View
  {'Hello '}          ──►      ├─ #text "Hello "
  {'world'}                    └─ #text "world"
</View>
```

That lightness matters later: a `#text` node skips everything a component
costs — props parsing, a layout node, a mounted platform view.

## Stage 4 — anonymous text runs (the core)

When a View has text children, who lays the text out? The web's answer
(CSS 2.1 §9.2.1.1): the container groups contiguous inline content into an
*anonymous box* — a box that exists in layout but not in your code — and
that box measures and renders the text as one run.

```jsx
<View style={{width: 200}}>
  {'This wraps like '}
  {'one paragraph, '}
  {'because contiguous strings form ONE run.'}
</View>
```

Runs split around block-level children and rejoin after them, in document
order:

```jsx
<View>
  before
  <View style={{height: 8, backgroundColor: 'steelblue'}} />
  after
</View>
// "before" is one run, the blue bar is a normal child, "after" is another
// run — painted in exactly that order.
```

White space collapses the way CSS says it should (`white-space: normal` by
default; `'pre'`, `'pre-line'`, and friends are supported as a style):

```jsx
<View>{'collapse   these\n  spaces'}</View>   // → "collapse these spaces"
<View style={{whiteSpace: 'pre-line'}}>{'keep\nthe line break'}</View>
```

One behavioral difference to know: classic `<Text>` has always preserved
newline characters, while bare strings follow CSS — under the default
`white-space: normal`, a `\n` in a string collapses to a space, and
`'pre-line'` preserves it. The same string moved from a `<Text>` into a
bare position can therefore render differently until the white-space mode
says otherwise.

**Two values are parsed and honoured except at a line break**, because both
would require participating in line breaking itself, and neither platform
text engine exposes that. They are listed here rather than left to be
discovered:

| value | what CSS says | what happens here |
| --- | --- | --- |
| `white-space: break-spaces` | a run of preserved spaces at a wrap point is *measured*, so it wraps like any other character | behaves as `pre-wrap`: the space run hangs past the edge. Identical unless a space run is long enough to outrun the line |
| `box-decoration-break: clone` | every line's fragment of a wrapped inline box gets its own full border/padding, and that ink **occupies advance** on each line | only the initial value `slice` is implemented — leading edge on the first fragment, trailing on the last |

Both are the same wall from two directions. The edges of an inline box are
reserved *before* the engine breaks lines, and where the lines fall depends on
that reservation; resolving it needs to be inside the line breaker, which is
where a browser does it. TextKit and `StaticLayout` both hand back finished
lines. Painting `clone`'s edges without reserving space for them would just
overlap glyphs, which is worse than not offering the value, so it is not
offered.

Under the hood each run is measured by the same text engine `<Text>` uses,
positioned by the container, and painted without creating extra mounted
views for the differ to track.

## Stage 5 — native rendering on both platforms

The shared engine decides *what* the runs are; each platform paints them.
On iOS, run painting interleaves with child views inside the container's
existing view. On Android, runs draw directly in the container's
`dispatchDraw` between children — no extra views on either platform. Both
platforms pass the same scripted layout checks (18 assertions each, read
from the running app), and both render the interleaving example above
identically.

## Stage 6 — inline-level Views

The web distinguishes *inline* content (flows within a line of text) from
*block* content (gets its own box). Views can now opt into inline behavior:

```jsx
<View style={{display: 'block'}}>
  before <View style={{width: 30, height: 40, display: 'inline'}} /> after
</View>
// The 30×40 box sits IN the sentence; the line grows to fit it.

<View style={{display: 'block'}}>
  a <View style={{display: 'inline', color: 'tomato'}}>flowing inline
  contents</View> b
</View>
// An un-sized all-inline View acts like a <span>: its contents join the
// surrounding run, its color applies, taps on it hit its own handler.
```

In a flex container the same child becomes a regular flex item, exactly as
css-display specifies for flex contexts.

## Stage 7 — style inheritance and `all`

With the flag on, the CSS *inherited text properties* — `color`, `fontSize`,
`fontFamily`, `fontWeight`, `fontStyle`, `fontVariant`, `letterSpacing`,
`lineHeight`, `textAlign`, `textTransform`, `whiteSpace` — cascade down the
tree into text, like CSS:

```jsx
<View style={{fontSize: 16, color: '#333'}}>
  <View style={{padding: 8}}>
    Inherited: 16pt, #333 — through the intervening View.
  </View>
</View>
```

**Compatibility is the centerpiece.** Many apps have leftover `color` or
`fontSize` keys in View styles that old React Native silently ignored.
Turning on inheritance must not activate them into existing `<Text>`. So a
root `<Text>` ships with the standard CSS reset in its user-agent style —
`all: 'initial'` — making it an inheritance boundary by default. Nothing on
existing screens changes. Every keyword of the standard `all` property then
works, per spec, on any element:

```jsx
<View style={{fontSize: 30, color: 'red'}}>
  <Text>14pt, black — exactly as before this project</Text>
  <Text style={{all: 'unset'}}>30pt red — opted into the cascade</Text>
  <Text style={{all: 'revert'}}>14pt — revert returns TO the UA boundary</Text>
  <View style={{all: 'initial'}}>isolated: the cascade restarts here</View>
  <View style={{all: 'revert'}}>30pt red — a View has no UA rule to revert
  to, so revert means inherit</View>
</View>
```

That last distinction — `revert` is not a synonym for `initial` — was a
spec-correctness bug found in review and fixed with tests on both platforms.
Boundaries are also a performance tool: the engine tracks which subtrees
contain text that could observe a style change, and skips everything else.

## Stage 8 — geometry and events

Text runs are real: they answer geometry queries and receive touches.
`getBoundingClientRect()` works on text nodes (fragment rectangles, like the
web's Range APIs), and pressing a span-like inline View inside a run
resolves to that element's own handlers.

---

## Speed

Methodology: release (-O3) builds of the C++ test harness, medians of 20–50
iterations, quiet machine, every suite measured in one session at
`2affd860114`. Every benchmark tier renders inside the same plain parent
View so tiers compare content, not harness.

**With the flag off — or on, if you keep writing `<Text>` — nothing costs
anything.** Every mount and style-update benchmark lands within run-to-run
noise (±5%) between flag values, and the parse work for the new style keys
does not even run with the flag off:

| workload | flag off | flag on |
| --- | --- | --- |
| mount 1,365 plain Views | 16.5ms | 16.2ms |
| inheritable style update, 1,365 Views | 2.11ms | 2.21ms |
| mount 200 styled `<Text>` rows | 6.65ms | 6.81ms |
| mount 15,000 `<Text>` lines | 354ms | 345ms |

**What text costs, in the shapes apps actually render.** Rather than
abstract tiers, the costing benchmark renders scenarios you can picture,
and every tier within a scenario renders the same content in the same
containers — only the way text is expressed changes.

*A settings-style list* — 1,000 single-line rows. The rows exist regardless
(they carry press handlers, padding, separators), so the number that
matters is the marginal cost of the text inside them, measured by
subtracting the empty-rows floor:

| 1,000 rows | total | text cost per row |
| --- | --- | --- |
| rows only, no text (the floor) | 10.6ms | — |
| rows + bare string | 13.5ms | **+2.9µs** |
| rows + NativeText | 17.5ms | +6.9µs |
| rows + `<Text>` | 26.6ms | +16.0µs |

Putting a line of text into a row you already have: a bare string is 2.4×
cheaper than a NativeText and 5.6× cheaper than a `<Text>`.

*A message list* — 100 rows, each with a 10-line body (a chat or comment
screen). Today's idiom is one `<Text>` per body; the bare tier renders the
identical body string under `whiteSpace: 'pre-line'`:

| 100 rows, 10-line bodies | total |
| --- | --- |
| `<Text>` bodies | 2.92ms |
| bare bodies | **2.31ms** (21% faster) |

*An article* — one 1,000-line text block. Here today's `<Text>` wins:
0.45ms vs 0.57ms for the bare block. An honest result — for one big block
of plain text, `<Text>`'s simpler fold beats the CSS white-space processing
of the run pipeline, and there is likely optimization headroom in the
pre-line pass.

*The community benchmark's shape* — 1,000 sibling text components with no
row containers — is kept purely for apples-to-apples with fast-text and
react-native-boost: their `NativeText` measures 8.4ms there. It is not a
shape real apps render (real apps always have containers; the
per-line-component premise only existed because text could not be a child),
and in both real scenarios above, bare strings beat NativeText in the same
containers.

Scaling is linear: 50 → 400 inline children in one container measures
1.15ms → 17.1ms with no super-linear bend (an early quadratic in run
construction was found by this benchmark and fixed before anything
shipped).

### The same benchmark in a real app

The harness isolates the rendering engine. To measure the whole pipeline —
JavaScript render, commit, layout, real text shaping, view mounting — the
same scenarios run inside RNTester **release builds** on the iOS simulator
and Android emulator (time from setState to the mounted tier's first
onLayout, medians of 10 after warmup):

| scenario (mount) | iOS release | Android release |
| --- | --- | --- |
| settings: 1k rows only (floor) | 19ms | 32ms |
| settings: rows + bare string | 243ms | 104ms |
| settings: rows + `<Text>` | 240ms | 92ms |
| settings: rows + NativeText | 230ms | 84ms |
| messages: 100 `<Text>` bodies | 38ms | 29ms |
| messages: 100 bare bodies | 42ms | 32ms |
| article: one `<Text>` | 7.5ms | 45ms |
| article: one bare block | 7.1ms | 35ms |
| community shape: 1k sibling NativeText | 225ms | 74ms |

What the real apps say, plainly:

- **On device, platform text layout dominates mounts.** The per-row text
  tiers land within ~6% of each other on iOS — end-to-end, the choice of
  text primitive inside your rows barely moves a mount. On Android, bare
  per-row text currently runs 14–24% behind `<Text>`/NativeText — a real
  platform-path gap in the run pipeline, recorded as an optimization
  target.
- **Against today's idiom, device mounts are at parity.** One `<Text>` per
  message body vs one bare body: ±10% either way, with the article shape
  slightly favoring bare on both platforms.
- **The big end-to-end lever is component count, not text primitive.** A
  thousand single-line text components cost 230–243ms on iOS however you
  spell them; a hundred 10-line bodies with identical content cost ~40ms.
  That option — fewer text components for the same lines — is what the
  content model makes natural.
- The engine-level advantages (the marginal-cost table above, update
  gating, memory) sit below platform layout costs in a mount benchmark;
  they surface where the engine is the bottleneck, not in device
  mount-time totals.

(Mount benchmarks on simulator/emulator, not physical hardware; Android
numbers read from the on-screen report because release Android blocks the
collector's cleartext HTTP.)

## Memory

Measured by removing fields, recompiling, and comparing struct sizes
(`./bench-string-children.sh --sizes`); compile-time asserts pin every
number.

| where | change | why |
| --- | --- | --- |
| every View's props | **+68 B** | the eleven inheritable style fields |
| every View's node | **+16 B** | one cascade change-tracking pointer |
| each text run / `<Text>` | +8–16 B | its stored inherited style |
| each View that sets a text style | +168 B | one style object, only when actually styled |
| every text fragment & cache entry | **−64 B** | TextAttributes 232 → 168 |
| every View's node, from this project's optimization work | **−448 B** | 1,576 → 1,128 bytes |

Net: the feature itself costs ~84 bytes per View, and the optimization work
done alongside repaid that several times over — a benchmark tree of 1,365
Views measured ~2.15 MB of nodes per tree copy when this work started and
~1.54 MB at the end, feature cost included. Rendering text as bare strings
saves more: each replaced `<Text>` drops a 1,472-byte paragraph node,
2,176 bytes of props, a JS component instance, and a state object.

## How this was tested

- **3,129 native-renderer tests green** (207 suites), including ~250 for
  this feature's behavior: inheritance, boundaries, every `all` keyword,
  inline layout, white space, block layout, margin collapsing.
- **Both platforms, scripted:** RNTester screens publish their measured
  layout rectangles; verification scripts read them from the running iOS
  simulator and Android emulator and assert the layout relations — 18
  checks per platform, all green, including the boundary semantics on the
  real CoreText and StaticLayout text stacks.
- **One command reproduces the numbers**, and the benchmark suites run in
  CI as ordinary tests so the code paths cannot silently rot.
- Struct sizes are compile-time assertions per platform (iOS's types are
  legitimately larger; its ceilings are pinned separately).

## What is deliberately NOT here

React Native gains the *machinery* — text nodes, runs, block and inline
layout, inheritance, `all`. It does not gain a component library. An element
catalog with user-agent styles is a framework-layer product (built and
proven separately) so react-native stays vocabulary-agnostic, and frameworks
can define elements without any engine changes.
