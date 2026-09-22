# chat-demo

An app that draws edge to edge, to test the elements in cases RN Tester cannot show.

In RN Tester the scroll view sits between a header and a tab bar and never overlaps a
system bar, so its safe-area inset is always zero. RN Tester's own navigation also
conflicts with a nested native stack over the back gesture and the top safe area. This
app has no chrome of its own, so both can be tested. Despite the name, it covers the
keyboard, safe areas, scrolling and navigation, not only chat.

Measured values from native Messages, and how they were measured, are in
[ui-metrics.md](ui-metrics.md).

## The screens

On iOS every screen, including the home screen, is a `Screen` in one
`react-native-screens` `ScreenStack`, with a translucent navigation bar, a back button
and the interactive back swipe. On Android the screens are switched by React state
instead (see [Known gaps](#known-gaps)).

- **Safe areas** (home screen) — a `<native:scroll>` that fills the window. The blue band
  is inset space the scroll view reserves; the page colour is content. Turning off
  *Reserve the safe area* removes the bands, and the content runs under the system bars.
  A readout shows `contentOffset`, the insets, the content height and the viewport
  height. A scroll view at rest has an offset of minus its top inset, so a negative
  offset does not mean it is scrolled. *Content anchor* (top or bottom) sets whether the
  keyboard moves the content, and *Add a row* grows the list. The composer at the bottom
  is the same one the chat uses, so a multi-line draft changes the bottom inset while the
  keyboard is up. This screen also sets the chat's message count (0 to 100,000) and
  whether the chat shows its performance banner.
- **Chat** — an offline chat that follows native Messages' behaviour. The numbered list at
  the top of `screens/ChatScreen.js` is the spec. Messages are mock data. The composer's
  `+` has commands for states that are otherwise hard to reach: receive a message, add
  fifty, edit the last one, add reactions, load earlier messages, scroll to either end.

  On iOS a long press on a balloon uses `UIContextMenuInteraction`: UIKit lifts the
  balloon (tail included) and shows its `<menu>` (Copy, Translate, Select, More…). The
  keyboard and the composer go down while the menu is open. Reactions are drawn as a
  badge on the balloon's corner, or a stack of badges for two or more. Dragging the
  transcript left shows each message's time. A message too long for a balloon shows a
  preview and a chevron that opens it in the Reader screen.

  Each message is wrapped in a `VirtualView`, so only messages near the viewport are
  rendered. Tapping the field scrolls to the latest message (as native Messages does); on
  a long conversation that makes every `VirtualView` re-evaluate at once. Native Messages
  uses a cell-reusing collection view, where this costs only what is visible. See
  ui-metrics.md, "Chat: jump to the latest message".
- **Reader** — the full text of a truncated message, as plain selectable text. The title
  is the message's first words.
- **Virtualized rows** — 10,000 rows in a `<native:scroll>`, each in a `VirtualView`. A
  `VirtualView` finds its container through the nearest ancestor that implements
  `virtualViewContainerState`. Without one it never gets a mode and stays rendered, which
  looks correct but virtualizes nothing. `VirtualizedCheck` tests that a distant row is
  not in the tree.

  The row count is high on purpose. On every scroll event the container reads the frame
  of every registered `VirtualView`, so the cost grows with the list length whether or
  not rows are rendered. Each view returns a stored frame and superview
  (`RCTVirtualViewGeometry` in `RCTVirtualViewProtocol.h`) instead of asking UIKit.

  Rows start hidden: `createHiddenVirtualView({minHeight: ROW_HEIGHT})`. `VirtualView`'s
  default starts rendered, so the first commit would build all 10,000 rows and the first
  layout would unmount almost all of them. The hidden placeholder has the row's height,
  so the scroll range is correct from the first frame and the two scroll buttons land on
  the right rows. This is the equivalent of CSS `content-visibility: auto` with
  `contain-intrinsic-size`.

  Opening the screen still takes seconds in Debug, because all 10,000 elements are in the
  tree and the cost grows faster than the row count. For a list this long an app should
  use `unstable_VirtualColumn`, which renders a first batch of rows plus one hidden
  `VirtualView` spacer for the rest, and renders more rows as the spacer nears the
  viewport. This screen keeps all 10,000 elements because it exists to measure the
  per-scroll cost. See ui-metrics.md, "Virtualized sweep cost" and "Virtualized time to
  open".

## How it's built

### Written in the elements

Every box is a `<div>`, text is a `<p>` or a bare string, every control is a `<button>`,
`<input>`, `<select>` or `<a>`, and colours come from `systemColor(...)`.

A new app using these elements must do two things. Both fail silently if missed.

- **Set the feature flags in native code**: `AppDelegate.mm` on iOS, `MainApplication.kt`
  on Android. They are read natively, so a JavaScript `override()` has no effect.
  - `enableNativeGestureRecognizers` (both platforms): without it a `<button>` draws and
    highlights normally but its `onClick` never fires.
  - `enableYogaDisplayBlock` (both): gives `<div>` real block layout.
  - `useSharedAnimatedBackend` and `cxxNativeAnimatedEnabled` (iOS only;
    `MainApplication.kt` does not set them): without them `transition-*` and
    `animation-*` styles are accepted but the new value applies immediately.
  - `ReactFeatureFlags.dispatchPointerEvents` (Android): `onClick` is generated by
    `JSPointerDispatcher`, which only exists when this flag is on. Without it no `<a>` or
    `<button>` responds, while native controls such as checkboxes still work. iOS calls
    `RCTSetDispatchW3CPointerEvents(YES)` in `AppDelegate.mm` instead.
- **Declare flex containers**: set `display: 'flex'` and `flexDirection`. A `<div>` is
  `display: block`, and a CSS flex container defaults to a row where a `View` defaults to
  a column. Styles copied from `View` code are ignored without the first and lay out
  sideways without the second.

### The composer

On iOS the composer bar is a subview of its screen's view, not an input accessory view.
While a field in the bar is being edited, the bar's bottom is pinned to
`keyboardLayoutGuide`; otherwise it is pinned to the screen's bottom edge. The guide's
`keyboardDismissPadding` is set to the bar's height, so dragging the transcript down
starts dismissing the keyboard when the finger reaches the bar. During a back swipe the
bar moves with its screen, as in native Messages; UIKit hides input accessory views for
the whole of an interactive pop. See `EXPKeyboardAccessoryComponentView.mm`.

The bar sets `automaticInsets={false}` on `<native:keyboardaccessory>` and pads its own
bottom: native Messages' field sits closer to the bottom edge than the bottom safe-area
inset, which a bar that reserves the inset cannot match. See
[`SafeAreaDefaults.md`](../expo-intrinsics/__docs__/SafeAreaDefaults.md) and
ui-metrics.md, "Composer bottom padding".

The audio-message icon in an empty field is decoration only. It is five rounded rects
(`AUDIO_BARS` in `Composer.js`) because iOS 27 draws it from a ChatKit asset, not an SF
Symbol.

### The composer's `+`

`PLUS_KIND` in `Composer.js` chooses which `+` implementation is shown. Each screen
passes its commands to `Composer` as `actions`.

- `'panel'` (iOS default): `<native:popover>`, a card of
  round coloured icons with labels. The `+` turns into the card and back with UIKit's
  zoom transition. Native Messages' `+` opens a card like this, not a menu. See
  [`NativeKeyboardPanel.md`](../expo-intrinsics/__docs__/NativeKeyboardPanel.md).
- `'html'` (Android default): a `<button>` containing a `<menu>`. The simplest option,
  and the one to copy for an ordinary menu. On Android it opens a `PopupMenu`, with
  `destructive` commands in the theme's `colorError`.
- `'native'`: `<native:button>`, a `UIButton` with a `UIMenu` and no custom drawing,
  kept as a UIKit-only reference to compare the other two against.
- `'both'`: all three side by side, for comparing by hand. It moves the field to the
  right of where native Messages puts it, and the send animation starts from the field,
  so don't use it to check anything else.

`<native:popover>` and `<native:button>` render nothing on Android, which is
why Android uses `'html'`.

A `UIMenu` does not cover the keyboard: UIKit draws it in a window below the keyboard's
window and places it above the keys (ui-metrics.md, "Menu and keyboard window levels").
The panel does cover the keyboard: it is a popover in the app's window, and while the
keyboard is up the keys are stood down behind a picture of themselves for as long as
the card is open, the way ChatKit does it. `MenuCheck` in `ios/uitests` checks that the
`+` button is drawn correctly before the panel opens and after it closes.

### The send animation

When a message is sent, an animated copy of its balloon is drawn in `ComposerBar`'s
`overlay`, inside the bar, so it can move over the composer. The copy starts at the
field's frame. The new row stays hidden until the copy reaches it.

- **The copy's destination is computed once, when send is tapped.** The row reports its
  frame in the scroll view's content coordinates (`measureLayout` against the content
  container). The screen then computes where that content will be once the field has
  shrunk back to one line and the list has scrolled to the end. Don't use
  `measureInWindow` for this: inside `<native:scroll>` it leaves out the offset the
  scroll view applies natively (see `contentShift` in
  [`NativeScroll.md`](../expo-intrinsics/__docs__/NativeScroll.md)), and inside the bar
  it returns the bar's layout position, not its position on top of the keyboard.
- **The text wraps the same everywhere.** The copy has the row's exact, unrounded width,
  and the field's text column is as wide as the balloon's, so the field, the copy and the
  row break lines at the same places. `WrapCheck` checks the field against the balloon.

### CSS for fixed animations

Animations whose values are known in advance are CSS, run by the renderer on iOS (see the
flags above). The typing indicator and the pop-in of a received balloon are `animation-*`
styles: they start when the element mounts and need no effect, ref or cleanup.
`animation-direction: alternate` plays the typing dots' curve backwards on alternate
cycles, as `autoreverses` does natively. The receipt's appearance, its `Delivered` to
`Read` change, the date separator's fade-in and the field shrinking after a send are
`transition-*` styles.

`Animated` is used for springs, which CSS lacks (the send animation, the `+` panel's
contents), and for values that follow a finger or are measured at runtime (the send
animation's start position, the timestamp reveal). Every `Animated` animation uses the
native driver, including the send animation's `width`: with `useSharedAnimatedBackend`
on, the native driver accepts `width`, `height` and the insets. Animating a layout
property with `useNativeDriver: false` costs a `setNativeProps` and a commit of the whole
surface on every frame.

## Running it

Android:

    export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
    ./gradlew :packages:chat-demo:android:app:installDebug \
      -Preact.internal.useHermesStable=true

iOS:

    cd packages/chat-demo/ios && xcodegen generate && bundle exec pod install

Run `pod install` after every `xcodegen generate`, not only the first. Regenerating
rewrites the project and removes the CocoaPods integration, and the next build fails with
`'React/RCTBundleURLProvider.h' file not found`. That looks like a header search path
problem, but the cause is the missing CocoaPods workspace setup.

Run Metro from the **repository root**, not from this package. The entry point is
`packages/chat-demo/index`, and it imports the elements from `packages/expo-intrinsics`;
only the root covers both.

On Android, `MainActivity` calls `setDecorFitsSystemWindows(false)` and puts the React
root inside a `CoordinatorLayout` with a collapsing `AppBarLayout`, so `<native:scroll>`'s
nested scrolling can be tested against a native toolbar.

## Checking it against native Messages

The iOS Messages app ships with the simulator runtime, so it can be measured in the same
simulator, at the same window size, as this app. [ui-metrics.md](ui-metrics.md) lists the
reference environment and how values are measured, including how to send a real message
in Messages and how to measure a symbol's drawn size with `tools/symbol-ink.m`.

`tools/composer-diff.py` opens both apps, raises each composer, and prints the positions
of matching landmarks and the difference between them:

    python3 tools/composer-diff.py            # keyboard up
    python3 tools/composer-diff.py --docked   # keyboard down

Compare with the keyboard up: native Messages lays out its composer differently when the
keyboard is down.

`tools/gate.sh` runs jest, a fresh build and the UI tests in `ios/uitests` on the booted
simulators. It checks the test output, because `xcodebuild`'s exit code can be 0 when
tests did not run.

## Known gaps

`DOM-CSS-LIMITATION(…)` tags are listed in
[`dom-css-limitations.md`](../../dom-css-limitations.md) at the repository root.

- **Android has no native stack.** `react-native-screens` is not autolinked on Android in
  this repo yet (an unresolved vtable for `RNSFullWindowOverlayProps`). `App.js` loads it
  with `require` and checks that its native view manager exists; if not, it switches
  screens with React state instead of failing at startup.
- **The context-menu lift is iOS-only.** On Android a long press on a balloon is the
  system's long press and shows the `<menu>` as a `PopupMenu`, without the lift and the
  dimmed background. See `DOM-CSS-LIMITATION(ios-only-contextmenu)`.
- **Nothing adds a reaction yet.** Native Messages shows reactions in a bar above the
  context menu, which is a private UIKit view that a `<menu>` cannot create, and the
  `+` card no longer offers them either: the reaction display was not done well enough
  to show from the composer. The display itself remains, with badge sizes and positions
  that match native Messages (ui-metrics.md, "Reaction badge placement" and "Reaction
  pile"); two things there are the demo's own choice: the front badge of a stack shows
  an emoji where Messages may show a count, and a stack has at most three badges.
- **The heart reaction is flat pink.** Native Messages shades it from light to deep pink
  with artwork that neither a font nor a tinted symbol can reproduce.
- **Tapping send while dragging the transcript does nothing, but the button still
  highlights.** In native Messages the send button does not respond at all during a drag.
  Disabling it would need the drag state in React state, and re-rendering the rows at the
  start of every drag breaks interactive keyboard dismissal.
- **The caret is shorter than native Messages'**, at the same 17-point font size.
  `<textarea>` uses `UITextView`'s caret, which matches the font's line height; Messages'
  caret is taller. See ui-metrics.md, "Caret height".
- **The send arrow is slightly taller and thicker than native Messages' (accepted).** The
  difference is one pixel at 3x. Messages draws the arrow from an image asset, not an SF
  Symbol, and `arrow.up` at 17 points matches either its size or its line width, not
  both. See ui-metrics.md, "Send arrow ink".
- **CSS animations cannot animate layout properties.** `animationKeyframes` supports
  `opacity`, `background-color`, `border-color` and `transform`; `height` can only be
  animated by a transition, which must be declared before the change it animates.
  `applyLayoutFrames` in `CSSTransitions.cpp` already applies height frames for
  transitions, so supporting them in animations is a small change.
- **`box-shadow` on a balloon with a tail draws nothing**: the mask that cuts out the tail
  also clips the shadow. The context-menu lift still has a shadow, because UIKit draws it
  from the balloon's outline, passed as the `UITargetedPreview`'s `visiblePath`. See
  `DOM-CSS-LIMITATION(balloon-tail-clips-box-shadow)`.
- **`corner-shape` only draws on iOS.** It parses on both platforms, but Android draws
  corners from the border radii alone, so every value looks like `round` there. See
  `DOM-CSS-LIMITATION(corner-shape-ios-only)`.
- **Not re-tested: a long press in the composer field making the composer disappear
  (issue #4).** It was reported when the bar was an input accessory view and needs
  checking with the current layout.
