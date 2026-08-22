# Status: what is verified, what is open, what to run

A single register for the HTML-elements work, so that "is this done?" has one
answer rather than being reconstructed from commit messages.

**Every result here is dated, and is worth exactly as much as the last time
someone ran it.** Two claims in this repo have already been quoted long after
they stopped being true — a `244/244` in `text-conformance/README.md` and a set
of screenshots that had been showing the wrong screen for hours. Re-run before
quoting. The commands are in the table for that reason.

Last full sweep: **2026-08-23**, branch `frontier`.

---

## 1. The test surface

Everything that can be run against this work, whether or not it currently is.
"Not run" is listed deliberately: an unrun suite is an unknown, not a pass.

| Suite                        | Command                                                                               | Last result                                             | Date       |
| ---------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------- |
| Unit (jest)                  | `yarn jest`                                                                           | **238 suites, 5537 passed, 1 skipped, 0 failed**        | 2026-08-23 |
| Integration (Fantom)         | `yarn fantom`                                                                         | **243 suites, 3355 passed, 0 failed** (cmake-fresh tester) | 2026-08-23 |
| Device conformance, iOS      | `node text-conformance/verify.js ios`                                                 | **245 checks / 26 cases — matches real Safari exactly** | 2026-08-23 |
| Device conformance, Android  | `node text-conformance/verify.js android`                                             | **245 checks / 26 cases — matches real Safari exactly** | 2026-08-23 |
| Browser oracle (real Safari) | `node text-conformance/oracle.js`                                                     | 24 cases written                                        | 2026-08-22 |
| Visual comparison            | `node text-conformance/build-report.js`                                               | 63 screens x Safari/iOS/Android; 34 web pages, 16 from shared documents | 2026-08-23 |
| Lint                         | `yarn lint` (`--max-warnings 0`, whole repo)                                          | **clean**                                               | 2026-08-23 |
| Format                       | `npx prettier --check <files>`                                                        | clean                                                   | 2026-08-22 |
| iOS build                    | `xcodebuild … -scheme RNTester`                                                       | ARCHIVE SUCCEEDED (Release, device, ad-hoc export)      | 2026-08-23 |
| Android build                | `./gradlew …:app:installDebug`                                                        | BUILD SUCCESSFUL                                        | 2026-08-23 |
| Flow                         | `yarn flow-check`                                                                     | **0 errors** (was 20, never previously run)             | 2026-08-23 |
| Android JVM unit             | `yarn test-android -Preact.internal.useHermesStable=true`                             | **568 tests, 0 failures** (from result XML)             | 2026-08-23 |
| iOS ObjC tests               | see note below (NOT `yarn test-ios` on this machine)                                  | **169 tests, 16 skipped, 0 failures**                   | 2026-08-23 |
| TypeScript types             | `yarn test-typescript-legacy`, `yarn test-generated-typescript`                       | both clean                                              | 2026-08-23 |
| Astryx geometry (CDP)        | `ASTRYX_VERIFY_PLATFORM=android node packages/rn-tester/scripts/astryx-cdp-verify.js` | **16/16 PASS**                                          | 2026-08-23 |
| **AddressSanitizer sweep**   | build with `-enableAddressSanitizer YES`, walk every route (see below)                | **69/69 routes, 0 reports**                             | 2026-08-22 |

`yarn test-android` fails configuration without the Hermes flag — _"Trying to
use Hermes Nightly but hermes-compiler version is not specified"_ — the same
flag the app build needs. It reports BUILD SUCCESSFUL with most tasks
up-to-date, so read the count out of `ReactAndroid/build/test-results/**/*.xml`
rather than trusting the exit code; a fully cached run is not a run.

`yarn test-ios` cannot run here as written. `scripts/.tests.env` pins CI to
**iPhone 16 / iOS 18.3.1** and this machine has only iOS 26.5 simulators; the
script sources that file _inside_ its test function, so `IOS_DEVICE` and
`IOS_TARGET_OS` set in the environment are overridden. Do not edit the pin to
make a local run pass — it is what CI tests against. Run the same two commands
the script runs, against a simulator that exists:

