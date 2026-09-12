# chat-demo

An app whose window reaches its own edges, for the behaviour RN Tester cannot show.

RN Tester answers "does this element behave"; it cannot answer "does it behave when the
window has no chrome of its own". Measured there, its scroll view sits at y=535 with a
height of 1631 inside a 2400-tall window whose system bars are `[0, 136, 0, 63]` — it
never overlaps a bar, so the safe-area reservation correctly computes zero and there is
nothing to look at. That is not a fault in RN Tester; a catalogue needs a header and a tab
bar. It just means the interesting half of this work is invisible in it.

So: same elements, different question.

## The screens

- **Safe areas** — a `<native:scroll>` filling the window, drawn so its own geometry is
  visible: a red outline is the scroll view's bounds, a blue band inside it is space it
  reserved and will not put content in, and white is content. Turning reservation off in the
  bar makes the blue bands vanish and the content run under the system bars, which is the
  claim, shown rather than captioned. It also reports where it is scrolled — a scroll view
  rests at MINUS its top inset, and reading `-62` as "already scrolled" is the mistake the
  readout exists to prevent.
- **Chat** — the behaviours the platform's own chat actually has, measured off the running
  system rather than guessed. Offline and mockable: a hundred messages, or a message
  arriving while you read history, are one tap away rather than something to wait for.
  Hold a balloon and the PLATFORM answers: `UIContextMenuInteraction` lifts the balloon
  in its own shape, tail included, and presents the reactions as a `UIMenu`. Every message
  is a `VirtualView`, so a history of any length costs the tree only what is near the
  viewport — while you STAY near it. A jump costs the whole list: tapping the field takes
  you to the latest message (the native transcript's rule, and the right behaviour), and with 253 messages every one of the 253 `VirtualView`s
  re-evaluates and reports a mode change, then one commit unmounts about 250 rows'
  contents and mounts the ten at the destination. Measured off the app's own trace in
  Release: focusing from near the bottom drops **no** frames in 41, focusing from the top
  drops **two** (29ms and 33ms). The reveal itself is clean either way — the offsets step
  frame by frame. The native transcript is a reusing collection view, where the same jump is
  O(visible); this is the `VirtualView`-where-a-collection-belongs trade in the Virtualized
  screen's note, one layer down. On Android, which has no counterpart to the interaction, the hold falls back
  to the element's own `contextmenu` timer and the app draws the picker itself — a capsule
  63 points tall on a 49-point glyph pitch, with a 34-point badge in the balloon's own
  bottom stop, both measured off the platform's own chat on a 402-point window.
- **Virtualized rows** — ten thousand rows in a `<native:scroll>`, each one a
  `VirtualView`, which renders its children only while they are near the viewport. The
  screen exists because the failure it guards against is invisible: before the scroll view
  answered `virtualViewContainerState`, a `VirtualView` inside one found no container, never
  received a mode, and stayed rendered forever — a list that looks perfect and virtualizes
  nothing. `VirtualizedCheck` asks the only question that can tell the difference, which is
  whether a row a long way off is still in the tree.

  Ten thousand rather than four hundred because the number is what made the COST visible.
  The container asks every registered `VirtualView` for its rect on every scroll event, so
  the sweep is linear in the list's length whatever is rendered. Measured here in Release,
  normalised by rows actually scrolled, it cost **35.6 sample-milliseconds per row and now
  costs 3.03** — four separate things, each invisible until the one above it was gone:
  `-convertRect:toView:`'s layer geometry, `-[UIView superview]`'s lock, ARC autoreleasing
  a returned view ten thousand times a frame, and `CGRectGetMinY` being a real call into
  CoreGraphics. See `RCTVirtualViewProtocol.h`.

  The rows start HIDDEN, which is not `VirtualView`'s default. Its default export begins in
  the not-hidden state and waits to be told it is off screen, so the first commit built all
  ten thousand rows in full — a `<div>`, a `<native:chatbubble>` and a `<p>` whose text was
  laid out — and the first layout then unmounted nine thousand nine hundred of them.
  Reported as "the Virtualized demo got much slower to load", and it was: **13,610ms** from
  tap to mounted in Debug, against **6,710ms** with `createHiddenVirtualView({minHeight:
  ROW_HEIGHT})` and **90ms** at four hundred rows. The placeholder is the row's own stated
  height, so the scroll range is exact from the first frame and both buttons still land where
  they say. This is `content-visibility: auto` with a `contain-intrinsic-size`, and the same
  bargain: the box is real and takes its space, and its contents do not exist until they are
  close.

  Six point seven seconds is still six point seven seconds, and nothing that keeps ten
  thousand elements in the tree will fix that — the cost is superlinear, 0.19ms a row at four
  hundred and 0.68ms at ten thousand. An app with a list this long should use
  `unstable_VirtualColumn`, which renders about ten rows plus ONE hidden `VirtualView` spacer
  sized `remaining x estimated height` and pages in more as the spacer nears the viewport.
  This screen keeps the ten thousand deliberately, because the sweep cost above is what it is
  for and a paginating list has no far end to sweep.
- **Native stack** — a `react-native-screens` stack, so the scroll view and the keyboard
  can be judged underneath a real navigation bar with the platform's own back gesture.

The last two used to live in RN Tester and were moved here, because a native stack nested
inside RN Tester's own navigation fights it for the back gesture and for the top safe
area — which are exactly the things it exists to demonstrate.

## It is written in the elements

Every box is a `<div>`, every run of prose a `<p>` or a bare string, every control a
`<button>`, `<input>`, `<select>` or `<a>`, and the colours come from `systemColor(...)`.
A demo for these elements written in `View` and `Text` would be evidence they were not
ready.

Two things a new app has to do for them, both of which fail silently:

- **The feature flags go in `AppDelegate.mm` on iOS and `MainApplication.kt` on Android**,
  and the Android list is longer by one. `enableNativeGestureRecognizers` is what makes a
  `<button>`'s `onClick` fire — without it the button draws its full native chrome,
  highlights under a finger, and does nothing — and `enableYogaDisplayBlock` is what gives
  `<div>` a real block formatting context. `useSharedAnimatedBackend` and
  `cxxNativeAnimatedEnabled` are what make CSS transitions and CSS animations RUN; without
  them `transition-*` and `animation-*` are accepted and do nothing, and the value still
  applies immediately, which reads as a broken animation rather than a missing flag. On Android `ReactFeatureFlags.dispatchPointerEvents`
  is what makes `onClick` EXIST at all: the click is synthesised by `JSPointerDispatcher`,
  which is only constructed when that flag is on, so with it off every `<a>` and `<button>`
  in the app is dead while the native-backed controls still work. All are read NATIVELY, so
  a JavaScript `override()` cannot reach them.
- **Flex containers must say so.** `display: 'flex'` AND `flexDirection`, because `<div>` is
  display:block and a CSS flex container is a row by default where a `View` is a column.
  Styles ported from `View` are silently ignored without the first and come out sideways
  without the second.

### The composer's `+` has three implementations

`PLUS_KIND` in `Composer.js` switches between them, so they can be compared on a running
screen rather than described:

- `'panel'` — the custom `<native:keyboardpanel>` card. **The default**, because it is what
  the platform's own chat has: opened on the simulator and screenshotted, its `+` is a
  rounded card of circular coloured tiles and labels anchored at the bottom-left — Camera,
  Photos, Stickers,
  Apple Cash, Audio — and not a menu at all.
- `'html'` — `<button>` with a `<menu>` child. The one to copy for anything that IS a menu,
  and the shorter path by far.
- `'native'` — `<native:menubutton>`, built as the control group: a `UIButton` with a
  `UIMenu` and nothing of ours in it. The two agree.

Three at once was a good comparison — it is how the Liquid Glass press turned out to be
missing from two of the three — and a bad composer: it pushed the field two buttons right of
where the platform puts it, and the send flight measures its origin from that field.

**The card grows as a window AND a miniature**, which took a recording to settle. The
platform's own `+` at 24fps: a row icon is 15 pixels across on the first frame the card can be seen and
39 when it settles, and the row pitch goes 54.5 to 68. So the contents are scaled to about
four tenths and grow with the card, while the card's own outline is a frame animation on two
springs — the native menu's width and height animators —
which is why it changes shape on the way, nearly square to tall. This was written as the
frame alone for a while, and reported as the panel "scrolling down instead of growing from
the `+`", which is exactly what a full-size list uncovered from the bottom looks like. The
scale is UNIFORM: an earlier version scaled x and y to reach a 40-point square button and
the list came out squashed, and the native icons stay circular the whole way.

**The symbol stays, and the native one does not.** The platform fades its `+` out as the
menu opens (gone in about 80ms) and shrinks it to a third. Copying that was reported from a device: "the `+`
button's icon disappears when pressed and then the large `+` appears. Instead, it should grow
directly into the large `+`." Measured off the recording, it did exactly that — 15.33pt, gone
for 970ms, back at 23.0. The platform is animating a POPOVER, which grows over the button and takes
its place, so a symbol left behind would label something that is no longer there. Ours replaces
the KEYS: the button stays put and tapping it again is how the panel closes, which is already
why the button itself is not faded. So the glyph is a plain child of the button and the
button's own growth to `PLUS_OPEN_SCALE` carries it — 15.33 to 23.0 over 310ms opening, 23.0 to
15.33 over 260ms closing, one animation and one shape.

**Android gets the menu, and not by taste.** `<native:keyboardpanel>` is iOS-only and renders
nothing there, which left the `+` dead and every one of the demo's commands unreachable on that
platform — verified on the emulator, where tapping it did nothing at all. `PLUS_KIND` is
therefore `'panel'` on iOS and `'html'` on Android: the same `<menu>`, presented the way each
platform presents a list of commands, which is the whole argument for writing it as a `<menu>`
rather than as a card.

`<native:menubutton>` is iOS-only too and renders nothing on Android, which is what lets the
composer be written once. The HTML one opens a `PopupMenu`
with `destructive` in the theme's `colorError` — verified on the emulator, including that
choosing a command runs it.

The menu route is what the platform's own chat uses, and it does *not* cover the keys: measured, a menu is
drawn at window level 1 and the keyboard at level 10000001, so UIKit places it in the space
above them. `MenuCheck` in `ios/uitests` holds the part of that which used to be broken —
the `+` staying visible while its own menu is up.

### The motion is CSS where CSS can say it

The typing indicator and the receipt's fade-in are `animation-*` styles, run in the renderer
off the JavaScript thread. Both are the case CSS animations exist for: they run because the
element carries them, from the moment it mounts, with React committing once and no effect,
no ref and nothing to stop on unmount. The typing dots were sixty lines of `Animated` before,
including a cubic bezier mirrored by hand to imitate `autoreverses` — `animation-direction:
alternate` plays the curve backwards for you, which is both shorter and the thing the
platform's own layer does.

What is still `Animated`, and why: **springs**, which CSS has none of — the send flight, the
`+`'s symbol, the reaction picker's growth — and anything whose values are **measured at
runtime**, since a flight whose origin comes from `measureInWindow` cannot be a keyframe list
written ahead of time.

All of it runs on the NATIVE driver, including the send flight's width. A layout property
could not once, and on the shared animated backend it can: `width`, `height` and the insets
are in the allowlist when `useSharedAnimatedBackend` is on, which this app turns on. It
matters more than it sounds — a JavaScript-driven layout property is a `setNativeProps` and
a commit per frame, and a commit is the whole surface, which is what "the bubble drops
frames" turned out to be. The picker's backdrop stays `Animated` for a third reason: it needs a
completion to unmount on, and a CSS animation has no callback.

## Running it

Android:

    export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
    ./gradlew :packages:chat-demo:android:app:installDebug \
      -Preact.internal.useHermesStable=true

iOS:

    cd packages/chat-demo/ios && xcodegen generate && bundle exec pod install

`pod install` after EVERY `xcodegen generate`, not just the first: regenerating rewrites the
project and drops CocoaPods' integration with it, and the next build fails on
`'React/RCTBundleURLProvider.h' file not found` — which reads like a broken header search
path rather than a missing workspace.

Metro is served from the **repository root**, not from this package: the app's entry point
is `packages/chat-demo/index` and it imports the elements under test out of
`packages/expo-intrinsics`, so the root is the only project root covering both.

`MainActivity` calls `setDecorFitsSystemWindows(false)` explicitly, and hosts the React
root inside a `CoordinatorLayout` with a collapsing `AppBarLayout` — a real native
neighbour for the scroll view to cooperate with, which is what
`<native:scroll>`'s nested scrolling is for.

## Checking it against the platform

The platform's own chat app ships with the iOS runtime and runs in the simulator,
so the app this one is measured against is available whenever a number is in
doubt — at the same window size, with no cross-device scaling.

**A value that reads like the answer may not be the rule.** The maximum balloon
width reads as 0.85 of the window, and 0.85 of the window is 60 points wider
than any balloon the platform will draw: the rule takes the transcript width,
the margin and whether a `+` button is present, and 0.85 is only its
no-plugin-buttons branch. Measured on a 402-point transcript with a 16-point
margin: 280.6667 with a `+` button, 314.5 without. A balloon sent in the
platform's own chat here measures 280.667 across. See `BALLOON_PLUS_RESERVE` in
`screens/ChatScreen.js`.

`tools/symbol-ink.m` exists because a symbol's IMAGE size is not its ink, and the
ink is what a screenshot measures. The `+` was specified by searching point size
and weight for the ink the platform draws; the first search was done on estimates
and was wrong about the weight and the stroke both.

**The platform's own chat will send to itself over SMS on the simulator**, which
is the only way to get a real balloon, a real tail and a real receipt to measure.
Open the first conversation, tap the field, `idb ui text`, then tap the send
arrow (it sits at about `(360, 504)` with the keyboard up). That is where the
receipt's position, the tail's drop, the separator's type and the balloon's
maximum width were all settled. Writing rows into its database from outside does
NOT work — the schema's triggers call functions only the app itself registers.

`tools/composer-diff.py` is the routine version of all of it: it opens both apps,
brings each composer up, and prints a table of landmarks with the difference
between them.

    python3 tools/composer-diff.py            # keyboard up
    python3 tools/composer-diff.py --docked   # keyboard down

Raised, everything it measures agrees to a third of a point except the caret's
height. **Raise the keyboard before believing anything**: the native docked
composer is a different layout from its raised one, and the two are not
interchangeable — see the gap below.

## What the composer matches, measured

Both apps on the same 402x874 simulator, docked with the keyboard down:

| | native | ours |
|---|---|---|
| field pill top / bottom | 805.67 / 846.00 | 805.33 / 846.00 |
| pill bottom to the screen's edge | 28.00 | 28.00 |
| `+` glyph | x 40.33-55.33 | x 40.33-55.33 |
| dictation glyph ink | 11.67 x 17.67 at x 347.00 | 11.67 x 17.67 at x 347.00 |
| dictation glyph fill | (180, 184, 191) | (180, 184, 191) |
| last receipt's ink to the pill's top | 20.34 | 21.33 |

The 28 is the platform's concentric padding and is LESS than the
34-point bottom safe area, which is what `automaticInsets={false}` on
`<native:keyboardaccessory>` exists for — see `SafeAreaDefaults.md`.

And in DARK mode, which is where the field's fill had to stop being the platform
theme's own constant and start being chosen for the composite — see `FIELD_FILL`:

| | native | ours |
|---|---|---|
| field interior | 25 | 25 |
| field's specular rim | 54 | 52 |
| `+` glyph | x 40.33-55.67 | x 40.33-55.67 |
| `+` circle interior / rim | 25 / 54 | 19 / 47 |
| field's leading edge | 67.00 | 67.00 |

The geometry is identical. What is left is one number in one place: our glass
sits about six levels darker than the platform's effect over the same dark backdrop,
which shows on every surface that has no fill of its own to lift it — the `+`'s
circle is UIKit's glass button and has none.

## Known gaps

- **RESOLVED (2026-09-08): the reaction badge.** Two things were wrong and both
  are now taken from captures of the platform's own badge rather than inferred.

  The TAIL is two circles, not one dot: the platform's intermediate bubble (16x15)
  fused to the disc's outward-bottom edge, and its anchor bubble (8x7)
  detached further along the same diagonal. A lone 5-point dot read as a speck
  rather than a thought bubble.

  The GLYPHS were the picker's, not the badge's. The native picker shows them in
  colour (gold thumbs, blue "HA HA", red "!!", purple "?"); the BADGE shows them
  WHITE, except the heart, which is pink. Reading a badge off a picker therefore
  gets five of six wrong — which is how `😂` came to stand for "Ha", where
  the platform draws the WORDS on two staggered lines.

  Two traps worth keeping: `\uFE0E` (the text-presentation selector) does NOT
  give a monochrome glyph on iOS — the colour emoji comes back, so a white thumb
  is impossible from a font and needs `<img src="system:…" tintColor="…">`, which
  is what the `symbol` field beside every reaction was always for. And a `\n` does
  not stack text: this renderer follows HTML, where a newline is whitespace, so
  "HA\nHA" came out on one line.

  Still unlike the native badge: its heart is shaded light-to-deep pink; ours is flat,
  because the gradient lives in the platform's artwork and neither a font nor a
  tinted symbol can carry it.

- **RESOLVED (2026-09-08): the bar is hosted by the SCREEN, not by the input
  system.** `_contentView` is an ordinary subview of the screen's view, pinned
  leading/trailing with its bottom on `view.keyboardLayoutGuide.topAnchor` and
  `usesBottomSafeArea = NO` (the bar reserves the home-indicator strip itself).

  This replaces the responder claim — `becomeFirstResponder` with the bar as
  `inputAccessoryView` — and everything built on it: the lending walk, the
  reclaim watchdog, the peek stand-down, and the arbitration between two
  screens' bars. All of that existed to hand-emulate what the guide does.

  **Proven with a stock-UIKit control app** (120 lines: a `UINavigationController`,
  a pushed VC, a bar with a text field, self-driving, swiped with `idb`), in two
  variants differing only in how the bar is hosted:

      inputAccessoryView on the VC   docking needs a claim; a back-swipe makes
                                     the bar VANISH
      pinned to keyboardLayoutGuide  docks by itself with no claim; a back-swipe
                                     SLIDES it with the screen

  The second is the platform's own chat, measured off a reference recording: composer and keys
  translate together with the list showing through behind. An accessory can never
  do that — it lives in `UITextEffectsWindow`, which no navigation transition
  moves. **Eight** arrangements of accessory ownership were measured (window-parked
  responder, child view controller, the screen's own controller, a responder-chain
  splice, the full documented recipe, only one bar in the app,
  `inputAccessoryViewController` bare and wrapped) and every one failed for that
  single reason.

  Also settled by measurement, not reading: react-native-screens is **not**
  driving this pop — `handleSwipe:` never fires; iOS 26's native
  `interactiveContentPopGestureRecognizer` drives it with UIKit's own animator.

  NOT the in-place design abandoned earlier. That moved the bar BETWEEN windows —
  in the screen while docked, handed to the input system while focused — and a
  view cannot change windows during its own `becomeFirstResponder`, so focusing
  the composer cancelled its own keyboard. Here the bar never changes windows.

  `EXP_LAYOUT_GUIDE_BAR=0` selects the old hosting; the whole suite (51 tests)
  passes either way, and `DemoCase` passes the variable through so one suite
  judges both.

- **RESOLVED (2026-09-07): the composer going down for a peek, and the balloon
  lifting clear of it.** A docked bar is held up by a first responder of its own,
  so unlike an ordinary accessory it does not go down when a context menu
  presents — it has no field to resign. It then draws above the lifted balloon,
  because it lives in the keyboard's window: level 10000001 against an app
  window's clamp of 10000000, so nothing the app owns can be put above it. The
  earlier goal ("bar stays, balloon above") was therefore unreachable at any
  price, and the workaround built for it — a snapshot of the whole of
  `UITextEffectsWindow` lifted into a clear window at the keyboard's own level —
  is what put the bar over the balloon and the menu's dim.

  It is now a deletion: the peek posts `EXPPeekWillBegin`, calls
  `[window endEditing:YES]`, and the accessory releases its own claim, which
  `endEditing:` cannot reach because the claim is not a text input. The bar rides
  down in UIKit's ordinary dismissal and comes back on `EXPPeekDidEnd`.

  Hooked to `willDisplayMenuForConfiguration:` and NOT
  `configurationForMenuAtLocation:` — UIKit asks for a configuration whenever it
  merely considers a long press, so a drag beginning with a brief press tore the
  composer out, and `willEndForConfiguration:` arrives only sometimes, so it
  never came back. The end is guarded by a `_peekIsOpen` flag: a balloon is
  deallocated on every row recycle, and an unguarded end let ordinary scrolling
  announce peeks ending.

- **RESOLVED (2026-09-07): the wrong screen's bar after a cancelled swipe.** The
  claim lives in the window so navigation cannot reparent it; the cost is that it
  no longer dies with the view that took it. Released now when the bar leaves the
  window, with a notification so the bar that stayed can take it up — through the
  DEFERRED reclaim, because claiming during a dismissal cancels it.

- **RESOLVED (2026-09-07): a stale editing stamp blocking every claim.** A
  composer torn down by a navigation transition never posts an end-editing
  notification, so the app-wide `EXPEditingField` named a field that no longer
  existed — and every claim is gated on it. A committed pop with the keyboard up
  then left the home screen with keys and no composer.
  `EXPCurrentlyEditingField()` now returns nil for a field with no window.

- **RESOLVED (2026-09-07): the composer vanishing when a back-swipe starts.**
  The claim architecture was right; where the claim LIVED was wrong.

  A docked bar stays on screen by being first responder with the bar as its
  `inputAccessoryView`. That claim sat on `EXPKeyboardAccessoryComponentView`,
  which is inside the screen — so it was the view UIKit associated the input
  assembly with. An interactive pop reparents the outgoing screen:

      …ComponentView < RNSScreenView < UIViewControllerWrapperView < UINavigationTransitionView
      …ComponentView < RNSScreenView < _UIParallaxDimmingView < UIView < _UIParallaxTransitionCardView

  and in that same frame UIKit retires the assembly the moved view was providing
  — `UITrackingWindowView` to **y=4000**, `UIKeyboardItemContainerView` shrunk to
  the bar alone at the window's bottom edge. 4000 + 874 = 4874, the ~4852 the
  dock reported. The bar is then off screen while still in its window, at alpha
  1, not hidden.

  The first responder while typing is the composer, and that is inside the hosted
  bar in the KEYBOARD window, which never moves. So a transition disturbs only
  the provider. `EXPKeyboardAccessoryClaim` is that provider, parked in the
  WINDOW: zero-sized, non-interactive, first-responder-capable, returning the
  bar as its `inputAccessoryView`. Nothing navigation does reaches it.

  Seven earlier rounds fixed the wrong thing, including one written up here as a
  resolution that did not hold. All of them edited code that does not run during
  the failure: timestamps across the gesture show no resign, claim, takeover,
  lend or recycle in the four seconds around the vanishing. What found it was
  instrumenting the ANCESTRY rather than the view — a position is the sum of a
  chain, and reading properties of the bar (window, alpha, hidden, isFirstResponder)
  returned "healthy" every time while it was plainly gone. Two chains were needed:
  `didMoveToWindow` fires on a WINDOW change, so a reparent within the same window
  is silent, and only the app-side chain separates "the incoming bar arrived" from
  "our screen was reparented".

  Reproduces on the simulator — enable the software keyboard first (I/O >
  Keyboard > Toggle Software Keyboard; a reboot leaves it OFF, which is why this
  looked device-only), then
  `idb ui swipe --udid $SIM 3 420 260 420 --duration 2.0`. Note `idb` can drive
  react-native-screens' own pan recogniser but NOT UIKit's edge-pan, so the platform's
  own chat cannot be used as the oracle for this gesture.

- **NOT A DEFECT: the transcript moving a few points as a tail retracts.**
  Measured like-for-like against the platform's own chat on a transcript long enough to scroll
  (a two-message conversation cannot scroll, and comparing against one is
  worthless): an older row travels ~22pt through a send in the native transcript and ~5.3pt
  here, with balloon bodies constant in both. Ours is the steadier of the two.
  See `__tests__/tailReserve-test.js`, which pins the invariant that a balloon's
  BODY does not change when its tail leaves — the "bubble grows" report, twice
  made and disproved by the balloon's own traced numbers.

- **The composer snaps in both directions, and so does the platform's.** Measured on the simulator frame by frame at 5-20ms: the native field
  is one line of ink at 1895ms and two at 1911ms growing, and two lines of text
  in one frame and one of placeholder in the next collapsing. It snaps both ways.
  The platform's resize duration constant is 0.1, but nothing
  here spends it — an earlier note in this file said it did, from the constant's
  name, and that was wrong.

  What the native composer has is COVER: at the frame it collapses, the balloon is a
  two-line box sitting exactly over the two lines of text, and it leaves. Ours
  cannot hide there — our flight starts as a one-line box ABOVE the field — so
  the second line goes in the open, which was reported twice from a device.
  Closing that properly means the flight starting at the field's own box, not a
  longer animation on the field.

  An eased collapse was built and taken out again. It runs if the declaration is
  left on the field permanently — 60 -> 51 -> 47 -> 42 -> 40 — but then the
  growth eases too, which was reported straight back. Declared at the send
  instead it never starts: the engine's trace, rendered into the transcript to
  read it on a device, shows no height transition beginning at all. The engine is
  not at fault (`ViewCSSHeightTransition-itest` covers a transition declared by
  the same change), so something about this screen's commit order is, and it is
  not understood yet. See the comment above `Composer`'s `return` in
  `Composer.js`, which carries the measurements.
- **CSS ANIMATIONS do not do layout properties, and that is the piece missing
  here.** `animationKeyframes` interpolates `opacity`, `background-color`,
  `border-color` and `transform`; `height` is transitions-only. It matters for
  exactly the case above: a transition is a REACTION to a change and needs the
  declaration in place before it, while an animation runs because the element
  CARRIES it and needs no before-and-after pair at all. An eased collapse
  declared at the moment of the send is trivial with the second and awkward with
  the first. The mechanism is already there — `applyLayoutFrames` commits height
  frames for transitions — so this is a small piece of plumbing rather than a new
  engine.
- **The send flight is CLIPPED by the transcript, and the platform's is not.** The
  clearest measurement of the session, both apps' balloons tracked as connected
  components frame by frame:

  | | ours | native |
  | --- | --- | --- |
  | enters at | 313 x **28** | 317 x **65** |
  | starting box | y 462..489, cut at the bar | y 464..528, the field's whole box |
  | narrowest | 214 | 203 |
  | settles at | 277 | 261 |

  The width curve is already the platform's. What differs is that our transcript's
  bounds end at the composer bar, so the balloon enters as a 28-point sliver and
  grows to 67 as it rises out from under the bar; the platform draws its balloon
  OVER the bar, at the field's whole box, which is what hides the field's
  collapse underneath it.

  **The structure that fixes it, and it was built and reverted.** The flight
  belongs to the composer: a message in flight is not part of the list yet.

  NOTE (2026-09-10): the hosting is now settled, and settled on a phone. The bar
  is a subview of its screen's view, its bottom on the screen's
  `keyboardLayoutGuide` while a field inside it has the keyboard and on the
  screen's bottom edge otherwise, and the guide's `keyboardDismissPadding`
  (iOS 17) is the bar's height — so a transcript drag begins dismissing the
  keyboard when it reaches the composer, which is the native reach, with no
  accessory at all. Every accessory arrangement, as a view or as a view
  controller, was measured with a plain-UIKit probe to vanish for the whole of an
  interactive pop: UIKit hides input accessories for the length of a navigation
  transition and slides only the keys with the card. The platform's own chat keeps
  its composer in the screen's view the same way and sets the same
  padding. One rule beside it, also the platform's: a screen COVERED by a push lets its
  field go in `viewWillDisappear:`, because a field UIKit resigns by taking its
  view out of the window is flagged to become first responder again the moment
  the view is back — the start of the next pop, where it took the keyboard from
  the screen being popped. A screen being popped keeps its field.

  NOTE (2026-09-08): the reason given below for why it had to be drawn by the bar
  — that the bar is an `inputAccessoryView` in the KEYBOARD's window, so nothing
  in the app's window can draw over it at any z-order — **no longer holds.** The
  bar is now an ordinary subview of the screen, pinned to `keyboardLayoutGuide`,
  in the app's own window. A balloon in the app window CAN now be drawn over it,
  so the whole "child of the bar" structure may be unnecessary and the landing
  problem it created may not need solving at all. Re-measure before rebuilding
  from the analysis below. Drawn
  as a child of the bar — which sets `clipsToBounds = NO` for its material — the
  balloon enters at 322 x 55 in the field's own box and rises over the
  transcript. That part worked and measured right.

  **What defeated it was the LANDING**, and the second attempt narrowed it to
  something specific. When the row itself flies, its spring ends at
  `translate: 0` and it arrives exactly wherever the row is, however wrong the
  measurement was — the reading only sets where it starts from. A balloon flying
  to a measured destination has no such protection.

  Two causes were found and fixed, taking the error from sixty points to
  twenty-one:

  1. the receipt MOUNTS when the message lands, and a bottom-anchored transcript
     pays its height by moving everything above it up. Its space is reserved from
     the send instead, which is what `Receipt` already says it wants;
  2. the field COLLAPSES the moment the send empties it, and its box moves down
     with the bar — so the flight was told to start from the two-line field and
     drawn starting from the one-line one. The box is now taken while the draft
     still exists.

  **What is left is 21 points, and it is one number.** Two experiments settled
  it:

  - the birth box, printed on screen at the moment the balloon appears, is
    `{left: 52, top: 0, width: 322, height: 60.67}` — the correct two-line field
    before the collapse — and an outline drawn on the container lands exactly on
    the balloon. The START is right;
  - aiming the flight late — three still frames, ten, and after the insets have
    been quiet for a tenth of a second — lands in exactly the same place every
    time. So the twenty-one points are NOT a destination that moved. They are a
    systematic offset.

  The offset is this: `origin.y` is the top of the OBSTRUCTION, which the
  transcript computes as `transcriptMaxY - inset.bottom`, and the field's own top
  is **20.67 points below it** — the bar's chrome above the pill. The flight is
  aimed from the obstruction and drawn from the field, so it lands short by
  exactly that. (It is also why today's balloon starts a line too high: it starts
  at the obstruction.)

  **The fix is for the bar to publish that number**, which is the only place that
  can know it: `ExpoKeyboardAccessoryEventEmitter`'s dock event already carries
  `{docked, reserve}` — `reserve` being the strip below — and wants a `contentTop`
  beside it, the distance from the top the bar RESERVES to the top its React
  content begins at. `ComposerBar` forwards it, and the screen adds it to
  `origin.y`. With that, the flight starts at the field, lands on the row, and
  the overlay's start and the row's landing are the same measurement.

  The platform animates its balloon's HEIGHT as well as its width — 65 → 51 → 65 on
  the same two legs — and our surface used to animate width alone. **REMOVED
  2026-09-07, and this paragraph is kept only as the record of what it was:** the
  height breath pinned the surface through `restingHeight`, which was cleared
  only in the flight's completion callback, so an INTERRUPTED flight never
  cleared it and the balloon kept a height taller than its own box — reported as
  bubbles growing when their tails disappeared, and proven by tracing the box
  height beside the surface's (`box=40.6 h=47.0`). Five height mechanisms became
  one. What it used to be: `surfaceHeight` sits beside `surfaceWidth` on `NativeChatBubble`, the
  surface takes it pinned to its BOTTOM edge (so the breath rises out of the
  composer rather than sinking into the row), and `ChatScreen`'s flight springs
  it on the same two legs and clocks as the width. The native view already
  rebuilds its shape from its bounds every frame (`-_updateMask`), so no C++ was
  needed — the height is a layout prop on the shared animated backend, like the
  width. The one thing width did not have to worry about is uncovering the text:
  a surface shorter than its box would leave the line's top drawn on no balloon,
  so the trough is CLAMPED to `max(h·SQUASH_TROUGH, h − BUBBLE_PADDING_V)` —
  never higher than the text's own top. A one-line send (most of them) breathes
  the full amount; a tall balloon breathes only as far as stays behind its text.
  The remaining fidelity gap is that the platform COMPRESSES its text into the
  shorter box and ours does not, which is why the clamp exists rather than a
  matching text squeeze — that squeeze is the next step here, and it needs the
  reflow-free scaling the send already uses on the X axis extended to Y.

  The two attempts are kept at `/tmp/ub/ChatScreen.flight-attempt.js` and
  `/tmp/ub/ChatScreen.flight-v2.js` for as long as that lasts.
- **A form control's padding used to reach nothing, and might elsewhere.** The control is
  laid out in the CONTENT box, so its padding belonged to the element container and a touch
  there hit no control — a fifteen-point dead strip down the composer's leading edge,
  reported as "sometimes tapping the text area doesn't bring up the keyboard". Fixed for
  every control by one `-hitTest:` on `EXPElementControlComponentView`, which is what HTML
  means: a control's box IS the control. Worth remembering because nothing about it is
  visible — the strip draws exactly like the rest of the field.
- **The caret is a point and a third short.** 20.67 against the platform's 22.00, on the
  same 17-point font in both. `<textarea>`'s caret is `UITextView`'s and follows the
  font's line box; the native one is taller than its own font asks for.
- **The send arrow is a third of a point taller and a third thicker, and that is
  ACCEPTED.** Its ink measures 13.00 x 16.00 against the platform's 13.00 x 15.67, with
  a 2.33-point shaft against 2.00; the head matches exactly. One pixel at 3x is
  also all the comparison resolves, so there is nothing left to fit to.
  The native send button is a vector asset rather than a symbol — so
  there is no configuration to search the way the `+` was searched, and `arrow.up`
  at 17 points matches on the ink or the shaft but never both.
- **The received balloon's grey is taken from the framework, not the screen.**
  The platform's own chat will not deliver a message to itself, so there is no received balloon on
  the simulator to sample — see `BUBBLE_GREY` in `screens/ChatScreen.js` for the two
  sources that disagree and which one this follows.

- `react-native-screens` is not autolinked on Android in this repo yet — an unresolved
  vtable for `RNSFullWindowOverlayProps`. The native-stack screen requires it lazily and
  says so on screen, rather than taking the whole app down at startup on a platform where
  the other two screens work.
- The app icon is generated by a few lines of PIL rather than drawn; it is a composer bar
  over three rows of keys, chosen to be legible at 40 points where a word would not be.
- **The LIFT is iOS-only; the hold and the menu are on both.** A hold on a balloon is
  `UIContextMenuInteraction` on iOS — the lift in the balloon's own shape, the blur, the
  platter and the dismissal are the system's — and on Android it is the platform's long
  press, on its own clock and slop, presenting the `<menu>` as a `PopupMenu`. What Android
  has no counterpart for is the lift and the dim, so a balloon there is not raised out of
  the page. See `DOM-CSS-LIMITATION(ios-only-contextmenu)`.

  The app's own picker — a capsule 63 points tall on a 49-point glyph pitch, with a 34-point
  badge in the balloon's own bottom stop, both measured off the platform — is now unreachable on
  both platforms, because a box with a `<menu>` no longer publishes `contextmenu`: the
  platform is presenting, and an app told as well drew its picker over the platform's. It is
  kept as the reference measurement of what the platform does.
- **Reactions are DISPLAYED, and shaped from the platform's own numbers.** Since the platform
  presents the peek, the app cannot hang the reaction PICKER above the platter (that pill is a
  private accessory view a `<menu>` cannot make), so reactions are SET from a `+`-panel command
  ("React to the last message" cycles the six; "Others react to the last message" stands in for
  a group) and DRAWN as a corner badge. A message's reactions are an array: one → a single
  36-point disc; two or more → the AGGREGATE pile. Neither position is guessed. The single badge
  and the pile's container (46×40), corner, and stacked-disc SHAPE are measured on the
  platform — its own sizes, and its stacked-disc asset art rendered at runtime, for the shape: a front disc carrying the most-recent glyph with one or two
  discs peeking ~4pt behind it, fanned away from the tail. The demo's own choices (not platform
  measurements): the front shows an emoji where a large real pile may show a count, and the demo
  caps at three. The badge is a SIBLING of the balloon so the peek lifts the balloon and leaves
  the reaction behind. Reference constants and the measurement method are in the
  reaction-pile ground-truth note.
