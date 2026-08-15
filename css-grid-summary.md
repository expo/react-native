# CSS Grid in React Native — what works, and how it was checked

A short summary of the `grid-lanes` branch.

## What you can write

```jsx
<View style={{
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
  gap: 16,
}}>
  {photos.map(p => <Photo key={p.id} {...p} />)}
</View>
```

Track lists are the CSS you already know, as a string. That matters more than
it sounds: every one of the six demos in WebKit's Field Guide to Grid Lanes is
built on `repeat(auto-fill, minmax(...))` and not one uses a literal track
list, because that is what makes a gallery responsive without a breakpoint for
every width.

**Supported**

| | |
| --- | --- |
| containers | `display: 'grid'`, `'inline-grid'` |
| track sizes | lengths, percentages, `fr`, `auto`, `max-content`, `fit-content()`, `minmax()` |
| repetition | `repeat(n, …)`, `repeat(auto-fill, …)`, `repeat(auto-fit, …)` |
| placement | `gridColumnStart/End`, `gridRowStart/End`, line numbers incl. negatives, `span n` |
| implicit tracks | `gridAutoRows`, `gridAutoColumns` |
| flow | `gridAutoFlow: 'row'`, `'column'`, either with `dense` |
| alignment | `justifyItems`, `alignItems`, `justifySelf`, `alignSelf`, `justifyContent`, `alignContent` |
| gaps | `gap`, `rowGap`, `columnGap`, including percentages |

**Not supported.** `min-content` as a *maximum*, the `x` ceiling in
`fit-content(x)`, named grid lines, `grid-template-areas`, and `subgrid`. Each
is in `dom-css-limitations.md` with the reason.

## How it is checked

Every expected number comes from **real Safari**, which implements CSS Grid
natively. Nothing is hand-computed.

One declarative list of cases feeds three consumers, so they cannot drift:

- `oracle.js` renders each case as CSS and reads the geometry back out of
  Safari through safaridriver.
- `replay.cpp` rebuilds the same case through Yoga's C API.
- `gen-fantom-test.js` emits a Fantom suite that renders it as React Native
  and reads `getBoundingClientRect()`.

**194 cases, 2,840 coordinate assertions, zero mismatches** — in the engine and
through React Native. The full Fantom suite (3,342 tests) is unaffected. On a
real simulator and emulator, `grid-cdp-verify.js` re-checks track geometry
through the actual platform layout pass: 9 of 9 on each.

Cases that an engine cannot express are reported as UNSUPPORTED with the
reason rather than skipped, because coverage that shrinks quietly reads as a
pass.

The corpus is built to *discriminate*, not merely to pass. `auto-fill` is swept
across seven container widths, where an off-by-one in the repetition count
shows up as a different layout rather than a small delta. `auto-fit` is run at
item counts that leave 0, 1 and 4 tracks empty. `dense` is run against the same
shapes as sparse, and Safari confirms three of the four place items
differently — so an implementation that ignored `dense` would fail, and one
that reordered everything would fail the fourth. Every `grid-auto-flow` shape
is run in all four flows, and row differs from column in each, so the column
keyword cannot be quietly ignored either.

## Bugs this found

- **The engine sized padded containers wrong.** The track total is a
  content-box size, but it was floored at the node's padding+border, which is
  only right for a border-box size — so a container with 20px of padding around
  a 20px row measured 80px instead of 60px. It only shows when padding exceeds
  the content, which is why it survived review upstream. Reported with a
  standalone reproduction in `grid-bug-report/`.
- **`start` and `end` were never parsed.** They are the alignment keywords CSS
  Grid is specified in terms of. Fourteen alignment cases failed until they
  were added.
- **A lone `max-content` track collapsed to zero width in React Native** while
  passing in the engine harness, because the two built the track differently.
  CSS says a bare track breadth becomes both the minimum and the maximum; Yoga
  has no max-content minimum. Having two independent harnesses is what caught
  it.

## What it costs

Nothing, for the apps that do not use it — and slightly less than before.

All grid style now lives in one allocation that exists only when a grid
property is set:

| | before | after |
| --- | --- | --- |
| every View's props | 2,416 bytes | **2,288** |
| every View's node | 1,216 bytes | **1,088** |

That is **112 bytes per View below where the branch started**, with the feature
included. Compile-time assertions pin the sizes so the gain cannot erode.

## Where to look

- `packages/rn-tester` → **Grid** — ten screens, each showing the CSS that
  produces it, ported from WebKit's demos: a responsive gallery, auto-fill vs
  auto-fit, a newspaper with spanning stories, a full-bleed header, a pinboard,
  a mega menu, dense packing.
- `grid-lanes-conformance/` — the corpus and both harnesses.
- `build-android-rntester.sh` — the Android build, with its two traps handled.
