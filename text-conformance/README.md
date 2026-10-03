# text-conformance

One corpus of mixed inline / block / flex / inline-flex cases, run against three
engines: real Safari, iOS, and Android.

```
node oracle.js                 # render in Safari, write expected.json
node gen-device-screen.js      # regenerate the RNTester screen from cases.js
node verify.js ios             # compare iOS with Safari
node verify.js android
node verify-events.js ios      # tap things, check what the tap hit
node verify-events.js android
```

`verify*.js` need Metro on `:8081`, RNTester open on the screen concerned, and
— because both apps share Metro's inspector — **only one of the two apps
running**. Android also needs `adb reverse tcp:8081 tcp:8081`.

Routes: `-route TextConformance` and `-route TextEventTargets` on iOS,
`--es route TextConformance` on Android.

## Why the assertions look the way they do

Text cannot be pinned to Safari's pixels. Three engines shape with three fonts,
so "the span is 41.4pt wide here and 43.1pt there" says nothing about
correctness, and comparing those numbers directly produces a wall of failures
that mean nothing. What the three must agree on is:

- **Structure** — which boxes share a line, which sit above which, which
  contain which. Font metrics move lines around; they do not change how many
  there are or what is on them. This is the pairwise-relation `signature` in
  `invariants.js`, and it is what almost every case here actually asks.
- **The absolutes CSS pins regardless of font** — a block child's width, a
  sized atomic inline, a padding offset. Declared per case as `assert`.
- **Differences** — a case may name a `baseline` it differs from by one
  property; the delta between the two is font-independent even though neither
  number is. This is the only way to check inline box decorations exactly, and
  it is what identified a half-a-padding error on Android that no single
  measurement could have.

`oracle.js` refuses to write `expected.json` unless **Safari itself satisfies
every assertion**. A case that is wrong about the spec must not become the
standard the native engines are held to; that check caught four bad cases the
first time it ran.

## Files

| file | what it is |
| --- | --- |
| `cases.js` | the corpus — one element tree per case, plus its assertions |
| `serialize.js` | a case as HTML for the browser, and as CSS from RN's style vocabulary |
| `invariants.js` | rects → the quantities three engines can be compared on |
| `oracle.js` | drives Safari through safaridriver, writes `expected.json` |
| `gen-device-screen.js` | writes the RNTester screen from the same corpus |
| `verify.js` | reads the device over CDP and compares |
| `verify-events.js` | taps each probe and checks the target and the bubble chain |
| `expected.json` | Safari's answer, checked in |
| `results-*.json` | the last run per platform |

## Coordinates

`verify-events.js` calibrates its pointer by clicking rather than by computing:
it clicks three points, reads back where the app says they landed, fits the
transform, and refuses to proceed unless the fit round-trips. Deriving it from
window geometry instead was wrong by about 20pt across and 50pt down — enough
to land every tap on the row above the one aimed at, which reads exactly like a
hit-testing bug and is not one.

It calibrates against the event's **screen** coordinates, not its client ones:
`getBoundingClientRect()` is screen-relative, and on Android the client space is
offset from that by wherever the React root view sits. See
`DOM-CSS-LIMITATION(client-coordinates-are-not-rect-coordinates)`.
