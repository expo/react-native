# Text as a child of any view

What changed, what it costs, and how to ship it.

Longer versions: `string-children-report.md` for the design,
`string-children-perf-memo.md` for the measurements.

## What changed

You can put text directly inside a view:

```jsx
<View>Hello</View>
```

Today that throws — *"Text strings must be rendered within a `<Text>`
component."* The wrapper it replaces is not punctuation: every `<Text>` is a
React component, a native node, a props object and a state object, created and
mounted for each piece of text on screen.

Text placed directly in a view follows the web's rules:

- **Styles inherit.** Set `fontSize` on a view and the text below it picks it
  up. `<Text>` deliberately does not, so nothing that exists today changes.
- **White space collapses.** `"a   b"` renders as `a b`, and a line break
  becomes a space. `whiteSpace: 'pre-line'` keeps line breaks.
- **Inline elements work.** `<b>`, `<span>` and the rest flow inside a line of
  text, carry padding and borders, report a real box to
  `getBoundingClientRect()`, and receive taps that bubble.
- **`display: 'block'` is real** — a block layout mode in Yoga with margin
  collapsing and floats, not a flex column pretending.

## How it works

A view now holds two kinds of children — other views, and text — laid out by
completely different machinery. The solution is the browsers': the engine
groups neighbouring text into one hidden object, a **run**, and hands that to
layout as a single box.

```
<View>                          <View>
  Hello <b>there</b>     →        [run: "Hello there"]   ← one box to lay out
  <View />                        <View />               ← an ordinary child
</View>                         </View>
```

The run is measured by the platform's real text engine, so line breaking and
fonts behave exactly as they do for `<Text>`. The view paints it directly —
no extra native view per line.

## What it took

- **Text becomes a real node.** `RawText`, a special case bolted to the side
  of the tree, becomes a proper text node — what the DOM calls `#text`.
- **Block layout in Yoga.** `display: 'block'`, margin collapsing, floats. A
  standalone Yoga feature, useful and reviewable without any of the text work.
- **Inline flow.** `display: 'inline'` folds a view into the surrounding line;
  `inline-block` and `inline-flex` stay whole and sit on the text baseline.
- **Style inheritance.** Eleven properties pass from a view to the text below
  it, with three cost controls so a style change never walks a subtree that
  cannot observe it.
- **Both platforms.** Painting text that no longer belongs to a text view,
  hit-testing taps against glyphs, exposing the text to screen readers.

## Speed

> **Measured against upstream, 2026-08-16.** The figures below compare bare
> strings with the *branch's own* `<Text>` — which at the time was carrying a
> regression that made every `<Text>` run a second full text layout, since
> fixed. Against **upstream `main`**, which is the comparison that matters to
> anyone deciding whether to adopt this, bare text is 9% faster than `<Text>` on
> 1,000 settings rows, 37% faster on 100 message bodies and 50% faster on one
> 1,000-line article — smaller than the numbers here. See
> `text-vs-upstream-benchmarks.md`, which also explains what makes two different
> binaries comparable at all.


Release builds of RNTester, medians of 10 after warm-up, two sessions:

| | bare strings | `<Text>` | |
| --- | --- | --- | --- |
| 1,000-row list, iOS | **150ms** | 206ms | 1.37× faster |
| 1,000-row list, Android | **47ms** | 95ms | ~1.9× faster |
| 100 message bodies of 10 lines, iOS | **56ms** | 91ms | 1.63× faster |
| one 1,000-line article, iOS | **47ms** | 77ms | 1.65× faster |

**The win is removing a component, not faster text.** Where text already sits
inside something — a row, a card, a cell — putting it on that container
deletes a component and everything attached to it. Where it has no container,
a view holding a string costs the same as a `<Text>`: 1,000 unstyled lines
measure 20.85ms either way. Real screens are the first case.

In the engine alone, putting a line of text into a row you already have costs
**5.2µs** as a bare string, 9.3µs as a `NativeText`, 19.4µs as a `<Text>`.

**Why you can believe these numbers.** Variants interleave rather than running
one after another, so drift cancels instead of landing on whichever ran last;
each uses its own strings, so none warms the caches for the next; row
containers are pinned against flattening, which otherwise lets the `<Text>`
variants skip a view mount per row. Every run reports its drift and a spread
per variant — the two sessions above drifted +0.2% and −2.1%.

**Against fast-text and react-native-boost.** Both swap `<Text>` for
`NativeText` and report 40–50%, measured on thousands of sibling text
components with no containers — a shape that only exists because text could
not be a child. In shapes apps do render, a bare string beats `NativeText`
anyway (5.2µs against 9.3µs in the same row; 150ms against 177ms for 1,000
rows on device) while keeping the press handling, accessibility and layout
events that `NativeText` gives up to be fast.

## What it costs an app that never uses it

**Mount: about 1.5%** on a tree with no text, roughly 0.15µs per view. Style
updates and `<Text>` mounts show no measurable difference.

That cost is prop parsing, not layout. React Native's classic props path asks
for every key a struct might have, one at a time, so twelve new keys cost every
view whether or not it sets any. The push-based path behind
`enableCppPropsIteratorSetter` visits only the keys actually present, and this
feature already supports it:

| mounting 1,365 text-free views | flag off | flag on | overhead |
| --- | --- | --- | --- |
| classic props path | 15.55ms | 15.82ms | 1.85% |
| push-based props path | 12.34ms | 12.45ms | **0.87%** |

The overhead halves, and that path is 21% faster to mount regardless of this
feature.

