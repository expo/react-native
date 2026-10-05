# expo-intrinsics

The HTML element catalog. React Native ships the machinery — text children,
anonymous inline formatting contexts, `display`, the cascade — and this package
supplies the elements: every tag name, its user-agent style, and which backing
component it uses.

An element is three things: **a tag name**, **a UA style**, and **a display**
that falls out of the style. Most are one line each. See
[`__docs__/ProvidingHTMLElementsInTheFramework.md`](__docs__/ProvidingHTMLElementsInTheFramework.md)
for the model and the precedence rules.

## What is here

Around 60 elements: the text-level set (`b`, `i`, `em`, `strong`, `code`,
`cite`, `dfn`, `abbr`, `mark`, `sub`, `sup`, `q`, `time`, `data`, `var`,
`samp`, `kbd`, `small`, `s`, `del`, `ins`, `u`, `span`, `br`), the block and
sectioning set (`div`, `p`, `section`, `article`, `header`, `footer`, `nav`,
`main`, `aside`, `address`, `hgroup`, `search`, `blockquote`, `figure`,
`figcaption`, `pre`, `hr`, `h1`–`h6`), lists (`ul`, `ol`, `li`, `menu`, `dl`,
`dt`, `dd`), the interactive aliases (`a`, `button`, `label`), `img`, and
`noscript`.

## Known limitations

These are decisions, not gaps we have not noticed. Each says what it would take,
so a future reader can reopen it on evidence rather than guess at the reasoning.

### Tables — deferred, not blocked

`table`, `thead`, `tbody`, `tfoot`, `tr`, `td`, `th`, `caption`, `colgroup` and
`col` are not provided. They need `display: table` and its siblings, which Yoga
does not implement; the supported set is `none flex block inline inline-flex
inline-block grid inline-grid grid-lanes inline-grid-lanes contents`.

This is doable and deliberately deferred. Tables are infrequent on mobile, where
lists are the usual way to present the same data, and where the layouts people
actually reach for are already available: **CSS Grid** covers table-shaped
layout, and **Grid Lanes** covers the masonry and column-flow arrangements that
tables were historically abused for. An app that needs a data grid is better
served by those than by table layout's auto column sizing and border collapse.

Reopen this if real apps show up wanting `colspan`/`rowspan` semantics
specifically, rather than the two-dimensional layout grid already gives them.

### Ruby annotations — out of scope

`ruby`, `rt` and `rp` are not provided and are not planned. Ruby is a layout
mode of its own — annotations positioned against base text, with their own line
breaking and spacing rules — and implementing it means new work in the text
engine on both platforms, not a UA style. It is out of scope for this catalog.

### Bidirectional text controls — out of scope

`bdi` and `bdo` are not provided, and `unicode-bidi` is not supported. The
renderer resolves text direction per paragraph; these elements exist to override
the bidi algorithm for a span within one, which the text engines are not wired
to express here. Note this is narrower than "no RTL": `direction` and RTL layout
work — it is the per-span *override* that is absent.

### `wbr` — not supported

`wbr` marks a soft break opportunity inside a word. Supporting it means teaching
the line breaker about an author-supplied break point, which is real work in
both platform text engines.

Possible, but we would want to see it justified first — at least a few
significant apps needing it. Long unbroken strings are usually better handled
with `overflow-wrap` than by hand-placing break opportunities.

### Elements whose absence is a work item, not a decision

Form controls (`input`, `textarea`, `select`, `option`, `form`, `fieldset`,
`progress`, `meter`), media and embedded content (`video`, `audio`, `canvas`,
`iframe`, `svg`, `picture`), and the interactive elements (`details`, `summary`,
`dialog`) are not here yet.

These are the ones that matter most, and they are a different kind of work from
the rest of the catalog: they should use the **native platform control** — real
SwiftUI or Jetpack Compose via Expo UI — not a styled `<div>`, and not a React
Native component from main. The Expo UI dependency is conditional, resolved the
way `<img>` resolves `ExpoImage`: used when present, degrading to the
author-styled path when absent.

**Styling a natively-backed element:** layout applies, appearance does not.
`width`, `height`, `margin`, `padding`, `display`, `position`, the flex and grid
properties, `opacity` and `transform` all work — Yoga owns the box the control is
drawn into. `color`, `font-*` and the rest of the paint properties do not reach
the control, which renders itself with the platform's own typography and
chrome; `background-color` and friends paint the box *behind* it, which usually
looks like nothing happened. `appearance: none` is how an author takes appearance
back, at which point the element becomes an ordinary styleable box. The full
table is in
[`__docs__/PlatformFidelity.md`](__docs__/PlatformFidelity.md), and
[`__docs__/TextInput.md`](__docs__/TextInput.md) covers `<input>`/`<textarea>`
specifically — how to get an input that is synchronous *and* controlled, which
React Native's `TextInput` cannot be.

`img` is the proof that the seam works: it resolves its view config lazily at
first render and points at `ExpoImage` when the Expo runtime provides it,
falling back otherwise. The rest follow that shape.

The plan for all of them — the `<input>` type table, where `<native:switch>`
and friends fit alongside it, how an element learns whether it is inside SwiftUI
or Jetpack Compose, and what that means for depending on Expo UI — is in
[`__docs__/NativeBackedElements.md`](__docs__/NativeBackedElements.md), with
[`__docs__/PlatformFidelity.md`](__docs__/PlatformFidelity.md) covering what
matching the platform's own UX actually requires.

## Adding an element

A markup-only element is a row in `src/uaStyles.js` and a name in the
appropriate list in `src/index.js`. No shadow node, no descriptor, no native
code.

```js
// src/uaStyles.js
address: {fontStyle: 'italic'},

// src/index.js — the block list
'address',
```

Test it for what would actually be wrong if the registration were missing. An
unregistered tag does not throw: it falls through to the *inline* unknown
element, so a block element that was never registered silently flows inline with
its siblings and reads as a styling bug. `__tests__/Tier1Elements-itest.js`
asserts block layout and inline participation for that reason, rather than
asserting that something rendered.
