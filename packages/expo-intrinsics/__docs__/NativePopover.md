# `<native:popover>`

A card the platform presents as a popover, zoomed out of the element under
`anchor`, over a keyboard stood down behind a picture of its keys. The native
chat's `+` opens one.

```jsx
<native:button title="+" ref={plus} onPress={open} />
<native:popover visible={open} anchor={plusRect} onClose={() => setOpen(false)}>
  {rows}
</native:popover>
```

Everything visible is the platform's: the card is the popover's own glass
platter, the morph in and out of the anchor and the dimming behind are UIKit's
zoom transition, the tap outside and the pull to dismiss are the popover's, and
it is placed with its vertical centre on the anchor and moved only as far as the
screen's edges require. What the element adds is standing the keyboard down for
it, so the card can lie over the keys.

## It is a popover in the app's window

Nothing of the app's can be drawn over the keys where they are. A `UIWindow` of
your own at a higher level **does not work**: `windowLevel` is _clamped_ — ask
for 10000002 and you get 10000000, one below the keyboard's
`UIRemoteKeyboardWindow` at 10000001, and your window draws underneath. Nor is
the accessory's window enough: a plain `inputAccessoryView` lives in
`UITextEffectsWindow` at level 1, and a view there shows _through_ the
keyboard's translucent backdrop while being drawn under the opaque key caps. A
view inside `UIRemoteKeyboardWindow` itself covers the keys, but a popover
presented there asserts inside UIKit. So the keys are stood down, as below.

The card is a **popover** with UIKit's zoom transition —
`UIViewController.preferredTransition = zoom`, its source view the glass of the
element under `anchor` (whatever answers `exp_glassView`: a `<native:button>`'s
effect view, a glass `<button>`'s chrome) — which is the native chat's own
construction: ChatKit's send-menu presentation applies popover chrome to its
card's controller and takes the popover's zoom transition. The popover's own
chrome is the card: on iOS 26 UIKit installs a glass platter in it, and its zoom
morphs the source button into that platter, and only into that. React's box sits
inside it with no surface of its own — a glass drawn by the element inside a
chrome drawn as nothing looked like the morph on the simulator, whose glass is a
stand-in, and on a phone the button stayed lifted while the card merely
appeared. The morph, the dimming, the pull-to-dismiss and the tap outside are
all the platform's.

The popover lives in the **app's window**, under the keyboard's — and the keys
are stood down for it, the way ChatKit asks the keyboard for a snapshot to
dismiss behind. A picture of the keys goes into the app's window where they
were, from the bar's bottom down, and holds the transcript's room as the
keyboard's obstruction; the bar holds its place (`holdsItsPlace` on the
accessory) so the button stays where it is drawn and is the zoom's source; the
field lets the keyboard go without animation; and when the card is gone the
field takes the keyboard back under a second picture placed in the keyboard's
own window for the length of its return, after which the bar follows the
keyboard again. A card asked for while the keys are still returning waits for
them. A popover inside the keyboard's window asserts inside UIKit, and every
other presentation there shows a receding copy of the keys behind the card while
it zooms. A rotation while the card is up closes it at once, the keyboard
returning the way UIKit brings it, as the native chat's send menu does.

The popover is anchored on the button's glass with no arrow, so UIKit centres
the card on the button and moves it only as far as the screen's edges require:
the native chat's card, recorded on a phone, sits at the left margin with its
vertical centre on the `+`, over the keys and the composer alike; tapping
outside it is the way out. Only the x of `anchor` is used to find the button:
the bar is lifted onto the keyboard by the platform, which the layout
`measureInWindow` reads never hears about, so with the keyboard up the measured
y is the bar's docked position and not where the button is drawn. The element
takes the y from the bar itself.

## Props

| Prop      | Type                    | Default |                                                                                                     |
| --------- | ----------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| `visible` | boolean                 | `false` | Whether the card is up.                                                                             |
| `anchor`  | `{x, y, width, height}` | —       | The element the card grows out of, in window coordinates — usually straight from `measureInWindow`. |
| `onClose` | function                | —       | The card dismissed itself — a tap outside, a pull, a rotation — and `visible` is yours to correct.  |

The children are the card's content, laid out by React; the first child's frame
is the card, and its box states no surface of its own — the platter is the
surface. Give the box a `maxHeight`: the card is as tall as its content up to
that, and the native chat's card is 452 points.

## It works with the keyboard down

With no keyboard up there is nothing to stand down: the card is presented over
the app's content, still centred on the anchor and clamped to the screen's
edges.

## A menu, a panel or a popover

|                                                    |                                                              |
| -------------------------------------------------- | ------------------------------------------------------------ |
| [`<native:button>`](NativeButton.md)               | UIKit's own menu, drawn above the keys, positioned by UIKit  |
| [`<native:keyboardpanel>`](NativeKeyboardPanel.md) | an alternative input **in place of** the keys                |
| `<native:popover>`                                 | a card of commands **over** the keys, zoomed out of a button |

## Platform

iOS only. See `DOM-CSS-LIMITATION(ios-only-popover)`: on Android it renders
nothing rather than red-boxing, so an app can write it unconditionally.
