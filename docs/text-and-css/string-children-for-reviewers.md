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

Against **upstream `main`** — the comparison an adopter is actually asking
about. iOS simulator, Release builds of both, one session, alternating builds,
with every tier's laid-out height recorded and identical so the two are known
to have done the same work. **[device-marginal]**: each tier's time minus a
text-free floor tier of the same shape, so what differs between two binaries
but not between tiers cancels.

| | bare text | `<Text>` | `NativeText` |
| --- | ---: | ---: | ---: |
| 1,000 settings rows | **90.5ms** | 107.9ms | 97.4ms |
| 100 message bodies of 10 lines | **19.0ms** | 31.5ms | — |

Bare text is **16% faster than `<Text>`** and **7% faster than `NativeText`** on
the row shape, and **40% faster than `<Text>`** where each element holds more
text.

**The win is removing a component, not faster text.** Where text already sits
inside something — a row, a card, a cell — putting it on that container deletes
a component and everything attached to it. That is also why the row shape shows
the smallest gain: every row mounts a view either way, and the text is one
short line.

`NativeText` is the floor of what today's architecture can do — the host
component `<Text>` compiles to, with the JS wrapper removed. Bare text is ahead
of it while keeping the press handling, accessibility and layout events
`NativeText` gives up to get there.

**Two numbers that are not on this scale.** In the engine alone
(**[engine]**: the C++ renderer under Fantom with a deterministic text
measurer, no platform views and no real shaping) a row's text costs 19.3µs as a
bare string, 32.0µs as a `NativeText` and 63.8µs as a `<Text>`. Those are not
the device numbers divided by a thousand and they should never be quoted beside
them: the engine benchmark had bare text 1.7× ahead of `NativeText` while the
device had it 2% behind, and the entire difference was iOS view mounting, which
the engine cannot see. See `text-vs-upstream-benchmarks.md` for the tags and
what each can and cannot tell you.

**Why you can believe these.** Tiers interleave rather than running one after
another, so drift cancels instead of landing on whichever ran last; each uses
its own strings, so none warms the caches for the next; row containers are
pinned against flattening, which otherwise lets the `<Text>` tiers skip a view
mount per row. Every run reports its drift and a spread per tier, and every
tier reports the height it laid out — which is what caught a 2.4× figure that
turned out to be a partial layout rather than a speedup.

**Against fast-text and react-native-boost.** Both swap `<Text>` for
`NativeText` and report 40–50%, measured on thousands of sibling text
components with no containers — a shape that only exists because text could not
be a child. In shapes apps do render, bare text beats `NativeText` anyway,
while keeping what `NativeText` gives up to be fast.

## What it costs an app that never uses it

**Mount: about 1.5%** on a tree with no text, roughly 0.15µs per view. Style
updates and `<Text>` mounts show no measurable difference. **[engine]**, and
measured as flag-on against flag-off inside ONE binary — which is the only way
to isolate this feature's own cost, and a different question from the
`[device-marginal]` figures above.

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

**Memory, against upstream `main`** — **[sizeof]**, compiled from each tree's
own headers, so exact:

| per node | upstream | this branch |
| --- | ---: | ---: |
| `ViewProps` | 1424 | **1400** |
| `ViewShadowNode` | 1040 | **1016** |
| `TextAttributes` | 224 | **168** |
| `ParagraphProps` | 1704 | 1728 |
| `ParagraphShadowNode` | 1424 | **1360** |

Every one of those but `ParagraphProps` is SMALLER than upstream, carrying the
whole feature set. `TextAttributes` shrinking 56 bytes reaches every fragment
and every measure-cache entry in every app, whether or not it uses this.

That is the state after moving the CSS transition and animation longhands
behind one pointer; before that, `ViewProps` was 1752. The feature's own share
of the growth is about 68 bytes — the eleven inherited text properties — which
an earlier flag-on/flag-off measurement isolated; the rest belonged to the
motion stack and is now gone.

Whole-process resident set is **+21.2 MiB** (**[rss]**, 18 paired samples),
flat across every tier including a text-free one, so it is a fixed cost of the
larger binary rather than a per-node cost. Compile-time assertions pin the
structures so none of this drifts unnoticed.

Every `<Text>` replaced by a bare string also drops a 1,472-byte paragraph
node, 2,176 bytes of props, a component instance and a state object.

## Text selection

Text in a view is selectable when it asks to be:

```jsx
<View style={{userSelect: 'text'}}>long-press to copy me</View>
```

A long press offers **Copy**, which copies that view's text — every run of it,
in reading order, even when a child view sits between two runs. Both
platforms, same behaviour.

Two things to know:

- **`auto` means not selectable.** On the web everything is selectable unless
  told otherwise. Making that true here would make every string in every
  existing app selectable, so `auto` keeps React Native's answer and
  `text`/`contain`/`all` opt in. The value is read on the element that paints
  the text; it does not inherit, which is also how `<Text selectable>` works.
- **Copy takes the whole element, not a dragged range.** On iOS that is
  precisely what `<Text selectable>` does, so nothing is missing there. On
  Android `<Text selectable>` does better — it is a real `TextView`, with drag
  handles. Matching that means hosting a `TextView` per run, and those views
  land in the same child list the renderer mounts into, so every index it uses
  would need translating. Worth doing; not worth doing first.

`<Text selectable>` is untouched — `userSelect` on a `<Text>` still becomes
the `selectable` prop, exactly as before.

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
and green; `canary` needs screen-reader behaviour checked by hand, since no
test can hear what VoiceOver says; `stable` needs a large app
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

- **465 tests across 33 suites** for text; **3,515 renderer tests across 213
  suites** on the branch, including cases derived from web-platform-tests and
  layout numbers pinned against real Safari. All passing; counts re-measured
  2026-08-16.
- **40 layout cases per platform against a running app**, reading geometry back
  through the real text engines — the only way to check what a stub measurer
  cannot model — plus **7 event-target checks** that tap an inline element and
  assert the target and the bubble chain. Clean on both iOS and Android. These
  run against a simulator and an emulator, not physical devices.
- **Compile-time size assertions** on all three changed structures, and the
  benchmark suites run as ordinary tests, so a regression fails a test rather
  than surprising someone later.
