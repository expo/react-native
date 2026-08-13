# Platform fidelity: what "no compromise" actually costs

The bar is the platform's own UX — real controls, real gesture recognizers, real
animations — reached through HTML APIs. This document is what the codebase says
about that bar today: four findings, each checked in the source rather than
reasoned about, and what they imply for the element plan.

The short version: **one of the four is already solved, one is a missing CSS
property, one is a hardcoded line in the ScrollView, and one is an architectural
move the fork has already made once for a different feature.**

---

## Finding 1 — a real platform control keeps its platform behaviour. This part works.

`RCTSwitchComponentView` is not an imitation of a switch. It owns a `UISwitch`
and wires it up the way any UIKit app would:

```objc
_switchView = [[UISwitch alloc] initWithFrame:self.bounds];
[_switchView addTarget:self action:@selector(onChange:)
      forControlEvents:UIControlEventValueChanged];
```

That means the thumb animation, the pan-to-toggle recogniser, the haptic on
change and the accessibility element are all the platform's — the comment in the
file says so explicitly: _"UISwitch is the accessibility element not this
view."_

**So the no-compromise path for controls is not "make our box feel native". It
is "be the control."** Nothing in the renderer stands between a mounted native
control and its own gesture recognisers. This is the finding that makes the rest
of the plan viable, and it is worth stating because the obvious worry — that
RN's touch system would fight the control — does not materialise for a control
that handles its own touches.

The corollary matters for the element catalog: every element in the plan that
maps to a real control (`<input type=checkbox|date|range|color|file>`,
`<select>`, `<video>`, `<audio>`, `<progress>`) gets native fidelity **for
free**, and gets it precisely by _not_ being styleable in the ways an author
might expect. Which leads directly to the next finding.

---

## Finding 2 — CSS already has the property that decides this, and we do not support it

There is a real tension between "the platform draws it" and "the author styles
it", and it cannot be resolved per-element by fiat: a design system will want a
checkbox in its own colours, and an iOS app will want the real switch. The web
settled this years ago with **`appearance`**:

- `appearance: auto` — the platform's control, drawn by the platform.
- `appearance: none` — strip the native rendering so author styles apply.

This is exactly the switch our catalog needs, it is already the vocabulary web
authors know, and **it is entirely absent here**: `appearance` is not in
`ReactNativeStyleAttributes`, not in `StyleSheetTypes`, and the StyleX runtime
lists it in `DROPPED_PREFIXES` and discards it.

**Recommendation: implement `appearance` as the native/styled selector.** It
gives every form element one honest answer to "can I style this?" — yes, if you
opt out of the native control and accept that you are now drawing it yourself.
That is the same bargain the web makes, and it means the catalog never has to
choose on the author's behalf.

It also gives `resolveUIViewClassName` a second input beyond `type`: an
`<input type="checkbox">` resolves to the native switch under `appearance: auto`
and to a styleable box under `appearance: none` — per instance, from props,
using machinery that already exists.

---

## Finding 3 — RN turns off iOS's scroll-touch disambiguation, globally and unconditionally

`RCTScrollViewComponentView` contains, with no prop and no flag:

```objc
_scrollView.delaysContentTouches = NO;
```

UIKit's default is `YES`, and the reason is UX: it delays touch-down feedback by
roughly 150ms so a scroll that _begins_ on a control does not flash it. With it
off, every control inside a scroll view lights up the instant a finger lands,
including when that finger was starting a scroll.

The fork has already fixed the _other_ half of this — a scroll now cancels
in-flight pointers, so the press state clears. But clearing a highlight that
should never have appeared is not the same as the platform's behaviour, and on a
list of pressable rows the difference is visible.

**Noted, not proposed.** Making it configurable is one line plus a prop, but it
is a change to shared React Native code affecting every app, and the work here
is scoped to the new elements. It is written down because it explains why a
pressable inside a scroll view behaves the way it does, and because a gesture
arena — see the revision below — removes the need for the flag rather than
tuning it. Android's `ViewConfiguration` tap-timeout is the corresponding knob
if this is ever revisited.

---

## Finding 4 — `:hover` and `:active` are matched in JavaScript, so press feedback is a round trip

This is the deepest one, and it applies to everything `appearance: none` — every
author-styled control, which is most of a design system.

The fork's CSS stylesheet engine — `parse.js`, `match.js`, the Metro transformer
— is **entirely JavaScript**. So the sequence when a finger lands on a styled
button is:

> native touch → pointer event to JS → selector re-match → new computed style →
> commit → native style applied

The transition between the two states then animates natively and off-thread,
which is why it looks smooth once it starts. But the _trigger_ crosses to JS and
back. Under load — a list scrolling, a JS-side render in flight — the highlight
arrives late, and lateness in touch feedback is the single most legible
difference between a native app and one that is not. A browser evaluates
`:active` natively. UIKit sets `highlighted` on the main thread.

**Recommendation: evaluate interaction pseudo-classes in the renderer, not in
JS.** The renderer already dispatches the pointer events, so it already knows
the state; what it lacks is the rule matching.

This is not a speculative architecture. **The fork has already made exactly this
move once**: CSS transitions and animations were moved into the renderer and off
the JS thread, for precisely this reason, and that work is already landed and
verified on both platforms. Interaction state is the same shape of problem with
the same solution, and the animation half of it is already sitting in C++
waiting to be driven from there.

Scope it tightly: `:hover`, `:active`, `:focus`, `:focus-visible`, and
`:disabled` — the state pseudo-classes, matched against a single element, no
combinators, no structural selectors. That is enough for every control in the
plan and avoids porting a selector engine.

---

## Revision — the gesture half, and why Reanimated's model is not the one to copy

The four findings above were written before taking seriously that **React
Native's own views are not the reference for best practice** — the ecosystem's
answer is React Native Gesture Handler and Reanimated. That is right, and it
sharpens two of the findings and corrects a third.

### The fork already has Reanimated's half, and arguably a better version of it

Reanimated exists to get reactions off the JS thread: it runs a second JS
runtime on the UI thread so a worklet can respond to a gesture without a round
trip. That is the right goal, and the fork already reaches it for style — but
declaratively and without a second runtime. `CSSTransitions.h` says so directly:

> `// callback (the UI thread); every access is guarded.`

CSS transitions and animations are evaluated in C++ on the UI thread, driven by
the animation choreographer's frame callback. So for the specific job of "a
gesture changes an element's style and the change animates", the fork does not
need worklets: it needs the _state_ change to happen where the animation already
lives. That is Finding 4, and it stands — but the reason is stronger than
originally stated. It is not "move it to C++ because C++ is fast". It is that
**the destination already exists and already runs on the UI thread**; only the
trigger is on the wrong side.

Reanimated remains the right tool for reactions that are genuinely arbitrary
JavaScript. Declarative style state is not that, and should not pay for a
runtime it does not need.

### The gesture half is the real gap, and RNGH's model is the one to adopt

Hit-testing is already native — `PointerEventsProcessor` resolves a target in
C++. What is not native is everything after: the handler is JS, and arbitration
between a press and a scroll goes through RN's responder system rather than a
gesture arena of native recognisers that can compose (simultaneous, exclusive,
require-failure).

That is exactly what RNGH provides, and it is the piece the catalog should be
built on. A control whose press state is decided by a native recogniser, in an
arena the scroll view also participates in, gets the platform's disambiguation
by construction.

### Which corrects Finding 3

Exposing `delaysContentTouches` was treating a symptom. The reason a control
inside RN's ScrollView flashes on touch-down is that there is no arena deciding
between the scroll and the control — the flag is UIKit's built-in stand-in for
one, and RN switched it off. **With a real gesture arena the flag stops
mattering**, because the disambiguation is the arena's job. Keep the one-line
fix as a stopgap if it helps sooner, but it is not the answer.

### The finding that ties it together: `touch-action`

Here is the part worth the most attention. The web already has the declarative
vocabulary for gesture arbitration, and it is a CSS property:

```css
touch-action: auto | none | pan-x | pan-y | manipulation;
```

`touch-action` is how a browser element declares _"this gesture is mine, not the
scroller's"_ — which is precisely what RNGH expresses imperatively with
`simultaneousWithExternalGesture` and `requireExternalGestureToFail`. **It is
the HTML API for the gesture arena.** And like `appearance`, it is entirely
absent here: not a style attribute, not known to the renderer.

So the choice framed as "HTML APIs _or_ the RNGH approach" is a false one. The
three things platform fidelity needs each already have a web-standard spelling:

| what it decides                         | web vocabulary                | status today                     |
| --------------------------------------- | ----------------------------- | -------------------------------- |
| platform control vs author-styled       | `appearance`                  | absent, and StyleX drops it      |
| who wins a gesture: element or scroller | `touch-action`                | absent                           |
| press/hover/focus feedback              | `:active`, `:hover`, `:focus` | matched in JS, off the UI thread |

Implementing those three _is_ adopting RNGH and Reanimated's approach, expressed
in the API surface we already want authors to write. The imperative libraries
become the reference for the model and the arbitration semantics, not
necessarily a dependency.

### RN's components are not candidates at all

The premise that RN's views are not best practice cuts further than the
ScrollView, and the conclusion is stronger than "prefer something else where it
matters". **No element in this catalog should be backed by a React Native
component from main.** Not `Picker` for `<select>`, not `Slider` for
`<input type=range>`, not `Switch`, and not RN's `Animated` for anything. They
are the fallback that made mobile React feel non-native in the first place, and
adopting them here would bake that into the element vocabulary permanently.

The backing is **Expo UI** — real SwiftUI on iOS and Jetpack Compose on Android
— falling through to a direct native view of our own where Expo UI has no
component. See the mapping below.

## Expo UI is the backing, and it resolves the host-context question

Expo UI's universal layer (SDK 56+) renders real SwiftUI on iOS and Jetpack
Compose on Android from one tree. Its component list covers most of the
catalog's outstanding controls almost exactly:

| HTML                                                  | Expo UI (universal) | note                                 |
| ----------------------------------------------------- | ------------------- | ------------------------------------ |
| `<button>`, `<input type=button\|submit\|reset>`      | `Button`            |                                      |
| `<input type=checkbox>`                               | `Checkbox`          | a checkbox, not a switch — see below |
| `<input type=range>`                                  | `Slider`            |                                      |
| `<input type=text\|password\|email\|…>`, `<textarea>` | `TextInput`         | see the controlled-input note        |
| `<select>`, `<option>`                                | `Picker`            |                                      |
| `<details>` / `<summary>`                             | `Collapsible`       |                                      |
| `<dialog>` (sheet presentation)                       | `BottomSheet`       |                                      |
| `<fieldset>`                                          | `FieldGroup`        |                                      |
| `<native:switch>`                                     | `Switch`            |                                      |
| scroll containers                                     | `ScrollView`        | not RN's                             |

### Three backings, not two — the community components need no `Host`

Expo UI also ships **drop-in replacements** under `@expo/ui/community/*`, which
are API-compatible with the popular React Native community libraries and are
powered by the same native Compose/SwiftUI implementations — but are used as
ordinary React Native components, with **no `Host` wrapper**. That matters here,
because it means a control element does not have to be inside an Expo UI tree to
be native:

| HTML                                      | community component                    |
| ----------------------------------------- | -------------------------------------- |
| `<select>`, `<option>`                    | `@expo/ui/community/picker`            |
| `<input type=range>`                      | `@expo/ui/community/slider`            |
| `<input type=date\|time\|datetime-local>` | `@expo/ui/community/datetime-picker`   |
| `<dialog>` (sheet)                        | `@expo/ui/community/bottom-sheet`      |
| `<native:segmented-control>`              | `@expo/ui/community/segmented-control` |
| `<native:menu>`                           | `@expo/ui/community/menu`              |
| `<native:pager>`                          | `@expo/ui/community/pager-view`        |

So resolution has **three** tiers, in order:

1. **inside a `Host`** → the universal Expo UI component, as a member of the
   SwiftUI/Compose tree;
2. **outside a `Host`, Expo UI installed** → the `@expo/ui/community/*`
   component — still native, no host boundary required;
3. **Expo UI absent, or `appearance: none`** → the author-styled element-box.

Tier 2 is what makes the catalog useful in an ordinary React Native screen that
is not built out of Expo UI trees, which is most screens. It is also why the
host-context work is not a prerequisite for shipping native controls: without it
every control still lands on tier 2 rather than falling all the way to tier 3.

Two things follow immediately.

**`<input type=checkbox>` should be `Checkbox`, not `Switch`.** An earlier draft
of the plan mapped it to `UISwitch` because that is the familiar iOS control.
Expo UI ships both, so the faithful mapping is available: a checkbox is a
checkbox, and `<native:switch>` is how an author asks for the switch. This is
the `<native:*>` rule from the plan doing real work rather than being
hypothetical.