```shell
cd packages/rn-tester
xcodebuild build-for-testing  -workspace RNTesterPods.xcworkspace -scheme RNTester \
  -sdk iphonesimulator -derivedDataPath /tmp/RNTesterBuild \
  -destination "platform=iOS Simulator,id=<UDID>"
xcodebuild test-without-building -workspace RNTesterPods.xcworkspace -scheme RNTester \
  -sdk iphonesimulator -derivedDataPath /tmp/RNTesterBuild \
  -destination "platform=iOS Simulator,id=<UDID>" -resultBundlePath /tmp/RNTesterTestResults
```

Three environment faults have to be cleared first, and each one presents as the
suite failing:

- **Stale listeners on port 5555** stop the harness's own WebSocket server
  binding, and it retries 60 times before giving up.
  `lsof -ti tcp:5555 | xargs kill -9`.
- **A leftover `/tmp/RNTesterTestResults`** makes xcodebuild refuse to write its
  result bundle. Remove it between runs.
- **Metro must be RUNNING.** `RCTBundleURLProviderTests testBundleURL` fails
  without a packager on :8081 — and `objc-test.sh` kills whatever holds that
  port when it starts, so a run following a failed run finds it gone. Verified:
  that test is the only failure without Metro, and passes with it.

The test targets also emit `SWIFT_VERSION '' is unsupported` during
`build-for-testing`. Pre-existing in this checkout's pod configuration; the
tests themselves build and run.

### AddressSanitizer

The strongest correctness instrument here, and it was unusable until today.

```shell
cd packages/rn-tester
xcodebuild build -workspace RNTesterPods.xcworkspace -scheme RNTester \
  -configuration Debug -sdk iphonesimulator -derivedDataPath /tmp/rntester-asan \
  -destination "platform=iOS Simulator,id=<UDID>" -enableAddressSanitizer YES \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO
```

Install it, launch with `--console-pty` so ASan's report on stderr is captured,
then deep-link each route in turn and watch the log for `AddressSanitizer`.

**Debug builds were impossible on iOS** until the memory-budget `static_assert`s
in `ViewShadowNode.cpp` were limited to `NDEBUG`: a Debug build's libc++ types
are larger, so `sizeof(TextAttributes) <= 288` failed outright. That took the
ObjC test suite and ASan with it — and left a stale app from a previous day
installed on the simulator, serving iOS results for hours, because
`build-for-testing` could not replace it.

Two things worth keeping. **Check what is INSTALLED, not what you built**: the
bundle's own timestamp is the evidence, and the Release build and the test build
have different layouts (only the latter carries an `RNTester.debug.dylib`). And
a guard that breaks a build is worse than no guard, because everything
downstream of it stops silently.

Flow will not finish cold: it crawls ~45k files through `node_modules/expo*`
symlinks. **Park `expo`, `expo-image` and `expo-modules-core` out of
`node_modules` first**, then it completes in about four minutes. Restore them
afterwards — everything else in the repo needs them.

The 20 errors it found on its first run were all in `packages/expo-intrinsics`,
and 19 of them predated this branch's recent work: an unrun checker accumulates.
Two were more than cosmetic and are worth knowing about, because both were a
type that had stopped describing its own code:

- `Form.js` declared `onSubmit` as `{formData, preventDefault}` while `submit`
  passes `method`, `enctype`, `action`, `url` and `body` as well — deliberately,
  per the comment there, so that `preventDefault` is an informed choice. The
  runtime was fixed and the type never was, so reading `event.method` was an
  error on a value that is always present.
- `accessibilityForAlt` returned an indexer (`{[string]: unknown}`), which made
  `{...accessibility}` in `<img>`'s JSX unspreadable: Flow cannot tell whether
  an indexed key will overwrite an explicit prop. It now names the two shapes it
  returns, which documents the alt-text mapping the indexer had erased.

### 1.1 Suites re-run after the `<p>` change

The `<p>` work (§4.2) changed the user-agent sheet, so any suite run before it
is stale. Fantom, jest, lint and the visual captures were all re-run afterwards
and are the numbers above.

The device conformance numbers were measured _before_ the revert. That is sound
rather than sloppy: the corpus contains no `<p>`, and the revert is a
JavaScript-only change to one tag's user-agent entry. It is still the one row in
this table whose date and whose tree do not exactly coincide.

### 1.2 What each instrument can and cannot see

