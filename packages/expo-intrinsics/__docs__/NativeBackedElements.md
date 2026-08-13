# The native-backed elements: a plan

The markup elements are done — a tag, a UA style, a display, and one of two
generic backings. The ones left are different in kind: `<input>`, `<textarea>`,
`<select>`, `<video>`, `<audio>`, `<canvas>`, `<iframe>`, `<details>`,
`<dialog>` and friends should be **the platform's own control**, not a styled
`<div>`. That pulls in three questions the catalog has not had to answer before:

1. `<input>` is one tag standing for ~22 different controls. Does it stay one
   element, or do we also expose `<native:switch>`, `<native:calendar>` and the
   rest?
2. A `<button>` inside a SwiftUI hierarchy should be a SwiftUI button, and
   inside Jetpack Compose a Compose button. How does an element know?
3. These controls come from Expo UI and the wider Expo SDK, so the catalog
   acquires a real runtime dependency for part of its surface.

This plan answers each, then sequences the work.

> **Read [`PlatformFidelity.md`](PlatformFidelity.md) alongside this.** It
> checks the "no compromise on native UX" bar against the codebase and revises
> the sequencing below: `appearance` becomes a prerequisite, and evaluating the
> interaction pseudo-classes in the renderer becomes its own phase ahead of the
> styled controls.

---

## 1. What already exists, so we build on it rather than beside it

Four pieces of machinery are already in place, and the plan leans on all four.

**Per-instance component resolution.** A view config may carry
`resolveUIViewClassName(props)`, consulted where `createNode` is called, so
**one JSX tag can be backed by different native components per instance**. This
is how `<span>` becomes `element-box` when its display establishes a formatting
context and stays text-backed otherwise. It is also, unmodified, the mechanism
that lets `<input type="checkbox">` and `<input type="date">` be different
native components.

**Lazy, provider-supplied view configs.** `<img>` resolves its config at first
render and points at `ExpoImage` when the Expo runtime supplies one, falling
back when it does not:

```js
const expoViewConfig = globalThis.expo?.getViewConfig?.('ExpoImage');
```

Every native-backed element below follows that shape. It is proven end to end.

**Namespaced intrinsics.** `<native:*>` tags mapping to an existing native
component were proven in an earlier spike — an external module registered
`native:switch` onto `UISwitch` with no C++ at all. Two build details are
required and known: Babel needs `throwIfNamespace: false`, and Metro needs a
source-map fix for namespaced JSX names.

**React's host context.** This is the one most likely to be overlooked, so it
gets its own section below — the reconciler already implements it.

---

## 2. `<input>`: keep the tag, and add `<native:*>` alongside it

### The problem

HTML's `<input>` is a single tag whose `type` attribute selects among roughly
twenty-two controls that share almost nothing: `text`, `password`, `email`,
`number`, `tel`, `url`, `search`, `date`, `time`, `datetime-local`, `month`,
`week`, `color`, `range`, `checkbox`, `radio`, `file`, `submit`, `reset`,
`button`, `image`, `hidden`. A checkbox and a date picker are not variations of
one widget; on iOS they are `UISwitch` and `UIDatePicker`, and in SwiftUI
`Toggle` and `DatePicker`.

### Why this is not the blocker it looks like

`resolveUIViewClassName(props)` already selects a backing component **per
instance from props**, and `type` is a prop. So `<input type="checkbox">`
resolving to a switch and `<input type="date">` to a date picker needs no new
renderer seam. The work is the mapping table and the prop translation, not the
dispatch.

### Recommendation: both, for different jobs

Ship `<input>` **and** a `<native:*>` family, because they answer different
questions.

**`<input type=…>` earns its place where the mapping is faithful.** The point of
the HTML layer is that code written for the web runs here. A React component
from a design system, or a form ported from a website, writes
`<input type="checkbox">`. Having that arrive as a real `UISwitch` is the
feature, not a compromise. Types to support first, where the platform control
genuinely is the HTML control:

| type                                                          | iOS                           | Android          | notes                                                           |
| ------------------------------------------------------------- | ----------------------------- | ---------------- | --------------------------------------------------------------- |
| `text`, `password`, `email`, `number`, `tel`, `url`, `search` | `UITextField`                 | `EditText`       | `type` maps to keyboard + secure entry; already prototyped      |
| `checkbox`                                                    | `UISwitch`                    | `MaterialSwitch` | HTML semantics are a tri-state box; the platform gives a switch |
| `radio`                                                       | segmented / custom            | `RadioButton`    | needs group semantics from `name`                               |
| `range`                                                       | `UISlider`                    | `Slider`         |                                                                 |
| `date`, `time`, `datetime-local`                              | `UIDatePicker`                | date/time picker |                                                                 |
| `color`                                                       | `UIColorPickerViewController` | color picker     | modal on both                                                   |
| `file`                                                        | document/photo picker         | document picker  | needs Expo SDK modules                                          |
| `button`, `submit`, `reset`                                   | see §3                        | see §3           | the host-context case                                           |
| `hidden`                                                      | —                             | —                | `display: none`; free                                           |

**`<native:*>` earns its place where HTML has no tag.** There is no HTML element
for a segmented control, a stepper, a page-sheet, or a platform calendar view
with a native month grid. Forcing them onto `<input>` or `<div>` would be worse
than naming them honestly:

```jsx
<native:switch value={on} onChange={…} />
<native:calendar selection={date} onSelect={…} />
<native:segmented-control options={…} />
<native:stepper value={n} />
```