**Do not map `<ul>`/`<li>` onto `List`.** Expo UI's own guidance is that `List`
is unsuitable for large lists, because each `ListItem` is a JSX node processed
on the JS thread. `<ul>` is a markup element with no size bound and must stay a
block container; `List` is a candidate only for an explicitly native
settings-style grouping, and that is better spelled as a `<native:*>` element
where the constraint is visible at the call site.

### `Host` is the host-context boundary the plan was looking for

The plan's open question was whether "am I inside SwiftUI?" is a JS fact or a
native one, and it leaned toward needing a change to React's reconciler to carry
a host kind. Expo UI answers it: **every Expo UI tree is wrapped in `Host`**,
and `RNHostView` embeds React Native content back inside a SwiftUI tree. The
boundary is already _declared_, as a component, in both directions.

That means host context can propagate as ordinary **React context** from `Host`,
with no reconciler change at all. The objection in the plan — that
`resolveUIViewClassName(props)` cannot see React context — only applies to
elements resolved purely through a view config. The control elements are
composites already (`<input>`, `<textarea>` and `<dialog>` are composites in the
existing prototypes), and a composite can read context and choose its backing
before the host element is created.

So the design collapses to something much cheaper than option (A) or (B):

- inside a `Host`, `<button>` renders Expo UI's `Button`;
- outside one, it renders the element-box backing;
- an HTML subtree inside a SwiftUI tree goes through `RNHostView`.

The reconciler change stops being a prerequisite, and with the work scoped to
the new elements it is not on the table at all: it would change React itself.
The markup elements, which have no composite to read context in, simply do not
get host-context resolution — an honest limitation, and a far smaller one than
patching React to remove it.

### Which CSS applies to a natively-backed element

A native-backed element is still a box in the layout tree, so the honest answer
is _some_ styles apply and it splits cleanly along one line: **Yoga owns the
box, the platform owns the control.**

| CSS                                                               | applies?                           | why                                                                                                     |
| ----------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `width`, `height`, `min/max-*`, `aspect-ratio`                    | **yes**                            | Yoga sizes the box the control is drawn into                                                            |
| `margin`, `padding`, `border-width`                               | **yes**                            | box metrics, resolved before the control sees its bounds                                                |
| `display`, `position`, `top/left/…`, `z-index`                    | **yes**                            | participation in flow and stacking is the box's, not the control's                                      |
| flex and grid properties, `gap`                                   | **yes**                            | the element is a normal flex/grid item                                                                  |
| `opacity`, `transform`                                            | **yes**                            | applied to the host view's layer, above the control                                                     |
| `background-color`, `border-color`, `border-radius`, `box-shadow` | **paints, but not on the control** | these paint the host view _behind and around_ the control; a SwiftUI `Button` still draws itself on top |
| `color`, `font-*`, `letter-spacing`, `text-align`                 | **no**                             | the control renders its own text with the platform's typography                                         |
| `appearance: none`                                                | **switches tiers**                 | opts out of the control entirely, at which point everything above applies normally                      |

The row that surprises people is the paint row: setting `background-color` on an
`<input type=checkbox>` is not an error and not a no-op — it colours a box the
control sits on top of, which usually looks like nothing happened. That is worth
documenting per element rather than leaving authors to discover it.

**A curated subset could be translated rather than dropped.** Expo UI exposes
SwiftUI modifiers (`@expo/ui/swift-ui/modifiers`), so properties with a direct
modifier counterpart — padding, corner radius, opacity, shadow, tint — could be
mapped through instead of painting behind. That is a real opportunity and also a
trap: a partial mapping that silently covers five properties and ignores the
rest is harder to reason about than a clear line. If we do it, the mapped set
must be enumerated in this table, and everything outside it must keep behaving
as the table says.

The general rule to state in the README, and the one authors need in one
sentence: **layout is yours, appearance is the platform's, and
`appearance: none` is how you take appearance back.**

### The controlled-input trap, which is the one thing to get right

Expo UI's `TextInput` does not take a string. Its `value` is an
`ObservableState` from `useNativeState`, and `onChangeText` runs **as a worklet
on the UI thread**, writing the value with no React render cycle. That is
exactly the property this document has been arguing for, and it is easy to
destroy by accident.

HTML's `<input value onChange>` is the React _controlled_ pattern: every
keystroke round-trips through React state and re-renders. A naive `<input>`
wrapper that accepts `value` and `onChange` and forwards them to Expo UI's
`TextInput` **reintroduces precisely the JS round trip Expo UI removed**, and
the element would feel worse than the component it wraps.

