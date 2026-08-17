# Text strings in React Native — what changed, and what it costs

> **Which benchmark these numbers are.** Performance figures in this directory
> come from five different measurements on different scales — see [text-vs-upstream-benchmarks.md](text-vs-upstream-benchmarks.md) for the
> tags and what each can and cannot tell you. The speed table below is [device-absolute]
> against the branch's own `<Text>`, measured before that baseline's
> regression was found.

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
> anyone deciding whether to adopt this, bare text is **16% faster than `<Text>`**
> and **7% faster than `NativeText`** on 1,000 settings rows and **40% faster**
> on 100 message bodies; the article shape is not comparable across the two
> builds. All smaller than the numbers here. See
> `text-vs-upstream-benchmarks.md`, which also explains what makes two different
> binaries comparable at all.
>
> **On a physical iPhone**, in the branch's own build (so against the branch's
> `<Text>`, not upstream's), bare text is 10.7% cheaper on the row shape, 24%
> faster on the message shape and 25.5% faster on the article shape —
> `text-vs-upstream-benchmarks.md`, "On a physical iPhone".


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

About **84 bytes per View** in the common case — that is the feature's own
cost, measured by removing its fields and recompiling. Against upstream `main`
the branch nonetheless comes out **48 bytes per View smaller**, because other
work on the same branch removed more than the feature added. See
`text-vs-upstream-benchmarks.md` for the compiled per-node table.

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

- **3,515 renderer tests** across 213 suites — 465 across 33 for text
  specifically — including cases derived from web-platform-tests and layout
  numbers pinned against real Safari. All passing; re-measured 2026-08-16.
- **40 layout cases on each platform**, reading geometry back out of a running
  app through the actual text engines — CoreText on iOS, `android.text.Layout`
  on Android — covering inheritance, block and inline layout, inline element
  boxes, and white-space processing, plus 7 event-target checks. Clean on both.
  These run against a simulator and an emulator, not physical devices.
