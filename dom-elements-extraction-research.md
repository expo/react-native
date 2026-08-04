# Research: The DOM **elements** module (`<div>`, `<span>`, `<i>`, `<b>`, `<img>`, `<unknown>`)

*Scope clarified (2026-07-23): string children / text nodes / the implicit-text engine (anonymous
IFC, style inheritance, `display:block`) are **built into RN core** — not part of this module. The
module is the **element catalog** only: the intrinsic tags plus HTMLUnknownElement handling.
Grounded in the `frontier` diff vs `upstream/main` (merge-base `bf691fa53c2`).*

---

## 1. What the module is (and isn't)

**In the module** — the elements, each a thin, additive registration:
- `b`, `i`, `span` — inline text elements (`TextShadowNode` subclasses with baked-in `fontWeight`/`fontStyle`)
- `img` — inline replaced element (Image-backed, routes inline instead of blockifying)
- `div` — block element (a View with `display:block` forced on)
- `unknown` — the **HTMLUnknownElement fallback**: any unregistered lowercase tag resolves here

**In core (not the module), by decision** — the engine every element leans on:
- text nodes / string children, the anonymous inline-formatting-context in View
- style inheritance cascade, `display:block` in Yoga, the mount-layer text-run painting
- the `enableStringChildren` flag plumbing

This is a much cleaner split than treating the whole feature as one unit. The elements are a
**catalog that registers against a core engine**. The engine is settled core.

---

## 2. The elements are already module-shaped — except how they register

Each tag is: a JS view-config + a C++ `ConcreteShadowNode` subclass + a descriptor. Nothing in
core changes *shape* for a tag to exist. The only thing keeping them from being a module today is
that their **descriptors are hand-wired into three separate core registries**:

