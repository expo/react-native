# Keyboard and scroll views

Working notes for the `keyboard-scroll` branch. Started 2026-08-31 14:30 PDT, based on
frontier `d6880a05a04`.

## The defect

Keyboard-driven layout today is a **replica**, not a follower.

* `KeyboardAvoidingView` subscribes to `keyboardWillShow` / `keyboardDidShow`, reads the
  end frame, and starts its *own* `LayoutAnimation` using the duration and curve carried in
  the notification. It is a second animation, on a second clock, aimed at the same target.
* `RCTScrollViewComponentView` does the same in native: `UIKeyboardWillChangeFrame` →
  set `contentInset` inside a matched `UIView` animation.
* Android has **no** per-frame keyboard support at all. `WindowInsetsAnimation` appears in
  zero files; `ReactRootView` reads a static `ime()` inset.

A replica is correct only while the two clocks agree. They disagree whenever:

| case | what breaks |
|---|---|
| interactive dismissal (drag the keyboard down) | no notification is emitted per frame, so nothing tracks the finger |
| the keyboard changes height mid-flight (autocomplete bar, accessory resize) | the replica is aimed at a stale end frame |
| hardware keyboard attach/detach | height changes with no matching animation |
| split / undocked / floating keyboard (iPad) | the end frame is not a bottom inset at all |
| a different curve than the one modelled | drift, visible at the end of the transition |

The fix is not a better replica. It is to stop replicating: sample the keyboard's geometry
on the platform's own clock and let layout consume it as an inset.

## Platform floors (measured, not assumed)

| | value | consequence |
|---|---|---|
| iOS deployment target | **15.1** (`helpers.rb:83`) | `UIView.keyboardLayoutGuide` is iOS 15+, so it is available unconditionally |
| Android `minSdk` | **24** | `WindowInsetsAnimation` is API 30+, so the compat shim is required |
| Android `compileSdk` / `targetSdk` | 37 / 36 | |
| androidx | `appcompat 1.7.0` as `api` | pulls in `androidx.core`, which has `WindowInsetsAnimationCompat` (API 21+) and `WindowInsetsControllerCompat` |

## Does the keyboard belong in CSS?

Yes, and it is already specified — this does not need inventing.

* **`env(safe-area-inset-top/right/bottom/left)`** — CSS Environment Variables, shipped on
  the web for years. The fork does not support `env()` at all today.
