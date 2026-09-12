# `<native:menubutton>`

A button whose action is to open a menu, built entirely out of the platform's
own pieces.

```jsx
<native:menubutton
  title="+"
  style={{width: 40, height: 40}}
  commands={[
    {id: 'photo', label: 'Photos'},
    {id: 'clear', label: 'Clear', destructive: true},
  ]}
  onCommand={id => run(id)}
/>
```

| Prop | Meaning |
| --- | --- |
| `title` | The label. Goes into the button's *configuration*, not its children. |
| `systemImage` | An SF Symbol name, used instead of `title` when both are given. |
| `prominent` | The platform's filled/tinted glass rather than the plain one. |
| `commands` | `{id, label, disabled?, destructive?}[]`, in order. |
| `onCommand` | `({id}) => …`, the command's `id` rather than its index. |

iOS only. See `DOM-CSS-LIMITATION(ios-only-menu-button)`.

## What it is for

It was built as the **control group** for `<button>` with a `<menu>` child:
everything about it is the platform's, so that anything the HTML route gets
wrong shows up as a difference against it. It turned out the two agree, and the
comparison is worth keeping — the demo's composer switches between them with one
constant (`PLUS_KIND` in `packages/chat-demo/Composer.js`).

Prefer `<button>` + `<menu>`. It says the same thing in HTML's own words, it
carries the semantics (a button with a list of commands), and it works on both
platforms — a `UIMenu` on iOS, a `PopupMenu` on Android, both verified on a
running device. Reach for this element
when you want the platform's control and nothing of your own: the title inside
the chrome rather than as a child, and the button's own touch tracking rather
than the element's.

## The label goes in the configuration

`title` is not drawn as a child, and that is the point of the element. A glass
button draws its label *inside* its chrome — below the material and above the
refraction. A label supplied as a subview sits on top of the glass instead of in
it, and reads as a sticker on a button rather than as the button's own text.

## The menu and the keyboard

A menu presented by UIKit is drawn in a `UITextEffectsWindow` — measured at
window **level 1**, against the app's own window at level 0. That is what makes
the lift read as the button rising off the screen.

An accessory's window is `UIRemoteKeyboardWindow`, measured at level
**10000001**. Two things follow, and both are handled here rather than left to
the caller:

- **A menu does not cover the keys.** UIKit draws it in a `UITextEffectsWindow`
  at level 1 and places it in the space above them. That is UIKit's choice
  rather than a wall: a view added to `UIRemoteKeyboardWindow` itself *does*
  cover the keys, which is how `<native:keyboardpanel>`'s overlay works. A menu
  is not yours to reposition, so if you need the keyboard's space, use a panel.
  See `DOM-CSS-LIMITATION(overlay-cannot-cover-the-keys)`.
- **The lift would take the button with it.** Presenting from the real button
  inside an accessory lifts it into a window *below* the bar it came from: the
  button disappears for as long as the menu is up, and its glass does not come
  back afterwards. So in a window above the lift's, the menu is presented from an
  invisible anchor and opened by the real button's own `touchUpInside` through
  `performPrimaryAction` — the touch stays on the real button, which is where the
  glass press comes from, and the thing UIKit takes away is empty.

`MenuCheck` in the demo's UI tests holds the second of those, by sampling the
button's pixels while its menu is open. It has to be a pixel test: through the
whole fault `hidden` was 0, `alpha` and `layer.opacity` were 1, the configuration
was set, and the button was in its superview at the right index.

## See also

- [`<native:keyboardaccessory>`](NativeKeyboardAccessory.md) — the bar this is
  usually in
- [`<native:keyboardpanel>`](NativeKeyboardPanel.md) — a card in place of the
  keyboard, for what a menu is too small to hold
