# `<native:keyboardaccessory>`: a bar that is part of the keyboard

The chat composer, the toolbar above a text field, the "Done" row. Anything that belongs
against the keyboard when there is one and against the bottom of the screen when there is
not — which is one requirement, not two, which is why this element takes no `behavior`
prop and asks the author nothing.

```jsx
<NativeKeyboardAccessory>
  <TextInput placeholder="Message" />
  <Text onPress={send}>Send</Text>
</NativeKeyboardAccessory>
```

## Part of the keyboard, not next to it

The distinction sounds academic and is the whole feature. A bar that merely tracks the
keyboard's frame looks identical while the keyboard animates, and behaves differently the
moment anything touches it or the keyboard goes away.

| | a view that follows the keyboard | this |
| --- | --- | --- |
| while the keyboard animates | identical | identical |
| when the keyboard is dismissed | goes with it, or has to be re-shown | stays, above the home indicator |
| z-order against other chrome | competes | drawn by the platform, above everything |
| the home indicator | the author reserves for it | the bar's own safe area does |

**iOS**: the children are handed to UIKit as the `inputAccessoryView` of a responder this
element owns. The bar is genuinely in the keyboard's window. Becoming first responder is
what keeps it on screen when no keyboard is up — without it a composer would appear only
while something else was focused.

Owning a responder is not enough on its own, and the three things it is not are each a bug
that shipped:

- **The bar is lent to every text input in the window.** UIKit shows the accessory of
  whoever is first responder, so a field elsewhere on the screen taking focus asked that
  field for an accessory, got none, and the bar vanished — and did not come back on
  dismissal, because nothing made this view first responder again. Measured: a composer at
  `(12, 768, 378, 40)` before, `(0, 0, 0, 0)` after and for good. Every field now gets the
  same accessory view, and the bar takes itself back one runloop turn after the borrowing
  field ends editing — deferred, because moving between two fields ends editing on the first
  before it begins on the second, and reclaiming it in between takes the keyboard away from
  the field the user just tapped.
- **UIKit owns the height.** It writes the accessory's frame on every layout pass, so a
  `setFrame:` override is simply overwritten — measured, a bar forcing 153 was laid out at
  119, pass after pass, with the 34 points it reserved hanging off the bottom of the screen.
  A height CONSTRAINT is the supported way to ask, and it must be written only when the
  number changes: updating it from inside `setFrame:` span the main thread at 100% for the
  whole of a drag.
- **"Am I docked" is a SCREEN question, not a window one.** The bar does not live in the
  app's window; it lives in the keyboard's, which is only as tall as the keyboard and its
  bar. `CGRectGetMaxY(self.bounds) >= window.bounds.height` is therefore true there always,
  and the home indicator's space was being reserved on top of the keys as well.

The frosted look is not a blur anyone applied: the content view is a `UIInputView` in the
keyboard's own style, so a bar with no background of its own is drawn on the keyboard's
material, correctly in both states — over the keys while typing and over the page's content
when docked. An author who sets a background still gets it, painted on top.

**Android**: the IME belongs to another application's window and nothing here can be
attached to it, so "part of the keyboard" has to be built out of two halves that iOS gets
in one: the bar follows the keyboard's own inset animation, driven per frame by
`WindowInsetsAnimationCompat.Callback.onProgress`, and it offers drags on itself to the
same `WindowInsetsAnimationController` the keyboard uses.

## Dragging

| | iOS | Android |
| --- | --- | --- |
| a drag STARTING on the content, reaching only the bar | dismisses | dismisses |
| a drag STARTING on the content, reaching the keys | dismisses | dismisses |
| a drag STARTING on the bar itself | does **not** dismiss | **dismisses** |

The first row is what a real accessory buys, and it is worth being precise about: the bar is
part of the keyboard's frame, so `keyboardDismissMode = .interactive` starts dismissing as
soon as the finger reaches the BAR — measured, 83 points above the keys — rather than only
on the keys. The platform's own chat behaves identically; both were driven with real tracked touches.

The third row is a different question. Where a drag BEGINS decides whether it is a
scroll-view pan at all, and a touch beginning on the bar never becomes one, `inputAccessoryView`
or not. On Android the gesture is driven by hand anyway, so the rule there can be the more
generous one.

Two things had to be true on Android for that to work at all, and each failure looked
exactly like "the drag handling is not wired up":

- **The gesture is claimed on the touch slop, not on the controller being ready.** Taking
  control of the IME animation is asynchronous, so the dragger answers "no" on the very
  event that starts the request. Waiting for a "yes" means never claiming the gesture: the
  moves go to the text field under the finger and the controller arrives with nothing
  driving it.
- **The child's `requestDisallowInterceptTouchEvent` is not honoured.** A text field asks
  to keep a drag the moment one starts on it — that is how a field keeps a drag for
  selecting text — so this view saw the DOWN and then nothing. `ReactRootView` declines the
  same request for the same reason. The cost is a vertical drag inside a MULTI-LINE
  composer, which is read as "put the keyboard away" while a keyboard is up.

## Something has to make room for it

