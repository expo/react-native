# The peek, and the menu that rides on it

A hold can be the platform's own — the lift, the blur behind it, the menu and
the dismissal — rather than a drawing of one. Two props say so:

```jsx
<div
  wantsContextMenu={true}
  onCommand={event => apply(event.nativeEvent.id)}>
  <menu>
    <menu>
      <li id="love" icon="system:heart">Loved</li>
      <li id="like" icon="system:hand.thumbsup">Liked</li>
      <li id="dislike" icon="system:hand.thumbsdown">Disliked</li>
    </menu>
    <li id="copy">Copy</li>
    <li id="delete" destructive={true}>Delete</li>
  </menu>
  …the box's own content…
</div>
```

## The box holds it, the surface shapes it

The props are on the BOX — the thing that receives the touch, and the thing the
lift has to carry, because a lift of a balloon's surface alone would leave the
words behind. What a surface contributes is the SHAPE: a preview is a rounded
rectangle unless it is given a path, so `<native:chatbubble>` hands its own
outline, tail included, up to its box, and the box gives it to UIKit when the
lift begins. Computed when UIKit asks rather than stored, because a send
animation resizes the balloon every frame and a reveal drag slides the column.

**One thing to know if a peek ever stops firing.** A node that forms a view
without forming a STACKING CONTEXT gets a view of its own and its children are
mounted into the nearest stacking context above it — so the box is real, holds
the prop, installs the interaction, and is CHILDLESS, with nothing inside it to
touch. That is what `wantsContextMenu` setting only `formsView` cost, and the
symptom is silence rather than an error: UIKit simply never asks for a
configuration. It is visible in the ancestor chain under the finger, where the
box that wanted the peek is a sibling of the content rather than its parent.

## What each half does

**`wantsContextMenu`** installs a `UIContextMenuInteraction` on iOS and makes the
box track Android's own long press. Either way the hold duration, the movement
slop, the scroll-cancels-the-hold rule and the haptic are the system's; on iOS
the lift and the blur are too. Without the prop the element still publishes
`contextmenu` from a timer of its own on iOS, which is enough for an app that
only wants to know.

**`contextmenu` fires only when nothing is presenting.** A box with a `<menu>`
gets the platform's menu, and that IS the event happening — an app told about it
as well draws its own picker over the platform's, which is exactly what it did.
A box with no menu gets the lift alone, and then the app is the only thing that
can say what a hold means.

**`<menu>`** is what the peek presents. It is HTML's list of commands, read out
of the tree and handed to the platform exactly as `<button>`'s is — same helper,
same shape, same `onCommand` event. What differs between the two elements is only
who opens the list: a button on a tap, a box on the hold.

A box with no `<menu>` gets the **lift alone**, which is what a peek was before
there was any way to say otherwise.

## The icon, and the group that decides the shape

A command's `icon` is an image SOURCE, the same `system:<symbol>` scheme `<img>`
takes — so a menu and a picture say where a symbol comes from the same way.

A `<menu>` nested inside the `<menu>` is a GROUP, which is what nesting already
means. Each group is drawn as one inline section, and **a group whose commands
all carry an icon is presented at `UIMenuElementSizeSmall`** — UIKit's compact
row of glyphs. Write both a glyph and a word: the row draws the glyph and
VoiceOver reads the word.

**A compact row holds four.** A group of six came out as a row of four with the
other two as ordinary rows underneath; two groups of three come out as a tidy
three-by-two. So the number per row is the author's, expressed the only way the
platform will honour — by grouping. See
`DOM-CSS-LIMITATION(compact-menu-row-holds-four)`.

The row is asked for by the GROUP and never inferred from the commands, which
was the first rule here and was wrong twice over. `preferredElementSize` is a
property of a menu and says nothing about its children's titles — Apple's own
compact rows give each action both a title and an image — and inferring the row
from icon-only commands would have made an author drop the labels to get it,
which is a row of reactions nothing can name.

Only the `system:` scheme resolves here, and deliberately: the menu is built
while UIKit is asking for it, so there is no moment to load anything
asynchronously. Any other source returns no image and the command draws without
a glyph rather than delaying the menu.

## Why not draw it

Because the parts that are hard to see are the parts that are hard to copy. A
hand-drawn picker has to reproduce the lift's timing, the platter's material, the
way a menu re-anchors when the content scrolls under it, the dismissal, and the
window level all of it lives at — and each of those is a measurement that goes
stale with the next OS. The demo's own reaction picker did reproduce them, and
this exists so it does not have to.

The one thing an app still owns is the SHAPE of the lift: a preview is a rounded
rectangle unless it is given a path, so a balloon lifted without one grows a
tail-less square out of a shape that has a tail. `<native:chatbubble>` passes its
own path for that reason — computed when UIKit asks rather than stored, because
a send animation resizes the balloon every frame and a reveal drag slides the
whole column.

## Known gaps

- **The LIFT is iOS only.** The hold and the menu are on both platforms — a
  `UIContextMenuInteraction` here, Android's own long press and a `PopupMenu`
  there — but Android has no counterpart to raising the element out of the page
  and blurring what is behind it, so a balloon there is not lifted. See
  `DOM-CSS-LIMITATION(ios-only-contextmenu)`.
- **Android's menu has no icons and no groups.** `PopupMenu` takes a title and an
  enabled flag; `icon` and the nested-`<menu>` grouping are read and dropped, and
  `destructive` becomes the theme's `colorError` rather than an attribute.
- **No submenus.** A `<menu>` inside a `<menu>` is a GROUP — an inline section —
  and never a submenu the reader has to open. Nothing spells a real submenu.
- **A compact row holds four.** The native chat fits six reactions because its row
  is a
  private `_UIContextMenuAccessoryView` hung above the platter rather than part
  of the menu, and there is no public API for that.
- **A hold cannot be taken back.** UIKit asks for the configuration about eighty
  milliseconds before an enclosing scroll view's pan reaches `Began`, so
  "cancel the peek when the list starts scrolling" is not implementable from the
  element — and does not need to be, because a finger that begins a scroll is
  moving before the half second is up and UIKit's own recogniser fails. See
  `DOM-CSS-LIMITATION(peek-outruns-the-scroll)`.
