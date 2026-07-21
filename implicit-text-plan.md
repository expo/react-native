# Plan: Textless `<Text>` — bare strings, style inheritance, and `<b>`/`<i>`, the DOM/CSS way

**Goal.** Make `<View>hello</View>` render text without an explicit `<Text>` wrapper, give text
styles web-like inheritance, and support inline tags (`<b>`, `<i>`, `<span>`). Implement CSS
semantics — including per-display-type block/flex behavior — and DOM semantics (events, APIs,
node kinds), with **one exception: apps using explicit `<Text>` must not break** (it renders
pixel-identically). Direct replacement, no migration staging. Scope: iOS + shared (C++/JS)
code, Fabric only.

All file references are to `packages/react-native` at react-native `main`
(0.87-rc, commit `7bb31ff7be`).

---

## 1. The governing principle: three trees, like the web

The web separates:

1. **DOM** — elements + text nodes, as authored. Anonymous boxes never appear here.
2. **Box tree** — generated from the DOM by `display` rules. This is where anonymous block
   boxes and inline formatting contexts (IFCs) exist (CSS2 §9.2.1.1, css-flexbox-1 §4).
3. **Painting** — boxes paint their own content; a `<div>` paints its text runs itself. There
   is no hidden "paragraph element".

Mapped to Fabric:

| web | Fabric |
|---|---|
| DOM | shadow tree (`ShadowNode`s) |
| box tree | Yoga tree + text layout |
| painting | mounting layer / component views |

Node-type ↔ DOM mapping (all existing types keep their roles):

| shadow node | DOM concept | fate in this plan |
|---|---|---|
| `RawTextShadowNode` ("RawText") | Text node (CharacterData) | **concept kept, implementation replaced** (§3.F): character data must remain ordered leaf *nodes* (mixed content `a<b>b</b>c` needs text/element siblings — a `textContent`-style prop cannot express it), but RawText's fake-component packaging (descriptor, RawProps parsing of the string, family + unused EventTarget, descriptor-mediated clone per text change) is un-DOM-like overhead. Replace with a first-class lightweight `Text` node kind, as DOM engines do (`Text : CharacterData` in WebKit/Blink/Gecko). |
| `TextShadowNode` ("Text", nested `<Text>`) | inline text element | kept — it is an *Element*, distinct from character data by DOM design. Rename to **`InlineText`** so "Text" can mean character data; not "Span", which must stay free for the `<span>` *tag* — `<span>`/`<b>`/`<i>` are registered component names all backed by this one class (`span` = neutral instance, `b`/`i` = attribute-defaulting instances). |
| `ParagraphShadowNode` ("Paragraph", outer `<Text>`) | block text container (`<p>`) | kept unchanged (the back-compat exception). Possible far-future convergence to "block element + inherited text props" would first need CSS analogs for `numberOfLines`/`ellipsizeMode`/`adjustsFontSizeToFit`. |
| *(anonymous text)* | *(no DOM node — box tree only)* | text/inline children in the tree + anonymous Yoga items + View-state runs; no node created |

**Design rule that follows:** bare text support belongs in the *layout and painting* layers.
The shadow tree keeps text nodes (today's `RawText`, §3.F's `Text` kind) and inline-tag
elements as direct children of the View — no synthesized Paragraph shadow nodes. (A commit-hook approach that synthesizes wrapper
Paragraph nodes was designed, prototyped and validated first — kept as Appendix A; it works,
but it puts anonymous boxes into the "DOM", which diverges from the web model and drags in
synthetic-node problems: family reparenting, foreign nodes in DOM traversal/DevTools,
identity churn across commits.)

## 2. What exists today (verified against source)

- **The `<Text>` requirement is soft.** Fabric's `createTextInstance` always creates an
  `RCTRawText` node; "Text strings must be rendered within a `<Text>` component" is a
  dev-only `console.error` (`Libraries/Renderer/implementations/ReactFabric-dev.js:15889-15910`);
  prod hardcodes `{isInAParentText: true}` (`ReactFabric-prod.js:10340`). Bare strings
  already reach the C++ shadow tree as `RawText` children of the View. Verified end-to-end
  with a Fantom test: they mount as nothing, silently.
- **They are cleanly ignored, not rejected.** `RawTextShadowNode`/`TextShadowNode` are not
  `YogaLayoutableShadowNode`s and (on iOS) lack `FormsView`, so Yoga skips them
  (`YogaLayoutableShadowNode.cpp:236-255`) and the differ never mounts them
  (`mounting/internal/sliceChildShadowNodeViewPairs.cpp:112-125`). The "DOM" part of the web
  model is therefore *already in place*.
