# `<native:scroll>`

A scrolling container built on `UIScrollView` and `NestedScrollView`.

```jsx
<native:scroll>{rows}</native:scroll>
```

That is the whole of a correct scrolling screen. Everything in the next section
happens without being asked for.

Namespaced JSX needs Babel's `throwIfNamespace: false`. Without it, import the
component and use it as a tag — the same element either way:

```jsx
import NativeScroll from '@react-native/expo-intrinsics-poc/src/NativeScroll';
```

## What you get without writing anything

- **Safe areas on every edge it runs past.** Content starts below the status bar
  and the navigation bar, and above the home indicator.
- **Room for the keyboard, and for whatever rides on it.** A
  `<native:keyboardaccessory>` is part of the obstruction, not something extra
  to subtract.
- **A focused field brought into view** when the keyboard arrives.
- **Drag-to-dismiss.** Dragging down over the keyboard takes it with your
  finger.
- **The platform's navigation behaviour.** A large title that collapses as you
  scroll, the navigation bar's scroll-edge appearance, and tap-the-status-bar to
  return to the top.

Turn any of it off with the props below. Nothing has to be turned on.

## The one rule to know

**A scroll view rests at minus its top inset, not at zero.**

With a 168-point inset for the bars, a view sitting at the very top of its
content reports `contentOffset.y === -168`. That is what "at the top" looks
like. A `0` here would mean the first row is hidden behind the navigation bar.

Everything else follows from it: `onScroll` reports negative offsets near the
top, and a view scrolled to its end reports
`contentSize.height - height + inset.bottom`.

## Props

| Prop                    | Type                                     | Default         |                                                          |
| ----------------------- | ---------------------------------------- | --------------- | -------------------------------------------------------- |
| `contentAnchor`         | `'top' \| 'bottom'`                      | `'top'`         | Which end of the content is held when it changes size.   |
| `automaticInsets`       | `{top, bottom, left, right}` of booleans | all `true`      | Which edges reserve the safe area.                       |
| `contentInset`          | `{top, bottom, left, right}`             | zeroes          | Your own inset, **added** to the automatic one.          |
| `avoidsKeyboard`        | boolean                                  | `true`          | Reserve room for the keyboard and anything docked to it. |
| `keyboardDismissMode`   | `'none' \| 'interactive' \| 'on-drag'`   | `'interactive'` |                                                          |
| `edgeEffects`           | `{top, bottom, left, right}` of `'automatic' \| 'soft' \| 'hard' \| 'hidden'` | all `'automatic'` | How content is treated where it scrolls under an edge — the fade under a header is the top edge's `'soft'`. iOS 26+. |
| `scrollEnabled`         | boolean                                  | `true`          |                                                          |
| `bounces`               | boolean                                  | `true`          |                                                          |
| `showsScrollIndicator`  | boolean                                  | `true`          |                                                          |
| `contentContainerStyle` | style                                    | —               | Styles the content, not the viewport. Padding goes here. |

### `contentAnchor`

`'top'` is the default and keeps the top of the content still when it grows —
right for a list you read downwards, and what both platforms do. Neither
`UIScrollView` nor Android's `ScrollView` has an anchor at all; where the
equivalent exists it is off by default (SwiftUI's `defaultScrollAnchor` is
unset, `LinearLayoutManager.stackFromEnd` is false, Compose's `reverseLayout` is
false), so a default of `'bottom'` here would be this element inventing a
behaviour rather than reaching the platform's.

`'bottom'` keeps the **newest** content visible — right for a chat, and you ask
for it.

Neither anchor moves the reader when the content changes ABOVE them — see below.
That is not part of this choice.

Two things about `'bottom'` are worth being precise about:

- It only acts **while you are actually at the bottom**. Scrolled up reading
  history, you stay where you are when a message arrives. That is the behaviour,
  not a limitation of it.
- It is about content _changing size_, which includes the keyboard opening and
  the composer growing a line.

To move a reader who is _not_ at the bottom, call `scrollToLatest()`.

### `automaticInsets`

Per edge, because "reserve the top but not the bottom" is a real requirement and
a single switch cannot say it.

```jsx
// The bottom edge is mine; everything else, do the usual thing.
<native:scroll
  automaticInsets={{top: true, bottom: false, left: true, right: true}}
/>
```

### `contentInset`

Added to the automatic inset, not instead of it. Eight points of breathing room
at the bottom means eight _more_ than the keyboard needs.

The bottom inset is the **larger** of the safe area and the keyboard, never
their sum: the keyboard is drawn over the home indicator, so reserving both
would reserve the same points twice and leave a gap under the keyboard.

## Methods

Call these on the ref.

| Method                            |                           |
| --------------------------------- | ------------------------- |
| `scrollToLatest(animated = true)` | Go to the newest content. |
| `scrollToTop(animated = true)`    | Go to the beginning.      |

