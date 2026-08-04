# Structurally correct registration for the intrinsics + making expo-intrinsics an autolinked library

## 1. Why every "app registers → core consults" scheme fails (the real root cause)

The intrinsics register **eagerly**, at component-factory init:
- **iOS**: `RCTParagraphComponentView.supplementalComponentDescriptorProviders` is captured once inside
  `RCTComponentViewFactory`'s one-time setup, triggered by `RCTViewComponentView +load`.
- **Android**: `CoreComponentsRegistry.addCoreComponents` builds the provider registry during Fabric init.

Both fire **before app/module init on device** (proved on iOS: paragraph read `.361` < app register `.362`;
the app's code is in a late-loading `RNTester.debug.dylib`). So *any* scheme where the app populates a
registry that core reads eagerly — including Seam 3's `IntrinsicComponentDescriptorRegistry` — loses the
race. This isn't a bug to patch; **eager registration is the wrong mechanism.**

## 2. The structurally correct mechanism: lazy, on-demand resolution (how real Fabric libraries work)

RN already resolves components **lazily** and it's timing-safe. Verified in the code:

```
ComponentDescriptorRegistry::at(name)                     // reconciler needs "b" during commit
  → miss → providerRegistry_.request("b")                 // ComponentDescriptorRegistry.cpp:73
    → componentDescriptorProviderRequest("b")             // the lazy hook
      → RCTComponentViewFactory._registerComponentIfPossible("b")   // iOS
          Fallback 1: RCTComponentViewClassWithName("b")
          Fallback 2: thirdPartyFabricComponentsProvider.thirdPartyFabricComponents["b"]  // codegen/autolinking
```

The request fires on a descriptor **miss**, which happens during **commit** (when JS first renders `<b>`) —
long after all native init. `thirdPartyFabricComponentsProvider` is the **codegen + autolinking** artifact
(set from `RCTAppDependencyProvider` in `RCTReactNativeFactory`). This is precisely why `react-native-svg`
et al. never have a timing problem: their components resolve on first use, not at load.

**So the fix is to route intrinsic resolution through this lazy path instead of eager capture** — i.e., make
expo-intrinsics a normal autolinked Fabric library. Core then names nothing and there is no init-order race.

## 3. The one wrinkle: `<b>`/`<i>`/`<span>`/`unknown` are descriptor-only

`img` and `div` are view-backed — they slot into the standard path directly (real component views /
ViewManagers). But `b/i/span/unknown` are **inline text**: they have a ComponentDescriptor (so the shadow
node can be created) but **never mount a view** (the paragraph absorbs them; Android's error `Can't find
ViewManager 'b'` is exactly "descriptor missing, so Fabric wrongly tried to mount it"). The lazy path above
is keyed on **view classes**. Two ways to satisfy it:

- **(A) Phantom component views — no core change.** Give `b/i/span/unknown` trivial `RCTViewComponentView`
  subclasses (iOS) / minimal ViewManagers (Android) whose only job is to supply the descriptor via
  `[klass componentDescriptorProvider]`. They are registered via the normal codegen/autolinking provider,
  resolved lazily on first `<b>`, and **never instantiated** because the shadow node's traits say it forms no
  view. This works today.
- **(B) A generic "virtual component" registration in RN core — cleaner, needs an RN change.** Let a library
  contribute *descriptor-only* providers that the lazy `providerRegistry_.request` path consults (a generic
  registry keyed by name, consulted **on miss**, not eagerly). This is Seam 3's registry — but read *lazily*
  at request time instead of *eagerly* at factory init, which removes the race. Small, generic, no DOM names
  in core. Best long-term, but it's an upstream RN core addition.

Recommendation: ship with **(A)** (unblocks now, standard mechanism), and propose **(B)** upstream so
descriptor-only intrinsics are first-class.

## 4. Making `packages/expo-intrinsics` an autolinked library

Structure it as a standard RN Fabric component library so autolinking + codegen wire registration at the
correct load phase on every platform:

```
packages/expo-intrinsics/
  package.json            # name, RN peer dep, and:
    "codegenConfig": { "name": "ExpoIntrinsics", "type": "components",
                       "jsSrcsDir": "src/specs" }   # NativeComponent specs for b/i/span/img/div
  src/
    index.ts              # side-effect: register view configs + install the unknown resolver (already built)
    specs/*NativeComponent.ts   # codegenNativeComponent specs (drives descriptor/props codegen)
  ios/
    *.podspec             # compiles the C++ shadow nodes + ObjC component views
    RCT{Img,Div,B,I,Span,Unknown}ComponentView.{h,mm}   # real for img/div, phantom for the text ones
  cpp/react/renderer/components/intrinsics/   # the shadow nodes, moved out of RN core:
    InlineTextTagShadowNodes.{h,cpp}          #   from components/text
    DivShadowNode.h                            #   from components/view  (+ move the ConcreteState<ViewState>
    ImgTagShadowNode.{h,cpp}                   #   instantiation out of ViewShadowNode.cpp)
                                               #   from components/image  (extract from ImageShadowNode)
  android/
    build.gradle
    src/.../ExpoIntrinsicsPackage.kt          # ReactPackage: ViewManagers (real img/div, phantom text)
    src/.../jni + codegen                      # autolinked ComponentDescriptors
  react-native.config.js  # autolinking entry
```

Autolinking then does what it does for any library: iOS adds the components to
`thirdPartyFabricComponentsProvider` (lazy resolution), Android registers the `ReactPackage` + codegen
descriptors at Fabric-init. **No manual app-init call, no `IntrinsicComponentDescriptorRegistry`, and RN core
references none of it** — which also finishes the "core is DOM-agnostic" goal for real.

Prereqs discovered this session that this phase must also do:
- Extract `DivShadowNode` (and its `ConcreteState<ViewState>` explicit instantiation) out of core
  `ViewShadowNode.cpp`, and `ImgTagShadowNode` out of core `ImageShadowNode.h` — currently these intrinsics
  are *defined inside* core components.
- The string-children / text-node **engine** stays in RN core (per the standing decision); only the element
  catalog moves.

## 5. Recommendation / sequencing

1. **Now:** revert Seam 3 to the Stage-1 direct-`dom::` wiring so all three platforms are green again (the
   generic registry is the wrong shape; keep the good parts — the DOM-agnostic *unknown* hook (Seam 1/2/4)
   stays, it has no timing dependency).
2. **Next:** stand up `packages/expo-intrinsics` as an autolinked library per §4, using phantom component
   views (A) for the descriptor-only text intrinsics. This is the real fix and simultaneously completes the
   extraction — the eager-capture and the core references both disappear.
3. **Optional upstream:** propose (B), a lazy descriptor-only "virtual component" provider, so text-like
   intrinsics don't need phantom views.
```