This matters more than the pass counts, because a green run from a blind
instrument is worse than no run at all — it is a false negative wearing a badge.

- **Fantom cannot see** anything that depends on real text shaping. Its measurer
  is a monospace grid advancing one 10pt cell per UTF-16 code unit. It measures
  `<p>`'s block margin correctly whether or not the device does, and it puts
  combining-mark text 40pt wide where a real engine puts it 0pt wider. It also
  resolves `PlatformColor` to nothing, so colour assertions there are vacuous.
- **The conformance corpus cannot see** user-agent margins: every case is
  measured under `* { margin: 0; padding: 0; border: 0 }`. Questions about UA
  box metrics belong to the demo screens and the device.
- **The visual comparison cannot see** anything numeric. It is a picture. Its
  value is catching the class of error where geometry is right and the result
  still looks wrong — and it is only as good as its capture integrity (§3.2).
- **Only the device harness** sees platform text layout, and only it saw the
  four inline-box failures in §4.1.
- **None of them** saw §4.2, because the defect was a demo module mutating
  global state at import time. It took a bisect on the device — the same corpus
  machinery, pointed at a question it was not built for.

---

## 2. Open defects

### 2.0 A shared child can arrive at layout wearing the wrong ownership

Found 2026-08-22 by making `<img>`'s load events real on Android: the
`onLoadStart` handler's `setState`, interleaved with the run-state progression
commits, produced a layout pass whose child was a SEALED `Paragraph` from the
previous generation — with its yoga node's owner pointing at the NEW parent,
which is the state the clone-callback contract is supposed to make impossible.
`Attempt to mutate a sealed object` abort, deterministic on the image-events
demo, three instrumented builds of evidence:

- the sealed child's `ownerIsParent=1` at the abort (so ownership was taken
  without a clone, past both `adoptYogaChild` branches);
- an ownership-based clone guard in `updateYogaChildren` fires — and a
  SECOND instance of the same parent tag still carries the sealed child, so
  the laundering is generational, not a single call site.

Two defences are in place: `updateYogaChildren` records which children's yoga
nodes were foreign-owned *before* its detach erases the evidence and clones
them, and `layout()` clones a sealed child in place rather than aborting — the
same contract Yoga's clone callback implements one layer down, applied at the
last line. The abort is gone and trees stay per-generation correct. **The
underlying generational leak is not yet root-caused**; the reproduction is
`HTMLEmbeddedExample/loading` on Android with the layout()-guard reverted, and
the next probe should log every owner transition for one tag across commits.

### 2.1 `@expo/ui` is not linked on Android

The iOS build autolinks Expo modules through the local expo checkout
(`use_expo_modules!` in the Podfile). `packages/rn-tester/android` has no Expo
autolinking configured at all, so `@expo/ui`'s native views are absent and
`ExpoUISmokeExample` cannot render them.

The screen now **reports** that rather than throwing (it used to die with
`Cannot read property 'Host' of undefined` and be caught by the surface error
boundary — that boundary working, but an unlinked dependency is an expected
condition on this platform, not an exceptional one). iOS still renders the real
SwiftUI controls.

Worth keeping: `import {Host} from '@expo/ui'` compiles to a property read on
the module object, so with that object undefined **even `Host != null` throws**.
The guard has to be a `require` in a `try`. The first attempt crashed on its own
null check.

Closing it means wiring Expo autolinking into the Android build. The same
asymmetry applies more quietly to `<img>`, which takes the `expo-image` backing
on iOS and the framework fallback on Android — so the two columns for any image
case in the comparison report are running different code, not the same code
twice.

### 2.1a Replaced elements ignore padding when painting their content

`<img style={{backgroundColor, padding: 6}}>` should draw the bitmap inset to
the CONTENT box with the background visible through the padding ring — the
web column shows exactly that yellow ring on the sizing demo, and both device
backings paint the bitmap across the whole box instead. CSS is unambiguous
(the replaced content fits the content box; background covers padding).
Closing it means teaching both image backings a content inset derived from
the computed padding — expo-image and the framework image view alike.

### 2.2 (CLOSED 2026-08-23) Checkables centre on their label line