- **All text machinery is reusable.** `BaseTextShadowNode::buildAttributedString`
  (`BaseTextShadowNode.cpp:27-83`) flattens any node's text-ish children (RawText fragments,
  nested attribute merging via `TextAttributes::apply`, non-text children as inline
  *attachments*); `TextLayoutManager::measure` measures an `AttributedString` under
  constraints with caching (`textlayoutmanager/platform/ios/.../TextLayoutManager.mm:28-100`);
  `RCTTextLayoutManager` draws one into any frame (`drawAttributedString`,
  `RCTTextLayoutManager.mm:69-129`). None of this is Paragraph-specific — Paragraph and
  TextInput are just its current callers.

## 3. Design

### A. Box generation: CSS box rules per display type

**Directive: implement CSS, including per-display-type block/flex behavior. The single
back-compat exception is explicit `<Text>`, whose semantics do not change.** The container's
`display` decides how inline-level content is boxed — no bespoke grouping rule:

**Classification** (outer display of each child): *inline-level* = text runs, inline tags
(`<span>`, `<b>`, `<i>`, and the replaced `<img>` — §3.C), elements with `display:'inline'`
(phase 2). *Block-level* = everything else: `View` and `Image` (the RN components keep
today's block-level outer display — `View`'s *inner* display stays `flex`, which every
existing RN layout depends on), authored `<Text>`/Paragraph (the `<p>` analog), and the
intrinsic `<div>` tag.

The RN/HTML tag correspondence this fixes (each tag gets its web-standard display, so a
snippet ported from the web lays out the same):

| tag | outer display | inner display | notes |
|---|---|---|---|
| `View` (RN) | block | **flex** | unchanged; the RN default every layout relies on |
| `Image` (RN) | block | replaced | unchanged |
| `<div>` | block | **block** | true block container (block formatting context) — §3.A block section |
| `<span>` / `<b>` / `<i>` | inline | inline | inline text elements (§3.C) |
| `<img>` | inline | replaced | inline replaced element (attachment inside the IFC) |
| `<Text>` (RN) | block | (RN paragraph) | the `<p>` analog, back-compat exception |

`View` is deliberately **not** `<div>`: a View is block-outer/flex-inner (RN's model), a
`<div>` is block-outer/block-inner (the web's). Keeping them distinct is what lets `<div>`
mean *true block* — see the block-container implementation note below.

**Flex containers (`display:'flex'`, the default)** — css-flexbox-1 §4, faithfully:
- Each contiguous sequence of *text runs* is wrapped in one anonymous block-container flex
  item establishing an IFC.
- Inline-level *element* children (`<b>`, `<span>`, `display:'inline'` elements) are
  **blockified** into their own flex items, exactly as on web.
- Whitespace-only anonymous items are not rendered.
- Consequence, documented: `<View>a<b>b</b>c</View>` is three flex items (stacked in RN's
  default column direction). That is the spec. Single-flow text is what block containers are
  for — see below — or explicit `<Text>`.

**Block containers (`display:'block'`, and the intrinsic `<div>`)** — CSS2 §9.2.1.1:
- All inline-level children — text runs *and* inline elements — join a single flow; block
  containers with only inline-level children establish one IFC directly, and mixed content
  wraps each contiguous inline sequence in an anonymous block box between block siblings.
- `<div>a<b>b</b>c</div>` (or `<View style={{display:'block'}}>…`) renders "a**b**c" as one
  wrapping inline flow, and stacks block-level children as true block boxes — the web
  `<div>` behavior.
- **Implementation: a real `display:block` in Yoga, not a flex emulation.** The first
  landing emulated block on flex primitives (force column + `alignItems:'stretch'`, pin
  anonymous boxes to `alignSelf:'stretch'`, keep Yoga on `YGDisplayFlex`). That is enough
  for a lone inline flow but it is *not* a genuine block container: a real `<div>` needs a
  block formatting context (block-level children laid out in the block direction with block
  sizing, not flex items; anonymous block boxes generated natively between block siblings;
  and, incrementally, margin collapsing and static positioning). Flex cannot express these
  without fighting the flex algorithm, so **`display:'block'` is implemented as a first-class
  Yoga display type** (`YGDisplayBlock`): the block layout algorithm lives in Yoga, RN's
  `display` style (`'flex' | 'none' | 'contents'` today) gains `'block'` through
  `YogaStylableProps`/conversions + TS/Flow types + codegen, and the shadow node maps it
  straight to `YGDisplayBlock` rather than rewriting styles. The IFC/anonymous-box machinery
  below is shared with flex containers (only the sequence-grouping predicate differs). Staged
  (documented, each a Yoga milestone): (1) block-inner layout of block-level children +
  inline flow; (2) anonymous block boxes for mixed inline/block content; (3) margin
  collapsing; (4) floats / static-position specifics. The flex emulation remains only as the
  fallback when the native path is flag-gated off.

Under default flex, a lone bare string (`<View>hello</View>`) still renders — one anonymous
item — so the headline feature works everywhere; `display:'block'` is the opt-in for
web-exact mixed inline flow.

**White-space:** inside newly-legal anonymous IFCs, apply CSS `white-space: normal`
processing (collapse runs of whitespace, trim line edges) — there is no back-compat to
violate since this content was invisible. Explicit `<Text>` keeps RN's verbatim behavior
(the exception clause). **Decided and implemented** (§7): collapsing runs in
`InlineContentShadowNode` (the anonymous-IFC box) only, spanning fragment boundaries so a
space split across text nodes or around an inline element collapses to one; attachment
fragments (`<img>`) are opaque anchors. Whitespace-only runs are still dropped upstream in
`ImplicitTextContent.cpp` (flexbox rule).

**Implementation inside `YogaLayoutableShadowNode`/`ViewShadowNode`** (identical machinery
for both display types — only the sequence-grouping predicate differs):

- During child adoption (`updateYogaChildren`, `YogaLayoutableShadowNode.cpp:350-372`), where
  non-layoutable children are skipped today, detect inline-level sequences per the
  container's display type and create one **anonymous Yoga child** per sequence (and, in
  flex containers, one per blockified inline element): a Yoga node owned by the View's
  shadow node (not backed by any shadow-tree child), carrying a measure function that builds
  the sequence's `AttributedString` (via `buildAttributedString` over exactly those
  children) and measures it with the shared `TextLayoutManager` — the same path
  `ParagraphShadowNode::measureContent` uses (`ParagraphShadowNode.cpp:222-274`).
