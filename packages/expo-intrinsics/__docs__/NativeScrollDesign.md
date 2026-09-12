# `<native:scroll>`: a scroll view on the platform's own container

## Why it is not a configured `ScrollView`

It began as one — the same view with four props set. That is worth having: most
scroll views in most apps put a focused field behind the keyboard purely because
nobody found the props. But it inherits what is underneath, and on Android what
is underneath is `android.widget.ScrollView`.

Grep `ReactScrollView` for `NestedScroll` and there are **no hits**. Not
implemented badly — not implemented. The nested-scrolling protocol
(`NestedScrollingChild3` / `NestedScrollingParent3`) is how scrolling containers
cooperate on Android: it is what lets a list drive a collapsing toolbar, hand a
fling to a bottom sheet when it reaches its top, or live inside anything built on
`CoordinatorLayout`. A container that does not speak it cannot take part in those
interfaces, and no combination of props adds it.

So `<native:scroll>` is its own element with its own view on each platform, built
on the container the platform itself provides:

| | container | what that gives us for free |
|---|---|---|
| Android | `androidx.core.widget.NestedScrollView` | both halves of the nested-scrolling protocol, fling, edge effects, touch arbitration |
| iOS | `UIScrollView` | the gesture recognizers, deceleration curve, rubber banding, indicators, pointer and trackpad handling, accessibility |

### The claim, measured

Same app, same screen, same swipe, only the scroll view swapped, with a real
`AppBarLayout` above the React surface:

| | app bar before | app bar after |
|---|---|---|
| `ScrollView` | `[0,0][1080,168]` | `[0,0][1080,168]` — inert |
| `<native:scroll>` | `[0,0][1080,168]` | gone, collapsed |

With `<native:scroll>` the React container grows from `[0,168][1080,2400]` to
`[0,0][1080,2400]` as the bar collapses, and scrolling back to the top brings it
in again. With `ScrollView` the list scrolls and the bar does not move.

Worth knowing: the announcement crosses several plain React `ViewGroup`s on its
way up, none of which implement `NestedScrollingParent`. It works anyway, because
`NestedScrollingChildHelper` walks the *whole* parent chain looking for a parent
that accepts rather than stopping at the first one that does not. So this
composes with existing React Native trees rather than requiring them to be
rebuilt.

## It rests at minus its top inset

A scroll view's resting offset is `-contentInset.top`, not zero. `contentInsetAdjustmentBehavior`
is `Never` here — deliberately, because UIKit has no mode for "the top but not the bottom" —
and moving the offset when the inset changes is the part of the automatic behaviour that has
to come with it. Without it a screen whose top inset arrives after its content opens scrolled
by exactly that much: measured, a 62 point status-bar inset and a first row under the clock,
reported as "the demo starts already scrolled".

The DELTA is applied rather than assigning `-inset.top`, so a reader who is not at the top
stays where they are looking; at rest the delta does the obvious thing, because their offset
is the old resting position by definition. Not while a finger is down — the offset belongs to
the gesture then, and moving it reads as the content slipping.

## Insets never enter layout

Insets are applied on the UI thread, in the frame they are computed, and never
travel through the shadow tree. Routing them through it would commit a layout per
frame of a keyboard animation to move content whose size has not changed — at
120Hz, a relayout of the whole subtree per frame.

What "reserve room" means differs at the two ends, and the implementations
differ accordingly:

- **The top displaces the content.** The first row has to start below the status
  bar, and the only way to move content the mounting layer has positioned is to
  move the view holding it.
- **The bottom extends the scrollable range.** The last row has to be *reachable*
  above the keyboard, which is a question of how far the view can scroll rather
  than of where anything is drawn.

The top's displacement is added to the range as well, or pushing the content down
by it would push the same amount off the far end.

`contentInset` from the author is **added** to the automatic reservation rather
than replacing it: eight points of breathing room at the bottom means eight more
than the keyboard needs, not eight instead of it. The keyboard and the bottom
safe area do **not** sum — the keyboard is drawn over the home indicator, so
reserving for both would reserve the same points twice.

### `automaticInsets` names edges, and that is not decoration