Closed by `DOM-CSS-DEVIATION(checkable-line-centering)`: the sheet gives
checkbox and radio `vertical-align: middle`, which all three engines already
implemented for atomic inlines (the cxx TextLayoutManager, the Android
placeholder span and the iOS attributed-string path each carry the CSS2
§10.8.1 middle maths). One UA declaration, no engine change.
`CheckableLineCentering-itest` pins the centred geometry AND that an author's
own `vertical-align: baseline` still beats the sheet; verified on both
simulators — the wrapped-label demo now reads as one line with the control
centred against the text, matching Material rows and iOS Settings rows. See
SpecDeviations.md for the full entry.

While looking at this section: the Android text-field chrome questions from
the same review are ANSWERED, not open — the underline-with-transparent-
background IS the platform's plain `EditText` (Material's filled box is
`TextInputLayout`, a library component, not the platform widget), and the
"value shows its end" behaviour was real and is fixed
(`ElementTextInputSelectionTest`).

---

## 3. Items to check

### 3.0 iOS: half-leading around attachment lines

Measured on the embedded line-height demo (text line above a 56pt inline box):
web 4px and Android 5px of gap above the `lineHeight: 26` box versus 1px above
the default-leading twin — CSS's half-leading below the taller line's glyphs.
iOS measures 1px/2px: the explicit line-height's below-glyph leading does not
appear ahead of the attachment's line. The centring pass
(`RCTApplyBaselineOffsetForRange`) runs for run strings and the corpus pins
iOS box geometry Safari-exact, so the residual is TextKit's distribution of
the extra leading on lines adjacent to attachments. Next probe: dump the
drawn storage's paragraph style for the demo run (lldb attach was repeatedly
fatal to the app tonight; instrument the draw path in a debug build instead).


Claims that are currently unverified, or verified in a way that would not catch
being wrong.

### 3.1 The Astryx geometry checks run on Android only

Not a gap in coverage so much as one worth knowing: the Astryx CDP verifier
cannot reach our iOS RNTester at all, because it is a **Release** build and
registers no CDP target — `/json/list` shows only the Android emulator. That is
why the verifier grew an Android mode rather than being reported as passing on
iOS. To check it on iOS, build RNTester in Debug first.

Every suite in §1 has now been run at least once.

### 3.2 Capture integrity of the visual comparison

Two `DisplayContents` examples come back byte-identical on Android and are
flagged `CAPTURE UNRELIABLE`. **That flag is a false positive, and the diagnosis
this section used to carry was wrong twice over.**

It first said the two examples shared a viewport. Then, on seeing a near-empty
frame, it said the app had never navigated. Neither is true. The examples
genuinely render the same thing: `contents-textinput`'s own description is _"a
TextInput with display: contents (should behave as if display: none was set)"_ —
rendering nothing is the correct result, and `contents-leaf-node` is an empty
bordered box too. A byte-identical frame is an accurate picture of both.

The detector is still right to flag identity — it is what caught the 23 routes
below, which were a real failure — so the flag stays and this note explains the
one place it fires without a defect behind it.

The capture scripts did gain a real guard from the investigation: when a frame
comes back unchanged (iOS) or a module repeats (Android), they now bounce off
another module before navigating, because RNTester does not re-scroll for a deep
link to a sibling example of the screen it is already showing.

The 23 `HTMLConformanceExample/<case>` routes that never navigated have been
removed from the route list; the module exposes exactly one example. The capture
script's own docstring had described this failure and the detector logged it
without acting on it — a detector wired to a log line rather than to a decision.

### 3.3 Other module-scope calls to `overrideUAStyle`

§4.2 was caused by one. The function mutates the shared user-agent style object,
so any call at module scope in a lazily-loaded screen makes app-wide rendering
depend on which screens have been visited. There are none left today —

```shell
grep -rn "overrideUAStyle" packages/rn-tester/js packages/expo-intrinsics/src
```

— and a new one would be very hard to attribute, so it is worth re-checking
whenever `<p>`-shaped weirdness reappears.

---

## 4. Fixed, and how it was verified

### 4.1 A box inside a `<span>` was placed after the inline box

`<span>`-nested atomic inlines reported _and drew_ at x=80 where Safari puts
them at 40; a wrapped one landed a whole line low. iOS only. Four conformance
cases.

The two obvious explanations were both wrong, and each would have meant editing
working code: the iOS text layout returns exactly Safari's answer (probed:
`frame=(50.00,…)` for the padding case), and the correction in `ViewShadowNode`
was not missing — it was subtracting zero.

