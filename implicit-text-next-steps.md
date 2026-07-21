# Implicit Text: Remaining Work — an actionable backlog

This is the **work queue** for the implicit-text feature. It assumes you have done the ramp-up
in `implicit-text-onboarding.md` (spec + code tour) and have read the design in
`implicit-text-plan.md` (the living spec). This document does not re-teach those; it tells you
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

Implemented and green behind the `enableImplicitTextChildren` flag (default off): bare strings
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

Exact incantations (see `implicit-text-onboarding.md` §4 for detail, §6 for gotchas):

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools

# Rebuild the Fantom C++ tester after ANY C++ change (yarn fantom will NOT do this for you):
cmake --build private/react-native-fantom/build/tester -j10

# Run a suite:
yarn fantom packages/react-native/Libraries/Text/__tests__/ImplicitText-itest.js
```

**The deterministic measurer contract** (cxx `TextLayoutManager`, flag-gated) is how intrinsic
text sizing is asserted headlessly: **10pt/char** (+2pt bold, +1pt italic, + `letterSpacing`
per char); **line height** = explicit `lineHeight` if set, else `fontSize + 6`; naive wrap at
the width constraint. Extend it deliberately (and document it) if a task needs a new observable
dimension.

**Web mirror** (`__tests__/__fixtures__/implicit-text-web-mirror.html`): every behavioral case
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
   (`ImplicitText-itest.js`, `ImplicitTextBaseline-itest.js`, `Text-itest.js`,
   `ReadOnlyText-itest.js`, `ReactNativeElement-itest.js`).
2. Web-mirror twin added/updated and passing in Safari; spec section cited in the test.
3. Explicit `<Text>` pixel-identity untouched (the baseline guards prove it).
4. Checkpoint commit whose message states known-working and known-broken.
5. Behavior change reflected in `implicit-text-plan.md` (the living spec).

Tasks whose verification cannot be headless (simulator/device) say so and give the manual proof.

---

## 2. Recommended order

Do the **Track A** items first — they close in the headless loop with the tightest feedback.
**Track B/C** are the two large core efforts (pick one and give it a dedicated run).
**Track D/E** need a simulator/device or Android and are best batched when you have that set up.

**Renumbered 2026-07-21** (per direction): the iOS simulator items were pulled forward to
T5–T7 and first-class text nodes (Track C, the plan's own-review item) deferred to **T8**.
T1–T5 are done; T6–T7 are the active simulator items. (T5 = iOS paint order, simulator-verified.)

| # | Task | Track | Verifiable headlessly? | Size | Depends on | Status |
|---|---|---|---|---|---|---|
| T1 | White-space processing | A | ✅ | S–M | — | ✅ done |
| T2 | Unknown-element nodeName fidelity | A | ✅ (dev bundle) | S | — | ✅ done |
| T3 | Lazy View state | A | ~ (alloc + regression) | M | — | ✅ done |
| T4 | Native Yoga `display:block` | B | ✅ (Fantom parity) | XL | own flag | ✅ done (Stage 1) |
| T5 | iOS paint order + per-run views | D | ❌ (simulator) | M | — | ✅ done |
| T6 | iOS touch hit-testing on drawn text | D | ❌ (simulator) | M | **T5** | open |
| T7 | Intrinsic `<img>` tag | D | ❌ (image pipeline+device) | M | — | open |
| T8 | First-class text nodes (replace RawText) | C | ~ (dev/shared only) | XL | — | deferred (own review) |
| T9 | Intrinsic `<div>` tag | B | ✅ | S | **T4** | open |
| T10 | Android mounting story | E | ❌ (Android) | XL | — | open |
| T11 | Upstream the dev-warning removal | A | n/a | S | — | open |

---

## Track A — headless, tight loop

### T1. White-space processing inside anonymous IFCs — ✅ DONE

- **Status (done).** Implemented as `collapseWhitespace` in
  `InlineContentShadowNode.cpp`, applied in both `getContentAttributedString` (paint) and
  `measureContent` (layout) after `buildAttributedString`, so it affects anonymous IFCs
  only — explicit `<Text>` stays verbatim. Collapses runs of ASCII whitespace to a single
  space across fragment boundaries, trims the IFC's leading/trailing edges, drops emptied
  fragments; attachment fragments are opaque anchors; whitespace-only runs are still dropped
  upstream in `ImplicitTextContent.cpp`. §7 decision (CSS-normal collapsing) recorded in the
  plan. Tests: `ImplicitText-itest.js` M3 (3 cases) + web-mirror twins (Safari 17/17).
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
  whitespace-only-item drop (flexbox rule). Gate everything on `enableImplicitTextChildren`.
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
  `ImplicitText-itest.js` M5b (per-instance `<foo>`/`<bar>`) + web-mirror twin (Safari 18/18).
  **Prod follow-up:** the `ReactFabric-prod.js` injection is not done (minified-bundle edit —
  same fork-carry category as T11); until then the prod path falls back to `unknown`.
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
  follow-up (prod path is a fork carry until upstreamed — see T11).
- **Effort / risk / deps.** S. Risk: minified prod-bundle edit (defer to follow-up).

### T3. Lazy View state — ✅ DONE

- **Status (done).** `ViewComponentDescriptor::createInitialState` now returns `nullptr`, so a
  View starts stateless (restoring the exact pre-implicit-text hot path — `ViewState` is a
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
  Tests: `ImplicitTextNativeBlock-itest.js` — 4 parity cases (identical numbers to the M3
  emulation) + 3 native-only fidelity cases (a `flexGrow:1` block child does NOT grow; children
  stack at content size; a block child fills the content width). Web-mirror twins (Safari 20/20).
  **Full regression sweep green**: ImplicitText 39, baselines 4, Text 151, View-itest 224,
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
  core layout used by every RN view, so run the broad Yoga/layout suites, not just implicit-text.
- **Acceptance.** DoD 1–5 **plus** a green flexbox-regression sweep; emulation-vs-native parity
  on the floor cases; native-only cases prove the fidelity gain; each stage separately gated and
  documented.
- **Effort / risk / deps.** **XL, high risk** (core layout; multi-session). Own flag. This is the
  riskiest change in the whole feature — treat it as its own workstream.

---

## Track C — core representation refactor

### T8. First-class text nodes (replace `RawText`) — DEFERRED (own review; see note)

> **Deferred (2026-07-21).** Sequenced as its own reviewed effort. Scope spans the native
> FabricUIManager jsi binding (`createTextNode`/`commitTextUpdate`), a slim `#text` node kind,
> **three vendored renderer bundles** (dev/prod/profiling), the DOM layer, and deleting
> `RCTRawText` across iOS/Android/core registries + an iOS test. Only the shared-C++/dev-bundle
> slice is headless-verifiable; the rest needs platform builds. Original write-up below.

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