"The safe area" is not one decision. A list inside a card wants nothing, a
full-bleed list wants both ends, and a list under a translucent header wants the
top only. `contentInsetAdjustmentBehavior`'s four modes cannot say the last one.

It matters most in a case that was measured rather than imagined: **the automatic
top inset and a collapsing toolbar want opposite things.** The toolbar's pattern
is that content scrolls *under* the status bar while the toolbar, drawn over it,
owns the safe area. The reservation's rule is that a view overlapping the status
bar reserves for it.

With the toolbar expanded the scroll view starts at y=168, overlaps nothing, and
the reservation is correctly zero. With it collapsed the view sits at y=0 and
reserves the status bar's 136px — switching `automaticInsets.top` off shifts the
content back up by exactly that. Neither is wrong; they answer different
questions. An app with a collapsing toolbar sets `automaticInsets={{top: false}}`
and hands the top to the toolbar.

## What the platform's own chat actually does

The behaviours below were measured on the platform's own chat rather than
guessed, because a chat is the case that exercises all of this at once and
the system's is the one people compare against.

**Scroll position is an intent, derived and enforced — not a boolean.**
The native transcript's scroll intent has two cases, *current time* and
*below future messages*. The base intent is derived from the content offset;
triggers then amend it; and enforcement is a separate, deferrable step.

This is not a stylistic difference. Asking "am I at the bottom" at the moment a
layout changes gives a different answer from remembering what the user last
asked for, and the difference shows up exactly where it hurts: inside a native
stack, where the screen is being resized at the same time, the instantaneous
reading is taken against a view that is briefly neither where it was nor where it
is going. Measured: the same chat followed the keyboard on its own and did not
inside a `react-native-screens` stack, with the newest two messages ending up
behind the composer. Both platforms now use the remembered intent.

**The composer is a participant, not a neighbour.** The native transcript has
two triggers for it: focusing the composer, and the composer changing height,
both update where the transcript wants to be.

**Sending hides the message, then flies it in.**
`scrollToBottomHidingMessageAtIndexPath:computedInsets:animationProperties:` —
the transcript scrolls to where the new bubble WILL be while it is still hidden,
and only then does it arrive. Revealing and scrolling together reads as the list
jumping.

**And four settings, three of which validate ours:**

| | native | here |
|---|---|---|
| `contentInsetAdjustmentBehavior` | `.never` — composes its own | `.never` |
| `followsUndockedKeyboard` | `NO` | `NO`, arrived at independently |
| `keyboardDismissMode` | `.interactive`, but `.none` in the notification extension and while the conversation has no recipient | always `.interactive` |
| `automaticallyAdjustsScrollIndicatorInsets` | `NO`, indicator insets set separately | `NO` in effect: the indicator takes the content's top and bottom and the safe area's sides |

The last row started as an unresolved difference and was settled by measuring
rather than guessing: the native transcript passes the caller's top and bottom
indicator insets through untouched and replaces left and right with its safe
area insets, choosing the side by layout direction. So the rule is:
**vertically the indicator follows the content, horizontally it follows the safe
area.** Vertically it must, or an indicator running under the keyboard reports a
position the reader cannot see; horizontally it must not, because an author's
`contentInset` is about where content sits and an indicator is chrome, which
belongs inside the safe area whatever the content is doing. In landscape on a
notched device those differ.

Both platforms now do that. On Android it falls out of something that was
otherwise useless: horizontal padding cannot move the content — the mounting
layer positions that — but it does move the scrollbar, which the framework draws
inside the padding box.

**The rule for interactive dismissal, measured against the platform's own chat
rather than inferred from it.** UIKit documents on `UIKeyboardLayoutGuide.keyboardDismissPadding`:
*"When a user scrolls to dismiss the keyboard, the gesture waits to start the
dismiss until it intersects with the keyboard. This adds padding above the
keyboard to start the dismiss earlier."* That reads as though the rule were about
where the finger ENDS UP. It is not the whole rule, and the missing half matters:
interactive dismissal is driven by the scroll view's own pan, so the drag has to
BEGIN inside the scrollable content. Driving the platform's own chat with real
tracked touches:

| | native | here |
|---|---|---|
| a drag STARTING on the transcript, reaching only the composer | dismisses | dismisses |
| a drag STARTING on the transcript, reaching the keys | dismisses | dismisses |
| a drag STARTING on the composer | does **not** dismiss | does **not** dismiss (iOS) |

Two different questions, and conflating them is easy. Where a drag BEGINS decides
whether it is a scroll-view pan at all; where it REACHES decides whether that pan
dismisses. A touch that begins on the composer never becomes a pan — accessory or
not — so it does nothing in either app. A pan that begins on the transcript
dismisses as soon as it reaches the top of the COMPOSER, 83 points above the keys
in the measured case, which is what a real accessory buys: the bar is part of the
keyboard's frame, so the dismissal region starts at its top.

The first version of this table had only the second and third rows, which cannot
distinguish "the region starts at the composer" from "the region starts at the
keys" — both predict the same answers. It said the composer was not part of the
region. It is.

**Android differs only on the third row**: there the IME belongs to another window
and the gesture is driven by hand, so a drag beginning on the composer does move
the keyboard. On the rows that matter the two platforms agree.

The first Android implementation used "once the scroll has nowhere left to go",
which only works at the top of a list — so the common case, dragging down over
the keyboard mid-conversation, did nothing.

**A short list needs `alwaysBounceVertical`, and the reason is not cosmetic.** A
`UIScrollView` whose content FITS has no vertical pan at all, so there is no
gesture to dismiss the keyboard with: a chat with three messages in it could not
be pulled down. `bounces` does not help — it governs only what happens past an
end that exists. Proven both directions in a stock-UIKit control app with 200pt
of content in an 874pt viewport: off, the keyboard stays; on, it comes down.
`UITableView` sets it, the platform's own transcript bounces with two messages in it, and
a list that does not rubber-band reads as dead anyway.

## `contentAnchor`

Which end of the content the view holds on to. `"top"` is the ordinary list;
`"bottom"` is a chat.

Taken from SwiftUI's `defaultScrollAnchor`, which Expo UI already exposes as a
modifier, rather than from React Native's `maintainVisibleContentPosition`. The
same requirement, said in one declarative word instead of an object of indices.

It replaces the thing every React Native chat ends up writing by hand:

```js
onContentSizeChange={() => list.current?.scrollToEnd()}
```

which is not merely more code — it is **wrong in the case that matters**, because
it yanks a reader who has scrolled up to find something back to the newest
message every time one arrives.

The hard part is not following the content, it is knowing whether to. "Was the
reader at the end" has to be sampled *before* the content grows, because
afterwards it is unanswerable: every position looks like "not at the bottom" once
something has been added below it.

### What the three platforms actually mean by an anchor

They are usually described as the same feature and are three different
mechanisms. SwiftUI was measured with a probe app that reads the underlying
`UIScrollView`'s numbers on screen; Android was read — `LinearLayoutManager`
decompiled from `recyclerview-1.2.1.aar`, `android.widget.ScrollView` from an
emulator's own `/system/framework/framework.jar` (API 36), Compose from
published sources.

| | anchored to | acts |
|---|---|---|
| SwiftUI `ScrollView` | a **fraction of the scrollable range** | only while the current offset already satisfies it |
| `LinearLayoutManager` | a **child view and its on-screen coordinate** | every layout pass, always, not optional |
| Compose `LazyColumn` | the **key of the first visible item** | every measure, if the author supplied stable keys |
| `UIScrollView`, `android.widget.ScrollView` | nothing | — |

SwiftUI's rule is one line: `target = (contentSize − viewport) × anchor.y`,
applied on first layout and re-applied on any geometry change **while the offset
is still the target**; a drag clears that state and scrolling back re-arms it.
It knows nothing about items, so **prepending above a reader who has scrolled
away carries them down by exactly what was inserted** — measured, offset
unchanged at 353.7 while the top row went from 108 to 103. `.center` proves it
is a fraction rather than an edge: it opens at `(1364 − 590.3) × 0.5 = 387` and
after a 220-point prepend sits at `993.7 × 0.5 = 497`.

