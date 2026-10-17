# The style engine

CSS for HTML elements, resolved in C++ while a tree is committed, as a browser
resolves it in its style engine. JavaScript hands each element its inputs —
tag, classes, attributes, StyleX and inline styles, interaction states — and
the engine gives each element the props that layout and drawing read.

## Why

The Astryx runtime (`packages/rn-tester/js/astryx`) resolved CSS in JavaScript,
inside React's render of every element: selector matching against an ancestor
chain, the cascade, custom properties, `var()`, units and colours. To give each
element its ancestors it wrapped every HTML element in a component and five
context providers, so one element cost seven React nodes and about 34 hooks,
and a change to one element's classes re-rendered its whole subtree.

Measured on the iOS 27 simulator (Release build), Table Filter spent about
1,020 ms rendering, 413 ms of it in that per-element wrapper, where Mobile
Safari loads the whole page in 0.46 s. Safari does this work natively, and runs
the remaining JavaScript with a JIT: a benchmark shaped like the runtime's
per-element work took 279 ms in Hermes and 39 ms in JSC on the same Mac.

## Design

```
JavaScript (render)                    C++ (commit, before layout)
-------------------                    ---------------------------
<div className=… data-x=…              StyleEngine (a commit hook)
     {...stylex.props(…)}>               sheets, StyleX styles, tokens
  → one host node with its inputs   →    style pass over the new tree
    cssClass, cssAttributes,               match → cascade → var() → values
    cssStyle, cssInline, cssStates         props for each element
                                         queries: computed style, matches()
```

**Inputs.** An HTML element is one host node. Its props carry what selectors
and the cascade read and nothing resolved: `cssEngine` (styled by the engine),
`cssClass`, `cssAttributes` (the attributes selectors can name), `cssStyle`
(the id of a registered StyleX style), `cssInline` (an inline `style`, as
ordered entries), `cssStates` (hover, active, focus, popover-open), and for
the runtime's own structures `cssTag`, `cssPresentational` (SVG's
presentation attributes) and `cssScroll` (a scroll container's parts). They
are parsed into `ElementStyleInputs` with the element's props
(`ElementStyleInputsProvider`), so a pass reads them without JavaScript.

**Registration.** `globalThis.__cssEngine` takes sheets (`addStyleSheet`,
`replaceStyleSheet`, `removeStyleSheet`), StyleX styles (`registerStyle`, as
ordered entries with conditional values and blocks), tokens (`registerTokens`,
the root's custom properties under every sheet's), keyframes and the
environment media queries read (`setEnvironment`). Each change builds a new
immutable `Snapshot`, so a pass on any thread reads one consistent set. A
change does not commit by itself: the commit that comes with it styles the
tree, and `flush()` commits the surfaces no pass has styled since.

**The cascade** (`resolveElement`). The sheets' rules under StyleX's layer
(`astryx-base`), the StyleX style, the rules above that layer, the inline
style, then important declarations with layers reversed. Then custom
properties (each declaration's own `var()`s resolved where it is declared),
`var()` with fallbacks, `light-dark()` by the used `color-scheme`, `oklch()`,
`color-mix()`, `currentColor`, `calc()`/`min()`/`max()`/`clamp()` and units,
shorthands into longhands, and longhands into React Native's props. Font
size, colour, direction, container names and custom properties go into the
element's `StyleContext` for its descendants.

**The style pass** (`StyleEngine::Pass`). Registered before the transitions
hook, so transitions see computed values. It walks the new tree, styles each
element and clones it with its props; React keeps its own, unstyled nodes
(the clones do not take React's runtime reference), and a per-family cache
maps the node React committed to the one the pass produced. What it skips:

- a subtree whose root is the node the last pass was given or produced,
  under the same parent context and snapshot generation;
- an element whose React props and parent context are unchanged (its props
  and context are kept);
- the descendants of an element whose context changed only in what no
  selector reads of an ancestor (`AncestorFeatures`: classes, attributes,
  states and positions that non-subject compounds name): they keep the
  earlier context;
- everything inside a `display: none` element, which nothing draws.

A keyframes registration, or tokens and an environment that say nothing new,
keep the generation; a sheet change starts a new one only when it can change
matching (style rules, or a newly named layer).

**Outputs.** The pass writes the props React Native's views already read
(lengths as points, colours as packed integers, transforms and shadows in
their processed forms) over React's props through `RawProps`, so iOS and
Android receive them as any props update. React's props carry the element's
user-agent style, which the engine's author-level props override.

**Queries.** `computedStyle`, `customProperty` and `matches` answer from the
last pass; `matches` places the element among its siblings in the committed
tree. `explain` reports an element's declarations in cascade order, the
longhands they came to and its own custom properties. `hints` tells the
runtime, before an element is styled, whether its styles may give it a box,
scroll, or read its interaction state.

**Instrumentation.** `stats()` reports passes and their time, the nodes
visited and kept, the elements resolved and why (new, props, parent,
siblings, generation), the props parsed and the nodes cloned, the time in
matching, registrations and hints; `resetStats()` starts over. The pass and
rebuilds are trace sections (`StyleEngine::pass`, `StyleEngine::rebuild`,
`StyleEngine::restyleAll`).

## What stays in JavaScript

Behaviour, not style: popover and dialog state and the top layer, the
platform scroll view of a scroll container, the form controls' components,
interaction tracking, focus management, and the DOM methods Astryx calls on
its refs. An element needing none of these is rendered as its host node
directly, with no component. StyleX's `props()` merges its arguments and
registers the merged style once; it does not resolve values.

## Conformance

`packages/expo-intrinsics/__tests__/style-engine-conformance/` is a corpus of
cases, each a sheet, a tree and what to read, tied to the section of the spec
it checks and stating the value the spec gives. `oracle.js` runs it in Mobile
Safari on an iOS simulator and writes `expected.json` only if Safari agrees
with every reading; `StyleEngineConformance-itest.js` holds the engine to
Safari's answers. `StyleEngine-itest.js` covers the pass itself.

## Plan

1. **Engine core, measured.** Done: the corpus above, and Table Filter, Table
   Inbox, Table Tree and Table Page timed against the JavaScript engine,
   interleaved.
2. **Interaction and structure.** `:hover`, `:active` and `:focus` from the
   native view's own state, so an element that styles them needs no
   component; `@starting-style`; container queries and container units from
   the last layout; `when.descendant` and the other `:has()`-shaped
   conditions; `:nth-last-child(… of S)` in a sheet.
3. **One engine.** The user-agent sheet and the layout-time text cascade move
   into the engine; the JavaScript engine is removed; Android is verified on
   the emulator.