* **`env(keyboard-inset-top/right/bottom/left/width/height)`** — defined by the
  [VirtualKeyboard API](https://www.w3.org/TR/virtual-keyboard/), which also gives
  `navigator.virtualKeyboard.overlaysContent` and a `geometrychange` event.
* **`interactive-widget=resizes-content | resizes-visual | overlays-content`** — the
  viewport-meta control for whether the keyboard resizes the layout viewport. This is the
  web's spelling of the same choice `KeyboardAvoidingView.behavior` asks authors to make,
  and it is a better spelling: it is declarative and it is per-document, not per-subtree.

This fork is an unusually good host for it. The CSS transitions and animations work already
runs styles off-thread on a shared animation backend, so a per-frame `env(keyboard-inset-*)`
can drive layout at display rate with no JS round trip — which is exactly what a replica
cannot do.

## Architecture

```
   platform producer            transport                 consumers
   ────────────────────         ─────────────────         ──────────────────────
   iOS   keyboardLayoutGuide ─┐
                              ├─→  KeyboardGeometry  ─→   env(keyboard-inset-*)
   Andr  WindowInsetsAnimation┘     (per frame, on        ScrollView contentInset
         Compat.Callback            the platform clock)   <native:keyboardaccessory>
                                                          JS: geometrychange
```

Invariant to hold throughout: **there is exactly one animation.** Anything that looks like a
second timer aimed at the keyboard's end state is the bug returning.

## Milestones

1. **Instrument first.** Log keyboard geometry per frame from every candidate source during
   show, hide, and interactive drag, on both platforms. Design against measured behaviour.
2. Per-frame geometry producer, both platforms, with unit tests.
3. Renderer-level environment values (keyboard + safe area), updated off the JS thread.
4. `env()` in the style layer.
5. ScrollView insets react automatically; form controls stay visible.
6. `<native:keyboardaccessory>`, and a chat demo that exercises the hard cases.

## iOS: measured, not assumed

A standalone UIKit probe (`/tmp/kbprobe`) sampled every candidate source on a `CADisplayLink`
during a show, a hide, and an interactive drag. Results, on iPhone 17 Pro / iOS 26.5:

**1. The advertised animation is not the animation.** The notification says
`duration=0.3833, curve=7`. The motion actually on screen accelerates for ~4 frames and then
decays with a long tail — a spring — running past 0.41s:

```
deltas per frame:  -4.4  -33.1  -42.2  -42.5  -38.3  -32.2  -26.1  -20.6 …
tail:              -0.7  -0.5  -0.3  -0.3  -0.2  -0.4
```

No cubic Bezier of duration 0.3833 has that shape. This is the measured reason a
`LayoutAnimation` replica cannot stay with the keyboard: it is not a tuning problem, the
curve family is wrong.

**2. `keyboardLayoutGuide.layoutFrame` is the model value, not the presented one.** On show
it jumps to its destination immediately (840 → 539 in one frame) while the keyboard is still
travelling. Constraining to the guide is correct — UIKit then animates your view as part of
the keyboard's own animation — but *reading* `layoutFrame` per frame is not a sampling source.

**3. The presentation layer of a view pinned to the guide gives the real per-frame value.**
Sampling `follower.layer.presentation().frame` reproduces the spring exactly, at display rate.

**4. During an interactive drag, no notification is emitted at all.** Zero. Meanwhile the
guide tracks the finger continuously (550 → 560 → 570 → … → 650). This is the proof that a
notification-driven implementation can *never* follow a drag — there is nothing to listen to.

**5. When the keyboard is hidden the guide rests on the bottom safe area** (`guideY=840,
height=34` on a 874pt screen — the home indicator). So a bar constrained to the guide's top
anchor is correct in both states with no branching. Safe area and keyboard are one quantity,
not two — which is a strong argument for treating them uniformly downstream.

### Consequence for the design

One mechanism covers every iOS case: **a hidden view constrained to `keyboardLayoutGuide`,
sampled through its presentation layer.** It reports the spring during show/hide, tracks the
finger during a drag, and folds in the safe area when the keyboard is gone.

## iOS producer: built and proven

`EXPKeyboardInsets` pins a hidden view to the root view's `keyboardLayoutGuide` and samples
its presentation layer on a display link. Measured against a real keyboard:

| case | result |
|---|---|
| show | 24 per-frame updates following the spring |
| interactive drag | **29 updates tracking the finger** (324 → 314 → … → 184) |
| at rest | `height=34, keyboard=0, safe=34` — the safe area, as one quantity |

Three defects found by running it rather than reading it:

1. **`UIWindow.keyboardLayoutGuide` never moves.** It compiles, activates, and stays at the
   origin through an entire show animation. The guide has to belong to a view inside the
   hierarchy; hosting the follower in `rootViewController.view` fixed it. Nothing in the API
   suggests this — the isolation run is what found it.
2. **Parking on stability switches the sampler off as the animation starts.** `willShow` is
   posted while the keyboard is still at rest, so the frames right after it are legitimately
   stable. Needed a grace period after each wake.
3. **A one-shot wake cannot cover a gesture.** The finger may travel for a second before it
   reaches the keyboard; the sampler parked first and reported a single update at the end.
   Tracking is now a nesting *hold* released when the gesture ends.

## Android: measured

A gradle-free probe APK (`/tmp/andprobe`, built in seconds with aapt2 + javac + d8) on an
API 36 emulator, with `setDecorFitsSystemWindows(false)` and a platform
`WindowInsetsAnimation.Callback`:

```
PREPARE  typeMask=8 (ime) durationMs=285
APPLY    ime=883 imeVisible=true          <- the FINAL value, before any motion
START    lower=0 upper=883 interpolator=PathInterpolator
PROGRESS ime=0 → 38 → 509 → 663 → 757 → 814 → 863 → 881 → 883
END
```

**The same lesson as iOS, in different clothes.** `onApplyWindowInsets` fires once, up front,
carrying the destination — it is the model value. Only `onProgress` reports what is on screen.
A consumer that reads the applied insets is aiming at the end state, exactly as a consumer
that reads `layoutFrame` on iOS is.

Two differences that matter:

* Android hands you the animation's `interpolatedFraction` directly, and the interpolator is
  a `PathInterpolator` rather than a spring. There is no need to reconstruct the curve —
  which is fortunate, because there would be no way to.
* Android has **no built-in interactive dismissal**. iOS gives it to you with
  `keyboardDismissMode = .interactive`; on Android, dragging the keyboard with a finger has
  to be driven explicitly through `WindowInsetsAnimationController`. That is the piece the
  "drag the keyboard up and down" requirement rests on, and it is genuine work rather than a
  flag.

## Verified on the simulator

**The end state, numerically.** Reading element frames from the accessibility tree rather
than judging screenshots: focusing field 14 moved its bottom from **915pt to exactly 539pt**,
which is precisely the keyboard's top edge. Flush, not approximately.

**The drag, from video.** A 2.5s interactive dismissal recorded at 6fps, then measured two
ways. The keyboard's top edge moves smoothly (274 → 416 in even ~5px steps — it is following
the finger). Cross-correlating a band of content between consecutive frames against the
keyboard's own movement:

```
content matched the keyboard within 1px on 23 of 27 frame pairs
  f41->f42   keyboard +10   content +10      <- speed varied; both varied identically
  f45->f46   keyboard +11   content  +3      <- scroll view out of content to reveal
```

The `+10/+10` pair is the evidence that matters: when the keyboard's speed changed, the
content changed with it. A replica aimed at an end state cannot do that. The four
disagreements are all in the last frames, where the scroll view has hit the top of its
content and physically cannot move further while the keyboard continues.

## Found along the way

* **`<input>` cannot be focused programmatically.** The intrinsic renders a custom Fabric
  component with no ref forwarding and no focus command, so there is no equivalent of
  `HTMLInputElement.focus()`. It is also not reachable by synthetic tap, which together mean
  a screen built from `<input>` cannot be driven by a test at all. The demo uses `TextInput`
  for now. Worth closing separately — focus is not a nicety for keyboard work.
* **A synthetic tap cannot focus a text field on this machine.** It reaches buttons fine, so
  the demo drives focus from buttons. Without that, none of the above could be checked
  automatically.

## Open

**The demo's long form scrolls up but not back down on Android.** Established twice that this
is not the keyboard work: it behaves identically with `keyboardDismissMode="none"`, which
takes the drag handling out of the path entirely, and stock RNTester screens scroll both ways
on the same emulator with the same gestures. It is also not the text inputs — a drag on the
right-hand edge, clear of every `EditText`, behaves the same. Most likely the example's own
container is giving the inner `ScrollView` an unbounded height, so what scrolls is RNTester's
page rather than the list, but that is a guess and it is written here as one. Worth chasing
before this screen is used to judge anything else.

## Where this got to

