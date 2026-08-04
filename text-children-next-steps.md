# Text Children: Remaining Work — an actionable backlog

This is the **work queue** for the text-children feature. It assumes you have done the ramp-up
in `text-children-onboarding.md` (spec + code tour) and have read the design in
`text-children-plan.md` (the living spec). This document does not re-teach those; it tells you
**exactly what is left, how to verify each item, and when it is done.**

Every task below follows the same shape:

> **Goal** — what a user can do when this ships.
> **Why / context** — the spec rule and the design decision behind it.
> **Entry points** — the files (and where in them) you will touch.
> **Approach** — the concrete steps.
> **Testing methodology** — how you *prove* it works (this project is test-first).
> **Acceptance** — the checklist that must be true to call it done.
> **Effort / risk / deps** — sizing and sequencing.

---

## 0. Where things stand (read first)

Implemented and green behind the `enableStringChildren` flag (default off): bare strings
under a View render as anonymous inline-formatting-context boxes (M1–M7), iOS painting, the
`<b>`/`<i>`/`<span>` intrinsic tags, unknown-element HTML semantics, `display:'block'` (flex
**emulation**), the full CSS **inherited text-property set** cascading into bare text with live
updates, and public `display:'block'` types. Matrix is 35/35 under Fantom; the web mirror is
15/15 in Safari.

Three §5 items are done: **inherited-property set**, **cascade correctness**, **`display:'block'`
public types**. **T1 (white-space), T2 (unknown-element `nodeName`, dev bundle), T3 (lazy
View state), and T4 (native Yoga `display:block`, Stage 1) are now done** — see their sections.
Everything else below is open.

## 1. The shared build / test loop (all tasks use this)

Exact incantations (see `text-children-onboarding.md` §4 for detail, §6 for gotchas):

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools

# Rebuild the Fantom C++ tester after ANY C++ change (yarn fantom will NOT do this for you):
cmake --build private/react-native-fantom/build/tester -j10

# Run a suite:
yarn fantom packages/react-native/Libraries/Text/__tests__/StringChildrenBehavior-itest.js
```

**The deterministic measurer contract** (cxx `TextLayoutManager`, flag-gated) is how intrinsic
text sizing is asserted headlessly: **10pt/char** (+2pt bold, +1pt italic, + `letterSpacing`
per char); **line height** = explicit `lineHeight` if set, else `fontSize + 6`; naive wrap at
the width constraint. Extend it deliberately (and document it) if a task needs a new observable
dimension.

**Web mirror** (`__tests__/__fixtures__/string-children-web-mirror.html`): every behavioral case
gets a browser twin. Verify in Safari over http (safaridriver refuses `file://`):

```bash
sudo safaridriver --enable   # once
cd packages/react-native/Libraries/Text/__tests__/__fixtures__
python3 -m http.server 8099 & safaridriver -p 4444 &
# W3C WebDriver: POST /session, POST /session/{id}/url to http://localhost:8099/…html,
# POST /session/{id}/execute/sync returning JSON.stringify(window.__results). Title = "ALL PASS".
```

**Feature-flag regen** (needed only for tasks that add a flag): edit
`scripts/featureflags/ReactNativeFeatureFlags.config.js`, then
`mise exec node@24 -- yarn featureflags --update` — **node 24, not the default node 25**, which
the `engines` check rejects.

### Definition of Done (applies to every task, from onboarding §7)

1. Matrix + baselines + regression suites green under Fantom
   (`StringChildrenBehavior-itest.js`, `StringChildrenBaseline-itest.js`, `Text-itest.js`,
   `ReadOnlyText-itest.js`, `ReactNativeElement-itest.js`).
2. Web-mirror twin added/updated and passing in Safari; spec section cited in the test.
3. Explicit `<Text>` pixel-identity untouched (the baseline guards prove it).
4. Checkpoint commit whose message states known-working and known-broken.
5. Behavior change reflected in `text-children-plan.md` (the living spec).

Tasks whose verification cannot be headless (simulator/device) say so and give the manual proof.

---

## 2. Recommended order

Do the **Track A** items first — they close in the headless loop with the tightest feedback.
**Track B/C** are the two large core efforts (pick one and give it a dedicated run).
**Track D/E** need a simulator/device or Android and are best batched when you have that set up.

