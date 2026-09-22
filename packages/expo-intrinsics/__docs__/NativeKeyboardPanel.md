# `<native:keyboardpanel>`

A panel that takes the keyboard's place.

```jsx
<native:keyboardpanel visible={open} style={{height: 280}}>
  {options}
</native:keyboardpanel>
```

## In place of the keys, not over them

The keys go away, the panel appears where they were, the composer stays put. A
panel that is an alternative **input** — a sticker picker, an emoji grid —
belongs here, because it is doing the keyboard's job. A panel that is a list of
**commands** is a menu, and a menu is drawn over what it acts on and leaves it
in place: that is [`<native:popover>`](NativePopover.md), which is what the
native chat's `+` opens.

## `inputView` is the responder's own

`UIResponder.inputView` is UIKit's primitive for "show this instead of a
keyboard", and using it hands the system four things:

- the transition in and out
- the height and where the panel sits
- the safe area beneath it
- what happens when the field is dismissed

A panel positioned over the keyboard would have to imitate all four.

## Props

| Prop      | Type    | Default |                          |
| --------- | ------- | ------- | ------------------------ |
| `visible` | boolean | `false` | Whether the panel is up. |

Give it a `height`. UIKit reads an input view's size and gives it exactly that
much of the screen, the same way it does for a keyboard.

## It cannot use `-apple-visual-effect`

A `UIVisualEffectView` samples what is behind it **within its own window**, and
the panel is in the keyboard's window with nothing behind it — so a material
there blurs nothing and renders as nothing. Use a colour:
`secondarySystemGroupedBackground` is the closest thing to the near-white the
native chat shows, and it follows the appearance.

## It works with the keyboard down

Tapping `+` when nothing is focused still opens the panel: it is raised exactly
as focusing a field raises a keyboard — the element becomes the first responder
itself when nothing else is one — so a button that opens it never silently does
nothing.

## Accessory or panel, or both

|                                                            |                              |
| ---------------------------------------------------------- | ---------------------------- |
| [`<native:keyboardaccessory>`](NativeKeyboardAccessory.md) | rides **above** the keyboard |
| `<native:keyboardpanel>`                                   | stands **in for** it         |
| [`<native:popover>`](NativePopover.md)                     | a card **over** it           |

Two different slots on the same responder. A composer usually wants the
accessory; a `+` button wants the popover; a chat wants both, which is what the
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