- After Yoga computes layout, the View's `layout()` records each anonymous item's result —
  `{AttributedString, ParagraphAttributes, frame}` per sequence — into **View state** (new,
  allocated only when sequences exist), exactly how Paragraph publishes `ParagraphState`
  today (`ParagraphShadowNode.cpp:300-346`). Inline attachments inside a sequence reuse
  Paragraph's attachment layout loop (`ParagraphShadowNode.cpp:363-446`).
- The differ and mounting see only the View (state change → `updateState` mutation) — no
  extra views, no extra shadow nodes, nothing to hide from DOM traversal.

### B. Painting: the View draws its text runs

iOS mounting: `RCTViewComponentView` gains a text pass — when its state carries text runs,
it manages **one lightweight internal run view per anonymous item** (a plain drawing UIView,
like `RCTParagraphComponentView`'s inner `RCTParagraphTextView`,
`RCTParagraphComponentView.mm:383-428`), each drawing its run via
`RCTTextLayoutManager drawAttributedString:`. Touch span resolution and accessibility
fragments reuse the paragraph implementations (`getEventEmitterWithAttributeString`,
`RCTParagraphComponentAccessibilityProvider`), fed per-run.

**Paint order (explicit design, not an afterthought):** a single content view cannot
interleave text with mounted children in authored order (`<View>a<View/>b</View>` must
paint "a" and "b" in document position relative to the inner view, per CSS painting order).
Hence per-run views: they are *component-view-internal* subviews (never differ-driven — the
differ still only sees the View), and `layoutSubviews` re-establishes z-order after every
mount/state change by interleaving React-mounted subviews and run views per the authored
child order recorded in state. React child mounting stays index-based and untouched; run
views are excluded from those indices (same pattern as the paragraph's content view today).

**Text-bearing Views must not flatten.** View-flattening removes prop-less Views
(verified in the Fantom baseline); a View whose children include text nodes must be forced
to mount so its state/runs have a host view — same mechanism that keeps Views with
`collapsable={false}` or background props unflattened.

This is the web-faithful part: the block box paints its own inline content; there is no
hidden text *element* at any layer (run views are paint artifacts, invisible to the tree,
events, and DOM APIs).

### C. Intrinsic tags `<b>`, `<i>`, `<span>`, `<img>`, `<div>` (and `<Text>`'s role)

- JSX lowercase types are plain strings resolved through
  `ReactNativeViewConfigRegistry.get` (`Libraries/Renderer/shims/ReactNativeViewConfigRegistry.js:75-98`),
  so registering configs via the same `createReactNativeComponentClass` call `NativeText`
  uses (`Libraries/Text/TextNativeComponent.js:79-89`) makes literal `<b>` work with zero
  reconciler changes.
- C++: subclasses of `TextShadowNode` (renamed `InlineText`, §1) for "b", "i", "strong",
  "em", "span", whose `Props` default `fontWeight`/`fontStyle` (`span` = neutral instance);
  names pass `componentNameByReactViewName` untouched; register descriptors alongside the
  text components (`RCTParagraphComponentView.mm:97-102` supplemental providers, and the
  Fantom/Android core registries). They are inline-level in §3.A's classification and work
  inside authored `<Text>` unchanged (nested-text traversal only requires the `InlineText`
  class, `BaseTextShadowNode.cpp:60-70`).
- **`<img>` — inline replaced element.** Unlike RN's block-level `Image`, the lowercase
  `<img>` tag is inline-level: it flows inside an IFC as a *replaced* box (an inline
  attachment), exactly as on the web. It reuses the inline-attachment machinery Paragraph
  already has for non-text children (`BaseTextShadowNode` attachments,
  `ParagraphShadowNode.cpp:363-446`); classification in §3.A routes it into the current run
  rather than blockifying it. `src`/sizing props map onto the existing image props.
- **`<div>` — block element.** The lowercase `<div>` tag is a block-level container with
  block *inner* display (§3.A block section): it is the intrinsic analog of a `View` but with
  `display:block` instead of `flex`, so ported web markup (`<div><span>…</span></div>`) lays
  out with true block semantics. It is registered like the other intrinsic tags and backed
  by the block-display path, not by `InlineText`.
- **The back-compat exception, stated precisely:** authored `<Text>` keeps today's RN
  semantics in full — block-level from the outside (a `<p>`), RN's own nested-text/inline
  rules, verbatim whitespace, and untouched Paragraph internals. Apps using explicit
  `<Text>` render pixel-identically with the flag on. Inline tags are additive (usable
  inside `<Text>` from day one) and bare-text IFCs are new surface area, so full CSS
  semantics apply only where nothing rendered before.

### D. Style inheritance: computed on the element tree

Following CSS, inheritance is defined on the element (shadow) tree, not on boxes:

- Add inheritable text attributes to `BaseViewProps` (shared), parsed with `BaseTextProps`'
  conversions; keys ≈ CSS inherited text properties: `color`, `fontFamily`, `fontSize`,
  `fontWeight`, `fontStyle`, `fontVariant`, `letterSpacing`, `lineHeight`, `textAlign`,
  `textTransform`. JS: add them to View's `validAttributes`
  (`Libraries/NativeComponent/BaseViewConfig.ios.js:190`).
- Resolution walks **up** the shadow tree at attributed-string build time: every
  `ShadowNodeFamily` has a parent pointer (`ShadowNodeFamily.cpp:36-44`, chain-walk at
  `:101-115`), so a View building an anonymous IFC computes its effective base attributes as
  `defaults ⊕ (ancestor Views' inheritable attrs, root→self)`. Cache per node revision;
  O(depth) only on cache miss. (Implemented as a top-down fold in
  `YogaLayoutableShadowNode::configureYogaTree`, which runs each layout pass.)
- **Live updates (the cascade is a computed value, so it must re-resolve).** Inheritable
  text props are *not* Yoga styles, so changing one (e.g. a grandparent's `color`) dirties no
  layout by default and — without help — no re-cascade would run and descendants would keep
  stale attributes. Two invalidations close this (implemented; regression-tested):
  (1) when a node's inheritable text props change between revisions, its clone dirties its
  Yoga node so a layout pass actually runs (the parent's `updateYogaChildren` propagates the
  dirty flag to the surface root); (2) `configureYogaTree` remembers the cascade value it
  handed each child and, when it differs on a later pass, re-propagates *and* dirties the
  descendant anonymous IFC box so it re-measures and republishes state — necessary because a
  colour-only change does not alter size and Yoga would otherwise keep the cached layout.
- **Compatibility split (resolves a real contradiction with the `<Text>` exception):**
  anonymous IFCs *always* inherit — they are new surface, nothing rendered there before.
  Authored `<Text>` does **not** inherit by default: apps commonly have inert `color`/font
  keys in View styles today (View's validAttributes silently drop them), so cascading into
  existing Paragraphs would break the pixel-identical promise. Web inheritance into
  `<Text>` is an explicit opt-in — `<Text inheritViewTextStyles>` per element plus an
  app-level default in the feature-flag config — implemented by seeding
  `ParagraphShadowNode::getContent` (`ParagraphShadowNode.cpp:70-94`) from the cascade
  instead of `TextAttributes::defaultTextAttributes()` only when opted in.
- Rejected: JS-context inheritance (can't reach text with no JS component around it, and
  duplicates the cascade), and commit-time top-down cloning (mutates the tree for what CSS
  defines as a computed value).

### E. Lift the restriction

Delete/gate the dev-only `console.error` in `createTextInstance`
(`ReactFabric-dev.js:15895-15898`). Durable fix upstream in the `react` repo host config;
one-line patch to the vendored bundles meanwhile (prod needs nothing).

### F. First-class text nodes (replace RawText outright — no compat shims)

Adopt the DOM engines' *semantics* (`Text : CharacterData`) while staying inside Fabric's
one node model — a family-less `ShadowNode` variant would be a second core model (cloning,
identity, traversal, sealing, and `updateMountedFlag` all assume families) and is explicitly
not proposed. The slim `Text` node is a `ShadowNode` subclass with component name `"#text"`
(DOM `nodeName`) that keeps a real per-node `ShadowNodeFamily` for identity/traversal but
deletes the overhead: **no EventTarget/EventEmitter allocation** (emitter becomes optional
on families — text nodes never dispatch), **no RawProps parsing** (`{string data}` is a
direct field; a trivial shared Props identity satisfies the base-class invariant), **no
state**, **no public component registration or name mapping** (one internal descriptor
constructs it — never resolvable from JS by name). `instanceHandle` stays on the family
because React's `createTextInstance` already passes one (`ReactFabric-dev.js:15889`) and the
DOM API layer resolves `childNodes` through per-node instance handles
(`ReadOnlyNode.js:393-403` → `NativeDOM.getChildNodes`) — on the web, DOM `Text` objects
*are* the text instances.

React is already shaped for this: host configs split `createInstance`/`createTextInstance`
(mirroring `createElement`/`createTextNode`; web returns real DOM Text nodes and updates via
a cheap `commitTextUpdate`), while RN currently shoehorns text into
`createNode("RCTRawText", {text})`. So: add a `createTextNode(text, instanceHandle)`
FabricUIManager method and a `commitTextUpdate` path (workstream E already touches
`createTextInstance`), and **delete the `RCTRawText` component** — its registration, the
`componentNameByReactViewName` entry, `RawTextProps`/`RawTextShadowNode`/descriptor, and the
`createNode("RCTRawText", …)` path. (A children-list variant — DOM's literal shape — buys no
further overhead reduction once this lands; skip unless child-list APIs get redesigned.)

Consumers updated in the same change: `buildAttributedString`'s RawText branch reads the new
node kind (`BaseTextShadowNode.cpp:34-55`); the differ/layout already ignore text nodes;
`ReadOnlyText` (DOM API layer) maps 1:1 onto it.

### G. Events and DOM APIs under this design

**Touch/pointer events.** iOS Fabric resolves the emitter by asking the hit component view
`touchEventEmitterAtPoint:` (`RCTTouchableComponentViewProtocol.h`, called from
`RCTSurfaceTouchHandler.mm:84` / `RCTSurfacePointerHandler.mm:162`) — the protocol is open
to any component view, so `RCTViewComponentView` implements it when it carries text runs
(today only the paragraph view does): find the run whose frame contains the point, then
resolve the fragment emitter via `characterIndexForPoint`
(`RCTTextLayoutManager.mm:255-283`), exactly as paragraphs do.
- Tap on an inline element (`<b onPress>`, nested span): the fragment carries that element's
  emitter (`RCTAttributedTextUtils.mm:434-442`) — a real JS-created family with a real
  instance handle. Works like `<Text onPress>` nesting today.
- Tap on bare text: fragments built directly from text nodes carry the *View's* emitter
  (their `parentShadowView` is the View) — matching web semantics exactly: DOM text nodes
  are not event targets; the parent element is. No null-handle hazard anywhere (contrast
  Appendix A).
- Bubbling/propagation happen through the authored React/shadow tree only — there are no
  synthetic nodes to appear in (or distort) propagation paths, `pointerEvents` behaves as
  today, and W3C pointer-event processing (`PointerEventsProcessor`) walks real ancestor
  chains.

**DOM traversal.** The shadow tree *is* the authored DOM, so `childNodes` of an element
yields its `ReadOnlyText` and element children in order, `parentNode` of a text node is its
element, `textContent` concatenates descendant data — all per spec, via the existing
`NativeDOM` path with text instance handles (§3.F).

**Geometry APIs.** `getBoundingClientRect` lives on `ReadOnlyElement` (per spec, `Text` has
none — only `Range` does): Views/Paragraphs answer from layout metrics as today. Inline
elements (`<b>`, spans) have no layout metrics — same as nested `<Text>` today (no
regression) — but web-parity rects are *answerable by this design*: the run's text layout
can enumerate enclosing rects for a character range
(`getRectWithAttributedString:...usingBlock:`, `RCTTextLayoutManager.mm:285-323`), keyed
from the View state's runs. Planned as a follow-up on `ReadOnlyElement` for inline
elements; same machinery serves a future `Range`/selection API.

**Observers.** `MutationObserver` observes shadow-tree commits — authored-only tree means
observed mutations are exactly the authored ones; `IntersectionObserver` targets elements,
unaffected.

**Accessibility.** Runs feed the same fragment-based a11y provider paragraphs use
(`RCTParagraphComponentAccessibilityProvider`), exposed from the View: bare text reads as
the View's content; links/roles on inline elements surface as sub-elements with traits, as
in paragraphs today.

**Inspector/DevTools.** Tap-to-inspect resolves through the hit view's emitter → instance
handle → fiber; every target (View, inline element) is authored, so source attribution
works without special cases.

Everything ships behind a new common feature flag (`enableImplicitTextChildren`) in
`scripts/featureflags/ReactNativeFeatureFlags.config.js` (same pipeline as
`enablePreparedTextLayout`, line 467).

## 4. Edge cases and risks

1. **Anonymous Yoga children are new plumbing — ownership spelled out.** The debug invariant
   (`ensureYogaChildrenAlignment`, `YogaLayoutableShadowNode.cpp`) requires
   `yogaNode_.getChildren()` and `yogaLayoutableChildren_` to be same-length with 1:1
   context back-pointers to `YogaLayoutableShadowNode`s — but nothing ties those vectors to
   `children_`. So anonymous items fit as minimal internal `YogaLayoutableShadowNode`
   subclasses (overriding `measureContent` to measure their sequence's `AttributedString`,
   plugging straight into `yogaNodeMeasureCallbackConnector`) that are inserted into the
   Yoga vectors by `updateYogaChildren` but never into `children_`: box-tree objects, not
   DOM. Lifecycle: each anonymous item is **owned exclusively by one shadow-node revision**
   of its containing View — created/rebuilt in `updateYogaChildren`, deep-cloned when the
   owner clones (never shared across revisions, so concurrent revisions are safe by
   construction); dirtiness flows in via §4.6 (a text-data change dirties the nearest
   layoutable ancestor's Yoga node, which re-measures its items), and out via normal Yoga
   dirty propagation. The rebuild logic in `updateYogaChildren`/`adoptYogaChild` learning to
   interleave them is the focused-prototype area (rollout stage 1); the invariants permit
   it.
2. **View state.** Views today have no state; adding an optional state type to the View
   descriptor touches a hot path — must stay `nullptr` (zero-cost) unless text sequences
   exist. **Done (next-steps T3):** `ViewComponentDescriptor::createInitialState` returns
   `nullptr`, and `ViewShadowNode::updateTextRunStateIfNeeded` allocates the `ViewState`
   lazily on the first runs (family `ConcreteState` ctor; null-safe early return otherwise).
   Probe: 43 Views constructed → 0 state allocations, 2 lazy allocations (the text Views).
3. **Events on bare text.** Fragments carry event-emitter attributes when their parent has a
   component handle (`RCTAttributedTextUtils.mm:434-442`); for runs directly under a View the
   fragment parent is the View itself (real family, real instance handle) so taps dispatch
   harmlessly to a real target — the synthetic-node `EventTarget::retain` null-deref hazard
   from Appendix A does not exist in this design. Inline tags with `onPress` work because
   their own families come from JS.
4. **Whitespace.** Implemented: CSS `white-space: normal` processing inside the new anonymous
   IFCs (collapse + line-edge trim; no back-compat exists there), verbatim behavior kept
   inside explicit `<Text>` (the exception clause). Whitespace-only anonymous flex items are
   dropped per flexbox. Landed in `InlineContentShadowNode::collapseWhitespace`; matrix M3 +
   web-mirror twins.
5. **Block layout is native Yoga, staged.** `display:'block'` (and the `<div>` tag) is a
   first-class `YGDisplayBlock` in Yoga (§3.A), not a flex emulation — the emulation only
   survives as the flag-off fallback. The block algorithm lands in stages (block-inner
   layout + inline flow → anonymous block boxes → margin collapsing → floats/static
   position); each stage is documented and separately flag-gated, so partial conformance is
   explicit rather than silent. Risk: this is a genuine Yoga change (new display type,
   layout path, and cache/dirtying interactions) — larger than the shared-C++ box generation,
   and the reason `<div>`/true-block is sequenced as its own workstream.
6. **Update path.** Text content changes arrive as RawText prop clones until stage 6, then
   as `commitTextUpdate` data updates on `Text` nodes (§3.F); either way the containing
   View's Yoga node must be dirtied and its anonymous item re-measured — Views don't
   observe child text today, so this dirty-propagation is new plumbing (analog of
   `shouldNewRevisionDirtyMeasurement`). State republishes; no identity churn anywhere —
   nodes are only ever the authored ones.
7. **Android.** Shared-C++ box generation compiles there, but Android paints text via
   platform TextViews, not a drawing pass; Android enablement needs its own mounting story.
   Flag ships default-off; iOS first.
8. **DevTools/DOM APIs** see exactly the authored tree — no attribution work needed (the
   main tooling win over Appendix A).
9. **`getAncestors` on text children** (`ShadowNodeFamily.cpp:101-139`) resolves through
   real children lists and keeps working, since the tree is unmodified.

## 5. Rollout — staged behind one disabled flag

All stages land behind the single `enableImplicitTextChildren` flag (default off); each has
Fantom acceptance tests as its exit criterion. The risky core representation change is
sequenced *last* so the feature never blocks on it (it remains a direct replacement, no
compat shims, when it lands).

1. **Anonymous-box ownership spike** (riskiest piece first): anonymous Yoga items over
   today's RawText nodes — layout + measure only, single-string case. Accept: bare string
   measures/lays out under flex Views in Fantom.
2. **Mounting + updates**: force-mount text-bearing Views (§3.B), View state, per-run
   views, `layoutSubviews` paint-order interleaving, text-change dirty propagation (§4.6),
   E (warning removal). Accept: render + update + reorder cases, paint-order test with
   mixed children.
3. **Block flow (emulated) + inline elements + whitespace**: initial `display:'block'` via
   the flex emulation (§3.A), blockification in flex, whitespace mapping. Accept: `a<b>b</b>c`
   matrix across flex/block. *(This is the stepping stone; stage 8 replaces the emulation
   with native Yoga block.)*
4. **Inheritance** with the `inheritViewTextStyles` compatibility split (§3.D). Accept:
   explicit-`<Text>` pixel-identity suite with the flag on.
5. **Intrinsic tags + typing**: `<b>`/`<i>`/`<span>` registration, the inline replaced
   `<img>`, and the block `<div>`; TS/Flow JSX typings. Accept: each tag lays out per its
   web display in the matrix + web mirror.
6. **Core text-node replacement** (§3.F): `createTextNode`/`commitTextUpdate` host-config
   path, delete `RCTRawText`. Separate change, own review.
7. RNTester page; Expo dogfood.
8. **Native Yoga `display:block`** (§3.A, §4.5): first-class `YGDisplayBlock` replacing the
   stage-3 emulation, so `<div>` is a true block container. Own sub-flag, own review;
   staged internally (block-inner layout + inline flow → anonymous block boxes → margin
   collapsing → floats/static position). This is the riskiest Yoga change and is sequenced
   as its own workstream — it can land after the rest of implicit text ships.

## 6. Verification performed

- All mechanism claims in §2-§4 verified by reading `main` sources (citations inline).
- **Fantom harness built and running locally** (macOS, `private/react-native-fantom`;
  required a `-Wdeprecated-literal-operator` patch to third-party nlohmann_json and Android
  cmdline-tools + NDK install).
- **Baseline verified green** (`Libraries/Text/__tests__/ImplicitText-itest.js`):
  `<View><Text>hello</Text></View>` mounts `<rn-view><rn-paragraph>` as expected; bare
  strings and mixed strings mount nothing — confirming §2 exactly (including the dev warning
  being non-fatal and prop-less Views getting view-flattened).
- **Events/DOM API paths verified in source** for §3.G: `touchEventEmitterAtPoint:` is an
  open protocol invoked on whatever component view is hit
  (`RCTSurfaceTouchHandler.mm:84`, `RCTSurfacePointerHandler.mm:162`); the DOM layer
  resolves `childNodes` via per-node instance handles (`ReadOnlyNode.js:393-403`), which
  `createTextInstance` already supplies.
- **Appendix A prototype** (commit-hook synthesis, ~120 lines) compiled and exercised the
  shared machinery end-to-end; its run surfaced the single-parent family assert
  (`ShadowNodeFamily.cpp:37`) — evidence for why reparenting-free designs (this plan) are
  structurally cleaner. The box-generation design (§3.A) has *not* been prototyped yet; its
  riskiest piece is item 1 in §4.

## 7. Open questions

- ~~Blockify inline elements or group them?~~ **Decided: follow CSS per display type** —
  blockify in flex containers (spec), group into one flow in `display:'block'` containers.
- ~~White-space processing inside new IFCs: CSS-normal collapsing or JSX-verbatim
  everywhere?~~ **Decided: CSS-normal collapsing** (§4.4), implemented in
  `InlineContentShadowNode` for anonymous IFCs only; explicit `<Text>` stays verbatim.
- Should `textAlign`/`lineHeight` inherit in v1 (interaction with Yoga alignment)?
- `display:'inline'` opt-in for the RN `View`/`Image` components in v1 or later? (Distinct
  from the intrinsic `<img>` tag, which is inline by definition — this is about letting an
  authored `View`/`Image` go inline. Attachment machinery is ready; classification is
  trivial; API review is the work.)
- **Native Yoga `display:block`: decided.** `<div>`/true block is implemented as a real
  `YGDisplayBlock` in Yoga (§3.A, §4.5), because a genuine `<div>` cannot be faked on flex
  column+stretch.
  - ~~First-release conformance floor?~~ **Decided: inline-flow + block-stacking is the
    floor**; margin collapsing and floats/static-position are later, separately-gated stages.
  - ~~Same flag or its own?~~ **Decided: its own sub-flag** (e.g. `enableYogaDisplayBlock`),
    separate from `enableImplicitTextChildren`. Native block modifies Yoga's core layout
    algorithm — it can regress *any* app's layout, not just implicit-text surface — so it
    needs an independent kill-switch, rollout %, and emulation-vs-native parity testing. The
    block grouping predicate carries both paths (native when on, flex emulation when off)
    until the emulation is retired.
- **North star: no flags — layout is determined by element type.** Feature flags
  (`enableImplicitTextChildren`, `enableYogaDisplayBlock`) are *transitional rollout
  scaffolding*, not the destination. The committed end-state is flag-free: an element's type
  alone determines its layout (`View` → block/flex, `<div>` → block/block, `<span>`/`<img>`
  → inline, `<Text>` → the `<p>` analog, bare strings → text runs). Each flag is removed once
  its behavior is proven and default-on; the emulation fallbacks (and the flag branches
  themselves) are deleted at that point. Design every stage so its flag is *retirable* — no
  behavior that only makes sense while the flag exists.

---

## Appendix A: the synthesized-Paragraph (commit hook) alternative — designed, prototyped, demoted

A `UIManagerCommitHook` (`UIManager.cpp:595`) that rewrites each committed tree, wrapping
inline runs in real `ParagraphShadowNode`s created through the descriptor flow
(`UIManager::createNode` recipe, `UIManager.cpp` `createNode`), with negative synthetic tags
and `nullptr` instance handles (precedent: the surface root family, `ShadowTree.cpp:245-253`).
Idempotent by construction; `progressState` (`ShadowTree.cpp:60-179`) is the traversal/memo
template; family caching keyed per (parent family, run) gives update stability.

Status: implemented as `ReactCommon/react/renderer/uimanager/ImplicitTextCommitHook.{h,cpp}`
(~120 lines) + registration in `UIManager::setComponentDescriptorRegistry`; compiles; first
run trips the single-parent assert (`ShadowNodeFamily::setParent`, `ShadowNodeFamily.cpp:37`)
when adopting React-owned text children — resolvable (last-writer-wins or a scoped
reassignment API), but emblematic of the approach's flaw: anonymous boxes leak into the
"DOM". Also requires an `EventTarget::retain` null-guard (`EventTarget.cpp:31`) before any
touch lands on synthesized text, DevTools/DOM attribution work, and identity caching.

Kept because: it is the fastest path to a demo, exercises identical text machinery, and its
Fantom test doubles as the acceptance suite for the §3 design (expected outputs differ only
in there being no `rn-paragraph` wrapper — the View itself carries the text runs).

---

## Status addendum (2026-07-21, post-implementation)

All matrix milestones (M1-M7) plus iOS painting, intrinsic tags, unknown-element
DOM semantics (incl. `nodeName`/`tagName` fidelity, dev bundle), the §3.E warning
removal, and CSS `white-space: normal` collapsing inside anonymous IFCs
(§3.A/§4.4) are implemented on this branch and verified: Fantom 39/39 +
regression sweeps, Safari web mirror 18/18, iPhone 17
Pro (iOS 26.5) simulator screenshots, and live CDP layout reads
(`packages/rn-tester/scripts/implicit-text-cdp-verify.js`). Demo:
`packages/rn-tester/js/ImplicitTextDemo.js`. Next: mine Web Platform Tests
(css/CSS2 normal-flow + visuren, css-flexbox anonymous items, css-display,
css-text white-space, css-inline, dom/nodes, HTMLUnknownElement) for additional
matrix cases; production hardening list in §4 unchanged.