**Renumbered 2026-07-21** (per direction): the iOS simulator items were pulled forward to
T5–T7 and first-class text nodes (Track C, the plan's own-review item) deferred to **T8**.
T1–T9 are done. T8 replaced RawText with first-class `#text` nodes (RawText deleted, headless-
verified). Only T10 (Android mounting story) remains.

**iOS-correctness pass 2026-07-21** (per direction "once iOS is 100% correct it will be a
better starting point for Android"): brought the whole feature to correct on-device rendering on
the `#text` model. (a) `pod install` regenerated the header map so the T8 RawText deletion +
`#text`/`createTextNode` path compiles/links/runs on iOS. (b) **`<div>` was rendering an empty
box** — `DivShadowNode` extended `ConcreteViewShadowNode` directly and so never inherited
`ViewShadowNode`'s text-children layout/paint machinery; fixed by templatizing the view shadow
node into `AbstractViewShadowNode<name, props>` (same non-type-param pattern the base
`ConcreteViewShadowNode` uses) so `<View>` and `<div>` share one copy (View behavior byte-
identical — same base types). (c) Registered `RCTDivComponentView` (seeds `_props` with a
default `DivProps`, self-registers via `+load`). (d) **Inline `<img>`** now positions at its
exact inline offset (text-layout attachment frame, exposed to the View through the
`InlineTextContentAccessor` seam so the view module keeps no text-module dependency) and the
painted run reserves the image's width (measure attachments on the paint path instead of reading
the never-laid-out box child's zero metrics). **Verified:** RNTester on iPhone 17 Pro (iOS 26.5),
all 11 demo cases render correctly; 54/54 Fantom itests (StringChildrenBehavior, StringChildrenNativeBlock,
StringChildrenBaseline) still pass. Remaining: revert the `enableStringChildren` flag default
`true→false` before the checkpoint commit (flipped on for the demo), then T10 (Android).

| # | Task | Track | Verifiable headlessly? | Size | Depends on | Status |
|---|---|---|---|---|---|---|
| T1 | White-space processing | A | ✅ | S–M | — | ✅ done |
| T2 | Unknown-element nodeName fidelity | A | ✅ (dev bundle) | S | — | ✅ done |
| T3 | Lazy View state | A | ~ (alloc + regression) | M | — | ✅ done |
| T4 | Native Yoga `display:block` | B | ✅ (Fantom parity) | XL | own flag | ✅ done (Stage 1) |
| T5 | iOS paint order + per-run views | D | ❌ (simulator) | M | — | ✅ done |
| T6 | iOS touch hit-testing on drawn text | D | ❌ (simulator) | M | **T5** | ✅ done |
| T7 | Intrinsic `<img>` tag | D | headless + device | M | — | ✅ done (device: inline offset + width reserved) |
| T8 | First-class text nodes (replace RawText) | C | headless (dev bundle) | XL | — | ✅ done (device-verified on iOS) |
| T9 | Intrinsic `<div>` tag | B | ✅ | S | **T4** | ✅ done (device-verified; shared via `AbstractViewShadowNode`) |
| T10 | Android mounting story | E | ❌ (Android) | XL | — | open |

---

## Track A — headless, tight loop

### T1. White-space processing inside anonymous IFCs — ✅ DONE

- **Status (done).** Implemented as `collapseWhitespace` in
  `InlineContentShadowNode.cpp`, applied in both `getContentAttributedString` (paint) and
  `measureContent` (layout) after `buildAttributedString`, so it affects anonymous IFCs
  only — explicit `<Text>` stays verbatim. Collapses runs of ASCII whitespace to a single
  space across fragment boundaries, trims the IFC's leading/trailing edges, drops emptied
  fragments; attachment fragments are opaque anchors; whitespace-only runs are still dropped
  upstream in `AnonymousTextContent.cpp`. §7 decision (CSS-normal collapsing) recorded in the
  plan. Tests: `StringChildrenBehavior-itest.js` M3 (3 cases) + web-mirror twins (Safari 17/17).
- **Goal.** Bare-text runs collapse runs of whitespace and trim line edges per CSS
  `white-space: normal`, so `<View>{"  a   b  "}</View>` lays out like the web, while explicit
  `<Text>` keeps RN's verbatim behavior.
- **Why / context.** css-text-3 §3. This is new surface (nothing rendered in bare-text runs
  before), so there is no back-compat to violate. **Blocked on a decision** (plan §7 open
  question): CSS-normal collapsing (proposed) vs. JSX-verbatim. Get sign-off before coding.
- **Entry points.** `InlineContentShadowNode::getContentAttributedString`
  (`components/text/InlineContentShadowNode.cpp`) — or a shared preprocessing step in
  `BaseTextShadowNode.cpp` applied only to the anonymous-IFC path (must NOT touch the
  Paragraph/`<Text>` path). The measurer already counts characters, so collapsing is observable.
- **Approach.** After building the run's `AttributedString`, apply white-space normalization to
  the fragment strings for anonymous IFCs only: collapse internal runs of ASCII whitespace to a
  single space, trim leading/trailing whitespace at IFC edges, and preserve the existing
  whitespace-only-item drop (flexbox rule). Gate everything on `enableStringChildren`.
- **Testing methodology.** Matrix cases: `{"  a   b  "}` measures the width of `"a b"` (3 chars
  = 30pt), leading/trailing spaces contribute nothing; a whitespace-only run stays zero-height
  (already covered — keep it green). Explicit-`<Text>` control with the same string keeps its
  current width (verbatim) — this is the pixel-identity guard. Add web-mirror twins asserting
  `getBoundingClientRect` widths against a browser `<div>` vs a `white-space:pre` control.
- **Acceptance.** DoD 1–5; collapsing applies **only** inside anonymous IFCs (a `<Text>`
  verbatim test proves the split); the §7 decision is recorded in the plan.
- **Effort / risk / deps.** S–M. Risk: leaking normalization into `<Text>`. Dep: sign-off.

### T2. Unknown-element `nodeName` fidelity — ✅ DONE (dev bundle; prod is a follow-up)

- **Status (done).** (a) Added `UnknownElementProps : TextProps` with a `nodeName` field parsed
  from a raw `"nodeName"` prop (`InlineTextTagShadowNodes.h`); `UnknownElementShadowNode` now
  uses it. (b) `createInstance` injects `nodeName: workInProgress.type` into the attribute
  payload when the resolved view config is the `"unknown"` singleton
  (`ReactFabric-dev.js`), and `nodeName` was added to the unknown config's `validAttributes`
  (`ReactNativeViewConfigRegistry.js`). (c) `getTagName` (`renderer/dom/DOM.cpp`) reads the
  prop when the component is `"unknown"`, so `tagName`/`nodeName` report `"RN:<tag>"`. Tests:
  `StringChildrenBehavior-itest.js` M5b (per-instance `<foo>`/`<bar>`) + web-mirror twin (Safari 18/18).
  **Prod follow-up:** the `ReactFabric-prod.js` injection is not done (minified-bundle edit —
  same fork-carry category as the §3.E dev-warning bundle edit); until then the prod path falls back to `unknown`.
- **Goal.** `document`-style DOM APIs report `<foo>`'s tag as `foo` (e.g. `tagName === "RN:foo"`)
  instead of the generic `unknown`.
- **Why / context.** HTMLUnknownElement keeps its tag name. Today unregistered lowercase tags
  resolve to the singleton `unknown` component and the name is lost.
- **Design finding (already scoped).** The raw tag is lost at the JS boundary:
  `ReactFabric` calls `createNode(tag, viewConfig.uiViewClassName, …)` and the unknown config's
  `uiViewClassName` is the singleton `'unknown'`
  (`Libraries/Renderer/shims/ReactNativeViewConfigRegistry.js` `getUnknownElementViewConfig`);
  C++ component names are static per-descriptor
  (`components/text/InlineTextTagShadowNodes.h` `UnknownElementShadowNode` → `"unknown"`), and
  `getTagName` (`renderer/dom/DOM.cpp:475`) returns `"RN:" + componentName`. **The only
  per-instance channel is a prop.**
- **Approach.** (a) Add a `nodeName` field to a new `UnknownElementProps : TextProps`
  (`InlineTextTagShadowNodes.h`), parsed from a raw `"nodeName"` prop; switch
  `UnknownElementShadowNode` to it. (b) Inject the tag name for unknown lowercase tags in
  `createInstance` — a **vendored `ReactFabric-dev.js` (+ `-prod.js`) bundle edit**, same
  fork-carry category as the §3.E dev-warning removal; add `nodeName` to the unknown config's
  `validAttributes`. (c) In `getTagName`, when the component is `"unknown"`, read the prop.
- **Testing methodology.** Fantom uses the **dev** bundle, so editing `ReactFabric-dev.js` is
  enough for a headless test. Add a matrix case: render `<foo>hi</foo>` under a View, resolve the
  element via the DOM API, assert `element.tagName` / `nodeName` reflects `foo`. Web-mirror twin:
  `document.querySelector('foo').tagName === 'FOO'`.
- **Acceptance.** DoD 1–5; a bare-`<foo>` DOM-API test reads `foo`; prod-bundle edit noted as a
  follow-up (prod path is a vendored-bundle fork carry).
- **Effort / risk / deps.** S. Risk: minified prod-bundle edit (defer to follow-up).

### T3. Lazy View state — ✅ DONE

- **Status (done).** `ViewComponentDescriptor::createInitialState` now returns `nullptr`, so a
  View starts stateless (restoring the exact pre-text-children hot path — `ViewState` is a
  feature-only addition). `ViewShadowNode::updateTextRunStateIfNeeded` allocates the state
  lazily on the first runs via the family `ConcreteState` ctor (the null→non-null transition),
  and short-circuits to a null-safe early return when `state_ == nullptr` and there are no
  boxes; once allocated the state persists (possibly emptied) for the node's life.
  **Allocation evidence** (instrumented probe, reverted): a tree of 40 plain Views + 1 outer
  + 2 text Views logged **43 `createInitialState` calls returning null → 0 `ViewState`
  allocated at construction, and exactly 2 lazy allocations** (the text-bearing Views).
  Correctness: full matrix + regressions green, incl. M2 remove-all-text and
  not-flattened cases and the broad View-itest (224) / forced-clone-commit-hook / sync-on-commit
  suites. No behavior change, so no new web-mirror twin (existing matrix guards correctness).
- **Goal.** A View with no text runs allocates **no** `ViewState` (zero-cost), matching the
  pre-feature hot path; state is allocated only when anonymous runs exist.
- **Why / context.** Plan §4.2 — the feature made `ViewShadowNode` stateful (`ViewState`), so
  every View now allocates an empty state. Production needs `nullptr` unless runs exist.
- **Entry points.** `ViewShadowNode` / `ConcreteViewShadowNode` state creation
  (`components/view/ViewShadowNode.{h,cpp}`, `ConcreteViewShadowNode.h`), and the state-on-demand
  path in `updateTextRunStateIfNeeded` (`ViewShadowNode.cpp:105`). Check where the initial state
  is created for a stateful node and whether it can be left null.
- **Approach.** Keep the state pointer null until `updateTextRunStateIfNeeded` first publishes
  runs; ensure the differ/mounting tolerate a null → non-null state transition (and back to
  empty when text is removed — the "collapses to zero" case must still work).
- **Testing methodology.** Correctness is headless: the whole matrix + regressions must stay
  green (esp. the M2 "removing all text collapses the View" and "text-bearing View is not
  flattened" cases), and non-text Views must behave exactly as a stateless View. The
  **allocation** claim is proven with a targeted alloc/counter probe or an instrumented build
  (document the measurement); note this is the one item whose core win is not a pure Fantom
  assertion.
- **Acceptance.** DoD 1–5; non-text Views observably allocate no `ViewState` (counter/probe
  evidence in the commit); full regression sweep green.
- **Effort / risk / deps.** M. Risk: state machinery assumes a state exists for stateful nodes —
  the null path is the subtle part.

---

## Track B — native Yoga block (the biggest layout item)

### T4. Native `display:block` in Yoga (`YGDisplayBlock`) — ✅ DONE (Stage 1 floor)

- **Status (done, Stage 1).** `display:'block'` is now a first-class Yoga block formatting
  context behind the new `enableYogaDisplayBlock` sub-flag (default off; the flex column+stretch
  emulation remains the flag-off fallback). Implemented:
  1. `Block` added to the Yoga `Display` enum (`YGEnums.h`/`.cpp`, `enums/Display.h`, `bitCount`
     4→5). `displayTypeFromYGDisplay` maps `YGDisplayBlock`→`DisplayType::Flex` so the
     RN-observable `displayType` is identical on both paths (parity).
  2. `calculateBlockLayout` in `yoga/algorithm/CalculateLayout.cpp` — a dedicated block layout
     path dispatched from `calculateLayoutImpl` **only** when `display == Block`, so the flex
     algorithm is untouched. In-flow children stack in the block direction; each child's definite
     dimensions are resolved (`getResolvedDimension`/`hasDefiniteLength`) and passed with
     `StretchFit`, auto-height children are content-driven (`MaxContent`), auto-width children
     fill the content width **only when the container width is definite** (else measured at
     content width so the container shrink-wraps); flex-grow/shrink are ignored; absolute
     descendants go through `layoutAbsoluteDescendants`.
  3. `enableYogaDisplayBlock` common feature flag (config → regen under node 24); `updateYogaProps`
     maps RN `display:'block'` → `Display::Block` when on, keeping the emulation when off. The
     shared anonymous-box grouping predicate in `updateYogaChildren` already carries both paths.
  Tests: `StringChildrenNativeBlock-itest.js` — 4 parity cases (identical numbers to the M3
  emulation) + 3 native-only fidelity cases (a `flexGrow:1` block child does NOT grow; children
  stack at content size; a block child fills the content width). Web-mirror twins (Safari 20/20).
  **Full regression sweep green**: StringChildrenBehavior 39, baselines 4, Text 151, View-itest 224,
  View-flexBasisFitContent, yogaNodeOwnerAssertion, ReadOnlyText 30, ReactNativeElement 170.
  **Not done (later stages, documented):** margin collapsing (Stage 3), floats/static-position
  specifics (Stage 4); RTL block positioning is implemented via the inline-start edge but not yet
  test-covered; auto-positioned absolute children use the flex static-position fallback.
- **Goal.** `display:'block'` (and the `<div>` tag, T9) is a **true block container** — block
  inner display, block-level children stacked with block sizing (not flex items), natively
  generated anonymous block boxes — replacing the flex column+stretch emulation.
- **Why / context.** Plan §3.A / §4.5 / §7. A genuine `<div>` cannot be faked on flex; the
  emulation covers the *floor* behaviorally but leaks flex semantics. **Decided (plan §7):** own
  sub-flag `enableYogaDisplayBlock`; first-release conformance floor = inline-flow +
  block-stacking; margin-collapsing/floats are later stages.
- **Entry points (scoped this session).**
  1. Add `Block` to Yoga's **generated** `Display` enum via `ReactCommon/yoga/enums.py`
     (precedent: the existing `Display::Grid`); regenerate `yoga/enums/Display.h`.
  2. Implement the block layout path in `yoga/algorithm/CalculateLayout.cpp` (~2805 lines) —
     **the real work**: a block formatting context distinct from the flex algorithm (children
     laid out in the block direction, each sized to the containing block's content width,
     container height = content).
  3. Audit every `style().display() ==` switch site to handle `Block`:
     `algorithm/CalculateLayout.cpp`, `algorithm/FlexLine.cpp`, `node/Node.cpp`,
     `algorithm/AbsoluteLayout.cpp`.
  4. Add the `enableYogaDisplayBlock` common flag (config → regen under node 24, see §1).
  5. Map RN `display:'block'` → `YGDisplayBlock` when the flag is on (extend
     `YogaStylableProps` `displayBlock` handling); keep the emulation as the flag-off fallback.
     The anonymous-box grouping predicate in `updateYogaChildren` is already display-aware and is
     shared between both paths.
- **Approach (stage it).** Stage 1: block-inner layout of block-level children + single inline
  flow (the floor). Stage 2: anonymous block boxes for mixed inline/block content generated
  natively. Stage 3: margin collapsing. Stage 4: floats / static-position specifics. Each stage
  is its own commit and flag-gated behavior.
- **Testing methodology.** Fantom **parity**: run the existing M3 block cases under
  `enableYogaDisplayBlock` on vs off and assert identical layout numbers (emulation-vs-native
  parity is the safety net). Add native-only cases that the emulation gets wrong (a block child
  with `flex:1` must NOT grow; block child width = containing block, not shrink-wrap). Web-mirror
  twins against a real `<div>`. **Crucially: a full flexbox-regression pass** — this modifies
  core layout used by every RN view, so run the broad Yoga/layout suites, not just text-children.
- **Acceptance.** DoD 1–5 **plus** a green flexbox-regression sweep; emulation-vs-native parity
  on the floor cases; native-only cases prove the fidelity gain; each stage separately gated and
  documented.
- **Effort / risk / deps.** **XL, high risk** (core layout; multi-session). Own flag. This is the
  riskiest change in the whole feature — treat it as its own workstream.

---

## Track C — core representation refactor

### T8. First-class text nodes (replace `RawText`) — ✅ DONE (RawText deleted)

- **Status (done).** Character data is now a slim first-class `#text` node (DOM
  `Text`/CharacterData), created through a new `createTextNode` host-config path; `RawText` is
  **deleted outright** (no compat shims).
  - **Slim node (§3.F):** `TextNodeShadowNode`/`TextNodeProps`
    (`components/text/TextNodeShadowNode.h`, name defined in `BaseTextShadowNode.cpp`) — component
    name `"#text"`, character data as a **direct field** (no RawProps parsing), no state, never
    resolvable from JS by name. `TextNodeComponentDescriptor` installs the anonymous-box factory.
  - **Native binding:** `UIManager::createTextNode(tag, text, surfaceId, instanceHandle)` sets the
    text directly; `UIManagerBinding` exposes the `"createTextNode"` jsi method. JS
    `FabricUIManager` Spec + cached properties + **all three renderer bundles**
    (dev/prod/profiling) rewrite `createTextInstance` to call `createTextNode` instead of
    `createNode("RCTRawText", {text})`.
  - **Consumers** read only `#text`: `buildAttributedString`, DOM `getTextContentInShadowNode`,
    `isInlineTextContent` + the run predicate, `isWhitespaceOnlyRun`. `#text` registered on every
    platform (Fantom stub, C++ element registry, iOS paragraph supplemental, Android
    CoreComponentsRegistry). `RawText` deregistered from all of them + `RCTRawText`/Paper removed
    (RCTBridge, Android name mapping).
  - **Deleted:** `RawTextShadowNode.{h,cpp}`, `RawTextProps.{h,cpp}`, `RawTextComponentDescriptor.h`;
    test fixtures migrated to `TextNode*`.
  - **Verified headlessly** (Fantom uses the dev bundle): StringChildrenBehavior 42/42, native-block 8/8,
    baselines 4, Text 151/151, ReadOnlyText 30/30, ReactNativeElement 170/170, View-itest 224,
    Image-itest 99 — the whole feature runs on `#text` with RawText gone.
  - **Platform tail / follow-ups:** the iOS build needs `pod install` to regenerate the
    git-ignored CocoaPods header map (still lists the deleted RawText headers); the C++/ObjC gtest
    targets weren't run (fixtures updated mechanically). `commitTextUpdate` (identity-preserving
    text edits — Fabric currently re-creates text nodes on change) is a future optimization.
- **Goal.** Character data is a slim first-class `Text` node (`"#text"`, DOM `nodeName`) instead
  of `RawTextShadowNode`'s fake-component packaging — no EventTarget, no RawProps parsing, no

- **Goal.** Character data is a slim first-class `Text` node (`"#text"`, DOM `nodeName`) instead
  of `RawTextShadowNode`'s fake-component packaging — no EventTarget, no RawProps parsing, no
  descriptor-mediated clone per text change — while keeping ordered leaf siblings for mixed
  content (`a<b>b</b>c`).
- **Why / context.** Plan §3.F (read it in full first). This is a direct replacement, no compat
  shims; `RCTRawText` is deleted outright.
- **Entry points.** `ReactFabric-dev.js` `createTextInstance` (~:15889) — add a
  `createTextNode(text, instanceHandle)` FabricUIManager method and a `commitTextUpdate` path;
  `BaseTextShadowNode.cpp:34-55` RawText branch reads the new node kind; delete `RCTRawText`
  registration, `componentNameByReactViewName` entry, `RawTextProps`/`RawTextShadowNode`; DOM
  layer `ReadOnlyText` maps 1:1; emitter becomes optional on `ShadowNodeFamily`.
- **Approach.** Follow §3.F's staging: add the slim node kind + host-config methods, migrate
  `buildAttributedString` and the DOM API layer, then delete `RCTRawText`. Keep
  `family`/`instanceHandle` (DOM `childNodes` resolves through per-node instance handles).
- **Testing methodology.** Fully headless: the whole matrix + `ReadOnlyText-itest.js` +
  `ReactNativeElement-itest.js` must stay green (they exercise `childNodes`, `parentNode`,
  `textContent`, mixed content). Add cases for `commitTextUpdate` (text data changes without a
  node identity change) and mixed `a<b>b</b>c` sibling ordering.
- **Acceptance.** DoD 1–5; `RCTRawText` is gone (grep proves it); text updates flow through
  `commitTextUpdate`; DOM traversal APIs unchanged.
- **Effort / risk / deps.** XL. Own review. Independent of T4.

---

## Track D — iOS simulator / device (not headless)

These cannot be proven under Fantom. Verify on an iPhone simulator; capture the proof.

**Simulator setup / proof tools** (onboarding §4/§6): flip `enableStringChildren`
`defaultValue`, `yarn featureflags --update` (node 24), `pod install` under `env -i` with a clean
`PATH` whose `git` is `/usr/bin/git`, `xcodebuild` RNTester, launch, screenshot via
`xcrun simctl io <udid> screenshot`. Live layout reads:
`node packages/rn-tester/scripts/css-display-cdp-verify.js` (Metro's inspector proxy needs
`Origin: http://localhost:8081`; it launches the app per screen with `-route <Name>`,
which `RNTesterAppShared` consumes via the restored `exampleFromAppetizeParams`
initial prop — no URL-scheme confirmation dialog). Demo screens (stock RNTester
example modules): `packages/rn-tester/js/examples/TextChildren/StringChildrenExample.js`,
`.../TextChildren/IntrinsicElementsExample.js`, `.../DisplayBlock/DisplayBlockExample.js`,
`.../DisplayInline/DisplayInlineExample.js` (shared blocks in
`.../TextChildren/TextChildrenShared.js`).

### T5. iOS paint order + per-run views — ✅ DONE (simulator-verified)

- **Status (done).** Replaced the single `RCTAnonymousTextContentView` (which drew every run on
  top) with one lightweight `RCTAnonymousTextRunView` per run (`RCTViewComponentView.mm`), each
  drawing its single run via `RCTTextLayoutManager drawAttributedString:`. Authored document
  order is threaded through: `YogaLayoutableShadowNode` records, per anonymous box, the count of
  preceding mounted children (`anonymousTextContentChildIndices_`), `ViewShadowNode` copies it
  into `ViewState::TextRun::documentOrder`, and iOS `reorderAnonymousTextRunViewsIfNeeded`
  (called from `layoutSubviews`) inserts each run view just below the child it precedes — so
  text authored before a child paints under it and text after paints over it. Run views are
  component-view-internal (never differ-driven), cleared in `prepareForRecycle`.
  **Verified:** RNTester on iPhone 17 Pro (iOS 26.5) — demo case 8 shows bare text authored
  before an overlapping box hidden beneath it (left cell) and text authored after painted over
  it (right cell); cases 1–7 unregressed. Headless: shared-C++ `documentOrder` plumbing green
  (StringChildrenBehavior 39, baselines 4, native-block 7, View-itest 224).
- **Goal.** `<View>a<View/>b</View>` paints "a", the inner view, then "b" in document order —
  one lightweight run view per anonymous item, interleaved with React-mounted children.
- **Why / context.** Plan §3.B. A single content view can't interleave text with mounted
  children in authored order (CSS painting order). Per-run views are component-view-internal
  (never differ-driven); `layoutSubviews` re-establishes z-order after every mount/state change.
- **Entry points.** `React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm` (search
  `RCTAnonymousTextContentView`); mirror `RCTParagraphComponentView`'s inner text view
  (`RCTParagraphComponentView.mm:383-428`) drawing via `RCTTextLayoutManager drawAttributedString:`.
- **Approach.** Replace the single content view with one run view per anonymous item; exclude run
  views from React child indices (same pattern as the paragraph content view); re-sort in
  `layoutSubviews` per the authored child order recorded in `ViewState`.
- **Testing methodology.** Simulator screenshot of an overlapping child between two runs; assert
  paint order visually. CDP layout read for the run frames.
- **Acceptance.** Screenshot shows correct interleaving; DoD 3 (explicit `<Text>` untouched);
  plan updated.
- **Effort / risk / deps.** M. Simulator-only.

### T6. iOS touch hit-testing on drawn text — ✅ DONE (simulator-verified via probe)

- **Status (done).** `RCTViewComponentView touchEventEmitterAtPoint:` now, when text runs exist,
  finds the run whose frame contains the point and resolves the fragment emitter via
  `getEventEmitterWithAttributeString:...atPoint:` (per-run `RCTAnonymousTextRunView`), falling
  back to the View's own emitter — so a tap on an inline element with a handler targets that
  element, while a tap on bare text targets the View (text nodes are never targets).
  **Bug found & fixed during verification:** `getEventEmitterWithAttributeString:` lays the run
  out in a text container at the origin and hit-tests with the *raw* point, so the point must be
  **frame-local**; passing the view-space point made it fall outside the (short) container and
  return null. Paragraphs never hit this because their text frame origin is ~0; runs have
  non-zero origins. Fixed by subtracting `runFrame.origin`.
  **Verified on device** (iPhone 17 Pro, instrumented log): before the fix the tap point was
  inside the BOLD run frame yet the resolved emitter was `0x0`; after the fix it resolves to a
  non-null inline touch emitter, while bare-text taps resolve null → the View. (The on-screen
  `onPress` counter can't be moved by synthetic `cliclick` taps — Pressability needs a real
  press gesture — so emitter resolution was confirmed via the instrumented log; the JS-observable
  target/bubbling semantics are covered headlessly by matrix M6, 39/39.)
- **Goal.** Tapping an inline element with a handler (`<b onPress>`) fires it; tapping bare text
  fires the containing View's handlers (text nodes are never targets).
- **Why / context.** Plan §3.G. `touchEventEmitterAtPoint:` is an open protocol invoked on
  whatever component view is hit.
- **Entry points.** Implement `touchEventEmitterAtPoint:` on `RCTViewComponentView` when runs
  exist (mirror `RCTParagraphComponentView`); resolve the fragment emitter via
  `characterIndexForPoint` (`RCTTextLayoutManager.mm:255-283`).
- **Testing methodology.** Simulator: tap an inline element → its handler fires; tap bare text →
  the View's handler fires. (The JS-observable half of event semantics — target/bubbling — is
  already covered headlessly by the M6 matrix cases; this is the on-device hit-test half.)
- **Acceptance.** Both taps behave per spec on device; plan updated.
- **Effort / risk / deps.** M. Dep: T5 (run views/frames). Simulator-only.

### T7. Intrinsic `<img>` tag (inline replaced element) — ✅ DONE (renders real pixels; positioning is first-cut)

- **Final design (Stage 3):** `<img>` is an **Image-backed** node — `ImgTagShadowNode`/
  `ImgTagComponentDescriptor` (declared in `components/image/ImageShadowNode.h`, impls in
  `ImageShadowNode.cpp`) reuse `ImageProps`/`ImageState`/`ImageManager` and mirror
  `ImageShadowNode`'s image-request logic, but with a distinct component name/handle `"img"` so
  it can be **routed inline** (not treated as a block Yoga child) and get its own component view.
  It reuses the whole Image rendering: iOS `RCTImgComponentView` subclasses `RCTImageComponentView`
  (overriding `componentDescriptorProvider`, self-registered via `+load`); JS `<img>` config
  reuses Image's `source`/`resizeMode`/`tintColor` + Image's load `directEventTypes` (else the
  reconciler rejects `topLoadStart`). `updateYogaChildren` routes `<img>` into the run as an
  attachment even though it is layoutable; `InlineContentShadowNode` sizes the attachment by
  measuring the img (`measureImageAttachments`, mirroring
  `ParagraphShadowNode::getContentWithMeasuredAttachments`); and `ViewShadowNode::layoutInlineImageAttachments`
  clones + stamps each img's `layoutMetrics` (`ParagraphShadowNode` clone-and-position pattern)
  so the differ mounts it inline.
- **Verified:** device (iPhone 17 Pro, iOS 26.5) — demo case 10 renders a real remote image
  inline in a bare-text flow (leans on the Image pipeline for load/decode). Headless: StringChildrenBehavior
  42/42 (`a<img/>b` inline, `a<img 30x40/>b` reserves 50×40 via real attachment measurement),
  native-block 8/8, **Image-itest 99/99 (Image itself unaffected)**, baselines 4, Text 151,
  ReadOnlyText 30, View-itest 224.
- **First-cut / follow-up:** positioning places the img at its run box's origin (measured size,
  right run), so precise inter-character offset within a mixed text+img run is not yet exact —
  drive it from the text layout's per-attachment frame (the box already measures them). Also:
  core/Android component registration (iOS + Fantom done); `src` string → `source` mapping (JS
  currently takes the `source={{uri}}` shape).