`scrollToLatest()` is what a chat calls when the user **sends** a message.
Sending is a different event from receiving: wherever they were reading, they
meant to go to the present. `contentAnchor="bottom"` deliberately does not cover
this, because it must not move a reader who is deliberately in the past.

```jsx
const transcript = useRef(null);

function send(text) {
  setMessages(previous => [...previous, message(text)]);
  transcript.current?.scrollToLatest();
}

<native:scroll ref={transcript} contentAnchor="bottom">
  …
</native:scroll>;
```

## Events

Every event carries the same payload:

```js
{contentOffset: {x, y}, contentSize: {width, height},
 containerSize: {width, height}, inset: {top, left, bottom, right}, timestamp}
```

`inset` is the **composed** inset in force for that frame — safe area, keyboard
and your own, already combined. It travels with the offset because the two move
together: during a keyboard animation both change on the same frame, and reading
them from two places gives you a torn pair.

| Event                                           |                                |
| ----------------------------------------------- | ------------------------------ |
| `onScroll`                                      | The content moved.             |
| `onInsetChange`                                 | The reserved inset changed.    |
| `onScrollBeginDrag` / `onScrollEndDrag`         | A finger took hold, or let go. |
| `onMomentumScrollBegin` / `onMomentumScrollEnd` | The fling started, or stopped. |

`onInsetChange` fires when nothing has scrolled — a keyboard opening under a
short list moves no content but changes what is reserved. Use it when you need
to know where the obstruction is: `inset.bottom` up from the view's bottom edge
is the top of whatever is covering it.

## Either anchor holds the CONTENT still

A scroll offset is measured from the top, so anything that changes the content
ABOVE the viewport — older messages loaded in, a row measured for the first
time, an edit far back in the history — moves everything on screen down by
exactly what it added.

Following the end when the reader is at the end is only half of what a bottom
anchor means, and the missing half is the half a reader notices. So this element
also remembers the first partially-visible row before every mounting transaction
and, once it has mounted, moves the offset by however far that row travelled. It
needs no estimate of what changed and no cooperation from whatever changed it.

It applies to **both** anchors, and to every list, without a prop. Keeping your
place is not a property of which end is fixed — a list anchored at the top has
the same problem the moment anything is inserted above the viewport. React
Native puts the same mechanism behind `maintainVisibleContentPosition`; here it
is simply how a scroll view behaves.

## It can host a `VirtualView`

`VirtualView` renders its children only while they are near the viewport, and it
finds out where the viewport is by walking up to the first ancestor that says it
is a virtualization container. This element says so, on both platforms — iOS
through `RCTVirtualViewContainerProtocol`, Android through
`VirtualViewContainer` — so a long list can be written as rows and cost only the
rows anyone can see.

```jsx
<native:scroll>
  {rows.map(row => (
    <VirtualView key={row.id}>
      <Row {...row} />
    </VirtualView>
  ))}
</native:scroll>
```

Two things to know before reaching for it.

**A hidden row keeps its last measured height** — `VirtualView`'s default hidden
style is `minHeight` taken from the rectangle it was last measured at. A row
that has never been measured has no height, so a list whose rows are sized only
by their content will collapse as it virtualizes. Give the row a height, or a
`hiddenStyle` that states one.

**The band is five viewports deep.** `virtualViewPrerenderRatio` is 5.0 and the
prerender rectangle is the viewport inflated by that on _each_ side, so nothing
is dropped until it is more than five screens away. That is why it costs nothing
to reach for on a list of thirty rows — and also why a test on a list of thirty
rows proves nothing.

**It composes with `contentAnchor="bottom"`, and that is tested.** The two pull
against each other in principle — the anchor is resolved from the content's
height, and rows materialising above the viewport change it — so the scroll view
holds the visible content still on every mounting transaction rather than only
following the end. See the section above.

## Related

- [`<native:keyboardaccessory>`](NativeKeyboardAccessory.md) — a bar that is
  part of the keyboard, and part of what this element reserves for.
- [Design notes](NativeScrollDesign.md) — why this is its own element rather
  than a configured `ScrollView`, and what was measured to decide it.

## The scroll indicator clears a rounded ancestor

An indicator is drawn inside the scroll view, so a clipping ancestor with a
corner radius cuts both of its ends off — `overflow: hidden` clips chrome as
well as content. The indicator's inset therefore includes the largest corner
radius on any clipping ancestor, walked up from this view; a list in a card with
30-point corners gets a 30-point indicator inset at each end.

Two things about where that runs are worth knowing, because the first version
had both wrong:

- It is applied from **layout**, not from the inset update. The inset update
  returns early when the composed content inset has not changed, and a scroll
  view whose content inset never changes — a plain list inside a card — returned
  there on its very first layout and reached the indicator code exactly never.
- Layout applies **only** the indicator. The full inset path also moves the
  content offset when an inset changes, and running that from layout would put
  an offset adjustment on a path that had never carried one.

The walk stops at the first ancestor that does not clip: a rounded view that
lets its children paint outside itself is not cutting anything off.
