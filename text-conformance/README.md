# text-conformance

One corpus of mixed inline / block / flex / inline-flex cases, run against three
engines: real Safari, iOS, and Android.

```
node oracle.js                 # render in Safari, write expected.json
node gen-device-screen.js      # regenerate the RNTester screen from cases.js
node verify.js ios             # compare iOS with Safari
node verify.js android
```

`verify.js` needs Metro on `:8081`, RNTester open on the screen, and — because
both apps share Metro's inspector — **only one of the two apps running**.

Start `verify.js` *before* launching the app: it is a server the screen POSTs
to on `:8900`, not a poller, and the screen reports once on mount.

**Routes.** Both platforms build the URL as `rntester://example/<route>Example`
— they **append `Example` themselves**, so the argument is the module key with
that suffix removed:

```
xcrun simctl launch <udid> dev.expo.rntester -route HTMLConformance
adb shell am start -n com.facebook.react.uiapp/.RNTesterActivity --es route HTMLConformance
```

Passing the full `HTMLConformanceExample` asks for `HTMLConformanceExampleExample`
and fails with an unmissable-but-easy-to-ignore banner rather than an error.

Android also needs **both** ports reversed — `:8900` as much as `:8081`, since
the report POST goes to `localhost` on the device:

```
adb reverse tcp:8081 tcp:8081
adb reverse tcp:8900 tcp:8900
```

## Why the assertions look the way they do

Text cannot be pinned to Safari's pixels. Three engines shape with three fonts,
so "the span is 41.4pt wide here and 43.1pt there" says nothing about
correctness, and comparing those numbers directly produces a wall of failures
that mean nothing. What the three must agree on is:

- **Structure** — which boxes share a line, which sit above which, which
  contain which. Font metrics move lines around; they do not change how many
  there are or what is on them. This is the pairwise-relation `signature` in
  `verify.js`, and it is what almost every case here actually asks.
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
| `cases.js` | the corpus — one element tree per case, its assertions, and `toHTML` |
| `oracle.js` | drives Safari through safaridriver, writes `expected.json` |
| `gen-device-screen.js` | writes the RNTester screen from the same corpus |
| `verify.js` | receives the device's POST, compares, writes `actual-<platform>.json` |
| `expected.json` | Safari's answer, checked in |
| `actual-ios.json`, `actual-android.json` | the last run per platform |
| `corpus.html`, `corpus.json` | the corpus as the browser and the device see it |
| `safari-corpus.png` | Safari's rendering, for a three-way visual check |

## Coordinates — for the event harness, which is NOT in this branch

There is no event verification here: this harness measures geometry only. The
notes below are what a tap-based harness needs, kept because both were learned
the hard way and neither is guessable.

Calibrate the pointer by **clicking, not by computing**: click three points,
read back where the app says they landed, fit the transform, and refuse to
proceed unless the fit round-trips. Deriving it from window geometry instead
was wrong by about 20pt across and 50pt down — enough to land every tap on the
row above the one aimed at, which reads exactly like a hit-testing bug and is
not one.

Calibrate against the event's **screen** coordinates, not its client ones:
`getBoundingClientRect()` is screen-relative, and on Android the client space is
offset from that by wherever the React root view sits. See
`DOM-CSS-LIMITATION(client-coordinates-are-not-rect-coordinates)`.

## Status

Run `node oracle.js` (real Safari), then `node verify.js ios|android` with the
"HTML: conformance harness" screen open. `Conformance-itest.js` runs the same
corpus through Fantom for a fast fix-and-check loop; the device is the
authority.

**All 39 cases pass on both platforms — 307 exact checks each, re-measured
2026-08-29 against builds made from this tree** (iOS: `xcodebuild` +
`simctl install`; Android: `installDebug`, with the native symbol checked in
the built `libreactnative.so` first, because "BUILD SUCCESSFUL" against stale
prefab headers is a silent no-op). Fantom runs the same corpus at 39/39.

Numbers in a README age badly. This section has twice claimed a pass that did
not reproduce, both times because it was written from a run nobody re-checked
and then quoted elsewhere as a live fact — once into a comparison report. It is
exactly as trustworthy as the last time someone ran the thing. **Re-run before
quoting it.**