Cause: that pass read an inline box's offset off the ancestor _node_, which only
carries it when the ancestor was stamped in place. A **sealed** ancestor is
stamped by cloning the path to it, leaving the walked node reporting its
pre-stamp origin. Sealed is the ordinary case. Fix records the origin each stamp
assigned and subtracts that.

Verified: iOS 19/23 → **24/24**, 246 exact checks against real Safari. Android
unaffected and still 24/24. Fantom 24/24.

### 4.2 `boundingRectForGlyphRange:` is given a character range — now covered

Latent, not the cause of 4.1. Covered by `encoding-does-not-move-a-box`: two
rows of identical-looking text, precomposed `U+00E9` (4 UTF-16 units) and
`e`+`U+0301` (8 units), each followed by a box. Asserted as `sameX` — the two
boxes must share an x — rather than against Safari's coordinate, because an
accented glyph's advance is a fact about a font while the equality holds in
every engine. Real Safari puts both at 35.31. Checked on the oracle too, where a
mismatch is reported as a CORPUS FAULT.

Deliberately **not** asserted under Fantom, which fails it by 40pt for reasons
of its own (§1.2).

### 4.2 `<p>` lost its user-agent margin — an RNTester demo was mutating the sheet

Paragraphs sat one line apart, so the space _between_ them equalled the line
spacing _inside_ one. It looked native, tag-specific and sometimes
platform-specific, and it survived every native explanation tried against it.

The cause was one line, at module scope, in an unrelated demo:

```js
// packages/rn-tester/js/astryx/dom.js
overrideUAStyle('p', {marginBlock: 0});
```

`overrideUAStyle` mutates the **shared** user-agent style object, so importing
the Astryx demo zeroed paragraph margins for every screen in the app — and since
RNTester loads example modules lazily, whether `<p>` had margins depended on
which screens had been visited. That is the whole of it.

Found by bisecting on the device rather than by reading:

    <p> UA margin                          0
    <p> AUTHOR margin                      16   ✓ so the tag takes margins
    <dl> UA (byte-identical entry)         16   ✓
    <blockquote>, <h4> UA                  16, 21.33 ✓
    <p> inside a padded parent             0    so not margin collapsing
    <p> with UA marginInline: 40           x=40 ✓ the UA object DOES arrive

The last line is what cracked it: the entry reaches `<p>`, and only the vertical
half was missing — which is what `{marginBlock: 0}` layered on top looks like.

Fixed in two places, because Astryx genuinely needs the reset — its Card
computes an exact 16px inset:

- `ASTRYX_RESET` in `js/astryx/jsx-runtime.js`, for Astryx's own elements.
- `ASTRYX_CARD_P` in `examples/Astryx/AstryxExample.js`, because that file is
  **not** compiled against the Astryx JSX runtime (the babel override covers
  `js/astryx` only), so its `<p>`s are core intrinsics.

Verified: `<p>` measures y=16, gap=16 on Android, matching `<dl>`; and
`astryx-cdp-verify` passes 14/14 with the Card inset still exactly 16.

A side effect worth noting: there is an example on the Astryx screen whose
stated purpose is _"No styles authored here. `<h1>`/`<h2>`/`<p>` carry the
user-agent …"_. The override had been silently zeroing the very thing it exists
to demonstrate.

### 4.3 `<button>` had no content inset, and the fix exposed a cascade inversion

`DOM-CSS-LIMITATION(button-padding-unresolved)` is closed. The label sat flush
against the button's tint, which neither a browser nor a native button does. It
had been left open because resolving it "needs a proper conformance pass against
both browsers, not a guess" — so the pass was run.

The corpus could not answer it: its page starts `* { padding: 0; border: 0 }`,
which erases the value in question, and Safari duly reported an inset of 0. A
case asserting 0 vs 0 would have passed forever while testing nothing, so it was
deleted and the browser measured directly instead — `getComputedStyle` on a bare
`<button>` in a bare document: `padding: 0 6px 1px 6px`, `border: 2px outset`,
content inset **left 8, top 2**. Ours carries platform chrome rather than that
border, so its padding absorbs both terms to reach the same inset.