**Simulator setup / proof tools** (onboarding §4/§6): flip `enableImplicitTextChildren`
`defaultValue`, `yarn featureflags --update` (node 24), `pod install` under `env -i` with a clean
`PATH` whose `git` is `/usr/bin/git`, `xcodebuild` RNTester, launch, screenshot via
`xcrun simctl io <udid> screenshot`. Live layout reads:
`node packages/rn-tester/scripts/implicit-text-cdp-verify.js` (Metro's inspector proxy needs
`Origin: http://localhost:8081`). Demo page: `packages/rn-tester/js/ImplicitTextDemo.js`.

### T5. iOS paint order + per-run views — ✅ DONE (simulator-verified)

- **Status (done).** Replaced the single `RCTImplicitTextContentView` (which drew every run on
  top) with one lightweight `RCTImplicitTextRunView` per run (`RCTViewComponentView.mm`), each
  drawing its single run via `RCTTextLayoutManager drawAttributedString:`. Authored document
  order is threaded through: `YogaLayoutableShadowNode` records, per anonymous box, the count of
  preceding mounted children (`anonymousTextContentChildIndices_`), `ViewShadowNode` copies it
  into `ViewState::TextRun::documentOrder`, and iOS `reorderImplicitTextRunViewsIfNeeded`
  (called from `layoutSubviews`) inserts each run view just below the child it precedes — so
  text authored before a child paints under it and text after paints over it. Run views are
  component-view-internal (never differ-driven), cleared in `prepareForRecycle`.
  **Verified:** RNTester on iPhone 17 Pro (iOS 26.5) — demo case 8 shows bare text authored
  before an overlapping box hidden beneath it (left cell) and text authored after painted over
  it (right cell); cases 1–7 unregressed. Headless: shared-C++ `documentOrder` plumbing green
  (ImplicitText 39, baselines 4, native-block 7, View-itest 224).
- **Goal.** `<View>a<View/>b</View>` paints "a", the inner view, then "b" in document order —
  one lightweight run view per anonymous item, interleaved with React-mounted children.
- **Why / context.** Plan §3.B. A single content view can't interleave text with mounted
  children in authored order (CSS painting order). Per-run views are component-view-internal
  (never differ-driven); `layoutSubviews` re-establishes z-order after every mount/state change.
- **Entry points.** `React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm` (search
  `RCTImplicitTextContentView`); mirror `RCTParagraphComponentView`'s inner text view
  (`RCTParagraphComponentView.mm:383-428`) drawing via `RCTTextLayoutManager drawAttributedString:`.
- **Approach.** Replace the single content view with one run view per anonymous item; exclude run
  views from React child indices (same pattern as the paragraph content view); re-sort in
  `layoutSubviews` per the authored child order recorded in `ViewState`.
- **Testing methodology.** Simulator screenshot of an overlapping child between two runs; assert
  paint order visually. CDP layout read for the run frames.
- **Acceptance.** Screenshot shows correct interleaving; DoD 3 (explicit `<Text>` untouched);
  plan updated.
- **Effort / risk / deps.** M. Simulator-only.

### T6. iOS touch hit-testing on drawn text

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

### T7. Intrinsic `<img>` tag (inline replaced element)

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

### T9. Intrinsic `<div>` tag (block element)

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

## Track A (cleanup) — upstreaming

### T11. Upstream the `createTextInstance` dev-warning removal

- **Goal.** The "Text strings must be rendered within a `<Text>`" dev-warning removal lives in the
  `react` repo host config, not as a vendored-bundle fork carry.
- **Entry points.** `react` repo Fabric host config; our edit is in
  `Libraries/Renderer/implementations/ReactFabric-dev.js`. (Prod needs nothing for the warning;
  the T2 prod-bundle `nodeName` injection is the related prod fork-carry to upstream too.)
- **Testing methodology.** n/a in this repo; verified by the vendored bundle regenerating clean
  from the upstreamed host config.
- **Acceptance.** The fork no longer carries the bundle edit for the warning.
- **Effort / risk / deps.** S. External repo.

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
- Tests / proof: `Libraries/Text/__tests__/ImplicitText-itest.js`,
  `ImplicitTextBaseline-itest.js`, `__fixtures__/implicit-text-web-mirror.html`,
  `packages/rn-tester/js/ImplicitTextDemo.js`,
  `packages/rn-tester/scripts/implicit-text-cdp-verify.js`.