**Memory: about 84 bytes per view** — 68 on the props object, 16 on the node.
Work done alongside removed 448 bytes from every view and 64 from every piece
of text, so apps end up smaller than before: a 1,365-view benchmark tree went
from about 2.15 MB of nodes per copy to about 1.54 MB, feature included.
Compile-time assertions pin all three structures.

Every `<Text>` replaced by a bare string also drops a 1,472-byte paragraph
node, 2,176 bytes of props, a component instance and a state object.

## Text selection

**It does not work on bare strings, on either platform.** This is the largest
gap and should be decided before the flag goes past experimental.

`<Text selectable>` is not the same feature on the two platforms today:
Android routes it to a real `TextView` and gets drag handles and a partial
range; iOS has no selection at all — a long press offers **Copy**, which takes
the entire string. A bare string is painted by the view itself, which on
neither platform is a text view, so neither behaviour happens. `selectable`
and `userSelect` on a view are inert.

React Native already solves this shape elsewhere: `enablePreparedTextLayout`
has the same problem and routes selectable text to a different view. A view
whose text is marked selectable would opt out of the run path and render
through the existing text view, losing the speed for that subtree and keeping
correct behaviour.

No pull request in the sequence is blocked by this. Text that cannot be
selected today could not be written at all, so it is a missing feature rather
than a regression.

## Backwards compatibility

**The new syntax cannot break old code, because today it throws.** No working
app contains it.

**Style inheritance is the part that could**, and the CSS `all` property
controls it:

- `style={{all: 'initial'}}` on any element stops inheritance at it.
- **`<Text>` has that boundary by default**, so every screen renders
  identically whether the flag is on or off.
- `style={{all: 'unset'}}` on a `<Text>` opts it in.

The opt-in is per element, at any depth, in either direction, and undone by
deleting one style key. Boundaries are also a performance tool: the engine
skips propagation into any subtree behind one.

One behaviour change when *moving* a string out of a `<Text>`: classic
`<Text>` preserves `\n`, a bare string collapses it. `whiteSpace: 'pre-line'`
keeps them.

## Rollout

A flag's `ossReleaseStage` is the rollout, and this needs no new mechanism:

| stage | experimental releases | canary | stable |
| --- | --- | --- | --- |
| `none` | no | no | no |
| `experimental` | yes | no | no |
| `canary` | yes | yes | no |
| `stable` | yes | yes | yes |

Land at `none` and nobody is affected. Each promotion is a one-line change,
revertible in a one-line change. `experimental` needs only the sequence landed
and green; `canary` needs selection decided and screen-reader behaviour checked
by hand, since no test can hear what VoiceOver says; `stable` needs a large app
running on it and the `RawText` deletion sequenced. A second flag,
`enableYogaDisplayBlock`, covers the Yoga block mode separately, because that
one changes an existing layout path rather than adding a new one.

**The flag and `all` are not alternatives.** The flag decides whether the
machinery is in the binary; it is all-or-nothing and set by whoever builds the
app. `all` decides whether a given screen wants the behaviour, per subtree,
with no flag involved. A rollout needs both.

**One dependency outside this repository.** The syntax cannot work until
React's renderer stops throwing, which is a separate pull request against
React. File it early — everything here can be ready and the feature still
cannot be switched on.

## The pull requests

Twenty-one, in eight themes. Largest ~800 lines, median ~250. Nothing before
the eighth requires believing in the feature; everything after the flag lands
behind it, so `main` with the flag off is unchanged at every step.

| # | theme | what it is | size |
| --- | --- | --- | --- |
| 1 | free win | `TextAttributes` 232 → 168 bytes, no behaviour change | ~150 |
| 2–5 | Yoga block | the `display: block` value, block layout, margin collapsing, floats | ~850 |
| 6–7 | text nodes | the node type, then the wiring behind the flag | ~400 |
| 8–13 | the core | cheap type checks, inline box properties, the run object, run building, measurement and whitespace, paint state | ~2,850 |
| 14–15 | platforms | iOS and Android painting, hit-testing, layout reuse | ~29 files |
| 16–18 | inline views | `display: 'inline'`, atomic inlines and baselines, `display: 'contents'` | ~700 |
| 19–21 | inheritance | the eleven properties, the cascade, `all` boundaries | ~1,450 |

Three follow-ups after the core, any order: `getBoundingClientRect()` on
inline elements, pointer events resolving to the right inline element, and
`user-select` (~200 lines across the property, iOS and Android — it depends on
the platform painting, nothing else depends on it).

Not in the sequence: the catalogue of HTML-like element names (`<b>`,
`<span>`, `<img>`), which belongs to a framework layer, and CSS transitions
and animations, which are a separate stack.

## What is not included

- `white-space: break-spaces` behaves as `pre-wrap`, and
  `box-decoration-break: clone` is absent. Both need to take part in line
  breaking, which neither platform's text engine allows.
- Counter styles cover the numeric and alphabetic sets; the additive scripts
  and complex CJK styles are absent.
- `<Text>` keeps its current behaviour throughout. It is the
  backwards-compatible surface; text in a view is the spec-compliant one.
  Migration is optional and can happen one component at a time.

## How it was checked

- **172 tests across 15 suites** for the feature; **3,514 renderer tests
  across 213 suites** on the branch, including cases derived from
  web-platform-tests and layout numbers pinned against real Safari.
- **About 30 checks per platform against a running app**, reading geometry
  back through the real text engines — the only way to check what a stub
  measurer cannot model.
- **Compile-time size assertions** on all three changed structures, and the
  benchmark suites run as ordinary tests, so a regression fails a test rather
  than surprising someone later.
