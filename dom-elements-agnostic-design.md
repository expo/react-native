# Design: DOM-agnostic RN core + a standalone `expo/dom`-style elements module

*Goal (from 2026-07-24): RN core knows **nothing** about `<b>`/`<i>`/`<span>`/`<div>`/`<img>`/
`unknown`. It exposes **generic** extension points — (1) a way to define intrinsic components, and
(2) a hook for unknown-element resolution. All DOM specifics live in a self-contained module
structured as if it were its own repo (`expo/dom`).*

This supersedes Stage 1's approach, where `DomElementsRegistry.h` lived **inside** RN core
(`components/text/`) and core registries called `dom::…`. That coupling is exactly what we're
removing. Stage 1's file move + verification harness stay useful; the registration wiring inverts.

---

## The principle: core provides mechanism, the module provides policy

| Concern | Today (DOM-specific in core) | Target (generic core + module) |
|---|---|---|
| Which tags exist | core registries enumerate `BTag`/`ITag`/`span`/`div`/`img`/`unknown` | module registers them through a generic RN API |
| Unresolved lowercase tag | `get()` hardcodes `getUnknownElementViewConfig()` | core calls a module-registered **resolver hook** |
| Preserve authored tag name | renderer hardcodes `=== 'unknown'` → `nodeName` | generic `recordNodeName` view-config flag |
| Report node name to DOM APIs | `DOM.cpp` special-cases component `"unknown"` | any node carrying a `nodeName` prop reports it |

Core ends up with four small **generic** seams; every DOM string (`"unknown"`, `b`, `i`, …) lives
only in the module.

---

## The four generic seams RN core must expose

### Seam 1 — JS: unknown/fallback view-config resolver *(clean, low-risk)*
`ReactNativeViewConfigRegistry` gains a registration hook; `get()` delegates instead of hardcoding:
```js
// core — generic, no DOM knowledge
let fallbackResolver: ?(name: string) => ?ViewConfig = null;
export function setFallbackViewConfigResolver(fn) { fallbackResolver = fn; }

export function get(name: string): ViewConfig {
  ...
    if (typeof callback !== 'function') {
      const fromFallback = fallbackResolver?.(name);
      if (fromFallback != null) return fromFallback;   // <-- the only change
      invariant(false, ...);
    }
  ...
}
```
The module (`expo/dom` entry) installs the HTMLUnknownElement policy:
```js
// module
ReactNativeViewConfigRegistry.setFallbackViewConfigResolver(name =>
  /^[a-z]/.test(name)
    ? {uiViewClassName: 'unknown', bubblingEventTypes: {}, directEventTypes: {},
       validAttributes: {nodeName: true}, recordNodeName: true}
    : null);
```

### Seam 2 — Renderer: generic `recordNodeName` flag *(vendored-bundle patch, plan §E pattern)*
Replace the `"unknown"` special-case in `ReactFabric-*.js` with a config-driven one:
```js
if (viewConfig.recordNodeName) keepChildren = {...keepChildren, nodeName: workInProgress.type};
```
Now any intrinsic component can opt into tag-name preservation; the reconciler names no tag.

### Seam 3 — C++: a generic intrinsic-component descriptor registry *(the substantive one)*
This is the real work. Core exposes a process-wide registry that modules populate and the core
component registries consult — so **no** core file names a DOM descriptor:
```cpp
// react/renderer/componentregistry/IntrinsicComponentDescriptorRegistry.h  (RN core, generic)
class IntrinsicComponentDescriptorRegistry {
 public:
  static IntrinsicComponentDescriptorRegistry& shared();
  // inlineText: resolves inside a paragraph's inline formatting context (<b>/<i>/<span>/unknown)
  void add(ComponentDescriptorProvider provider, bool inlineText);
  std::vector<ComponentDescriptorProvider> all() const;
  std::vector<ComponentDescriptorProvider> inlineText() const;
};
```
- iOS `RCTParagraphComponentView` supplemental providers = base text nodes **+ `…::shared().inlineText()`**
- `CoreComponentsRegistry` (Android) / Fantom stub = base **+ `…::shared().all()`**
- `expo/dom` registers its descriptors into `shared()` at init.

**The hard problem — registration/init ordering.** The providers must be in the registry *before*
those component registries are built. Options, preferred first:
1. **Explicit module init entrypoint** (how third-party Fabric components already register): the app
   calls the module's `registerComponents()` once at startup, before the surface starts. Autolinking
   generates this call for real libraries; in this fork we call it from RNTester setup / the Fantom
   stub / an Android `ReactPackage`. Deterministic, no static-init-order trap.
2. Static registrar object in the module TU (simple, but static-init order across TUs is unspecified —
   rejected as the primary path; usable only where the registry is built lazily on first surface).

Recommendation: **(1)** — it matches how RN already onboards out-of-tree components, so the module
stays a normal Fabric component library.

### Seam 4 — C++: generic node-name reporting in `DOM.cpp`
Replace `if (componentName == "unknown") …` with: if the node's props carry a non-empty `nodeName`,
use it. Trait- or prop-based, no `"unknown"` literal. HTMLUnknownElement keeps its tag; core stays
generic.

---

## The module, shaped like its own repo

```
packages/react-native-dom/            # the in-fork stand-in for expo/dom — self-contained
  package.json                         # own name, deps on react-native
  src/index.js                         # registers b/i/span/img/div view configs
                                        #   + installs the unknown resolver (Seam 1)
  cpp/react/renderer/components/dom/    # its OWN component dir (own CMake / podspec / gradle)
    InlineTextTagShadowNodes.{h,cpp}    # moved out of RN core components/text
    DivShadowNode.h                     # moved out of RN core components/view
    ImgTagShadowNode.{h,cpp}            # extracted from RN core components/image ImageShadowNode
    DomComponentsRegistry.{h,cpp}       # registers all of the above into RN's IntrinsicComponentDescriptorRegistry
  ios/ / android/                       # ComponentView / ViewManager glue, codegen config
  README.md
```
RN core (`packages/react-native/`) references **none** of this. The module depends only on RN's
public headers (`TextShadowNode`, `ViewShadowNode`, `ImageShadowNode`, the intrinsic registry) + the
string-children engine that stays in core.

---

## Decisions I need before executing

1. **Module location/name in this fork.** New top-level package `packages/react-native-dom/`
   (self-contained, own native build files) — the closest in-monorepo analog to a separate
   `expo/dom` repo? Or a different name/path?
2. **C++ intrinsic-component registry** — OK with `IntrinsicComponentDescriptorRegistry` in RN core
   as the generic seam, with the module registering via an **explicit init entrypoint** (option 1)?
   This is the one new piece of RN public surface.
3. **`<img>`** currently lives inside RN core's `ImageShadowNode.h` (reuses Image machinery). Move
   `ImgTagShadowNode` into the module (depending on core's public Image headers), or leave it in core
   for now and move later?
4. **Vendored renderer patch** for the generic `recordNodeName` flag — OK to edit the `ReactFabric-*.js`
   bundles (same as plan §E), with the durable fix upstreamed to React's host config later?

## Suggested execution order (once confirmed)
1. Seams 1 + 2 + 4 (JS resolver hook, generic `recordNodeName`, generic `DOM.cpp` node name) — RN
   goes DOM-agnostic on the JS/DOM side; Fantom-verifiable.
2. Seam 3 (intrinsic descriptor registry + init entrypoint); flip the three registries to consult it;
   move `DomComponentsRegistry` out of core.
3. Stand up `packages/react-native-dom/` and physically relocate the descriptor sources + build glue.
4. Delete the now-unused `components/text/DomElementsRegistry.h` from Stage 1.