- **Goal.** `<img src=…>` flows inside a bare-text IFC as an inline **replaced** box, like the
  web (distinct from the block-level RN `Image` component).
- **Why / context.** Plan §3.C. Reuses Paragraph's inline-attachment machinery
  (`BaseTextShadowNode` attachments, `ParagraphShadowNode.cpp:363-446`); classification routes
  it into the current run rather than blockifying.
- **Entry points.** Register `img` like `<b>`/`<i>`/`<span>` (JS config +
  `InlineTextTagShadowNodes` C++); map `src`/sizing onto the image props; hook the attachment
  layout loop.
- **Testing methodology.** Not headless — the deterministic measurer treats attachments as 0×0
  and there is no image pipeline under Fantom. Verify on the simulator (image renders inline
  between text) + a web-mirror twin (`<img>` inline replaced). Optionally extend the measurer to
  give `<img>` a deterministic intrinsic size behind the flag if a headless size assertion is
  wanted (document the contract extension).
- **Acceptance.** Simulator shows an inline image in a text flow; web-mirror twin passes; plan
  updated.
- **Effort / risk / deps.** M. Needs image pipeline + device.

### T9. Intrinsic `<div>` tag (block element) — ✅ DONE (headless)

- **Status (done).** `DivShadowNode`/`DivProps` (`components/view/DivShadowNode.h`) — a `View`
  (`ConcreteViewShadowNode` with `ViewProps`/`ViewState`) that forces `displayBlock = true`, so
  `<div>` is block-outer/block-inner and rides the existing View block path: native
  `YGDisplayBlock` when `enableYogaDisplayBlock` is on, else the flex emulation, plus the shared
  anonymous-IFC + `updateYogaChildren` machinery. `DivComponentName = "div"` (defined in
  `ViewShadowNode.cpp`); registered in the Fantom stub registry; JS config in `InlineTags.js`
  (reuses the base View `validAttributes` via `createViewConfig`). Being block-level (not in
  `isInlineTextContent`), a parent treats `<div>` as a block child.
  Verified headlessly: `StringChildrenBehavior-itest.js` M5 — `<div>a<b>b</b>c</div>` is one inline flow
  (one line), vs a flex View blockifying to 3× height; `StringChildrenNativeBlock-itest.js` — `<div>`
  as a native block container (both flags on). Regressions green (baselines 4, Text 151,
  ReadOnlyText 30, View-itest 224). Web-mirror twin added (literal `<div>` is `display:block`);
  Safari re-run blocked by a persistent safaridriver launch failure this session (passed 20/20
  earlier). **Follow-up:** iOS component-view registration for `"div"` (renders as a View) and
  core/Android registry entries — Fantom uses the stub registry, so headless is covered;
  on-device div rendering needs the platform registration.