The rule between them: **if the web has a tag whose semantics the platform
control genuinely shares, use the tag; otherwise use `<native:*>`.** A
`<native:switch>` is also the honest escape hatch when someone wants the
platform control's full API rather than the subset HTML's attribute surface can
express — `<input type="checkbox">` cannot say "use the iOS 26 prominent style",
and it should not try to.

This also means `<native:*>` is not a fallback for unfinished work. It is a
parallel, permanent vocabulary for platform-specific controls, and it should
read as a deliberate choice at the call site.

---

## 3. Host context: SwiftUI, Compose, and the seam that already exists

### The requirement

`<button>` inside a SwiftUI hierarchy should render a SwiftUI `Button`; inside
Compose, a Compose `Button`; otherwise, the UIKit/Android View control. The same
tag, resolving to a different native implementation depending on **what it is
being mounted into**.

### This is exactly what React's host context is for

React DOM solves the identical problem: `<a>` inside `<svg>` is not the same
element as `<a>` in HTML, and the reconciler tracks the current namespace as
_host context_ to decide. **React Native's reconciler already implements this
mechanism**, in `pushHostContext`/`popHostContext`, and already uses it — to
carry one boolean, `isInAParentText`, computed from a hardcoded list of
component names:

```js
nextContext =
  'AndroidTextInput' === nextContext ||
  'RCTMultilineTextInputView' === nextContext ||
  'RCTSinglelineTextInputView' === nextContext ||
  'RCTText' === nextContext ||
  'RCTVirtualText' === nextContext;
```

So the seam exists and is idiomatic React. Three things are missing:

1. it carries a boolean, not a host _kind_;
2. the kind is computed from a name list hardcoded in the reconciler, which a
   provider cannot extend;
3. `resolveUIViewClassName(props)` is not handed it, though it is called from
   `completeWork` where the host context is on the stack.

### The catch worth deciding early

On iOS today, **SwiftUI islands are created natively and lazily**, by
`RCTViewComponentView.effectiveContentView`, when a view's _style_ needs a
SwiftUI-only effect (filters/blur) and `enableSwiftUIBasedFilters()` is on. It
moves its subviews into a `UIHostingController` after the fact. JavaScript never
knows this happened.

That means "am I inside SwiftUI?" is currently **a native fact discovered at
mount**, not a JS fact known at element creation. There are two coherent designs
and they should not be mixed:

- **(A) Host context in JS.** SwiftUI hosting becomes something the tree
  _declares_ — a host element or provider that JS knows about — and host context
  propagates from it. Elements resolve their backing component at create time.
  Clean, matches React DOM, and requires a change to React's reconciler
  (extending host context and threading it into `resolveUIViewClassName`). The
  reconciler files here are generated from facebook/react, so this is an
  upstream React dependency — the stack already carries one.
- **(B) Resolution in native at mount.** The component view asks its ancestry
  whether it is inside a `UIHostingController` and swaps implementation. No
  React change; works with today's lazily-created islands. But the shadow tree
  and JS disagree about what the element is, `nodeName` and measurement get
  murkier, and every element needing this has to implement it twice, once per
  platform.

**Recommendation: (A), with a prototype of the JS-context interim first.** A
React context provider that a composite reads, choosing the component before the
host element is created, needs no React change and de-risks the whole idea
cheaply. It costs a composite per element — which the element model deliberately
avoids — so it is a spike, not the destination. If the spike holds up, the
reconciler change is the real fix and worth taking to React.

Whichever way, **declaring** SwiftUI hosting rather than inferring it from style
is likely the right move regardless, because it is what makes the host context
knowable at all.

---

## 4. The Expo dependency, and keeping it optional

Native-backed elements come from Expo UI and the Expo SDK: expo-video,
expo-audio, expo-image (already wired), the pickers behind `<input type=file>`
and `type=color`, and Expo UI's SwiftUI/Compose control set for §3.

The `<img>` precedent already sets the pattern, and it matters that it
**degrades**: `globalThis.expo?.getViewConfig?.('ExpoImage')` with a fallback
when absent. Keep that property. The catalog should split cleanly:

- **markup elements** — no runtime dependency, work anywhere;
- **native-backed elements** — resolve through the Expo runtime, and either fall
  back or fail with a message naming the missing package.

An app that installs none of it still gets the whole markup catalog. An app that
installs expo-video gets `<video>`. That keeps the package honest about what it
needs rather than requiring the SDK wholesale.

---

## 5. Sequencing

**Phase 1 — the free and the nearly free.** `<output>` (an inline element),
`<input type=hidden>` (`display: none`), `<progress>` and `<meter>` (a box and a
fill; no platform control needed to be useful), `<fieldset>`/`<legend>` as block
elements without the border notch, and `<form>` as a submit coordinator with no
visual at all. None of these need a native control or a host-context answer.

**Phase 2 — promote what is already proven.** `<input type=text>` family and
`<textarea>` from the Astryx prototypes; `<dialog>` from the top-layer work;
`<details>`/`<summary>` from the disclosure shim. This is packaging and API
review, not new capability, and it shrinks the gap between what the demos prove
and what the package ships.

**Phase 3 — the host-context spike.** The JS-context prototype from §3, with
`<button>` as the single subject, and a written answer on (A) versus (B) before
anything else depends on it. This gates Phase 4's controls, so it should not
wait.

**Phase 4 — platform controls.** The `<input>` type table, and the first
`<native:*>` elements. Ordered by whether the control exists in Expo UI already.

**Phase 5 — media.** `<video>`, `<audio>`, `<canvas>`, `<iframe>`, plus
`<picture>`/`<source>` which are pure JS resolution over `<img>`. Independent of
Phases 3–4 and parallelisable.

The one ordering constraint that matters: **Phase 3 gates Phase 4.** Building
the control set before deciding how host context works means building it twice.
