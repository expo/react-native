# Providing the HTML elements in the framework

The goal: the full HTML element library ships in the framework — the Expo layer
— rather than in react-native. Expo is the right owner because the elements need
the SDK — `<img>` should be expo-image, and in a SwiftUI host it should be Expo
UI's SwiftUI image; `<input>` should be a real platform control. The framework
keeps the machinery; Expo names the elements.

This is an exploration of what that takes. Most of the seams already exist.

## Where this already stands

Four things are already true, and they are most of the answer.

**Lazy native registration is a shared-C++ seam that names nothing.**
`OnDemandComponentDescriptorProviders` (componentregistry/) lets a library
register descriptor providers at load; the framework consults it on a miss
during commit, which is long after native init on every platform. Its own
comment names expo-intrinsics as the motivating case. One registration covers
iOS, Android and Fantom. This path is proven end-to-end — `<u>` is wired through
it and nothing else.

**The unknown element is already a policy, not a mechanism.**
`setFallbackViewConfigResolver` is a generic framework hook;
`DomElements/index.js` supplies the DOM policy ("any unregistered lowercase tag
is inline and unstyled"). Handing that to Expo is a matter of moving the
callback, not changing the framework.

**UA styles, tag identity and component selection are generic ViewConfig
fields.** `uaStyle`, `recordNodeName` and `resolveUIViewClassName` are declared
in `ReactNativeTypes` and consumed by the reconciler with no DOM knowledge. A
view config can point `uiViewClassName` at any registered native component — the
mechanism by which an element binds to expo-image is the same one that already
maps `<p>` onto `<div>`'s component.

**Inline participation is a trait, not a name list.**
`ShadowNodeTraits::InlineText` replaced the hardcoded set, precisely so "a new
intrinsic flows inline with no change to the framework".

## What an element actually is

Strip it back and an element is three things:

1. **A tag name** — the JSX type, and what `nodeName` reports.
2. **A UA style** — every default the browser would apply. `<p>`'s margins,
   `<b>`'s weight, `<button>`'s `inline-block` and content centring.
3. **A display** — which falls out of (2).

Everything else follows. Block versus inline is not a separate axis to declare:
`display` already drives `displayBlock` / `displayInline` /
`displayInlineAtomic` in `YogaStylableProps`, and `resolveUIViewClassName`
already picks the text-backed component or the box-backed one from the computed
display. That is why the overwhelming majority of tags in `index.js` today are
one line each — a name and a UA entry, aliasing an existing native component.

So the model Expo should expose is roughly:

```js
defineElement('p', {ua: {display: 'block', marginBlock: '1em'}});
defineElement('span', {ua: {display: 'inline'}});
defineElement('img', {ua: {display: 'inline'}, component: 'ExpoImage'});
```

Only the third line needs anything native. The first two need a _generic_ pair
of backing components — one that participates in a text run, one that generates
a box — and those two are the only element implementations Expo has to ship in
C++.

## Who registers what — the precedence ruleset

Origins with distinct claims, enforced by API shape in `ElementRegistry` rather
than by convention:

1. **react-native registers nothing.** It ships the machinery and the two
   generic backings, and no tag names.
2. **The framework (Expo) owns the bare tags.** `button`, `img`, `p` — the
   default vocabulary an app gets by using the framework, plus the
   unknown-element fallback. One framework per app. Registering the same bare
   tag twice throws: that is a catalog bug, not a precedence question.
3. **A library owns its namespace.** `defineReactElement('me', 'button', …)`
   yields `me:button`; the API takes namespace and name separately and joins
   them itself, so a library _cannot_ define a bare tag — the rule is
   unbreakable rather than validated. First definition within a namespace wins;
   a collision throws rather than picking a winner. The `rn` namespace is
   reserved.

An app-level override tier (redefine any tag before its first render) is
anticipated but deliberately not built yet. Each tag is registered with the
reconciler exactly once; resolution reads the registry's current entry, which is
the indirection a future override tier lands through.

User-agent styles layer the same way: the framework's UA sheet is the base, a
library's UA entries style only its own namespaced tags, an app reset
(`overrideUAStyle`) edits the merged result, and the author's `style` prop beats
all of it — the CSS origin ordering, with everything below the author collapsed
into one UA origin.

Two notes on the tag syntax itself. Literal `<me:button>` JSX needs
`throwIfNamespace: false` in the Babel transform plus a Metro source-map fix
(both proven on this fork; the fix is prepped as a Metro PR) — until a host
enables that, `React.createElement('me:button', …)` works everywhere, because a
tag is just a string. And the web's own answer to the same problem is the
custom-element dash (`me-button` needs no toolchain change at all); the colon is
the XML-flavored spelling of the same idea, and the registry is agnostic — the
separator is one constant.

## The two backings react-native offers

An element points its view config at a native component. For all but the
replaced and native-backed ones, that component is one of two react-native
supplies, and between them they are the whole contract:

**`inline-text`** — folds into a line of text. It participates in a text run
because `TextShadowNode` carries the `InlineText` trait, renders its content,
styles nothing of its own, and reports the authored tag through `nodeName`.
Everything a `<span>`, a `<cite>` or a `<button>` is beyond that is its tag and
its user-agent style. It is also where the DOM policy sends unregistered tags,
which is what it used to be named after — it was called `unknown`, and that
named one caller rather than the contract.

**`element-box`** — generates a box. A View that honours whatever `display` it
is given rather than forcing one, reports the authored tag, and carries the list
properties a list container needs. Every block element is backed by this,
`<div>` included.

So a provider defines an element as a tag name, a user-agent style, and which of
these two it uses — with `display` in the style deciding which. Its own native
component is needed only for a replaced element like `<img>` or something that
must be a platform control.

## The split

**The framework keeps the machinery**, none of which names an element: string
children and `#text` nodes, the anonymous inline formatting contexts in
`YogaLayoutableShadowNode`, Yoga block layout, `display` parsing, the
`InlineText` trait, the on-demand descriptor seam, the view-config fallback
hook, and the `uaStyle` merge.

**Expo owns the catalog**: every tag name, every UA style, the two generic
backing components, the replaced/native-backed elements, and the unknown-element
policy.

## Status

The catalog has MOVED. Every element — the inline ones, the block ones, the
aliases, the user-agent sheet and the unknown-element policy — lives in the
provider package, and react-native names none of them. What it keeps is
machinery: text nodes, the anonymous inline formatting contexts, Yoga's block
display and margin collapsing, `display` parsing, the `InlineText` trait, the
lazy descriptor seam, the view-config fallback hook, the `uaStyle` merge, and
the two generic backings described above.

Only `<img>` still has a component of its own, because it is a replaced element
— which is exactly the case that motivated a provider owning this in the first
place, since it wants to be expo-image.

## What blocked it

Five concrete things, all now resolved.

**1. RESOLVED — `"img"` is a trait, not a name.** `InlineReplaced`
(ShadowNodeTraits) now marks an inline replaced element: it flows in the run as
an attachment and is never blockified. The three call sites check the trait, the
`<img>` shadow node sets it alongside `InlineText`, and no layout code names the
tag. Any component that sets these traits behaves as an inline replaced element
whatever it is called — which is precisely what an expo-image-backed `<img>`
needs. The original text follows.

**1 (original).** The framework still hardcodes `"img"`. Three places treat it
by name rather than by concept: `YogaLayoutableShadowNode.cpp:516` and `:575`,
and `ViewShadowNode.cpp:178`. The concept is "an inline _replaced_ element — an
attachment that flows in the run and is never blockified", which is stronger
than `InlineText` (an inline text _element_ does get blockified in a flex
container). This wants the same treatment `InlineText` already got: a trait, set
by whoever implements the element. Without it, Expo's expo-image-backed `<img>`
cannot flow inline unless it is literally called `img`.

**2. RESOLVED — the framework no longer defines `div`.** `ViewShadowNode.cpp`
declares `DivComponentName` and `ElementBoxComponentName`, and
`DomElementsRegistry.h` aggregates the element descriptors. These are the two
generic backing components above; they should move out with the catalog. Nothing
about them is DOM-specific once they are named neutrally — they are "block
container" and "box".

**3. MOSTLY RESOLVED — the Android map is down to the generic backings.**
`FabricNameComponentMapping.kt` hardcodes `div`/`img`/`element-box`/`b`/`i`/
`span`/`u`/`unknown` onto `RCTView`/`RCTText`. It falls back to the name itself,
so this only matters for the small set of genuinely _native_ component names —
but that set is exactly what Expo would be adding. Either Expo registers real
view managers under its own names (likely anyway, for expo-image), or the
mapping needs to be extensible.

**4. RESOLVED — text-run participation needs no C++ class.** An inline element
points at the generic `inline-text` backing, which carries the trait; the tag
and the user-agent style are the whole definition. The original text of this
item follows, because the reasoning was right and only the conclusion was
premature.

**4 (original).** Text-run participation still requires a C++ class. The trait
is set by the shadow node, so an element defined purely as a name plus a UA
style cannot flow inline unless it is backed by a component that already sets
it. That is fine as long as Expo ships the two generic backings — but if the
ambition is "an element is just styles", the trait wants to be derivable from
`display: inline` as well. Worth deciding deliberately rather than by accident.

**5. RESOLVED — block elements are definable, and `div` is gone.** This one was
stated wrongly and is worth keeping as a record of why. Defining a block element
looked impossible: `AbstractViewShadowNode`'s members are explicitly
instantiated in `ViewShadowNode.cpp`, so a new specialization compiles and fails
to link. But specializing it was never necessary. react-native already ships the
generic box — `element-box`, a View that honours whatever display it is given
and reports the authored tag — so a block element is a tag name plus a
user-agent style saying `display: block`, pointed at that. No shadow node, no
descriptor, no C++.

`<div>` now IS that: react-native carries no `DivShadowNode`, no `DivProps`, no
`div` component and no Android name mapping for one. It is an ordinary entry in
the block-element list, and every other block element — `<p>`, the headings, the
lists — is backed by the generic box rather than by `<div>`'s component. The
list properties moved with them onto the generic box, because a list container
is one.

Both generic backings are now named for what they are and documented above as
the contract.

## Native-backed elements — PROVEN with expo-image

`<img>` now resolves to expo-image whenever the Expo runtime is present (and
falls back to the framework's Image machinery in Fantom and bare hosts).
Verified live on the iOS simulator: the catalog logs choosing
`ViewManagerAdapter_ExpoImage`, the view hierarchy shows `ExpoImage.ImageView`
at the authored size, and the image flows inline in a text run — which only
happens if the traits expo-image declared reached layout.

The enabling seam sits where it generalizes: expo-modules-core's
`ExpoViewTraits` lets any module view declare shadow-node traits by component
name (every Expo view shares one shadow node class, so `BaseTraits()` cannot
differ per view), and expo-image declares `InlineText` + `InlineReplaced` +
`LeafYogaNode`. expo-video or a form control declares the same way. The
framework contributed one general change: `RCTReactNativeFactory` forwards
`host:didInitializeRuntime:` to its delegate, which lets any app bootstrap the
Expo module runtime in four lines with no Expo AppDelegate.

The original notes follow.

## Native-backed elements (original notes)

This is the part that motivates Expo owning the library, and the mechanism is
already there: an element's view config names its native component.

`<img>` binding to expo-image is a view config with
`uiViewClassName: 'ExpoImage'`. It has been proven that an external module can
register intrinsics mapping to any existing native component with zero C++ —
that experiment used `<native:switch>` onto `UISwitch`.

**Host-dependent binding** (SwiftUI hosts get Expo UI's image) has three
possible shapes, and they are not equivalent:

- _Choose at registration._ Expo picks the component name when it defines the
  catalog, from the host it finds itself in. Simplest, one view config, no
  per-render cost — but the host must be known before the first render.
- _Choose per element via `resolveUIViewClassName`._ Already supported, but it
  is props-driven; the host is not a prop. It would need the host in context.
- _Choose inside one native component._ One `ExpoImage` that renders UIImageView
  or SwiftUI internally. Keeps the JS surface identical and puts the decision
  where the host is actually known.

The third is probably right for SwiftUI specifically, because a SwiftUI host is
a native-side fact. The first is right when the difference is bigger than a
render path.

`<input>` is a larger surface than `<img>` and should be scoped separately: it
carries form semantics (value, change events, focus, validation) that no
existing intrinsic has, and it is where "use the native platform control" has
the most value and the most divergence.

## Open questions

- Should the two generic backings be one component that switches on display,
  rather than two? `resolveUIViewClassName` currently switches between them per
  render; a single component would move that decision native.
- Does the UA sheet stay a JS object, or become data the native side can read?
  Today it is merged by the reconciler, which is simple and works.
- How does an app _reset_ UA styles from outside Expo? `overrideUAStyle` mutates
  in place today because view configs capture the object by reference — that is
  a sharp edge worth designing away before third parties depend on it.