- **Goal.** `<div>` is a block-level container with block inner display — the intrinsic analog of
  a `View` but `display:block`.
- **Entry points.** Register `div` like the other intrinsic tags, backed by the block-display
  path.
- **Testing methodology.** Fantom cases mirroring the block matrix but with the literal `<div>`
  tag; web-mirror twin against a real `<div>`.
- **Acceptance.** DoD 1–5.
- **Effort / risk / deps.** S, **but depends on T4** (native block) to be a *true* block; can
  ship earlier on the emulation with a documented deviation.

---

## Track E — Android

### T10. Android mounting story

- **Goal.** The feature works on Android (currently flag-off everywhere; the shared C++ compiles
  but nothing paints).
- **Why / context.** Plan §4.7 — Android paints text via platform `TextView`s, not a drawing
  pass, so it needs its own mounting story (not the iOS per-run-view approach).
- **Entry points.** Android Fabric mounting for the View component; the anonymous-run `ViewState`
  is already shared C++.
- **Testing methodology.** Android instrumentation / on-device; not headless here.
- **Acceptance.** Bare text renders and updates on Android behind the flag; regression parity.
- **Effort / risk / deps.** XL. Needs Android toolchain.

---

## Track F — css-display branch (display:'inline', block Stages 2–3) — ✅ landed