The bar reports its own top through the keyboard-docking protocol, which is how
`<native:scroll>` knows what to reserve. Without it a scroll view reserves whatever UIKit
says the keyboard's frame is, and that under-reports this bar: measured on the chat screen,
a reserve of 368.7 points against an obstruction 402.3 tall, leaving the newest message 16
points behind the composer — the exact fault the element exists to prevent. Only
`RCTViewComponentView` was registering, which covers Android's bar, a view in the app's own
window, and not this one.

The conversion is the awkward part, and the reason it is not a plain `convertRect:`: the
rectangle has to go bar window → screen → app window.

## It is out of the flow

The bar does not occupy a box in the column it is written in. Room for it is made by the
thing it covers — `<native:scroll>` already reserves the bottom obstruction, and the bar is
part of that obstruction — rather than by the bar reserving its own height twice. Write it
anywhere inside the screen; where it is written makes no difference to where it lands.

One consequence worth knowing: it must be the last thing in the WINDOW, not the second to
last. A bar inside a container that is itself shorter than the window — a `CoordinatorLayout`
child offset under a collapsing toolbar, say — lands wherever that container's bottom is,
which may be below the screen. Measured: the demo app's composer lost its second row that
way, with 22 of its 105 pixels left visible.

## Whether it is docked, and why the bar has to say

`onDockChange` fires with `{docked, reserve}` whenever the bar's relationship to
the bottom of the screen changes: `docked` is 1 while it rests on the screen, 0
while the keys are under it, and every value between during the transition;
`reserve` is the same answer in points — how much of the home indicator's strip
the bar is standing on.

**Nothing else answers this.** `Keyboard`'s own notifications do not, and that is
measured rather than assumed: installing an `inputAccessoryView` posts
`keyboardWillShow` with the ACCESSORY's frame as the end frame, so a bar that
listened to them read as permanently undocked. The view's `safeAreaInsets` do
not either — they change by WINDOW rather than by state, reporting 34 points
while the bar is in the app's window and zero once it is in the keyboard's, which
the shadow tree cannot see at all.

The bar already knows. It has to compute the strip of the indicator the keys have
not covered in order to reserve it, and that reserve IS the docked-ness. This
publishes what it was computing anyway.

**A fraction, not a boolean.** The transition is about a third of a second long,
and the thing an author does with this moves with it: the platform's native
composer takes its padding from a concentric 28 points on every side that meets
the screen's corner back to its ordinary 16 and 12 as
the bar leaves the corner behind. A boolean would put a step in the middle of a
slide.

The two platforms compute it differently because their bars are in different
places. iOS measures the strip its bar physically overlaps; Android's bar rides
above the whole obstruction and overlaps nothing, so it takes the same shape from
`KeyboardGeometry` — the always-there system bars, less however far the IME
extends past them. Both reach zero at the same point of the transition.

## Verified

Simulator and emulator, 2026-09-01, with real tracked touches — `XCUICoordinate.press(
forDuration:thenDragTo:)` on iOS ([[ios-gesture-harness]]), `adb shell input swipe` on
Android — never `idb ui swipe`, which delivers a start and an end with nothing in between
and cannot drive anything UIKit tracks continuously.

- iOS: bar sits flush on the keys, survives dismissal, drawn above the app's own tab bar;
  a pan reaching the bar's top (composer 490, keys 583, drag ending 500) dismisses
- Android: `mInputShown` goes `false` on a drag begun on the composer
- both: the composer rises with the keyboard and the transcript stays on its newest message
- iOS, 2026-09-04: `onDockChange` measured against the platform's own composer on the same
  simulator. Docked, the demo's `+` glyph lands at x 40.33-55.33, the same points as the
  native one's; raised, at
  x 28.33-43.33 with its centre at y 502.83, again the same
- iOS, 2026-09-04: the vertical too, once the bar took `automaticInsets={false}`. Both apps
  docked with the keyboard down: the field's pill ends **846.00** and begins **805.33** in
  ours against the native composer's 846.00 and 805.67 — 28.00 points off the screen's
  bottom edge in both, which is the concentric padding and is six points INSIDE the safe area

## `automaticInsets`

`true` by default: the bar reserves the part of the home indicator's band the keys are not
already covering, so a bar that ends under the indicator is not a mistake an author can make
by accident.

`false` hands that strip to the app, which is what the demo's composer takes. It is not
"ignore the safe area" — the bar goes on measuring the strip and `onDockChange` goes on
publishing it — it is "I will pay for that edge". The case for it is a number SMALLER than
the safe area: the native pill sits 28 points off the screen against a 34-point inset, and
while the element reserves and the bar pads the two add, so 28 is unreachable. See
`SafeAreaDefaults.md` for the same argument from the other direction.

## Known gaps

- **The bar is as wide as the SURFACE, not as wide as the keyboard.** They differ only when
  the surface is narrower than the window — an iPad split view. `<InputAccessoryView>` pays
  a state round trip on every surface to be right about that one; this does not.
- **No `react-native-screens` on Android in this repo yet**, so the native-stack demo is
  iOS-only for now.
