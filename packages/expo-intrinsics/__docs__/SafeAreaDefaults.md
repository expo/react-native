# Why a bar at the bottom of a screen ends up under the home indicator

A real bug, reported on the demo's virtualized screen: two buttons in a row at
the bottom, drawn straight over the home indicator. The fix is one wrapper. The
question worth answering is why the wrapper was needed at all, because the same
omission is available on every screen anyone writes.

## What each edge currently does

| | reserves the safe area | how to opt out |
|---|---|---|
| `<native:scroll>` | **yes**, per edge | `automaticInsets={{bottom: false}}` |
| `<native:keyboardaccessory>` | **yes**, the bottom strip the keys do not cover | `automaticInsets={false}` |
| `<native:safearea>` | **yes**, that is what it is | `edges={{…: false}}` |
| everything else — `<div>`, `<button>`, a flex column | **no** | — |

So the safe area is **opt-in everywhere except the three elements whose whole
job is the platform's furniture.** A `<div>` at the bottom of a screen is
exactly as tall as its content and sits wherever the layout puts it, which on a
full-bleed screen is under the indicator.

That is a defensible position — it is CSS's — but it is not the position the
platforms take, and the difference is what makes the mistake easy.

## What the platforms do

**SwiftUI insets by default.** A `VStack` at the bottom of a screen is above the
home indicator without the author doing anything; `.ignoresSafeArea()` is how you
ask for the other thing. The default is safe and the opt-out is a word.

**UIKit does not, and gives you a guide.** A view controller's view fills the
window and `safeAreaLayoutGuide` is what you pin to. The default is unsafe and
the opt-in is a constraint — which is why every UIKit app has the same four
constraints in it.

**The web does — through the VIEWPORT, which is the part usually missed.** The
default is `viewport-fit=auto`: the viewport is the safe area, `env(safe-area-inset-*)`
all resolve to **zero**, and there is nothing to remember. `viewport-fit=cover`
is how a page opts INTO drawing under the notch, and only then do those `env()`
values become non-zero and only then does the author owe padding.

So two of the three make the safe default free, and the web does it by moving
the VIEWPORT rather than by insetting each box.

## Why ours is the third

Because the surface is the window. A React Native surface is laid out against
the window's full size, `env()` reports the real insets from the first layout
pass, and every element lays out in that space. Nothing between the window and
the author's boxes has an opinion.

That was the right call for the elements that DO reserve — a scroll view has to
reserve as content inset rather than as padding, or its rows stop at the
indicator instead of scrolling under it, and no padded box can express that. But
it leaves everything else with an opt-in.

## What would change it

**The web's answer, ported: inset the SURFACE and let an element opt out.** The
surface's layout constraints would come in already reduced by the safe area, and
`env(safe-area-inset-*)` would resolve to zero — exactly `viewport-fit=auto`. An
element that wants the whole window says so, and its `env()`s light up. This is
the smallest change conceptually and the largest in blast radius: every existing
screen gains padding it did not have, including ones that deliberately run
edge-to-edge and compensate today.

**A user-agent style on whatever means "a screen".** Cheaper and narrower: if a
screen root were an element rather than a `<div>`, the UA sheet could carry
`padding: env(safe-area-inset-*)` and an author's own `padding` would override it
by the ordinary cascade. That is how `<native:scroll>`'s `overflow: hidden` and
`flex-grow: 1` already arrive. It needs an element that means "screen", which
the navigator has and the demo's plain `<div>` roots do not.

**Leave it opt-in and make the opt-in visible.** What is done today. The cost is
exactly the bug that prompted this: it is invisible on a simulator with no
indicator, invisible in a screenshot cropped above it, and obvious on a phone.

## The rule until then

**Anything drawn against a screen edge that is not a `<native:scroll>` needs a
`<native:safearea>`.** Scroll views are the exception because they reserve as
inset, and wrapping one is actively wrong — see the note on `NativeSafeArea`.

## And the opposite case, which the same vocabulary covers

An element that reserves can be told not to, and that is not the same request as
"ignore the safe area". The native composer sits **28** points off the bottom of
the screen against a safe area of **34** — it overlaps the top of the strip
deliberately, because 28 is concentric with the display's corner. No padding
expresses that while the element is also reserving, because the two ADD: the only
way to land on a number smaller than the safe area is to own the whole strip and
pay part of it.

So `automaticInsets={false}` means "I will pay for that edge", not "there is
nothing there". The element goes on measuring it — `<native:keyboardaccessory>`
still publishes the strip through `onDockChange` — because an author who owns an
edge needs its size more than one who does not.
