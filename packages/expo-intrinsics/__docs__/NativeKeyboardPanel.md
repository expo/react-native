# `<native:keyboardpanel>`

A panel that belongs to the keyboard — either **in its place** or **over it**.

```jsx
<native:keyboardpanel visible={open} style={{height: 280}}>
  {options}
</native:keyboardpanel>
```

## Two presentations

| `presentation` | |
|---|---|
| `inputView` (default) | The panel **replaces** the keyboard. The keys go away, the panel appears where they were, the composer stays put. |
| `overlay` | The panel is drawn **over** the keyboard, anchored to a button and growing out of it. The keys stay. |

Which one is right is a question about the panel's content, not about taste. A
panel that is an alternative **input** — a sticker picker, an emoji grid —
belongs where the keys were, because it is doing the keyboard's job. A panel
that is a list of **commands** is a menu, and a menu is drawn over what it acts
on and leaves it in place.

The native chat's `+` is the second kind. That was measured rather than assumed:
screenshotted with the keyboard up, its card covers the keys, the keys stay, and
the card is 452 points tall — well past the 336 a keyboard gets on the same
device, so an input view could not have produced it.

## `inputView` is the responder's own

`UIResponder.inputView` is UIKit's primitive for "show this instead of a
keyboard", and using it hands the system four things:

- the transition in and out
- the height and where the panel sits
- the safe area beneath it
- what happens when the field is dismissed

A panel positioned over the keyboard would have to imitate all four.

## `overlay` lives in the keyboard's window

Which is the whole trick, and it is not the obvious one. The obvious answer is a
`UIWindow` of your own at a higher level, and it **does not work** — but not for
the reason this page used to give. `windowLevel` is *clamped*: ask for 10000002
and you get 10000000, one below the keyboard's `UIRemoteKeyboardWindow` at
10000001, and your window draws underneath. There is no level to reach for.

Nor is the accessory's window enough. A plain `inputAccessoryView` lives in
`UITextEffectsWindow` at level 1, and a view there shows *through* the
keyboard's translucent backdrop while being drawn under the opaque key caps —
which reads as a card clipped at the accessory's bottom edge and is really a
card behind the keys.

What works is `UIRemoteKeyboardWindow` itself, after its
`UIInputSetContainerView`: a view there covers the keys completely. That is
where an overlay panel goes, and it is what the native chat's `+` card does.

All three were measured with `~/Developer/probes/windowprobe`, which puts a
coloured band in each and photographs the result. The old claim here — "an
overlay window at level 100000000 was still behind them" — was measuring the
clamp and reporting it as the compositing.

The card sits just above the composer, and the composer is found by measuring
the accessory bar rather than by taking a coordinate from JavaScript: the bar is
in the keyboard's window, and a position measured in JavaScript is in the app's.
Those are the same numbers only while the keyboard is down.

## Props

| Prop | Type | Default | |
|---|---|---|---|
| `visible` | boolean | `false` | Whether the panel is up. |
| `presentation` | `'inputView' \| 'overlay'` | `'inputView'` | See above. |
| `anchor` | `{x, y, width, height}` | — | The button an `overlay` grows out of, in window coordinates — usually straight from `measureInWindow`. |
| `onClose` | function | — | The panel dismissed itself. An `overlay` closes when you tap outside it, and `visible` is yours to correct. |

Give it a `height`. UIKit reads an input view's size and gives it exactly that
much of the screen, the same way it does for a keyboard; an overlay is sized the
same way, clamped so it never reaches the status bar.

## An overlay cannot use `-apple-visual-effect`

A `UIVisualEffectView` samples what is behind it **within its own window**, and
an overlay panel is in the keyboard's window with nothing behind it — so a
material there blurs nothing and renders as nothing. Use a colour:
`secondarySystemGroupedBackground` is the closest thing to the near-white the
native chat shows, and it follows the appearance.

## It works with the keyboard down

Tapping `+` when nothing is focused still opens the panel. An `inputView` panel
is raised exactly as focusing a field raises a keyboard — the element becomes
the first responder itself when nothing else is one. An `overlay` falls back to
the app's own window, which is above everything on screen when there are no keys
to clear. Either way a button that opens it never silently does nothing.

## Accessory or panel, or both

| | |
|---|---|
| [`<native:keyboardaccessory>`](NativeKeyboardAccessory.md) | rides **above** the keyboard |
| `<native:keyboardpanel>` | stands **in for** it, or covers it |

Two different slots on the same responder. A composer usually wants the
accessory; a `+` button wants the panel; a chat wants both, which is what the
keyboard demo does.

## It is out of the flow

Like the accessory: the host view is hidden and its children are drawn in the
keyboard's own window, so its box is read for its SIZE and never its position.
Written inside a row it would otherwise take a share of that row's width.

## Platform

iOS only today. `inputView` has no Android equivalent — an IME belongs to
another process there — so an Android panel would have to be a view positioned
where the keyboard was, with the animation driven by the same machinery
`<native:keyboardaccessory>` already uses for its bar.
