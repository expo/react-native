# Text strings in React Native — what changed, and what it costs

A short summary. The long version, with the reasoning and the dead ends, is in
`string-children-report.md`.

## What changed

You can now put text directly inside a `<View>`:

```jsx
<View>Hello</View>
```

Before, text had to be wrapped: `<View><Text>Hello</Text></View>`. The wrapper
was not decoration — it was a component, a shadow node, a props object and a
state object, created for every piece of text on the screen.

Text placed directly in a View follows the web's rules rather than React
Native's older ones:

- **Styles inherit.** Set `fontSize` or `color` on a View and the text below it
  picks it up, like CSS. `<Text>` deliberately does not do this, so nothing
  that exists today changes behaviour.
- **White space collapses.** `"a   b"` renders as `a b`, and a newline becomes
  a space, per css-text-3 — unless you ask for `white-space: pre` and friends.
- **Inline elements work.** `<b>`, `<span>`, `<em>` and the rest flow inside a
  line of text, carry padding and borders, report a real box to
  `getBoundingClientRect()`, and receive clicks that bubble.
- **Block layout is real.** `display: 'block'` is a true block formatting
  context in Yoga, with margin collapsing and floats — not a flex emulation.

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


Measured on an iPhone, release build. Bare strings are faster than `<Text>` in
every shape tested:

| what is on screen | bare strings | `<Text>` | difference |
| --- | --- | --- | --- |
| 1,000 list rows | **162.5ms** | 228.9ms | **1.41× faster** |
| 100 messages of 10 lines | **71.6ms** | 122.4ms | **1.71× faster** |
| one 1,000-line article | **60.2ms** | 103.6ms | **1.72× faster** |

The list-row figure is the cost *above* an empty list of 1,000 rows, so it is
the price of the text alone. `NativeText` — the internal component `<Text>`
compiles down to — costs 227.2ms on that shape, so bare strings beat it too.

**Why you can believe these numbers.** Each tier runs interleaved with the
others rather than all at once, so nothing that drifts over a session lands on
one tier. Each tier uses its own strings, so no tier warms up the caches for
the next. The screen reports two things alongside every result: *drift*, which
compares the second half of the session against the first, and a *spread* per
tier. This run had drift of −1.2% and spreads of ±1–5% — the machine was quiet
and the numbers had settled. A noisy run announces itself instead of quietly
reporting a confident-looking median.

## Memory

Struct sizes are measured by recompiling and asserting, not estimated
(`./bench-string-children.sh --sizes`), and compile-time checks pin them so
they cannot drift unnoticed.

**What the feature costs**

| where | cost |
| --- | --- |
| every View's props | +68 bytes (the inheritable style fields) |
| every View's node | +16 bytes (one change-tracking pointer) |
| each run or `<Text>` | +8–16 bytes (its inherited style) |
| a View that actually sets a text style | +168 bytes (one style object) |

About **84 bytes per View** in the common case.

**What it saves**

| where | saving |
| --- | --- |
| every text fragment and cache entry | −64 bytes (`TextAttributes` 232 → 168) |
| every View's node | −448 bytes (1,576 → 1,128) |

The 448 bytes came from optimisation work done alongside the feature, not from
the feature itself — but it is real, and it more than repays the cost above.

**In practice.** A benchmark tree of 1,365 Views held about **2.15 MB** of
nodes per tree copy when this work started and about **1.54 MB** at the end,
feature cost included. And every `<Text>` replaced by a bare string drops a
1,472-byte paragraph node, 2,176 bytes of props, a JavaScript component
instance, and a state object.

## What is not included

- `white-space: break-spaces` behaves as `pre-wrap`, and
  `box-decoration-break: clone` is not implemented. Both need to take part in
  line breaking, which neither platform's text engine allows.
- Counter styles cover the numeric and alphabetic sets; the additive scripts
  (Armenian, Georgian, Hebrew) and the complex CJK styles are absent, and
  `@counter-style` belongs to a stylesheet layer rather than the renderer.
- `<Text>` keeps its current behaviour throughout. It is the
  backwards-compatible surface; the spec-compliant one is text placed directly
  in a View.

## How it was checked

- **3,173 renderer tests** across 212 suites, including cases derived from
  web-platform-tests and layout numbers pinned against real Safari.
- **30 checks on each platform, on real devices**, reading geometry back out of
  a running app through the actual text engines — CoreText on iOS,
  `android.text.Layout` on Android — covering inheritance, block and inline
  layout, inline element boxes, and white-space processing.