### The four that used to fail, and why they are worth remembering

    nested-in-one-inline             inner.x   safari 40 vs ios 80
    nested-three-deep                inner.x   safari 40 vs ios 80
    inline-with-padding-around-box   inner.x   safari 50 vs ios 80
    nested-inline-wrap               inner.y   safari 20 vs ios 40

All four put a sized box inside a `<span>`, and the box was placed as though the
inline box occupied space before it. The obvious readings were both wrong, and
each would have produced a "fix" to working code:

- **Not the iOS text layout.** `RCTTextLayoutManager` hands back exactly
  Safari's answer — 50.00 for the padding case. Probed, not reasoned about.
- **Not a missing subtraction.** `ViewShadowNode` already had the correction,
  written for this same symptom. It was subtracting **zero**.

The real cause: that pass reads an inline box's offset off the ancestor *node*,
which only carries it when the ancestor was stamped in place. A **sealed**
ancestor is stamped by cloning the path to it, so the node the pass walks still
reports the origin it had at mount, and the mounting layer composes the offset a
second time. Sealed is the ordinary case — any relayout that does not re-clone
the inline boxes takes it — so the bug was live on every measurement after the
first. The fix records the origin each stamp assigned and subtracts that, so the
two passes cannot disagree.

Worth noting for anyone reading a screenshot: the stamped origin drives
*mounting* as well as `getBoundingClientRect`, so those boxes were being drawn
wrong too, not merely reported wrong.

### What this corpus cannot answer

Everything here is measured on a page that starts with
`* { margin: 0; padding: 0; border: 0 }`. That reset is deliberate — a default
body margin would offset every coordinate and the point is to pin geometry CSS
determines exactly — but it also means **the user-agent sheet's own margins are
erased before anything is measured.** A case added here to test `<p>`'s block
margin found Safari reporting no gap, which is the reset talking, not the
browser. Questions about UA margins need a different instrument; the demo
screens and Fantom are where those live.

The single exception is `vertical-align: middle`, and it is not a gap: CSS
defines it against the parent's x-height, so the coordinate is a fact about a
font file. That case asserts the properties every engine must agree on — the
box lands strictly between `top` and `bottom`, and inside its line box.

### `sameX` — comparing a case to itself

`encoding-does-not-move-a-box` needs a third kind of assertion. It renders the
same four accented letters twice — precomposed `U+00E9`, then `e` plus combining
`U+0301` — each followed by a box. Same glyphs and same picture; four UTF-16
units against eight.

The absolute coordinate is a fact about a font, so it cannot be pinned to
Safari's. The *equality* is not: whatever the font, the two rows must put their
box in the same place. `sameX` names the pair and asserts that, on the device
**and** on Safari — a mismatch on Safari is reported as a CORPUS FAULT, because
a case the browser fails is a case making a claim CSS does not.

It exists because iOS positions an atomic inline with
`boundingRectForGlyphRange:`, which takes a glyph range, from the **character**
range the attribute enumeration supplies. Those indices coincide for plain BMP
text and stop coinciding at the first combining mark, surrogate pair or
ligature. Real Safari puts both boxes at 35.31; both devices agree.

**Not asserted under Fantom, deliberately.** Its measurer is a monospace grid
that advances one cell per UTF-16 code unit, so the two rows land 40pt apart
there by construction — a fact about the stub. Asserting it anyway would leave
the case failing forever for a reason unrelated to the defect, which is how a
guard teaches people to ignore it. Fantom still runs the case structurally.

## Why the corpus is font-free

The earlier note below argued text cannot be pinned to a browser's pixels, and
that is still true. The corpus answers it by removing the font from the
question rather than working around it: every measured box is an atomic inline
with an explicit size, on lines with an explicit `line-height`. CSS then fixes
every coordinate, and exact comparison becomes legitimate. Cases that must
involve text are marked `withText` and compared structurally, or `heightOnly`
where `line-height` pins the answer regardless of the font.
