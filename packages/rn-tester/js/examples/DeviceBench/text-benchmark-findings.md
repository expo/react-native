# Why bare text does not win across the board

Measured with `DeviceTextBenchmark` on an iPhone 17 Pro simulator, iOS 26.5, three
sessions. Numbers below are from the two sessions whose drift control was healthy
(−6.0% and −7.6%); the first session drifted +22% and is used only where it agrees.

## The short answer

Bare text **does** win, or tie, everywhere except one shape: a single large block of text
that already contains newlines. There it loses about 3×. And that loss is not the bare path
being slower — it is `<Text>` being unusually *fast* on that particular input.

## What the numbers say

| tier | median | spread |
|---|---|---|
| settings rows only (floor) | 151.4ms | ±1% |
| settings rows + bare string | 355.2ms | ±13% |
| settings rows + Text | 445.2ms | ±13% |
| settings rows + NativeText | 239.8ms | ±1% |
| messages: bare bodies | 73.6ms | ±36% |
| messages: Text bodies | 159.5ms | ±76% |
| article: one Text | 14.5ms | ±1% |
| article: bare block | 52.2ms | ±6% |
| article: bare, no `pre-line` | 45.4ms | ±5% |
| **flat: one Text, no newlines** | **42.6ms** | ±4% |
| **flat: bare, no newlines** | **43.1ms** | ±7% |

### 1. Many small texts: bare wins

`355.2` against `445.2` for the same 1000 rows — bare is about 20% cheaper, and it was ahead
in two of three sessions and level in the third. The `messages` pair says the same thing
more loudly (`73.6` against `159.5`), though both of those tiers are too unstable to lean on.

### 2. One big block with newlines: bare loses 3×

`article: one Text` is `14.5ms`. `article: bare block` is `52.2ms`. This is the case that
stops bare text winning across the board.

### 3. It is not white-space processing

The obvious suspect was `whiteSpace: 'pre-line'`, which the bare tier has to carry — the bare
path follows CSS and collapses newlines, while `<Text>` preserves them, so without it the two
tiers would not render the same thing. Removing it costs `52.2 → 45.4`, about 5ms of a 35ms
gap. **Hypothesis refuted:** `pre-line` is real but minor.

### 4. It is not the bare path being slower either

The `flat` pair is the same characters with the newlines replaced by spaces, so the two tiers
differ in nothing but which path draws them:

```
flat: one Text, no newlines   42.6ms  ±4%
flat: bare,     no newlines   43.1ms  ±7%
```

A dead heat. **There is no inherent penalty in the bare path.**

### 5. What is actually happening: `<Text>` has a fast path for pre-broken text

Put 4 and 2 together and the direction reverses. Given a string of 1000 newline-separated
lines `<Text>` takes `14.5ms`; given the same characters as one long line it takes `42.6ms`.
`<Text>` is nearly **three times faster on the harder-looking input**, because hard line
breaks make line breaking trivial where one 40,000-character line has to be wrapped.

The bare path gets no such benefit: `45.4ms` with the newlines, `43.1ms` without. It pays the
wrapping cost either way.

So the gap in the article case is not a cost the bare path adds. It is a saving `<Text>` gets
and the bare path misses.

## What I would do about it

* **Find why the bare path does not shortcut on hard breaks.** That is the whole of the
  remaining difference, and it is a saving that already exists in the codebase — the goal
  would be to reach the same path, not to write a new one.
* **Do not tune `pre-line`.** It is worth about 5ms on a 1000-line block and it is required
  for correctness.
* **Look at the per-row overhead instead, which is far larger than any of this.**
  `NativeText` costs `239.8ms` where `<Text>` costs `445.2ms` on the same 1000 rows. Most of
  what a row pays for is the JavaScript component, not text layout, and it dwarfs the article
  gap in any realistic screen.

## Reading these numbers

Two tiers are too unstable to use: `messages: Text bodies` (±76%) and, in the third session,
`article: one Text` (±236%, against ±1% in the other two). The benchmark reports spread per
tier precisely so a number like that can be discarded rather than believed. The drift control
matters as much: the first session ran +22%, meaning it was still warming, and every close
comparison in it is worthless.

The `flat:` pair and the `article: bare, no pre-line` tier were added for this investigation.
The flat pair is worth keeping — it is the control that separates "bare is slow" from "Text
is fast", which is the question the other tiers cannot answer on their own.