`LinearLayoutManager` is the opposite. `updateAnchorFromChildren` takes a
currently-visible child and records **its coordinate on screen**, and the next
layout is built outward from there — so maintain-visible-position is the layout
algorithm rather than a feature, and a prepend never moves the reader whatever
the anchor. `stackFromEnd` only chooses which visible child that is (traversing
in reverse), where an EMPTY list starts, and which gap-fix may `offsetChildren`.
It does **not** follow appended content; Android chat apps use
`reverseLayout = true`, which makes the newest message index 0 at offset 0.

Compose keeps `lastKnownFirstItemKey` and re-points the index through
`findIndexByKey` on every measure — the strongest of the three. With one trap:
`getKey` defaults to `getDefaultLazyLayoutKey(index)`, so without an explicit
`key = { … }` the comparison always succeeds against the stale index and the
list jumps, silently, in the way the mechanism exists to prevent.

**So `<native:scroll>` follows Android, not SwiftUI, on holding the reader
still** — see `-[EXPScrollViewComponentView mountingTransactionWillMount:]`,
which runs for both anchors. A transcript loading older messages must not jump,
and SwiftUI's inability to hold the reader there is a gap in SwiftUI.

### Short content is `justify-content`, not an anchor

SwiftUI's `.bottom` pushes three messages to the bottom of the screen. Measured,
it does it with a **top `contentInset`** of
`(viewport − insetBottom − content) × anchor.y` — 524.7 points for `.bottom`,
262.3 for `.center` — parking the offset at `−insetTop`, which is both the
minimum and the maximum, so the view cannot scroll. The content view does not
move and `contentSize` does not change. It is gated on
`isLinkedOnOrAfter(Semantics.v6)`, so an app built against a pre-iOS-18 SDK does
not get it at all.

Android's answer is `ScrollView.fillViewport`, which re-measures the single
child at **exactly** the viewport height when it is shorter, plus `gravity`
inside it; and in `LinearLayoutManager`,
`fixLayoutEndGap(…, canOffsetChildren: true)` calling `offsetChildren`.

Both are *a content box filling the viewport with its children aligned to one
end* — which is `justify-content: flex-end` on a box with `min-height: 100%`,
and the content container already spells that. So it is deliberately **not** a
`contentAnchor` mode here: short content sits at the top, which is what a
transcript wants and what the platform's own chat does.

## What is deliberately absent

A prop that silently does nothing is worse than an absent one: the absent one
fails at the type level, the silent one fails on a user's device. So these are
not props:

| | why |
|---|---|
| `horizontal` | needs a different container on Android; also unnecessary on iOS, where `UIScrollView` shows only the indicator for an axis that can actually scroll |
| `pagingEnabled` | no Android equivalent. Expo UI's `scrollTargetBehavior` (`paging` / `viewAligned`) is the better shape for this — snapping as a behaviour rather than a flag — and is the direction to take when it is done |
| `maintainVisibleContentPosition` | `contentAnchor` is the same requirement, said better |
| `contentOffset` | was never read |

## Verified

Every behaviour below was run from a cold start on each platform, rather than
trusting the run that accompanied the change that introduced it. Numbers are
screen coordinates: device pixels on Android in a 1080x2400 window, points on iOS
in a 402x874 one.

| | Android | iOS |
|---|---|---|
| short chat starts at the top | first message y=406 | y=135 |
| long chat anchors to the bottom | newest y=1852, composer 1979 | newest y=696 |
| someone else's message moves nobody | offset identical before and after | identical |
| your own message goes to the present | newest 1052, reply 1206, composer 1332 | 371, 426, composer 471 |
| interactive dismissal | IME `[0,1517]` → `[0,0]` | keyboard top 539.7 → gone |
| a docked composer is part of the obstruction | newest clears by 69px | clears by 26pt |
| nested scrolling drives native chrome | app bar `[0,0][1080,168]` → collapsed | n/a (see gaps) |
| a native stack owns the top inset | n/a (see gaps) | transcript below the header once, not twice |
| a short list can still be dragged to dismiss | — | `keyboards` 1 → 0 (was impossible; see `alwaysBounceVertical`) |
| the safe area enters layout without a render | `env` 52 / 24, one layout | `env` 62 / 34, one layout per orientation |