| | iOS | Android |
|---|---|---|
| scroll insets follow the keyboard per frame | yes | yes |
| the focused field stays clear of it | yes | yes — was broken, three separate faults |
| a bar can sit on top of the keyboard | yes | yes |
| the keyboard follows a finger | yes (UIKit's own) | yes — driven explicitly |
| `<input>` / `<textarea>` `focus()` and `blur()` | yes | yes |
| `KeyboardAvoidingView behavior="position"` | driven by the renderer | driven by the renderer |
| unit tests | 10 | 9 |

Checked on an **iPad Pro 11-inch** as well as an iPhone: focusing the last field of the long
form puts its bottom at exactly 870pt, which is the top of the iPad keyboard *including its
shortcut bar*. The same number on the iPhone is 539pt and on Android 1517px. All three are
flush, and none of them needed a special case — the obstruction is whatever the platform's own
guide says it is, shortcut bar and all.

Everything above was checked by measurement rather than by looking: element frames from the
accessibility tree for end states, and frame-by-frame video for the transitions.

## KeyboardAvoidingView

Where this started, and now closed for one of its three behaviours. `position` only ever moved
its content and never resized it, so it hands the work to the accessory element and its own
`LayoutAnimation` is gone — along with the whole replica path, because
`LayoutAnimation.configureNext` applies to the entire next commit and would otherwise keep
animating unrelated views against a duration borrowed from the keyboard.

`padding` and `height` change layout rather than position. They are the harder half and still
take the old road.

Measured after the change: on iOS a bottom-anchored block lifts onto the keyboard, and a block
the keyboard cannot reach does not move at all. On Android the same block moves from y=2019 to
y=1370 as the IME arrives.

## `<native:scroll>`

The element an app should reach for instead of `ScrollView`. Same view underneath; what it
contributes is which behaviour is the default:

| | `ScrollView` | `<native:scroll>` |
|---|---|---|
| content moves out of the keyboard's way | off | **on** |
| a drag dismisses the keyboard with the finger | off | **interactive** |
| a tap on a control keeps the keyboard | dismisses | **kept** |
| insets follow the safe area | platform default | **automatic, both platforms** |

Every one is still overridable — defaults, not decisions — and there is a test that says so,
because an element that could not be overruled would be a worse `ScrollView` rather than a
better default.

Two things had to be built underneath it. The registry was missing a quadrant: a *library*
could register a host element but not a component, which is what an element needs when its job
is to improve an existing component's defaults rather than mount a new native view. And
namespaced JSX had to be re-enabled — this codebase had retreated to a hyphenated
`<native-switch>` spelling because babel refuses namespaces by default, but a namespace is
exactly how a platform element says it is not an HTML one, and there is no `<scroll>` in the
DOM to pretend about.

Still outstanding for the colon spelling: notes from earlier work say it also wants a Metro
source-map fix that has not landed. It does not stop the bundle building or the app running —
error stacks in namespaced files may be off until it does.

## Still open

* **The safe-area reservation cannot be demonstrated in RNTester, and that is now established
  rather than suspected.** Android honours `contentInsetAdjustmentBehavior` now and reserves room
  on every edge the view overlaps, with four cases under test. But RNTester's window is not
  edge-to-edge: measured, its scroll view ends at 2337px against a root of 2400 with a 63px
  navigation bar — exactly inset for the bars, so the root window insets are already consumed and
  the reservation correctly computes zero.

  A screen was built to try to force the case, dragging a scroll view up under the header, and it
  changed nothing: row 6 sat at y=178 with the reservation both on and off. That screen was
  removed rather than kept, because a demo that shows no difference is worse than none — it
  invites the reader to conclude the feature does nothing.

  What this wants is an app whose window does not fit system windows. The arithmetic has tests;
  the integration has not been seen working, and no amount of care in this app will change that.

* **`env()` is designed but not implemented.** `docs/keyboard-in-css.md` sets out which parts
  are worth building and which are a trap; none of it is written yet.
* ~~**`<input>` cannot be focused programmatically.**~~ **Fixed.** It has `focus()` and `blur()`
  now, through a `focus`/`blur` command on the element's component view and a `ref` that
  reaches it.

  Worth recording how nearly this was written up as something it was not. The first attempt
  did not work and the probe said `handle ok / host ref NULL`, from which I concluded that a
  ref on an intrinsic element is never populated — a limitation of the seam. It was not: React
  19 makes `ref` an ordinary prop, `Input` did not destructure it out, and the component's own
  `{...rest}` spread was therefore overwriting the ref it had just attached with the caller's
  (usually `undefined`). Pulling `ref` out of the spread was the whole fix. The evidence was
  real and the conclusion drawn from it was wrong, because "the ref is null" has a much more
  boring explanation than the one I reached for.

* **The long-form demo does not scroll back down on Android.** Narrowed, not solved. It is not
  the keyboard work: it behaves identically with `keyboardDismissMode="none"`, which takes the
  drag handling out of the path. It is not the ScrollView in general: stock RNTester screens
  scroll both ways, and so does the *other* keyboard screen in this branch — the mixed-content
  form in the demo app scrolls down and comes back exactly. It is not the text inputs: a drag
  on the right-hand edge, clear of every `EditText`, behaves the same. And it is not an
  unbounded container: giving the screen a stated height changed nothing, so that guess was
  wrong and the change was reverted rather than kept as a magic number that fixes nothing.

  What is left is something particular to a list of two dozen identical `TextInput` rows. Worth
  an hour with a fresh head; it has cost enough guesses.
* **Split and floating iPad keyboards** are still unverified by a run. A floating keyboard is
  produced by a pinch, and a synthetic pinch is not something this setup can send; dragging
  and long-pressing the hide key did not produce the undock menu on iOS 26. The behaviour is
  handled, but by inheritance rather
  than by intent: `keyboardLayoutGuide` ignores an undocked keyboard and rests on the bottom
  safe area, so the obstruction reports the safe area alone — which is the right answer, since
  a floating keyboard is not a bottom inset at all. Now set explicitly rather than relied on
  as a default. **Not yet verified on an iPad**, which is the honest status: the reasoning is
  from UIKit's documented behaviour, not from a run.

## The demo app

`KeyboardShowcaseExample` — chat and form screens inside SwiftUI's own `TabView`, which is
the case that makes keyboard insets interesting: a native tab bar, a safe area and a keyboard
all have an opinion about where the bottom is, and a composer has to clear the tab bar when
the keyboard is away and sit on the keyboard when it is not.

Three obstacles, none of them about keyboards:

* `.watchmanconfig` ignored `node_modules/@expo`, so `@expo/ui/swift-ui` could not be imported
  at all — Metro failed with "Failed to get the SHA-1 … The file is not watched", which reads
  like a caching problem and is a configuration one. A guarded `require` does not save you
  here: the failure is in the bundler, so it takes the whole bundle rather than falling back.
* A `Host` sizes to its content, so a `TabView` inside one renders its bar and collapses its
  pages. `useViewportSizeMeasurement` fixes the SwiftUI side; the React Native side needs the
  height stated, because the flex context does not cross into a hosted subtree.
* The pages have to allow for the tab bar. Without that the composer landed underneath it —
  the accessibility tree put Send at y=764 inside a tab bar spanning 726 to 809, so taps meant
  for the composer reached the tab bar.

## Log

* 14:30 — branch cut, orientation done, defect characterised above.
* 15:00 — iOS ground truth captured; five findings above. The replica approach is disproved
  by measurement, not by argument.
