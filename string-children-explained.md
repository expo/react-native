# Text in a View

You can write this:

```jsx
<View>Hello</View>
```

Today React Native makes you write `<View><Text>Hello</Text></View>`. That
wrapper is not punctuation — every `<Text>` on screen is a real component with
its own layout object, settings, and bookkeeping. Dropping it makes the same
screen render faster and take less memory.

## It renders faster

Release builds of the same benchmark app, against React Native as it ships. Each
figure is what the **text** costs: the same screen with its text taken out is
measured too, and subtracted from both sides.

| what is on screen | today | text in a View | |
| --- | ---: | ---: | --- |
| a settings list, 1,000 rows | 107.9ms | **90.5ms** | **16% faster** |
| a chat list, 100 messages of 10 lines | 31.5ms | **19.0ms** | **40% faster** |

Those two rows are the iOS simulator. The more text an element holds, the bigger
the gain: a one-line row mounts a view either way, a ten-line message body does
not.

On a real iPhone, comparing the two ways of writing text inside a single build,
the same shapes came out **11%** and **24%** faster.

It also outperforms the workaround people use today, which is to swap `<Text>`
for `<NativeText>` — the stripped-down component `<Text>` compiles into. That
buys its speed by giving up press handling, accessibility, and layout events.
Text in a View is 8.7% faster than `<NativeText>` on a phone, and gives up none
of the three.

## It uses less memory

Every `<Text>` you delete gives back about **3.1 KB** — its layout object, its
settings, its JavaScript component, its state.

And the parts that stay get smaller too. Sizes compiled from each codebase's own
headers, so these are exact rather than sampled:

| per | today | text in a View | |
| --- | ---: | ---: | --- |
| View — layout object + settings | 2,464 B | **2,416 B** | 48 B smaller |
| `<Text>` — layout object + settings | 3,128 B | **3,088 B** | 40 B smaller |
| every piece of text on screen | 224 B | **168 B** | 56 B smaller |

The last row is the one to notice: `TextAttributes` is copied into every text
fragment and every measure-cache entry, so it is the structure a text-heavy
screen holds the most of, and it is **25% smaller**. None of that row depends on
using the feature. It is the first pull request in the stack precisely because it
is worth taking on its own.

The feature itself does add fields to every View — about 68 bytes, so text styles
can inherit. That cost is real and it is included in the table above; other work
on the same branch removed more than it added.

## It costs nothing if you ignore it

A `<Text>` on this branch costs what a `<Text>` costs today: measured at −2% and
+0.5% on two shapes, both well inside the measurement's own resolution. Existing
code is untouched — a `<Text>` behaves exactly as it does now, including *not*
inheriting styles from the Views above it, so the stray `color` keys apps have
left in View styles for years stay ignored and no screen shifts.

## What you get besides speed

Text in a View follows the web's rules, because those are the rules it models:

- **Styles inherit.** Set `fontSize` on a View and the text inside picks it up.
- **Spaces collapse.** `"a   b"` renders as `a b`, unless you ask for
  `white-space: pre`.
- **Inline elements work.** `<b>`, `<span>`, `<em>` flow inside a line, take
  padding and borders, report a real box, and receive clicks.

## How it lands: 21 pull requests, plus three follow-ups

Stacked and flag-gated. At every step, React Native with the flag off behaves
exactly as it does now — so the stack can stop anywhere without leaving a mess.

| | theme | what it is |
| --- | --- | --- |
| 1 | a free win | text's core structure, 25% smaller. No flag, no feature — take it either way. |
| 2–5 | `display: block` in Yoga | real block stacking, margin collapsing, floats. Useful on its own. |
| 6–7 | text nodes | a string becomes a node in the tree. |
| 8–13 | the core | the box that lays out a line of mixed text and elements. |
| 14–15 | iOS and Android | drawing and touch on each platform. |
| 16–18 | inline Views | a View can be `inline`, folding into the line, or `inline-block` and atomic. |
| 19–21 | inheritance | text styles cascade down; `all` stops them. |
| +3 | the DOM surface | `getBoundingClientRect()`, clicks on inline elements, and selecting text. |

**Nothing before PR 8 requires believing in the feature** — the first seven
stand on their own. Each fix and optimisation is folded into the PR that
introduces the code, so nothing lands wrong-then-fixed. The largest PR is ~800
lines; the median is ~250.

## How much to trust the numbers

The two speed rows compare different builds of different codebases, where the
same code rebuilt drifts a few percent on its own. So each figure is reported
against a control that exists identically in both builds and that neither change
touches — for the settings list, the same 1,000 rows with the text taken out;
for the chat list, the same 100 containers either way. Whatever differs between
the builds but not between the measurements cancels out.

Each run also records how much text actually got laid out, and is thrown away if
the two builds laid out different amounts. That check exists because an earlier
run reported a "2.4× speedup" that was really a screen which had only rendered
part of itself, and nothing in the harness could say so at the time.

Memory is read out of the compiled binary rather than sampled, and pinned by
checks that fail the build if a structure grows.

Spec compliance is checked by a corpus of 40 layout cases — inline, block, flex,
and the combinations — run first through **real Safari**, and the check runs in
the strict direction: the corpus is not allowed to become the standard unless
Safari itself satisfies every assertion it makes. A case that is wrong about the
spec is caught before any native engine is held to it, which is how four bad
cases were found the first time it ran. The same corpus is then read back out of
a running app through each platform's own text engine — CoreText on iOS,
`android.text.Layout` on Android. All 40 pass on both, plus 7 checks that tap an
inline element and confirm what the tap hit. Those runs use a simulator and an
emulator; the phone was used for speed, not conformance.

Under that sit the integration suites, which run the real renderer headlessly:
465 tests across 33 suites for text specifically, and 3,515 across 213 for the
whole renderer.

Everything above was re-run on 2026-08-16 against the final state: renderer and
text suites passing, iOS and Android both building, and Safari re-measuring the
corpus to a file byte-identical to the one checked in.