- iOS: `RCTParagraphComponentView.mm` → `supplementalComponentDescriptorProviders` enumerates `BTag`/`ITag`/`SpanTag`/`UnknownElement`/`TextNode` descriptors.
- Fantom: `StubComponentRegistryFactory.h` enumerates all of them + `ImgTag`/`Div`.
- Android: `CoreComponentsRegistry.cpp` — **not registered yet** (the elements don't work on Android).

**Fix = one module-owned entrypoint** that each registry calls once:
```cpp
// components/dom/DomElementsRegistry.h
namespace facebook::react::dom {
  void registerComponents(ComponentDescriptorProviderRegistry&);   // Android core registry
  std::vector<ComponentDescriptorProvider> supplementalProviders(); // iOS Paragraph seam + Fantom
}
```
Each of the three registries collapses to one line; the enumerated type names stop leaking into
core; Android gets fixed for free. This is the single highest-value first step and it's small.

JS mirror: one side-effect module (`Libraries/DomElements/index.js`) registers every tag's view
config, replacing the current `InlineTags.js` import target.

---

## 3. `<unknown>` — the one element that needs a core *resolution* seam

This is the interesting part of your question, because the unknown element is fundamentally
different from the others. Every named tag (`b`, `img`, …) resolves by **matching** its registered
name. The unknown element resolves by **not matching** — it must catch the tags nobody registered.
A component that registers itself by name inherently *cannot* do that from outside core. So the
unknown element forces exactly one new core extension point.

**How it works today (all verified in the diff):**

1. **JS resolution (the catch-all).** `ReactNativeViewConfigRegistry.get(name)` — when a lowercase
   name has no registered config, it falls back to a singleton `unknown` view config
   (`uiViewClassName: 'unknown'`, `validAttributes: {nodeName: true}`). Uppercase names (real RN
   components) still throw. **This lives in a core shim file** — it's the resolution seam.
   ```js
   if (typeof name[0] === 'string' && /^[a-z]/.test(name)) return getUnknownElementViewConfig();
   ```
2. **Tag-name preservation.** All unknown tags share one view config, so the authored tag is lost
   here. The renderer injects it as a `nodeName` prop when `uiViewClassName === 'unknown'`
   (a patch in the vendored `ReactFabric-*.js` host config).
3. **C++ element.** `UnknownElementShadowNode` — a `TextShadowNode` subclass, component name
   `"unknown"`, **inline + unstyled** (true HTMLUnknownElement semantics). `UnknownElementProps`
   carries `nodeName`. Because JS already rewrote the component to `"unknown"`, C++ needs no
   fallback of its own — it just needs the `unknown` component registered (module-owned).
4. **DOM reporting.** `DOM.cpp` reads `nodeName` off `UnknownElementProps` so `HTMLUnknownElement`
   reports its real authored tag (e.g. `<foo>` → `nodeName === 'foo'`).

**How to make it module-owned (the recommendation):** the module can own the unknown element's
*definition and policy*; core only needs to expose the *dispatch point*. Two small, generic seams
replace today's DOM-specific special-cases:

- **Registry fallback hook** (replaces the hardcoded `getUnknownElementViewConfig` branch):
  ```js
  ReactNativeViewConfigRegistry.registerFallback(name =>
    /^[a-z]/.test(name) ? unknownElementViewConfig : null);
  ```
  Core keeps ~3 generic lines ("if unresolved and a fallback is registered, call it"); the *policy*
  (lowercase → HTMLUnknownElement) moves into the module's side-effect import.
- **Generic node-name recording** (replaces the `=== 'unknown'` renderer special-case): a
  `recordNodeName: true` flag on any view config, so the renderer patch becomes
  `if (viewConfig.recordNodeName) props.nodeName = type` — no DOM knowledge in the reconciler. The
  module opts in via its unknown view config. (Durable home for this is React's host config
  upstream; vendored-bundle patch meanwhile — same pattern as plan §E.)

That leaves core with only: the generic fallback hook (JS shim), the generic `recordNodeName`
renderer line, and the `DOM.cpp` nodeName read. Everything DOM-specific about the unknown element
— the singleton config, the `/^[a-z]/` policy, the `UnknownElementShadowNode`, the descriptor —
lives in the module.

---

## 4. Proposed module layout (in-tree first)

```
packages/react-native/
  Libraries/DomElements/
    index.js                # side-effect: registers b/i/span/img/div view configs
                            #   + installs the unknown-element registry fallback
    __tests__/              # the element-specific tests
  ReactCommon/react/renderer/components/dom/
    InlineTextTagShadowNodes.{h,cpp}   # BTag / ITag / SpanTag / UnknownElement
    DivShadowNode.h
    ImgTag*                            # (currently living in components/image — move or re-export)
    DomElementsRegistry.h              # registerComponents() / supplementalProviders()
    CMakeLists.txt + podspec fragment
```
Core keeps: TextNode/string-children engine, the registry **fallback hook**, the renderer
`recordNodeName` line, `DOM.cpp` nodeName read.

---

## 5. Staging

1. **Now — one boundary + one registration entrypoint.** Move the element files into the folders
   above; add `dom::registerComponents()` / `supplementalProviders()`; collapse the three core
   registries to one line each (fixes Android). Pure refactor, flag-gated, no behavior change.
2. **Next — convert the two unknown-element special-cases into generic core seams** (`registerFallback`
   + `recordNodeName`), so all HTMLUnknownElement policy lives in the module. Write down the
   remaining core contract (§6).
3. **Someday — own repo.** Once the elements register only through `ComponentDescriptorProviderRegistry`
   + the two generic seams (no bespoke core edits), the module is a normal autolinked Fabric
   component library (`react-native-dom-elements`) depending on a published RN whose core ships the
   engine behind the flag.

---

## 6. Core contract the module depends on (can't move)

- `TextShadowNode` / `TextProps` (base for `b`/`i`/`span`/`unknown`), `ViewShadowNode` +
  string-children engine (base for `div`), `ImageShadowNode` (base for `img`)
- the `unknown` **resolution fallback** in `ReactNativeViewConfigRegistry` — the one seam only core
  can provide, because it catches *unregistered* names
- generic `nodeName` recording (renderer) + read (`DOM.cpp`) for HTMLUnknownElement tag preservation
- `createReactNativeComponentClass` / `ReactNativeViewConfigRegistry` JS registration path
- `enableStringChildren` flag infra + Yoga `display:block`

---

## 7. Bottom line

- The module is the **element catalog**: `b`/`i`/`span`/`img`/`div` + the `unknown` fallback. Text
  nodes and the implicit-text engine are core.
- The named tags are already module-shaped; the only blocker is scattered registration → fix with a
  single `registerComponents()` entrypoint (also fixes the missing Android registration).
- `<unknown>` is special: it resolves by *not matching* a name, so it needs one core dispatch seam
  the module plugs into. Generalize today's two hardcoded special-cases (`getUnknownElementViewConfig`
  branch, `=== 'unknown'` renderer check) into a `registerFallback` hook + a `recordNodeName` flag,
  and all HTMLUnknownElement policy moves into the module.