**The first attempt broke the cascade**, and that is the part worth remembering.
Written as `paddingInline`, an author's `style={{padding: 0}}` did not override
it — a fixture asserting 2 measured 10. `applyAliasedProps` applies
`paddingInline`/`paddingBlock` unconditionally, so a user-agent longhand beats
an author shorthand: the same inversion that made `<p>`'s longhand workaround
unacceptable. `<button>` supplies its user-agent style through a function of its
props, so the cascade is expressed there: if the author states any padding, ours
withdraws. Pinned by a test that reads 8/2 without an author padding and 4/4
with one.

`DOM-CSS-LIMITATION(no-cascade-origins)` records the general problem, which was
previously undocumented: React Native has no cascade origins, styles flatten by
key, Yoga resolves by edge specificity, and any user-agent entry in a more
specific spelling than the author's overrides it. Only elements with a `uaStyle`
function can opt out.

### 4.4 The button chrome was rebuilt from platform measurements (2026-08-22)

Superseding the Safari-derived inset above: `<button>` wears the platform's
chrome, so its numbers now come from the platforms — read off a real
`UIButtonConfiguration` with a probe binary under `simctl spawn`, and from the
SDK's own `Widget.Material.Button` resources. Insets 7/12 and a capsule on iOS
(title `systemBlue`; it had been `link`, a *different blue*), 4/8 and radius 4
on Android; minimum height 44/48 — the touch target, since a `<button>`'s box is
its touch target — withdrawn when an author states a height, on the same grounds
as the padding withdrawal. Press feedback moved out of JavaScript entirely: it
was `opacity: 0.6` from React state, and is now each platform's own — a
measured ×0.75 alpha dim on iOS, a `colorControlHighlight` ripple installed as
the background's feedback underlay on Android. `<input
type=submit|reset|button>` had a button's behaviour and *none* of its chrome
(appearance keys off the tag, and `<input>`'s entry is the text field's); it now
shares `buttonUAStyle`. Pinned by `buttonMetrics-test.js` (both platform
tables), `ButtonContentCentring-itest.js` (plumbing, sheet-derived
expectations), `ElementButtonRippleTest.kt` (ripple exists, as an underlay,
gated with the floor — mutation-checked), and
`EXPElementButtonPressAppearanceTests.m` (the 0.75, driven through the real
`setPressed:` seam).

### 4.4 Two corpus cases asserted nothing, and one compared a font metric

Found by auditing the passing cases one at a time rather than trusting the
total.

- `box-between-text` and `box-in-inline-with-text` are compared structurally —
  which boxes share a line, in what order — but each measured a single box.
  Their signature was the string `"mid"`, which is what it would be wherever the
  box landed. Both now measure two boxes (`"mid after"`), so a box dropping to
  the next line or reversing order fails.
- `baseline-aligned-box-alone` expected a root height of **44** for a 40pt box
  under an EXACT comparison. The extra 4 is the strut's descent below the
  baseline — a font metric. The engines disagree correctly (Safari 44, iOS
  44.33, Android 43.81) and it passed only because all three fall inside the
  0.5pt rounding tolerance. A font update moving a descender by two thirds of a
  point would have turned correct behaviour into a reported bug. It is now
  `bounded`, asserting what CSS fixes: the box keeps its declared size at the
  top of the line, and the line box is strictly taller than the box.

### 4.5 Others

`<abbr>`'s dotted underline (CoreText and Android's native decoration, both
devices); the root font size as the platform's body size
(`DOM-CSS-DEVIATION(root-font-size-is-native-not-16px)`); heading margins
resolving against their own font size; the Android separator crash from a
drawable used as a colour; `PlatformColor` with a theme attribute resolving
invisible.

---

## 5. Intentional deviations and platform limits

Recorded at their sites as `DOM-CSS-DEVIATION(...)` and
`DOM-CSS-LIMITATION(...)`; see [SpecDeviations.md](SpecDeviations.md) for the
reasoning. To enumerate them:

```shell
grep -rho "DOM-CSS-\(LIMITATION\|DEVIATION\)([a-z0-9-]*)" packages/ text-conformance/ | sort -u
```

As of 2026-08-22 that is 29 limitations and 1 deviation. They are not defects;
each is a place the platform cannot do what the web does, or where native
behaviour is the better answer and the difference is written down.