Work on the `css-display` branch (from frontier), each behavior pinned against real
Safari fixtures before implementation:

- **T11. `display:'inline'` (done).** Parsed like `displayBlock`
  (`YogaStylableProps::displayInline`; never reaches Yoga). Atomic inline boxes ride the
  `<img>` attachment machinery (`isAtomicInline`; `layoutInlineAttachments`, generalized
  from img-only); span-like flow boxes (`isInlineFlowContent`: auto size + all-inline
  contents) join the parent IFC with their inheritable text props applied via
  `BaseViewProps::applyInheritedTextAttributes` (shared with the cascade). Blockifies in
  flex containers; absolute blockifies. Sized inline Views stay atomic (documented
  divergence from the web's ignore-size rule for non-replaced inlines). Deferred:
  fragment-level box decorations, flow-box layout metrics, block-in-inline splitting.
  Tests: `StringChildrenDisplayInline-itest` (10).
- **T12. Block Stage 2 run contiguity (done).** `display:'none'` children never split
  runs (block AND flex); absolute children don't interrupt the IFC in block containers
  but DO separate text-run sequences in flex (Safari-pinned). Fixed native block leaving
  `Display::None` children dirty (Debug assert). Tests:
  `StringChildrenMixedContent-itest` (8).
- **T13. Margin collapsing, Stages 3a+3b (done).** CSS2 §8.3.1 in
  `calculateBlockLayout`: adjacent siblings (max positives + min negatives),
  self-collapsing boxes collapse through, nested block-in-block margins escape through
  content edges (`foldEscapedMargins` post-layout walk), containment at independent-FC
  roots; fixed latent Stage-1 double-counted margins in child positions. Tests:
  `StringChildrenBlockMargins-itest` (15).
- **Remaining:** floats/clearance, static-position specifics, RTL coverage for block,
  fragment-level inline box decorations, Android (T10).
- **Demo/verify:** the display example screens (DisplayBlockExample /
  DisplayInlineExample, registered in RNTesterList) publish rects to
  `globalThis.__displayVerify`; assert with
  `packages/rn-tester/scripts/css-display-cdp-verify.js` (launch-arg routed;
  RNTester enables `enableYogaDisplayBlock` via an override in
  `RNTester/AppDelegate.mm`).

---

## Track G — Astryx on RN (css-display branch) — M1 ✅ landed

Meta's Astryx design system (React DOM + StyleX) running on the fork — see the
feasibility analysis (element/CSS inventory, 5 hard dependencies, milestone
ladder M1–M5). **M1 done:** the vendored, UNMODIFIED `Card` source renders
end-to-end in RNTester with web-identical geometry.

- **RN StyleX runtime** `packages/rn-tester/js/astryx/stylex-rn.js`
  (Metro-aliased as `@stylexjs/stylex`): defineVars token table, recursive
  `var()` fallback chains, element-local custom properties, `light-dark()`
  per Appearance (live retheme), `calc()` px arithmetic, conditional-value
  `default` branches, px→number conversion, unsupported-property drops with
  dev warns. 10 unit tests (`js/astryx/__tests__/stylex-rn-test.js`).
- **Elements** `js/astryx/dom.js`: `<p>` and `<button>` as view-config aliases
  of `<div>` (block containers; button gets DOM onClick with NO
  Pressable/gesture handlers, per direction). `nodeName` reports "div" for
  now; per-tag shadow nodes can graft in via the lazy descriptor seam later.
- **Vendored slice** `js/astryx/vendor/` (pristine; see its README):
  Card + tokens.stylex + container/padding.stylex + mergeProps/themeProps +
  BaseProps + naming.
- **Screen + verify:** `examples/Astryx/AstryxExample.js` (registered in
  RNTesterList; rects → `__displayVerify`), asserted by
  `scripts/astryx-cdp-verify.js`: total content inset == padding token
  (border + calc-reduced padding, 16 and 8), width 300 honored.
- **M2 done — interaction states + `<button>` without Pressable.** The
  runtime resolves CSS pseudo-classes from an `InteractionState`:
  `stylex.propsWithState(state, …)` merges whole-block pseudo styles
  (`{':active': {…}}`) in cascade order (`:active` beats `:hover`/`:focus`)
  and resolves per-property conditional values against the same state;
  Astryx's `@media (hover: hover)` / `(pointer: coarse)` capability guards
  evaluate per platform, so hover branches stay inert on touch.
  `useInteractionState()` (js/astryx/useInteractionState.js) sources that
  state from **W3C pointer events on the element itself** — pointerenter/
  leave/down/up/cancel + focus/blur — so an Astryx-shaped `<button>`
  (a block-container intrinsic) gets `:active`/`:focus-visible` styling and
  DOM `onClick` with **no Pressable, gesture responder, or JS gesture
  recognizer**. Leaving the element cancels the press, matching the browser.
  17 unit tests; sim-verified that the button's box comes purely from tokens
  (label inset 18/10 = `--spacing-4`/`--spacing-2` + 2px border).
  Note: the label is wrapped in a `<div>` because inline elements still have
  no layout metrics (the `<b>`/`<span>` gap) — measurement only, not styling.
- **M3 done — CSS custom-property inheritance across elements.** A property
  set on an ancestor is now visible to every descendant and can be *shadowed*
  for a subtree, which is what `Section`/`LayoutHeader`/`ClickableCard` rely
  on (they read `--container-padding-*` set by `Card`, and `Section` resets it
  to `0px` for its own children).
  - Resolution is two-pass. `stylex.props()` still resolves eagerly, but
    **defers** any `var()` whose name nothing local or global defines —
    taking its fallback there would be wrong, since an ancestor may supply it
    — and carries the element's own declarations on `__stylexVars`.
    `resolveInherited(style, vars, scope)` finishes the value at the element
    with the inherited scope in hand, and returns the scope to publish
    downward (ancestor scope + own declarations layered on top, copied, never
    mutated).
  - The element hook is a **JSX runtime** (`js/astryx/jsx-runtime.js`):
    lowercase intrinsics render through a wrapper that consumes the scope
    context, finishes the style, strips `__stylexVars`, and provides its
    merged scope; composite components pass through untouched, and only
    elements that *declare* properties add a provider. Babel points the
    Astryx directories at it (`.babelrc.js` override, absolute `test` paths —
    a relative one silently never matches) and Metro resolves the
    `astryx-jsx` module id.
  - Alternatives weighed: a module-level scope stack (rejected — React's
    render order can't be popped reliably), and native C++ inheritance via
    the existing `configureYogaTree` cascade (the right long-term answer,
    deferred as too large to land before anything renders; the JS layer stays
    the authoring surface either way).
  - 22 unit tests; sim-verified: the descendant escapes the inherited 20pt
    gutter to full-bleed, and the shadowed subtree reads `0px` rather than the
    inherited `20px` or its own `99px` fallback.
- **M4 done — `<input>`, and overlays.** `<input>` maps onto TextInput
  (js/astryx/elements/Input.js) via the JSX runtime's element registry;
  @expo/ui remains the eventual native target and that module is the only
  place that changes. Overlays land as the two things every Astryx overlay
  needs: `overlay/anchorPosition.js` implements CSS anchor positioning as a
  pure, unit-tested module (position-area, span-* edge alignment,
  position-try-fallbacks incl. flip-block/flip-inline, least-overflow choice
  and clamping), and `overlay/TopLayer.js` models the top layer as a
  root-mounted host plus registry — RN has neither a top layer nor
  createPortal for host components — preserving escape-from-ancestors,
  insertion-order stacking, light dismiss for `auto`, and a modal backdrop.
  `<dialog>` joins the element registry. NOT modelled, deliberately: focus
  trapping and `@starting-style` entry animations.
- **Next:** Android `fragmentRects` (iOS done — see T14), inline box
  decorations, SVG/icons, ResizeObserver, and — when the JS layer stabilizes —
  moving custom-property inheritance into the native cascade.

---

## T14. Inline-element layout metrics (`<b>`/`<span>` rects) — ✅ DONE

- **Goal.** `getBoundingClientRect()` on an inline text element returns its
  real rect, as on the web. Today it returns an empty rect, which also forces
  test/demo code to wrap labels in a `<div>` just to measure them.
- **The crux (verified by experiment).**
  `LayoutableShadowNode::computeRelativeLayoutMetrics` walks the ancestor
  chain and **bails unless every node in it is a `LayoutableShadowNode`**.
  Inline text elements are not, so the walk returns `EmptyLayoutMetrics`
  before any rect could be reported.
- **Design.** Three parts, all required together:
  1. `TextShadowNode` (and therefore every inline intrinsic) takes
     `LayoutableShadowNode` as its `ConcreteShadowNode` base *purely to carry
     metrics* — it is still never a Yoga node, so box generation is
     unchanged. `layoutTree`/`layout`/`dirtyLayout`/`getIsLayoutClean` are
     inert overrides (they are pure virtual on the base).
     **Tried, compiles, and passes everything except the conflict below.**
  2. A per-fragment-rect API on the text managers — the cxx deterministic
     measurer can compute them exactly (same advances/wrapping it already
     implements); iOS has `RCTTextLayoutManager`'s
     `getRectWithAttributedString:…usingBlock:`; Android would come from the
     `StaticLayout`. Fragments already carry their owning element in
     `fragment.parentShadowView`, so rects group by element and union.
  3. The owning View stamps those rects onto the inline elements after text
     layout, exactly as `layoutInlineAttachments` already does for `<img>`
     (clone-tree + `setLayoutMetrics`).
- **Status: landed** (`StringChildrenInlineMetrics-itest`, 5/5; full sweep 903
  passing). All three parts implemented; the cxx measurer computes the rects,
  **iOS now supplies them too** (`RCTTextLayoutManager
  getFragmentRectsWithAttributedString:…`, using `boundingRectForGlyphRange:`
  — which already unions a range that wraps): device-verified, 14/14 CDP
  checks, an inline `<b>` reporting x=89.4 w=41.4 inside a 126pt run.
  **Android is the remaining piece** (rects from the `StaticLayout` it already
  builds to paint), along with inline box decorations — a padded `<span>`
  still reports its text box rather than its border box.
- **The conflict, resolved.**
  `ReactNativeElement-itest` asserts that a nested `<Text>` returns an
  **all-zero** rect, commented "since it doesn't have its own independent
  layout". Landing (1) alone makes it return a *position with no size* —
  strictly worse — and landing (1)+(2)+(3) makes it return a real rect, which
  is web-correct but **changes documented upstream behavior**. Decided (with
  the project owner) to make the change: the test's comment — "doesn't have
  its own independent layout" — remains true, since the paragraph is
  unchanged; but an all-zero rect is not what the web reports, and the DOM API
  should be faithful. The expectation now asserts the real box.
- **Effort / risk.** M–L, cross-platform (three text managers). Headlessly
  verifiable for the cxx path.

---

## Appendix: file map (quick reference)

- Layout / cascade: `ReactCommon/react/renderer/components/view/YogaLayoutableShadowNode.{h,cpp}`,
  `ViewShadowNode.cpp`, `components/text/InlineContentShadowNode.cpp`.
- Inherited props: `components/view/BaseViewProps.{h,cpp}`,
  `Libraries/NativeComponent/BaseViewConfig.{ios,android}.js`.
- Deterministic measurer:
  `ReactCommon/react/renderer/textlayoutmanager/platform/cxx/.../TextLayoutManager.cpp`.
- Yoga: `ReactCommon/yoga/enums.py`, `yoga/enums/Display.h`, `yoga/algorithm/CalculateLayout.cpp`,
  `yoga/algorithm/FlexLine.cpp`, `yoga/node/Node.cpp`.
- Intrinsic tags / unknown: `Libraries/Renderer/shims/ReactNativeViewConfigRegistry.js`,
  `components/text/InlineTextTagShadowNodes.{h,cpp}`, `renderer/dom/DOM.cpp` (`getTagName`).
- Text nodes: `RawTextShadowNode`, `ReactFabric-dev.js` (`createTextInstance` ~15889),
  `components/text/BaseTextShadowNode.cpp`, `src/private/webapis/dom/nodes/ReadOnlyText.js`.
- iOS painting: `React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm`,
  `.../Text/RCTParagraphComponentView.mm`, `.../RCTTextLayoutManager.mm`.
- Flags: `scripts/featureflags/ReactNativeFeatureFlags.config.js`.
- Tests / proof: `Libraries/Text/__tests__/StringChildrenBehavior-itest.js`,
  `StringChildrenBaseline-itest.js`, `__fixtures__/string-children-web-mirror.html`,
  `packages/rn-tester/js/examples/TextChildren/` (+ `DisplayBlock/`, `DisplayInline/`),
  `packages/rn-tester/scripts/css-display-cdp-verify.js`.