**2026-09-01, re-run on both platforms** with the accessory and `env()` work in.
Android numbers taken from `dumpsys input_method` and `uiautomator dump` rather
than from pixels; iOS numbers from XCUITest driving the app by bundle id, with a
stock-UIKit control app to prove the harness could dismiss a keyboard at all
before any negative result was believed. `idb ui swipe` was found to deliver a
start and an end with nothing in between, so it cannot drive interactive
dismissal and every result it gave was discarded.

| behaviour | Android | iOS |
|---|---|---|
| short conversation starts at the top | ✓ | ✓ |
| long one anchors to the newest | 53 messages, shows 37–52 | ✓ |
| someone else's message moves nobody | 16–33 before and after `receive` | ✓ |
| your own message goes to the present | 16–33 → 48–53 | ✓ |
| drag from the composer | dismisses | does not — and the platform's own chat does not either |

Three of those took a second attempt for reasons worth recording, because each
looked like a defect and was not:

- an APK forty minutes stale on the device, so the fix under test was not running
- a drag that stopped short of the halfway point, so the keyboard correctly
  sprang back — the gesture working rather than failing
- LogBox's "Open debugger" toast, whose container reaches from y=2008 to y=2348,
  swallowing taps on a demo's controls

All three are instrument failures rather than product ones. The demo apps are now
driven by helpers that re-read a control's position from its label before every
tap, which removes the first class of them entirely.

## Known gaps

**`DOM-CSS-LIMITATION`: the left and right insets are not delivered on Android.**
Both mechanisms there are vertical — there is no horizontal range to extend, and
displacing sideways would push content out of a viewport Yoga sized to fit.
Delivering them means making the *content* narrower, which is a layout decision.
iOS has no such limit, because `UIScrollView.contentInset` takes all four edges.
Until it is fixed, put the padding on `contentContainerStyle`, where it is a
layout decision and behaves the same on both.

**React Native Gesture Handler will currently mis-arbitrate it.** RNGH's
`NativeViewGestureHandler.onPrepare` dispatches on the view's type:

```kotlin
when (val view = view) {
  is NativeViewGestureHandlerHook -> this.hook = view   // the extension point
  is ReactScrollView -> this.hook = ScrollViewHook()
  ...
}
```

`ScrollViewHook` exists to return `shouldCancelRootViewGestureHandlerIfNecessary()
= true`, which is what lets a scroll view take a gesture from the root handler.
`ExpoScrollView` is neither a `ReactScrollView` nor a `ReactViewGroup`, so it
falls through to the default hook and does not get that.

The fix is already designed for us — the first branch is a public extension
point, so the view need only implement `NativeViewGestureHandlerHook`. That
requires RNGH as a compile-only dependency, which cannot live in ReactAndroid but
can live in an Expo package. Incidentally RNGH's `disallowInterruption` is the
same idea as this fork's `EXPElementDragOwnership`, arrived at independently.

**Tapping the content does not dismiss the keyboard.** React Native's
`keyboardShouldPersistTaps` defaults to dismissing on tap; neither platform does
that natively, and the platform's own chat does not. The keyboard here goes away when it is
dragged away or when focus leaves. A prop to opt into tap-dismissal has not been
added because no case has needed it yet.

**The native stack works on iOS and not on Android.** `react-native-screens`
4.27 against a React Native built from source hits two walls: its CMake declares
`minSdkVersion 21` where ReactAndroid's prefab is built for 24 — fixed by setting
the `minSdkVersion` ext property the library reads — and then fails to link with
undefined vtables for `RNSFullWindowOverlayProps` and its siblings, which says
the library's generated Props are not in the autolinked C++ target. That is a
codegen-integration problem between a released library and a source build. Left
autolinked it fails the entire Android build, so it is excluded there through
`react-native.config.js`; Android builds as before and the native-stack screen
simply is not available on it.

**Tap-to-dismiss is not implemented.** `keyboardDismissMode` covers drags; a tap
on the content behind a keyboard does not dismiss it on either platform yet.
