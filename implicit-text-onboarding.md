# Implicit Text: Contributor Onboarding — from zero context to owning the test suite and the behavior

This document assumes **no prior knowledge** of this project, React Native internals, or the
CSS/DOM specs. Working through it should leave you able to (a) extend and maintain the test
suite, and (b) implement the remaining behavior yourself. The companion design document is
`implicit-text-plan.md` (same directory) — this file tells you how to *get to* the level where
that document is fully legible, and what to do then.

Repo: this branch of `expo/react-native` (fork of `react-native` main, 0.87-rc era).
Everything described below is already implemented and green unless explicitly marked open.

---

## 1. The mission in three sentences

React Native historically required every string to be wrapped in `<Text>`; bare strings under
a `<View>` were silently dropped. This project makes `<View>hello</View>` render — with **CSS
box semantics** (per-display-type layout), **DOM semantics** (node kinds, events, traversal
APIs), web-like **style inheritance**, intrinsic tags (inline `<b>`, `<i>`, `<span>`, the
replaced `<img>`; block `<div>`), and DOM-faithful handling of unknown tags — behind one
feature flag (`enableImplicitTextChildren`).
The single back-compat rule: **apps using explicit `<Text>` render pixel-identically** with the
flag on.

## 2. The behavior we are building (normative summary, with spec references)

The architecture mirrors the web's three-layer split. Internalize this table first; every
design decision in the project derives from it:

| web concept | React Native (Fabric) equivalent |
|---|---|
| DOM (elements + text nodes) | the shadow tree (`ShadowNode`s) — only authored nodes, never synthetic ones |
| box tree (where anonymous boxes live) | Yoga node tree + text layout ("anonymous Yoga items") |
| painting | the mounting layer (`RCTViewComponentView` etc.) |

Behavior rules, each anchored to the spec that defines it:

1. **Box generation per display type.**
   - *Flex containers* (every RN View by default): each contiguous sequence of **text runs**
     becomes one anonymous block-container flex item establishing an inline formatting
     context; inline-level *element* children are **blockified** into their own items;
     whitespace-only anonymous items are not rendered. Spec: [css-flexbox-1 §4 "Flex
     Items"](https://www.w3.org/TR/css-flexbox-1/#flex-items).
   - *Block containers* (`display:'block'`, new): all inline-level children — text runs *and*
     inline elements — join a single inline formatting context; mixed inline/block content
     generates anonymous block boxes between block-level siblings. Spec: [CSS2 §9.2.1.1
     "Anonymous block boxes"](https://www.w3.org/TR/CSS2/visuren.html#anonymous-block-level)
     and [css-display-3 §2](https://www.w3.org/TR/css-display-3/#box-generation).
   - Anonymous boxes are **layout-only**: they never appear in the shadow tree, DOM APIs,
     DevTools, or event paths — exactly as anonymous boxes never appear in the web DOM.
2. **Classification** (outer display): inline-level = text runs, inline text elements
   (nested `<Text>`, `<b>`, `<i>`, `<span>`), the inline replaced `<img>` tag, unknown
   elements; block-level = everything else (RN `View` and `Image` components, the intrinsic
   `<div>` tag — a *true* block container — top-level `<Text>` the `<p>` analog, …). Each
   tag gets its web-standard display, so `View`≠`<div>` (block-outer/flex-inner vs
   block-outer/block-inner) and the RN `Image` component ≠ the inline `<img>` tag.
   `display:'inline'` opt-in for the RN `View`/`Image` components is a
   designed-but-unimplemented phase (plan §3.A).
3. **Inheritance** is defined on the *element tree*, per
   [css-cascade-4 §7.3](https://www.w3.org/TR/css-cascade-4/#inheriting): inheritable text
   properties (currently `color`, `fontSize`; the full CSS inherited set is an open extension)
   cascade from Views into bare-text content. Authored `<Text>` does **not** inherit unless it
   opts in via `inheritViewTextStyles` — that is the pixel-identity exception in action.
4. **Text nodes** are DOM `Text` (CharacterData) per the
   [DOM Standard §4.7](https://dom.spec.whatwg.org/#interface-text): ordered leaf siblings
   (mixed content `a<b>b</b>c` requires this), no styles or events of their own. Today they
   are `RawTextShadowNode`; replacing that "fake component" packaging with a slim first-class
   text node kind is designed (plan §3.F) and still open.
5. **Events**: text nodes are never event targets; the parent element is
   ([UI Events §3.1](https://www.w3.org/TR/uievents/)). Taps on bare text target the
   containing View; inline elements with handlers receive their own events and bubble through
   the authored tree only.
6. **DOM traversal APIs** (`childNodes`, `children`, `parentNode`, `textContent`) behave per
   [DOM Standard §4.4](https://dom.spec.whatwg.org/#interface-node) — which we get for free
   because the shadow tree contains only authored nodes.
7. **Unknown elements** behave like
   [`HTMLUnknownElement`](https://html.spec.whatwg.org/multipage/dom.html#htmlunknownelement):
   inline, unstyled, content renders. Unregistered lowercase JSX tags resolve to the native
   `unknown` inline element instead of throwing or rendering a red box.
8. **White-space**: currently *not* collapsed (JSX literal rules apply). The designed proposal
   is [css-text-3 §3 `white-space: normal`](https://www.w3.org/TR/css-text-3/#white-space-property)
   processing inside the new anonymous IFCs only (no back-compat exists there). This is an
   **open decision** and a prime test-suite area.
9. **Deliberate deviations** (documented, not bugs): no whitespace collapsing yet (see 8);
   `display:'block'` currently ships as a *flex emulation* on Yoga (column+stretch; no margin
   collapsing, no floats) — the committed direction is a first-class `YGDisplayBlock` in Yoga
   so the intrinsic `<div>` tag is a *true* block container (plan §3.A/§4.5); the RN `Image`
   and `View` components stay block-level (the inline `<img>` *tag* is the web-inline-image
   opt-in, distinct from the block-level `Image` component); `gap` and `flexDirection:'row'`
   interact with runs per flexbox, not block, rules.

## 3. Becoming an expert: the two ramp-up tracks

Budget roughly a week per track; they interleave well (mornings spec, afternoons code).

### Track A — DOM/CSS

Read in this order, each with the experiment attached. Do the experiments in a real browser
with DevTools open; they build the intuition the specs alone won't.

1. [CSS2 §9 Visual formatting model](https://www.w3.org/TR/CSS2/visuren.html) — §9.2 is the
   heart: block-level vs inline-level, anonymous block boxes, inline formatting contexts.
   *Experiment:* `<div>text <span>inline</span> text <p>block</p> text</div>` — inspect the
   layout in DevTools; notice the anonymous boxes are invisible in the Elements panel (DOM)
   but visible in layout behavior.
2. [css-display-3](https://www.w3.org/TR/css-display-3/) — the modern reformulation:
   outer/inner display types, blockification (§2.7), `display:contents`.
3. [css-flexbox-1 §4](https://www.w3.org/TR/css-flexbox-1/#flex-items) — anonymous flex
   items, blockification of inline children, whitespace-only item removal.
   *Experiment:* `<div style="display:flex">hi <b>hi</b> hi</div>` — count the flex items
   (three), watch the spaces vanish. This single experiment explains why RN Views (flex)
   and `display:'block'` Views behave differently in our system.
4. [css-text-3 §3](https://www.w3.org/TR/css-text-3/#white-space-property) — white-space
   processing; and [css-cascade-4 §7.3](https://www.w3.org/TR/css-cascade-4/#inheriting) —
   inheritance (which properties inherit and why; compare
   [MDN's inherited-property list](https://developer.mozilla.org/en-US/docs/Web/CSS/Inheritance)).
5. [DOM Standard](https://dom.spec.whatwg.org/) §4.4 (Node) and §4.7 (Text/CharacterData);
   [HTML Standard on HTMLUnknownElement](https://html.spec.whatwg.org/multipage/dom.html#htmlunknownelement).
   *Experiment:* `document.querySelector('div').childNodes` vs `.children`; click a text node
   and log `event.target`.
6. **Ground truth: Web Platform Tests** — <https://github.com/web-platform-tests/wpt> and
   <https://wpt.fyi> (per-engine results: Chrome/Blink — which also covers Opera — Firefox/
   Gecko, Safari/WebKit). Skim these directories; they are the quarry for our suite:
   `css/CSS2/normal-flow/`, `css/CSS2/visuren/`, `css/css-flexbox/` (search "anonymous"),
   `css/css-display/`, `css/css-text/white-space/`, `css/css-inline/`, `dom/nodes/`,
   `html/semantics/interfaces/` (HTMLUnknownElement). Where engines disagree on wpt.fyi,
   *we* must make an explicit documented choice — those cases are gold.

### Track B — React Native / Fabric internals

Start with the public docs, then read source in this order (all paths under
`packages/react-native/` unless noted). The goal is to be able to narrate what happens
between `root.render(<View>hi</View>)` and pixels.

1. Docs: [Fabric render pipeline](https://reactnative.dev/architecture/render-pipeline) and
   [View flattening](https://reactnative.dev/architecture/view-flattening).
2. **Core node model**: `ReactCommon/react/renderer/core/ShadowNode.h` (immutable nodes,
   clone-based updates, `children_`), `ShadowNodeFamily.h` (identity across clones, parent
   pointers, `getAncestors`), `ShadowNodeTraits.h` (incl. our `AnonymousBox` trait).
3. **Layout**: `ReactCommon/react/renderer/components/view/YogaLayoutableShadowNode.{h,cpp}` —
   how shadow nodes wrap Yoga nodes; read `updateYogaChildren` (our anonymous-run detection
   lives here), `configureYogaTree` (our inheritance cascade rides this top-down pass),
   `layout` (metrics propagation). Then our box:
   `ReactCommon/react/renderer/components/text/InlineContentShadowNode.{h,cpp}`.
4. **The text stack**: `components/text/ParagraphShadowNode.{h,cpp}` (how explicit `<Text>`
   works: buildAttributedString → measure → ParagraphState),
   `components/text/BaseTextShadowNode.cpp` (the attributed-string flattening we reuse),
   `textlayoutmanager/platform/ios/.../RCTTextLayoutManager.mm` (TextKit measure/draw),
   `textlayoutmanager/platform/cxx/.../TextLayoutManager.cpp` (our deterministic test
   measurer — see §4 contract).
5. **Commit & mounting**: `ReactCommon/react/renderer/mounting/ShadowTree.cpp` (`tryCommit`),
   `Differentiator.h`, `React/Fabric/Mounting/RCTMountingManager.mm`, and our painting:
   `React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm` (search
   `RCTImplicitTextContentView`).
6. **The JS boundary**: `Libraries/Renderer/shims/ReactNativeViewConfigRegistry.js` (how JSX
   type strings resolve to native components; our unknown-element fallback),
   `Libraries/Text/TextNativeComponent.js` + `Libraries/Text/InlineTags.js` (tag
   registration), `Libraries/Renderer/implementations/ReactFabric-dev.js` around line 15890
   (`createTextInstance` — where bare strings become text nodes; we removed the dev warning).
7. **Guided tour via git history**: `git log --oneline --grep="implicit-text"` — read the ~13
   commits in order. Each message records what worked and what was known-broken at that
   point; the M1→M7 sequence is effectively a tutorial of the whole system. Read
   `implicit-text-plan.md` fully once after this — including Appendix A, the rejected
   synthetic-node design, which teaches *why* the box-tree approach is right.

**Katas** (do these before writing real code):
- Add `LOG(ERROR)` tracing in `updateYogaChildren` and run one Fantom test; narrate the
  clone/rebuild lifecycle you observe.
- Add a `<u>` tag end-to-end (C++ subclass + registration + JS config + one test). It's a
  ~30-line change that touches every layer; delete it after.
- Intentionally break the whitespace rule (render whitespace-only runs) and watch which
  tests catch it — matrix *and* web mirror.

## 4. The test suite: philosophy, mechanics, and your mission

### What exists

- **Matrix** (`packages/react-native/Libraries/Text/__tests__/ImplicitText-itest.js`): 28
  cases, milestone-organized (M1 layout → M7 DOM APIs + M5b unknown elements), run under
  Fantom (headless real C++ renderer) with the flag on via docblock pragma.
- **Baseline guards** (`ImplicitTextBaseline-itest.js`): flag-off behavior + the explicit-
  `<Text>` pixel-identity guarantee. These must stay green forever.
- **Web mirror** (`__tests__/__fixtures__/implicit-text-web-mirror.html`): the same cases in
  real DOM/CSS, self-asserting (PASS/FAIL table + `window.__results`). This anchors our
  expectations to actual browser behavior — 12/12 in Safari today.
- **Simulator demo** (`packages/rn-tester/js/ImplicitTextDemo.js`) + **CDP client**
  (`packages/rn-tester/scripts/implicit-text-cdp-verify.js`) for on-device proof.

### The rules that keep it healthy

1. **Comprehensive but not redundant**: every case must cover a *unique combination* of
   arrangement × display type × styling × events × DOM APIs. If a case would pass/fail in
   lockstep with an existing one, fold it in.
2. **Every behavioral case gets a browser twin** in the web mirror. If the browser twin can't
   be written, the RN expectation is suspect — stop and check the spec.
3. **Assert observably**: layout numbers (via `getBoundingClientRect`), rendered output
   structure, or DOM API results — not internal implementation details.
4. **Control-based assertions beat absolute numbers**: compare bare-string layout against an
   explicit-`<Text>` control rather than hardcoding sizes, wherever possible.
5. **The deterministic measurer contract** (cxx `TextLayoutManager`, flag-gated): 10pt per
   character (**+2pt when bold, +1pt when italic, plus `letterSpacing` per character**), line
   height = **explicit `lineHeight` if set, else** fontSize + 6 (default 14 → 20), naive wrap
   at the width constraint. This makes intrinsic text sizing (and now weight/style/
   letterSpacing/lineHeight inheritance) assertable headlessly. If a new test needs a new
   observable dimension, extend the contract deliberately and document it in the same commit.
6. **Regressions stay green**: `Text-itest.js`, `ReadOnlyText-itest.js`,
   `ReactNativeElement-itest.js`, and the baselines run with every change.
7. **Checkpoint commits** describe known-working / known-broken state explicitly.

### Running everything (exact incantations)

```bash
# Fantom (primary). First build takes ~30 min; incremental is fast.
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
cmake --build private/react-native-fantom/build/tester -j10   # incremental C++ rebuild
yarn fantom packages/react-native/Libraries/Text/__tests__/ImplicitText-itest.js

# Web mirror in Safari (headless-ish):
sudo safaridriver --enable   # once
safaridriver -p 4444 &  # then WebDriver: create session, navigate to the file served
                        # over http://localhost (file:// is blocked), read window.__results

# Simulator demo: flip enableImplicitTextChildren defaultValue in
# scripts/featureflags/ReactNativeFeatureFlags.config.js, `yarn featureflags --update`,
# pod install + xcodebuild RNTester (see gotchas), launch, screenshot via
# `xcrun simctl io <udid> screenshot`.

# CDP layout proof (app running under Metro):
node packages/rn-tester/scripts/implicit-text-cdp-verify.js
```

### The WPT mining workflow (your first project)

1. Pick a directory from the priority list: **(1)** `css/css-flexbox/` anonymous-item cases,
   **(2)** `css/css-text/white-space/`, **(3)** `css/CSS2/normal-flow/` + `visuren/`,
   **(4)** `dom/nodes/`, **(5)** `css/css-inline/`.
2. For each candidate WPT case: check wpt.fyi — if all engines agree, that's the expected
   behavior; if they disagree, bring it to the project owner as a decision item.
3. Translate: express the case with RN primitives in the matrix (layout/structure assertion
   under the deterministic measurer) **and** add the twin to the web mirror. Run the mirror
   in Safari to prove your reading of the case is right *before* touching C++.
4. If RN's current behavior differs: decide test-first whether it's a bug (fix it) or a
   documented deviation (assert the deviation and note the spec delta in the test).
5. Known gap areas the suite should grow into: white-space collapsing (once decided),
   dynamic restructuring (runs merging/splitting on conditional renders and prop updates),
   RTL and `direction`, `fontSizeMultiplier`/accessibility text scaling, nested
   `display:'block'` inside block, absolutely-positioned children inside IFC containers,
   `gap` interplay with runs, line-wrapping specifics, and on-device hit-testing of drawn
   text (simulator-only).

## 5. Open implementation work (in rough priority order)

Each item lists the entry-point files and the verification expectation. The plan doc §3-§4
has the full design for all of these.

> **The actionable backlog is `implicit-text-next-steps.md`** — a standalone work queue that
> gives every remaining task a Goal / Entry points / Approach / **Testing methodology** /
> **Acceptance** breakdown, a shared build-test-DoD section, and a recommended order by track
> (headless / native-Yoga / core-refactor / iOS-simulator / Android). Start there to pick up
> work; the list below is the quick index.

1. **White-space processing decision + implementation** — css-text-3 `normal` collapsing
   inside anonymous IFCs only. Touch: `InlineContentShadowNode::getContentAttributedString`
   (or a shared preprocessing step in `BaseTextShadowNode`). Tests first; get sign-off on
   the §7 open question.
2. **Paint order + per-run views on iOS** — ✅ **DONE (simulator-verified).**
   `RCTImplicitTextRunView` (one per run) replaces the single content view; authored order is
   threaded via `ViewState::TextRun::documentOrder` and `layoutSubviews` interleaves run views
   with mounted children. iPhone 17 Pro screenshot: text before an overlapping child paints
   under it, text after paints over. Plan §3.B / next-steps T5.
3. **Touch hit-testing on drawn text (iOS)** — implement `touchEventEmitterAtPoint:` on
   `RCTViewComponentView` when runs exist (mirror `RCTParagraphComponentView`'s). Verify on
   simulator: tapping an inline element with a handler fires it; bare text fires the View's
   handlers.
4. **Lazy View state** — ✅ **DONE.** `ViewComponentDescriptor::createInitialState` returns
   `nullptr` (Views start stateless, as before the feature); `ViewShadowNode` allocates the
   `ViewState` on demand via the family `ConcreteState` ctor on the first runs and has a
   null-safe early return. Probe evidence: 43 Views → 0 state allocations at construction, 2
   lazy allocations (the text Views). Full regression sweep green (matrix, View-itest 224,
   forced-clone commit hook, sync-on-commit).
5. **First-class text nodes (plan §3.F)** — replace `RawTextShadowNode`'s component packaging
   with a slim `"#text"` node kind (keeps family/instanceHandle for DOM APIs; drops
   descriptor/props-parsing/EventTarget); host config gains `createTextNode`/
   `commitTextUpdate`; delete `RCTRawText` outright (no compat shims). Largest open item;
   read the whole §3.F first.
6. **Full inherited-property set** — ✅ **DONE.** `BaseViewProps` gains `inheritedFontFamily`/
   `FontWeight`/`FontStyle`/`FontVariant`/`LetterSpacing`/`LineHeight`/`TextAlign`/
   `TextTransform` (parsed via the shared attributedstring conversions — header-only, no
   `rrc_view`↔attributedstring link, per §6 gotcha); folded in `configureYogaTree` and
   compared in `inheritableTextPropsDiffer` for live updates; added to both View configs. The
   deterministic measurer now makes `fontStyle` (italic +1pt/char), `letterSpacing`, and
   `lineHeight` layout-observable; `fontFamily`/`textAlign` are asserted via the run's
   rendered attributes. Tests: `ImplicitText-itest.js` M4b (5 cases) + web-mirror twin.
   `fontVariant`/`textTransform` are plumbed and cascade through the same fold but are not
   independently observable headlessly (not size-affecting, not serialized to the mount).
7. **Cascade correctness fix** — ✅ **DONE.** Two-part fix (implicit-text-plan.md §3.D):
   (a) inheritable text props touch no Yoga style, so a change to them alone never dirtied
   layout and no re-cascade ran — `YogaLayoutableShadowNode`'s clone ctor now compares the
   inheritable set (`inheritableTextPropsDiffer`) and `setDirty`s the node so a layout pass
   runs (the parent's `updateYogaChildren` propagates the dirty flag to the surface root);
   (b) `configureYogaTree`'s skip-optimization compares the cascade value it last handed each
   child (`receivedTextAttributes_`) and, when it changed, re-propagates and dirties the
   descendant anonymous IFC box so it re-measures and republishes state (covers colour-only
   changes, which don't alter size). Tests: `ImplicitText-itest.js` M4 "updating a grandparent
   color/fontSize re-cascades into an unchanged subtree" + web-mirror twins (Safari 14/14).
8. **Native Yoga `display:block`** — ✅ **DONE (Stage 1).** First-class `YGDisplayBlock` behind
   the `enableYogaDisplayBlock` sub-flag (emulation is the flag-off fallback):
   `calculateBlockLayout` in `CalculateLayout.cpp` dispatched only for `Display::Block` (flex
   path untouched), children stacked with block sizing (flex-grow ignored, auto width fills a
   definite container else shrink-wraps). `ImplicitTextNativeBlock-itest.js` (parity + native
   fidelity) + web-mirror twins; full flexbox-regression sweep (View-itest 224) green. Later
   stages (margin collapsing, floats/static-position, RTL coverage) remain open. Original scope
   notes below.
   - replace the flex emulation
   (column+stretch) with a first-class `YGDisplayBlock` in Yoga, so the intrinsic `<div>`
   tag is a *true* block container (block inner display, real block-level child stacking,
   natively-generated anonymous block boxes; then margin collapsing; then floats/static
   position). Touch: Yoga's style + layout algorithm, RN's `display` conversions + codegen +
   TS/Flow types, and the anonymous-box grouping predicate in `updateYogaChildren`. Own
   sub-flag; staged. Plan §3.A/§4.5.
   - **Scope assessment (2026-07-21).** Concrete entry points: (1) add `Block` to Yoga's
     *generated* `Display` enum via `ReactCommon/yoga/enums.py` (precedent: the existing
     `Display::Grid`), regenerate `enums/Display.h`; (2) implement the block layout path in
     `yoga/algorithm/CalculateLayout.cpp` (~2805 lines) — the real work, a block formatting
     context distinct from the flex algorithm; (3) audit every `style().display() ==` switch
     site (`CalculateLayout.cpp`, `FlexLine.cpp`, `node/Node.cpp`, `AbsoluteLayout.cpp`) to
     handle `Block`; (4) add the `enableYogaDisplayBlock` common feature flag
     (`scripts/featureflags/ReactNativeFeatureFlags.config.js` → `yarn featureflags --update`,
     **run under node 24 via `mise exec node@24 --`**, not the default node 25 which the
     engines check rejects); (5) map RN `display:'block'` → `YGDisplayBlock` when the flag is
     on, keeping the emulation as the flag-off fallback. Risk: this modifies core layout used
     by every RN view — needs a full flexbox-regression pass. The emulation already covers the
     floor (block-stacking + single inline flow) behaviorally, so this is fidelity, not
     function. Estimated multi-session; sequence as its own workstream (plan §7).
9. **Intrinsic `<img>` and `<div>` tags** — register `<img>` as an inline replaced element
   (reuse Paragraph's inline-attachment machinery; classification routes it into the run,
   not blockified) and `<div>` as a block container (backed by the `display:block` path
   above). JS registration mirrors the `<b>`/`<i>`/`<span>` config; add TS/Flow JSX typings.
   Plan §3.C.
10. **`display:'block'` public types** — ✅ **DONE.** Added `'block'` to the public `display`
    union in Flow (`StyleSheetTypes.js`) and TS (`StyleSheetTypes.d.ts`) + doc comment;
    dropped the now-obsolete `display:'block'` Flow suppressions and corrected the
    inherited-key suppression codes to Flow's actual `[incompatible-type]`. The implicit-text
    JS files (`ImplicitText-itest.js`, `ImplicitTextBaseline-itest.js`, `ImplicitTextDemo.js`,
    `StyleSheetTypes.js`) now pass `flow focus-check` clean (0 errors). Inherited text-style
    keys on `View` stay intentionally un-public-typed (flag-gated) — tests keep precise
    suppressions.
11. **Unknown-element nodeName fidelity** — ✅ **DONE (dev bundle).** The original tag name is
   plumbed through a `nodeName` prop so DOM APIs report `<foo>` (`tagName`/`nodeName` →
   `"RN:foo"`) instead of `unknown`. `UnknownElementProps : TextProps` carries it,
   `createInstance` injects `workInProgress.type` for the `"unknown"` view config, and
   `getTagName` reads the prop. Tests: `ImplicitText-itest.js` M5b + web-mirror twin. Prod
   bundle injection deferred (minified fork carry, like T11/§3.E).
   - **Design finding (2026-07-21).** The raw tag name is lost at the JS boundary:
     `ReactFabric` calls `createNode(tag, viewConfig.uiViewClassName, …)` and the unknown
     view config's `uiViewClassName` is the singleton `'unknown'`
     (`ReactNativeViewConfigRegistry.getUnknownElementViewConfig`); C++ component names are
     static per-descriptor (`UnknownElementShadowNode` → `"unknown"`), and `getTagName`
     (`renderer/dom/DOM.cpp`) returns `"RN:" + componentName`. So the only per-instance
     channel is a **prop**. Implementation: (a) add a `nodeName` field to an
     `UnknownElementProps` (subclass of `TextProps`), (b) inject it in `createInstance` for
     unknown lowercase tags — a **vendored `ReactFabric-{dev,prod}.js` bundle edit**, same
     fork-carry category as the §3.E dev-warning removal (Fantom uses the dev bundle, so that
     suffices for headless tests), (c) have `getTagName` read the prop when the component is
     `"unknown"`. Lower value than native block; do after.
12. **Android** — the shared C++ compiles there but painting needs an Android mounting story
    (TextViews, not a drawing pass). Currently flag-off everywhere by default.
13. **Upstreaming** — the `createTextInstance` dev-warning removal belongs in the `react`
    repo host config; our vendored-bundle edit is a fork carry.

## 6. Environment gotchas (each cost real time; don't rediscover them)

- **Never link `react_renderer_attributedstring` into `rrc_view`'s CMake** — it creates a
  dependency cycle that *silently breaks CMake regeneration*, leaving you testing stale
  binaries. Headers resolve via the common include path; symbols link in the final binary.
- Fantom bundles JS with `platform=android` → View prop additions go in
  `BaseViewConfig.android.js` (and `.ios.js` for parity).
- Props classes need defaults in **both** constructors — the parsing ctor *and* the default
  ctor — because `cloneProps` short-circuits empty props to `defaultSharedProps()`.
- `yarn fantom` only rebuilds C++ if the tester binary is missing — run the cmake build
  yourself after C++ changes.
- CocoaPods on this machine must bypass the Tuft git shim: run `pod install` under
  `env -i` with a clean `PATH` whose `git` is `/usr/bin/git`.
- Metro's inspector proxy returns 401 to CDP websocket clients unless the request carries
  `Origin: http://localhost:8081`.
- `safaridriver` needs one-time `sudo safaridriver --enable`, and pages must be served over
  `http://localhost` (it refuses `file://`).
- The deterministic measurer is flag-gated: flag-off suites still see the historical
  zero-size stub — that's what the baseline tests rely on.

## 7. Definition of done (for any change in this area)

1. Matrix + baselines + regression suites green under Fantom.
2. Web-mirror twin added/updated and passing in at least Safari (Chrome/Firefox where
   available); spec section cited in the test description.
3. Explicit `<Text>` pixel-identity untouched (baseline guards prove it).
4. Checkpoint commit whose message states known-working and known-broken.
5. Behavior changes reflected in `implicit-text-plan.md` (it is the living spec).