The way out is that HTML agrees with Expo UI here, and React is the odd one out.
**The DOM's own input model is uncontrolled**: the element owns its value, and
`value` is an initial-value attribute. Controlled inputs are a React invention
layered on top. So:

- `<input>` should be **uncontrolled by default**, holding its value in
  `useNativeState` and staying on the UI thread;
- `onChange` fires as a worklet, with an optional JS-thread callback for authors
  who genuinely need it;
- a `value` prop that changes from outside sets the observable, rather than
  making every keystroke a React render.

This is both more faithful to HTML and the only version that keeps the
platform's responsiveness. It is worth stating loudly because the obvious
implementation is the wrong one.

### Dependencies this commits us to

`@expo/ui` universal requires **SDK 56+**, and the UI-thread state path requires
**`react-native-worklets`**. Neither is a hard requirement: the dependency is
**conditional**, resolved the way `<img>` already resolves `ExpoImage` — looked
up at first render, used when present, fallen back on when absent.

That gives every control element two backings rather than one:

- **Expo UI present** → the real SwiftUI/Compose control, with the platform's
  own gestures, animation and accessibility.
- **Expo UI absent** → the author-styled element-box path.

And the fallback is not a separate code path to design, because **it is the same
path `appearance: none` already needs**. An author who opts out of the native
control and an app that has not installed Expo UI want exactly the same thing: a
styled box whose interaction feedback still has to feel native. That is a useful
coincidence — it means the work in Findings 2 and 4 is not overhead paid for
degradation, it is the same work serving two purposes, and it gets exercised by
every app rather than only the ones missing a dependency.

So the package keeps its shape: the markup catalog depends on nothing, the
control elements prefer Expo UI and degrade honestly, and no app is required to
install the SDK to get HTML elements that work.

One caveat on this whole section: `@expo/ui` is not installed in this
repository, so the component list and prop shapes above come from its
documentation rather than from reading the installed types. Expo UI is versioned
with the SDK and its API moves; confirm against the installed package's `.d.ts`
before implementing any of it.

---

## What this changes about the element plan

The plan's phases stand, but two things move and one is added.

**`appearance` becomes a prerequisite, not a nicety.** It is what lets the
catalog offer both native controls and styleable ones without choosing for the
author, and it feeds the resolver that Phase 4 depends on. It belongs with the
host-context spike in Phase 3, since both are inputs to the same resolution.

**Native interaction-state matching becomes its own phase, before the styled
controls.** Shipping `appearance: none` controls on top of JS-matched `:active`
means shipping the compromise into every design system that uses them, and
retrofitting later means re-testing every control. The animation infrastructure
it needs already exists.

**`delaysContentTouches` is out of scope.** It is a one-line change to React
Native's shared `ScrollView`, and it would alter touch behaviour for every
pressable in every app — not just this catalog's elements. The change here stays
inside the new elements. Recorded because it is a real deviation from UIKit's
default and worth knowing about; not proposed, because the blast radius is the
whole framework and the gesture arena makes it moot anyway.

Revised ordering:

1. Free elements (`<output>`, `<input type=hidden>`, `<progress>`, `<meter>`,
   `<fieldset>`, `<form>`) — unchanged, no fidelity questions.
2. Promote the proven prototypes — unchanged.
3. **`appearance`** and **`touch-action`** — the two declarations the element
   resolver and the gesture arena need. The host-context spike is no longer part
   of this: Expo UI's `Host` already declares the boundary, so context comes
   from React rather than the reconciler.
4. **Native interaction-state matching** in the renderer, on top of a **native
   gesture arena** modelled on RNGH rather than RN's responder system. This
   matters for `appearance: none` elements; anything backed by Expo UI gets the
   platform's interaction behaviour from the platform.
5. Platform controls and `<native:*>`, backed by **Expo UI** — now with both
   inputs settled, and starting with the uncontrolled `<input>` so the UI-thread
   text path is right before anything depends on it.
6. Media elements — independent, parallelisable throughout.

The one-line summary for anyone joining: _native controls already behave
natively, and the fork's CSS engine already runs on the UI thread — so the work
is not making boxes feel native, it is giving authors the three web-standard
declarations that decide platform behaviour (`appearance`, `touch-action`, and
natively-evaluated `:active`), and putting a native gesture arena underneath
them._