- **SUPERSEDED (#11).** This described the peek's window-level wall: the bar rode
  the keyboard as an `inputAccessoryView`, so drawing it above the peek's dim
  needed a window above the keyboard's clamped level. Both halves of that premise
  are gone. The requirement changed — the bar should go DOWN for a peek, with the
  balloon lifting clear — and the bar is no longer in the keyboard's window at
  all, so there is no wall to climb: it is an ordinary subview that rides down
  with the keyboard (measured, 482 → 805) and the lift is above it. The sibling
  issue #4, a field long-press dropping the accessory, was a responder race in an
  architecture that no longer holds a responder; it needs re-testing rather than
  fixing.
- ~~**A lifted balloon casts no shadow.**~~ **Closed** by the peek being the platform's:
  `UITargetedPreview` is handed the balloon's own outline as its `visiblePath` and UIKit
  casts the lift's shadow from it, tail included. The underlying limitation stands for a
  balloon shadowed by CSS — a mask clips the layer's shadow along with everything else, so
  `box-shadow` on a tailed balloon still draws nothing. See
  `DOM-CSS-LIMITATION(balloon-tail-clips-box-shadow)`.
- **`corner-shape` draws on iOS only.** The property parses and resolves on both — the
  C++ is shared — but Android's renderer takes its corners from the border radii alone, so
  every value renders as `round` there, silently. See
  `DOM-CSS-LIMITATION(corner-shape-ios-only)`.
- **The glass press is reproduced, not delegated.** A Liquid Glass control's press
  animation is driven by `UIControl`'s own tracking, and the touch that would feed it is
  the one React's pointer system dispatches `click` from. So the numbers here are
  measured off stock controls rather than asked for — 1.40x for a button, 1.05x for a
  surface — and need re-measuring when iOS changes them. The control group that produced
  them is `~/Developer/probes/glassprobe`. See `DOM-CSS-DEVIATION(glass-press-reproduced)`.
- The name is narrower than the app now is. It covers keyboard, safe areas, scrolling and
  navigation; it is called `chat-demo` because that is what it was for first.
