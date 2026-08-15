/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "ViewShadowNode.h"

#include "CloneWithLayoutMetrics.h"

#include <cmath>
#include <functional>
#include <limits>
#include <optional>
#include <string_view>
#include <unordered_map>
#include <vector>
#include <react/featureflags/ReactNativeFeatureFlags.h>
#include <react/renderer/attributedstring/TextAttributes.h>
#include <react/renderer/attributedstring/TextRoleMetrics.h>
#include <react/renderer/components/view/BaseViewProps.h>
#include <react/renderer/components/view/ElementBoxShadowNode.h>
// Included for its `extern` declaration, not just for the type: a `const` at
// namespace scope has internal linkage unless a prior `extern` declaration is
// visible, so without this the component name below would not be exported and
// the component view would fail to link against it.
#include <react/renderer/components/view/ElementButtonShadowNode.h>
#include <react/renderer/components/view/ElementCheckboxShadowNode.h>
#include <react/renderer/components/view/ElementRangeShadowNode.h>
#include <react/renderer/components/view/ElementColorInputShadowNode.h>
#include <react/renderer/components/view/ElementDateInputShadowNode.h>
#include <react/renderer/components/view/ElementFileInputShadowNode.h>
#include <react/renderer/components/view/ElementProgressShadowNode.h>
#include <react/renderer/components/view/ElementRadioShadowNode.h>
#include <react/renderer/components/view/ElementSelectShadowNode.h>
#include <react/renderer/components/view/ElementTextAreaShadowNode.h>
#include <react/renderer/components/view/ElementTextInputShadowNode.h>
#include <react/renderer/components/view/HostPlatformViewTraitsInitializer.h>
#include <react/renderer/components/view/InlineTextContentAccessor.h>
#include <react/renderer/components/view/primitives.h>
#include <react/renderer/core/ConcreteState.h>
#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/core/LayoutContext.h>
#include <react/renderer/core/LayoutableShadowNode.h>

namespace facebook::react {

namespace {
/*
 * These read the NODE's style, not `props.yogaStyle`, and the distinction is
 * not cosmetic. The flow-relative names — `marginBlock`, `paddingInline` — are
 * not stored in `yogaStyle` at all; they are separate alias fields that
 * `YogaLayoutableShadowNode::applyAliasedProps` folds onto the node's style,
 * with PRECEDENCE over the physical edges. Asking `props.yogaStyle` therefore
 * misses exactly the spellings an author of an HTML-element tree is most likely
 * to have written, and a user-agent default would overwrite them.
 *
 * `updateYogaProps` runs from the Yoga base's constructor, before `initialize`,
 * so by the time these are called the aliases are already applied.
 */

/** Whether the author stated horizontal padding of their own, on any edge. */
bool authoredHorizontalPadding(const yoga::Style& style)
{
  for (auto edge :
       {yoga::Edge::Start, yoga::Edge::End, yoga::Edge::Left, yoga::Edge::Right, yoga::Edge::Horizontal,
        yoga::Edge::All}) {
    if (style.padding(edge).isDefined()) {
      return true;
    }
  }
  return false;
}

/** Whether the author stated a block margin of their own, on any edge. */
bool authoredBlockMargin(const yoga::Style& style)
{
  for (auto edge :
       {yoga::Edge::Top, yoga::Edge::Bottom, yoga::Edge::Vertical, yoga::Edge::All}) {
    if (style.margin(edge).isDefined()) {
      return true;
    }
  }
  return false;
}
} // namespace

// NOLINTNEXTLINE(facebook-hte-CArray,modernize-avoid-c-arrays)
const char ViewComponentName[] = "View";

// NOLINTNEXTLINE(facebook-hte-CArray,modernize-avoid-c-arrays)
// Not JSX-addressable: the renderer swaps an element onto this component when
// its display generates a box (ElementBoxShadowNode.h).
const char ElementBoxComponentName[] = "element-box";

// NOLINTNEXTLINE(facebook-hte-CArray,modernize-avoid-c-arrays)
// The interactive flavor of the box, carrying a press event emitter that the
// plain box deliberately does not (ElementButtonShadowNode.h).
const char ElementButtonComponentName[] = "element-button";

// NOLINTNEXTLINE(facebook-hte-CArray,modernize-avoid-c-arrays)
// `<input type="range">`: the platform slider (ElementRangeShadowNode.h).
const char ElementRangeComponentName[] = "element-range";

// NOLINTNEXTLINE(facebook-hte-CArray,modernize-avoid-c-arrays)
// `<input type="checkbox">`: a UISwitch on iOS, a CheckBox on Android — each
// platform's own control for a boolean (ElementCheckboxShadowNode.h).
const char ElementCheckboxComponentName[] = "element-checkbox";

// NOLINTNEXTLINE(facebook-hte-CArray,modernize-avoid-c-arrays)
// `<input>` in its textual forms: a UITextField on iOS, an EditText on Android
// (ElementTextInputShadowNode.h).
const char ElementTextInputComponentName[] = "element-text-input";

// NOLINTNEXTLINE(facebook-hte-CArray,modernize-avoid-c-arrays)
// `<textarea>`: a UITextView on iOS, a multi-line EditText on Android
// (ElementTextAreaShadowNode.h).
const char ElementTextAreaComponentName[] = "element-textarea";

// NOLINTNEXTLINE(facebook-hte-CArray,modernize-avoid-c-arrays)
// `<progress>` and `<meter>`, which share one control
// (ElementProgressShadowNode.h).
const char ElementProgressComponentName[] = "element-progress";

// NOLINTNEXTLINE(facebook-hte-CArray,modernize-avoid-c-arrays)
// `<select>`: a pop-up UIMenu on iOS, a Spinner on Android
// (ElementSelectShadowNode.h).
const char ElementSelectComponentName[] = "element-select";

// NOLINTNEXTLINE(facebook-hte-CArray,modernize-avoid-c-arrays)
// `<input type="radio">`: a RadioButton on Android, drawn on iOS because UIKit
// has no radio (ElementRadioShadowNode.h).
const char ElementRadioComponentName[] = "element-radio";

// NOLINTNEXTLINE(facebook-hte-CArray,modernize-avoid-c-arrays)
// `<input type="date">`, `"time"` and `"datetime-local"`: a compact
// UIDatePicker on iOS, the platform picker dialogs on Android
// (ElementDateInputShadowNode.h).
const char ElementDateInputComponentName[] = "element-date-input";

// NOLINTNEXTLINE(facebook-hte-CArray,modernize-avoid-c-arrays)
// `<input type="color">`: the system picker on iOS, a swatch grid on Android,
// which has none (ElementColorInputShadowNode.h).
const char ElementColorInputComponentName[] = "element-color-input";

// NOLINTNEXTLINE(facebook-hte-CArray,modernize-avoid-c-arrays)
// `<input type="file">`: the system document picker on both
// (ElementFileInputShadowNode.h).
const char ElementFileInputComponentName[] = "element-file-input";

#if defined(__APPLE__) && defined(__aarch64__) && defined(NDEBUG)
#include <TargetConditionals.h>
// Memory regression guards (string-children-perf-plan.md). Every View in
// every shadow-tree generation is one of these; the copy-on-write cascade
// change took ViewShadowNode from 1576 to 1144 bytes, and growth here is a
// per-node tax on whole trees. If a legitimate change trips one, re-measure
// with ./bench-string-children.sh --sizes and move the bound consciously.
//
// OPTIMISED BUILDS ONLY (`NDEBUG`), and that is not a loophole. A debug build's
// standard-library types are larger — hardened containers, no empty-base
// collapsing — so a ceiling measured in Release is not a fact about a Debug
// build and holding one to it measures the configuration rather than the code.
//
// It was not guarded, and the cost was not a false alarm but a broken build:
// `sizeof(TextAttributes) <= 288` fails outright under `-configuration Debug`,
// so RNTester could not be built in Debug for iOS at all. That is the
// configuration the ObjC test suite uses, which is how a stale app from a
// previous day stayed installed on the simulator and served results for hours.
// A guard that stops the build in a configuration nobody measured is worse
// than no guard.
//
// The ceilings are per-OS: iOS types are legitimately larger (SharedColor
// carries a platform color object there, not a packed int32), so the same
// structs measure bigger under an iphoneos/iphonesimulator target — those
// bounds pin the iOS sizes as measured, they do not represent growth.
#if TARGET_OS_OSX || (!TARGET_OS_IPHONE && !TARGET_OS_TV && !TARGET_OS_WATCH)
static_assert(
    sizeof(ViewShadowNode) <= 1144,
    "ViewShadowNode grew past its memory budget");
static_assert(
    // 176 -> 184 with `baselineShift`, same addition as the iOS bound below.
    // 184 -> 208 with `href`, same addition as the iOS bound below.
    sizeof(TextAttributes) <= 208,
    "TextAttributes grew; it is copied and compared throughout the text stack");
static_assert(
    sizeof(ViewProps) <= 1900,
    "ViewProps grew; every mounted View holds one, plus one per pending "
    "generation during commits");
#else
static_assert(
    sizeof(ViewShadowNode) <= 1088,
    "ViewShadowNode grew past its memory budget");
static_assert(
    // 288 -> 296 for the numeric `baselineShift` (2026-08: symbolic list
    // markers centre their ink with it; it will also carry
    // `vertical-align: <length>`). One Float plus alignment padding — moved
    // consciously, per the note above.
    //
    // 296 -> 320 for `href` (2026-08-26). A `std::string`, 24 bytes, so that a
    // link inside a paragraph can say where it points: a link is a RANGE OF
    // GLYPHS, and the fragment's attributes are the only thing that travels
    // with a range. The struct already carries `fontFamily` on the same terms.
    //
    // The cost is footprint, not work: an empty string is stored inline, so a
    // fragment without a link allocates nothing and copies nothing extra
    // beyond the 24 bytes.
    //
    // The obvious alternative DOES NOT WORK, and is written down here because
    // it is the first thing anyone will reach for — this author included, who
    // built it before finding out.
    //
    // The destination belongs to the ELEMENT rather than to each of its
    // fragments, so reading it from `Fragment::parentShadowView`'s props would
    // cost nothing per fragment. But those props are always null:
    // `shadowViewFromShadowNode` in `BaseTextShadowNode.cpp` clears `props` and
    // `state` deliberately, to avoid retain cycles. Measured, not assumed — a
    // probe over the fragments of a real paragraph printed `props=0x0` for
    // every one, with `componentHandle` populated beside it, which is why the
    // event emitter reachable through the same ShadowView is not evidence that
    // the props are.
    //
    // A fragment's own attributes are therefore the only thing that travels
    // with a range of glyphs, which makes this the right home and not a
    // shortcut.
    //
    // 320 -> 344 is NOT ours: upstream's `std::vector<TextEffectInfo>
    // textEffects` (#56720) is 24 bytes on every fragment. It went unnoticed
    // because only an iOS build checks this bound, and the macOS one beside it
    // is re-checked by every Fantom run — so the two drifted apart. Raised to
    // what an iphonesimulator Release build actually measures rather than to
    // an arithmetic guess, which is how the previous number came to be wrong.
    sizeof(TextAttributes) <= 344,
    "TextAttributes grew; it is copied and compared throughout the text stack");
static_assert(
    sizeof(ViewProps) <= 2288,
    "ViewProps grew; every mounted View holds one, plus one per pending "
    "generation during commits");
#endif
#endif

template <const char* concreteComponentName, typename ViewPropsT, typename ViewEventEmitterT>
void AbstractViewShadowNode<concreteComponentName, ViewPropsT, ViewEventEmitterT>::
    initialize() noexcept {
  auto& viewProps = static_cast<const ViewProps&>(*this->props_);

  auto hasBorder = [&]() {
    for (auto edge : yoga::ordinals<yoga::Edge>()) {
      if (viewProps.yogaStyle.border(edge).isDefined()) {
        return true;
      }
    }
    return false;
  };

  bool formsStackingContext = !viewProps.collapsable ||
      viewProps.pointerEvents == PointerEventsMode::BoxOnly ||
      viewProps.pointerEvents == PointerEventsMode::None ||
      !viewProps.nativeId.empty() || viewProps.accessible ||
      viewProps.opacity != 1.0 || viewProps.transform != Transform{} ||
      (viewProps.zIndex.has_value() &&
       viewProps.yogaStyle.positionType() != yoga::PositionType::Static) ||
      viewProps.yogaStyle.display() == yoga::Display::None ||
      viewProps.getClipsContentToBounds() || viewProps.events.bits.any() ||
      isColorMeaningful(viewProps.shadowColor) ||
      viewProps.accessibilityElementsHidden ||
      viewProps.accessibilityViewIsModal ||
      viewProps.importantForAccessibility != ImportantForAccessibility::Auto ||
      viewProps.removeClippedSubviews || viewProps.cursor != Cursor::Auto ||
      !viewProps.filter.empty() ||
      viewProps.mixBlendMode != BlendMode::Normal ||
      viewProps.isolation == Isolation::Isolate ||
      HostPlatformViewTraitsInitializer::formsStackingContext(viewProps) ||
      !viewProps.accessibilityOrder.empty();

  bool formsView = formsStackingContext ||
      isColorMeaningful(viewProps.backgroundColor) || hasBorder() ||
      !viewProps.testId.empty() || !viewProps.boxShadow.empty() ||
      !viewProps.backgroundImage.empty() ||
      HostPlatformViewTraitsInitializer::formsView(viewProps) ||
      viewProps.outlineWidth > 0;

  if (!this->getAnonymousTextContentChildren().empty()) {
    // Text-bearing Views paint their runs and must not be flattened away
    // (text-children-plan.md §3.B).
    formsView = true;
    formsStackingContext = true;
  }

  bool holdsRadio = false;
  if (HostPlatformViewTraitsInitializer::treatsRadioRowsAsListRows()) {
    /*
     * A row holding an `<input type="radio">` is a row, and has to survive as
     * one.
     *
     * On iOS a run of radios is presented as the platform's grouped list, and
     * what the list hosts in each cell is the ROW — the element the author
     * wrote around the control, with its label and whatever else it holds.
     * Fabric flattens a view that draws nothing, and a row usually draws
     * nothing, so the row an author wrote was simply not in the view tree by
     * the time anything looked for it: the walk landed on the container above
     * and made one section the size of the screen.
     *
     * The alternative was to have authors write `collapsable={false}` on every
     * row, which is a renderer's implementation detail appearing in markup for
     * a reason nothing about the markup explains. `<input type="radio">` is all
     * anyone should have to write.
     *
     * BOTH traits, as the text-content check above sets both. Forming a view
     * without forming a stacking context is not the same thing: the row
     * survived, but the mounting layer put it somewhere else — each row alone
     * inside a wrapper of its own, so no two rows were ever siblings and no run
     * was ever more than one row long. A row is a row among its siblings or it
     * is not a row.
     *
     * Stated as a child scan for the same reason the text-content check is:
     * this runs where the children are already known, and the answer cannot
     * come from the props of the node itself. It is not a fallback for views
     * that would otherwise flatten, because the same answer decides the row's
     * user-agent PADDING below — and a row that draws a background already
     * forms a view, so a scan skipped on that ground would leave exactly those
     * rows unpadded.
     *
     * It runs only where the platform actually presents radios as a list.
     * Elsewhere — Android, which has a real `RadioButton` — the row is an
     * ordinary row, and neither the forced view nor the scan that decides it
     * buys anything.
     */
    for (const auto &child : this->getChildren()) {
      if (child->getComponentHandle() == ElementRadioShadowNode::Handle()) {
        formsView = true;
        formsStackingContext = true;
        holdsRadio = true;
        break;
      }
    }
  }

  // ONLY where a radio was actually found. Hanging this off `formsView` instead
  // reached every view that draws anything at all, and indented the whole page.
  if (holdsRadio) {
    this->applyRadioRowPaddingIfNeeded();
  }

  // Asked HERE, at the one moment the Yoga style holds only what the element
  // itself declared: `initialize()` runs from the constructor, before any
  // configure pass has had the chance to write a user-agent margin over it.
  this->authoredBlockMargin_ = authoredBlockMargin(this->yogaNode_.style());

  // Whether this element reads the cascade for a LENGTH. See the trait: it is
  // how the configure walk knows to hand a cascade to a node with no text in
  // it, which the dependents optimisation would otherwise skip.
  if (std::isfinite(viewProps.uaMarginBlockEm) ||
      std::isfinite(viewProps.uaMarginBlockRem)) {
    this->traits_.set(ShadowNodeTraits::Trait::ResolvesRelativeLength);
  } else {
    this->traits_.unset(ShadowNodeTraits::Trait::ResolvesRelativeLength);
  }

  // A first answer from what is knowable this early — a role resolves to a
  // platform size without needing a cascade, which is every heading. Anything
  // resolving against a font size instead is corrected by the configure pass,
  // which is the first moment that size exists.
  this->applyRelativeBlockMarginIfNeeded(
      std::numeric_limits<Float>::quiet_NaN(),
      std::numeric_limits<Float>::quiet_NaN());

  if (ReactNativeFeatureFlags::enableStringChildren() &&
      viewProps.displayInline) {
    // Atomic `display:'inline'` boxes are positioned by their container's
    // inline-attachment layout (stamped layout metrics); flattening one away
    // would hoist its children out of the stamped frame, so it must own a
    // host view.
    formsView = true;
    formsStackingContext = true;
  }

  if (formsView) {
    this->traits_.set(ShadowNodeTraits::Trait::FormsView);
  } else {
    this->traits_.unset(ShadowNodeTraits::Trait::FormsView);
  }

  if (formsStackingContext) {
    this->traits_.set(ShadowNodeTraits::Trait::FormsStackingContext);
  } else {
    this->traits_.unset(ShadowNodeTraits::Trait::FormsStackingContext);
  }

  if (!viewProps.collapsableChildren) {
    this->traits_.set(ShadowNodeTraits::Trait::ChildrenFormStackingContext);
  } else {
    this->traits_.unset(ShadowNodeTraits::Trait::ChildrenFormStackingContext);
  }
}

/*
 * The user-agent padding for a row that holds a radio.
 *
 * Applied here rather than in `updateYogaProps`, because that runs from the
 * Yoga base's constructor — before the initial tree's children are appended, so
 * a row looked childless there. Both of this function's callers run after the
 * base constructor has already written the style, so writing over it is the
 * last word; and every props change builds a NEW node, whose `initialize()`
 * re-applies it.
 *
 * A DEFAULT, not an override: a row that states its own horizontal padding
 * keeps it, exactly as a user-agent stylesheet gives way to an author's.
 */
/*
 * The heading margin, resolved against the size the heading is drawn at.
 *
 * `h1 { margin-block: 0.67em }` is one multiplication, but neither operand used
 * to be available in the same place. The sheet knows the factor and not the
 * size — the platform decides that from the text role. The text layer learns
 * the size and has no business setting margins. So the sheet sends the FACTOR
 * (`uaMarginBlockEm`), the text layer publishes the SIZE (`TextRoleMetrics`), and
 * they meet here, in the only layer that writes margins.
 *
 * Before this, the sheet stated the product and computed it against the size
 * the WEB would have used: an `<h1>` drawn at Title 1's 28pt carried the 22.8pt
 * margin belonging to 34pt. The type came from the platform and the rhythm
 * around it did not.
 *
 * ## What it does NOT do
 *
 * It does not take spacing from the platform. Neither iOS nor Android states
 * what the gap above a heading should be, and inventing one from a system
 * metric would be a guess wearing a native badge. The FACTOR here is the web's,
 * unchanged; only the size it multiplies is the platform's. `em` means what it
 * has always meant, and finally has the right value to resolve against.
 *
 * ## Falling back
 *
 * Where the platform published nothing — Fantom, or any host with no type scale
 * — this resolves against the font-size the cascade carried, which on such a
 * host is the web ladder's. Same code path, same factor, and the answer comes
 * out as the web's ladder. The fallback is not a degraded mode; it is the
 * correct result for a host with no platform to ask.
 *
 * ## Precedence
 *
 * A default, not an override. An author who writes `marginBlock` (or `marginTop`,
 * or `margin`) keeps it untouched — `uaMarginBlockEm` is a separate property that
 * only the user-agent sheet writes, so an author's margin and this one can never
 * be confused for one another. That separation is what lets a user-agent value
 * lose to an author's here, which is the precedence a UA sheet has on the web
 * and which merging both into one `style` cannot express.
 */
template <const char* concreteComponentName, typename ViewPropsT, typename ViewEventEmitterT>
void AbstractViewShadowNode<concreteComponentName, ViewPropsT, ViewEventEmitterT>::
    applyRelativeBlockMarginIfNeeded(Float emBase, Float remBase) {
  const auto& viewProps = static_cast<const ViewPropsT&>(*this->props_);
  const Float emFactor = viewProps.uaMarginBlockEm;
  const Float remFactor = viewProps.uaMarginBlockRem;
  // `isfinite` rather than `isnan`: unstated is the common exit, and an
  // infinite factor — reachable from an author writing `Infinity` — would
  // otherwise produce a margin Yoga cannot lay out. A NEGATIVE factor is left
  // alone, because a negative margin is meaningful CSS.
  const bool hasEm = std::isfinite(emFactor);
  const bool hasRem = std::isfinite(remFactor);
  if (!hasEm && !hasRem) {
    return;
  }
  react_native_assert(
      !(hasEm && hasRem) &&
      "a user-agent block margin is stated in one unit or the other");
  if (this->authoredBlockMargin_) {
    return;
  }

  /*
   * `rem` names one size for the whole document, so there is nothing about
   * THIS element to consult: the base arrives from the root and the only
   * fallback is the initial value the root itself starts from.
   */
  Float fontSize = std::numeric_limits<Float>::quiet_NaN();
  if (hasRem) {
    fontSize = remBase;
  } else {
    /*
     * `em` is this element's own computed font size. In order of authority:
     *
     *  1. what the platform says this role is — the case this exists for, and
     *     the only one that tracks the user's text-size setting. The cascade
     *     cannot supply this one: where a platform role answers, the cascade
     *     deliberately carries NO size, so that the platform's own font is
     *     asked for downstream and brings its weight and leading with it;
     *  2. the size the CASCADE computed for this element — the spec's answer,
     *     and the only one that sees an ancestor's `font-size`. The sheet's
     *     own stand-in for an unresolved role is already folded into it, so
     *     this step covers that case too rather than repeating it;
     *  3. the element's own declaration, for the one call that happens before
     *     a cascade exists (see `initialize`);
     *  4. the renderer's default, for an element that states none of these.
     *
     * Every step is a real font-size for this element, so the margin is `em`
     * against something true at each one.
     */
    if (viewProps.inheritedDynamicTypeRamp.has_value()) {
      if (const auto published =
              TextRoleMetrics::sizeOf(*viewProps.inheritedDynamicTypeRamp)) {
        fontSize = *published;
      }
    }
    if (std::isnan(fontSize)) {
      fontSize = emBase;
    }
    if (std::isnan(fontSize)) {
      fontSize = viewProps.inheritedFontSize;
    }
  }
  if (std::isnan(fontSize) || fontSize <= 0) {
    fontSize = TextAttributes::defaultTextAttributes().fontSize;
  }

  const Float margin = (hasRem ? remFactor : emFactor) * fontSize;
  auto style = this->yogaNode_.style();
  style.setMargin(yoga::Edge::Top, yoga::StyleLength::points(margin));
  style.setMargin(yoga::Edge::Bottom, yoga::StyleLength::points(margin));
  this->yogaNode_.setStyle(style);
}

template <const char* concreteComponentName, typename ViewPropsT, typename ViewEventEmitterT>
void AbstractViewShadowNode<concreteComponentName, ViewPropsT, ViewEventEmitterT>::
    applyRadioRowPaddingIfNeeded() {
  const auto padding = HostPlatformViewTraitsInitializer::radioRowPadding();
  if (padding.start == 0 && padding.end == 0) {
    return;
  }
  auto style = this->yogaNode_.style();
  if (authoredHorizontalPadding(style)) {
    return;
  }
  style.setPadding(yoga::Edge::Start, yoga::StyleLength::points(padding.start));
  style.setPadding(yoga::Edge::End, yoga::StyleLength::points(padding.end));
  this->yogaNode_.setStyle(style);
}

template <const char* concreteComponentName, typename ViewPropsT, typename ViewEventEmitterT>
void AbstractViewShadowNode<concreteComponentName, ViewPropsT, ViewEventEmitterT>::appendChild(
    const std::shared_ptr<const ShadowNode>& child) {
  BaseShadowNode::appendChild(child);
  // See the header: a row holding a radio has to survive flattening, and this
  // is the moment the initial tree learns it holds one.
  if (HostPlatformViewTraitsInitializer::treatsRadioRowsAsListRows() &&
      child->getComponentHandle() == ElementRadioShadowNode::Handle()) {
    this->traits_.set(ShadowNodeTraits::Trait::FormsView);
    this->traits_.set(ShadowNodeTraits::Trait::FormsStackingContext);
    this->applyRadioRowPaddingIfNeeded();
  }
}

template <const char* concreteComponentName, typename ViewPropsT, typename ViewEventEmitterT>
void AbstractViewShadowNode<concreteComponentName, ViewPropsT, ViewEventEmitterT>::layout(
    LayoutContext layoutContext) {
  YogaLayoutableShadowNode::layout(layoutContext);
  layoutInlineAttachments(layoutContext);
  updateTextRunStateIfNeeded(layoutContext.fontSizeMultiplier);
}

template <const char* concreteComponentName, typename ViewPropsT, typename ViewEventEmitterT>
void AbstractViewShadowNode<concreteComponentName, ViewPropsT, ViewEventEmitterT>::
    layoutInlineAttachments(LayoutContext layoutContext) {
  if (!ReactNativeFeatureFlags::enableStringChildren()) {
    return;
  }
  const auto& boxes = this->getAnonymousTextContentChildren();
  if (boxes.empty()) {
    return;
  }

  // Clone-and-position each inline attachment — the replaced `<img>` and
  // atomic `display:'inline'` elements (non-Yoga children) — at its exact
  // inline offset within the run. The run box resolves each attachment's frame
  // via the text layout; the attachment is placed at the box origin plus that
  // frame, so it sits between the surrounding glyphs and follows wrapping —
  // like a replaced element in a web line box (text-children-plan.md §3.C).
  auto* current = this;
  auto owning = std::shared_ptr<ShadowNode>{};

  for (const auto& box : boxes) {
    const auto boxFrame = box->getLayoutMetrics().frame;
    const auto* accessor =
        dynamic_cast<const InlineTextContentAccessor*>(box.get());

    // Give the run's inline elements (<b>, <span>, …) a real box to report
    // from getBoundingClientRect(). Purely additive — no effect on layout or
    // paint; routed through the accessor seam so this module keeps no text
    // dependency.
    /*
     * The origin each inline box was just stamped with, for the attachment
     * pass below.
     *
     * That pass subtracts an attachment's inline-element ancestors' offsets to
     * make its origin parent-relative, and it reads those offsets off the
     * ancestor nodes. That only works for an ancestor stamped IN PLACE. A
     * sealed one is stamped by cloning the path to it, which leaves the node
     * this loop walks — `*box`, from before the clone — still reporting the
     * zero origin it had at mount. The subtraction then subtracts nothing and
     * the attachment keeps run-space coordinates, which the mounting layer
     * composes onto the ancestor a second time.
     *
     * Sealed is the ordinary case, not the exotic one: a node is unsealed only
     * on the layout that follows its own clone, so any run that lays out again
     * without re-cloning its inline boxes — a re-measure, a state update
     * elsewhere in the surface — takes this path. A box inside a `<span>`
     * after a 40pt box reported x=80 against Safari's 40, and one inside a
     * `<span>` on a wrapped line reported y=40 against 20.
     *
     * Recording the origins here rather than re-reading them keeps the two
     * passes on one source of truth: this is the number the stamp used, so the
     * subtraction cannot disagree with it.
     */
    std::unordered_map<const ShadowNodeFamily*, Point> stampedOrigins;

    if (accessor != nullptr) {
      // Elements whose nodes are unsealed are stamped in place; the rest come
      // back here to be applied by cloning the path to them, exactly as the
      // attachment loop below repositions an inline `<img>`. Dropping them
      // silently is what left a `<b>` reporting its previous line's rect after
      // a resize rewrapped the run around it.
      // One pass for all of them: `cloneTree` searches the subtree for its
      // family and rebuilds the spine down to it, so a call per element is
      // quadratic in the number of elements in the run.
      LayoutMetricsByFamily stampsByFamily;
      for (const auto& stamp : accessor->stampInlineElementMetrics(
               layoutContext, boxFrame.origin, this->getLayoutMetrics())) {
        stampedOrigins[stamp.family] = stamp.metrics.frame.origin;
        stampsByFamily[stamp.family] = stamp.metrics;
      }
      if (!stampsByFamily.empty()) {
        auto replaced = cloneWithLayoutMetrics(*current, stampsByFamily);
        if (replaced != nullptr) {
          owning = std::move(replaced);
          current = static_cast<AbstractViewShadowNode*>(owning.get());
        }
      }
    }

    const auto placements = accessor != nullptr
        ? accessor->getInlineAttachmentPlacements(layoutContext)
        : std::vector<InlineAttachmentPlacement>{};

    // Attachment candidates are every atomic inline in this inline formatting
    // context, at any depth.
    //
    // Depth is the point. An inline box does not establish a formatting context
    // of its own — its children participate in the *same* IFC as the box (CSS2
    // §9.4.2, css-inline-3 §2.1) — so `<a><img></a>` puts the image on this
    // run's line exactly as a bare `<img>` does, and `<label><input> …</label>`
    // puts the control on the label's line. The text side already agrees:
    // `BaseTextShadowNode::buildAttributedString` recurses through nested
    // inline elements, so a nested `<img>` is measured, reserved and given an
    // attachment frame. Only the collection below stopped short of it, so the
    // frame existed and nothing was ever moved to it — the image simply never
    // appeared.
    //
    // Two kinds of inline box flow their contents into this run, and both have
    // to be descended into:
    //
    //  - an inline *text* element — `<a>`, `<span>`, `<b>`, `<label>`, `<q>`, a
    //    nested `<Text>` — which is a `TextShadowNode` carrying the `InlineText`
    //    trait, and is what this used to miss;
    //  - a *span-like* `display: inline` Yoga box, which `isInlineFlowContent`
    //    already recognised.
    //
    // That union is not new here: `InlineElementMetrics` decides what is
    // stampable with the same disjunction, for the same reason. This was the
    // one place carrying half of it.
    //
    // What must NOT be descended into is anything that is itself an atomic
    // inline: a replaced element or a box that establishes its own formatting
    // context. Those are leaves — they get placed, and their contents are their
    // own business. `<img>` carries `InlineText` as well, so it is the
    // `InlineReplaced` check rather than the trait that keeps it a leaf.
    /*
     * Each candidate carries the offset its inline-element ancestors already
     * contribute.
     *
     * The text layout reports an attachment's frame relative to the run, but an
     * attachment is *mounted* where it sits in the tree — inside the `<a>` or
     * `<span>` that contains it — and those elements have just been given
     * stamped metrics of their own by `stampInlineElementMetrics`. The mounting
     * layer composes a child's origin onto its parent's, so writing the
     * run-relative origin onto a nested attachment counts the ancestors twice:
     * an `<img>` after a 40pt run inside a `<span>` landed at x=80 where Safari
     * puts it at 40.
     *
     * (The stamp's comment calls itself "purely additive — no effect on layout
     * or paint". That is true of an inline element with no box children, which
     * is what it was written for, and false as soon as one contains an
     * attachment.)
     *
     * So the chain is accumulated on the way down and subtracted at the end,
     * leaving each attachment's origin relative to its own parent. This mirrors
     * what `InlineElementMetrics` does for the elements themselves with its
     * `stampedAncestorOrigin`.
     */
    struct Candidate {
      std::shared_ptr<const ShadowNode> node;
      Point ancestorOffset;
    };
    std::vector<Candidate> attachmentCandidates;
    const auto flowsIntoThisRun = [](const ShadowNode& node) {
      if (node.getTraits().check(ShadowNodeTraits::Trait::InlineReplaced) ||
          YogaLayoutableShadowNode::isAtomicInline(node)) {
        return false;
      }
      const auto flows = YogaLayoutableShadowNode::isInlineLevelContent(node);
      // Structural invariant: "flows its contents into this run" and "is itself
      // an atomic inline" are exclusive and exhaustive over inline-level
      // content. If a node were both, its contents would be placed on this line
      // *and* it would be placed as a box — the same content laid out twice.
      react_native_assert(
          !(flows && YogaLayoutableShadowNode::isAtomicInline(node)) &&
          "an inline box cannot both flow its contents and be an atomic inline");
      return flows;
    };
    const std::function<void(const ShadowNode&, Point)> collectCandidates =
        [&](const ShadowNode& parent, Point offset) {
          for (const auto& child : parent.getChildren()) {
            if (flowsIntoThisRun(*child)) {
              auto childOffset = offset;
              // Only a box that was actually stamped contributes an offset; a
              // `#text` node has no frame for the mounting layer to compose.
              //
              // Prefer the origin the stamp above just assigned: when that
              // element was sealed, the stamp went to a clone and this node
              // still carries its pre-stamp frame. Falling back to the node
              // covers an element this run did not stamp on this pass.
              if (const auto* layoutableChild =
                      dynamic_cast<const LayoutableShadowNode*>(child.get())) {
                const auto stamped =
                    stampedOrigins.find(&child->getFamily());
                const auto childOrigin = stamped != stampedOrigins.end()
                    ? stamped->second
                    : layoutableChild->getLayoutMetrics().frame.origin;
                childOffset.x += childOrigin.x;
                childOffset.y += childOrigin.y;
              }
              collectCandidates(*child, childOffset);
            } else {
              attachmentCandidates.push_back(Candidate{child, offset});
            }
          }
        };
    collectCandidates(*box, Point{0, 0});

    // One attachment can be looked up per candidate; a linear scan per
    // candidate is O(attachments²) in an attachment-heavy run.
    std::unordered_map<const ShadowNodeFamily*, const Rect*> placementsByFamily;
    placementsByFamily.reserve(placements.size());
    for (const auto& placement : placements) {
      placementsByFamily.emplace(placement.family, &placement.frame);
    }

    for (const auto& candidate : attachmentCandidates) {
      const auto& runChild = candidate.node;
      const auto* layoutable =
          dynamic_cast<const LayoutableShadowNode*>(runChild.get());
      if (layoutable == nullptr) {
        continue;
      }

      // The text layout's frame for this attachment is authoritative for both
      // offset and size; fall back to the box origin and a fresh measure only
      // if the platform layout manager reported no attachment frame (e.g. the
      // deterministic test manager).
      const Rect* attachmentFrame = nullptr;
      if (auto it = placementsByFamily.find(&runChild->getFamily());
          it != placementsByFamily.end()) {
        attachmentFrame = it->second;
      }

      // A REPORTED placement is itself the proof this candidate is an
      // attachment: the text layout measured it into the run. Gating on the
      // traits as well skipped exactly the node the run had reserved space
      // for whenever the backing does not declare them — the expo-image
      // <img> carries neither InlineReplaced nor an inline display, so a
      // nested <a><img> had its frame computed, thrown away here, and the
      // picture mounted at the line's start, under the words before it. The
      // trait check remains only for candidates the layout did NOT place.
      if (attachmentFrame == nullptr &&
          !runChild->getTraits().check(
              ShadowNodeTraits::Trait::InlineReplaced) &&
          !YogaLayoutableShadowNode::isAtomicInline(*runChild)) {
        continue;
      }

      auto attachmentSize = attachmentFrame != nullptr &&
              (attachmentFrame->size.width != 0 ||
               attachmentFrame->size.height != 0)
          ? attachmentFrame->size
          : layoutable->getLayoutMetrics().frame.size;
      if (attachmentSize.width == 0 && attachmentSize.height == 0) {
        attachmentSize = layoutable->measure(
            layoutContext,
            LayoutConstraints{
                .minimumSize = {0, 0},
                .maximumSize = {
                    std::numeric_limits<Float>::infinity(),
                    std::numeric_limits<Float>::infinity()}});
      }

      auto attachmentOrigin = boxFrame.origin;
      if (attachmentFrame != nullptr) {
        attachmentOrigin.x += attachmentFrame->origin.x;
        attachmentOrigin.y += attachmentFrame->origin.y;
      }
      // Relative to this attachment's own parent — see `Candidate`.
      attachmentOrigin.x -= candidate.ancestorOffset.x;
      attachmentOrigin.y -= candidate.ancestorOffset.y;

      owning = current->cloneTree(
          runChild->getFamily(), [&](const ShadowNode& oldShadowNode) {
            auto cloned = oldShadowNode.clone({});
            auto& clonedLayoutable =
                dynamic_cast<LayoutableShadowNode&>(*cloned);
            clonedLayoutable.layoutTree(
                layoutContext,
                LayoutConstraints{
                    .minimumSize = attachmentSize,
                    .maximumSize = attachmentSize});
            auto metrics = clonedLayoutable.getLayoutMetrics();
            metrics.frame.origin = attachmentOrigin;
            clonedLayoutable.setLayoutMetrics(metrics);
            return cloned;
          });
      if (owning != nullptr) {
        current = static_cast<AbstractViewShadowNode*>(owning.get());
      }
    }
  }

  if (current != this) {
    this->children_ = current->children_;
  }
}

namespace {

/*
 * CSS2 §10.8.1 says an atomic inline aligns by "the baseline of its last line
 * box in the normal flow". Line boxes are not only the box's own: they live
 * wherever the flow puts them, including inside descendant blocks, which is
 * what these two functions walk to find.
 *
 * Every rule below is pinned to Safari (17 cases, `getBoundingClientRect` on
 * an inline-block of a fixed 60x40 in a 60px line, so the box is free to
 * float and every answer is distinguishable):
 *
 *  - text one, two, or N levels down behaves exactly like text directly in
 *    the box (48 / 48 / 48 for 10pt, 29 / 29 / 29 for 30pt);
 *  - the LAST line box wins even when it overflows the box's own height
 *    (two stacked blocks, 30pt then 10pt: baseline 45 inside a 40pt box);
 *  - a child with no line box is SKIPPED, not fatal — a trailing empty block
 *    falls back to the previous block's line box (29, not the bottom edge);
 *  - out-of-flow children never contribute: `position: absolute` and `float`
 *    both give the bottom edge (18), the same as an empty box;
 *  - a CLIPPED descendant contributes its own bottom margin edge rather than
 *    the line box inside it (23, between the line box's 29 and the box's own
 *    bottom edge at 18) — the same rule the box itself obeys, applied one
 *    level down. But only if it has one at all: a clipped EMPTY block gives
 *    the bottom edge (18), so clipping does not conjure a baseline;
 *  - offsets accumulate through padding and margins (a 12pt margin on the
 *    inner block moves the baseline by exactly 12).
 */

/*
 * Whether `node`'s subtree contains a line box at all — the question a
 * clipped box has to answer before it can offer its bottom edge.
 */
bool subtreeHasLineBox(
    const YogaLayoutableShadowNode& node,
    const LayoutContext& layoutContext);

/*
 * The baseline of the last in-flow line box in `node`'s subtree, in `node`'s
 * own coordinate space, or nullopt when the subtree has none.
 */
std::optional<Float> lastInFlowLineBoxBaseline(
    const YogaLayoutableShadowNode& node,
    const LayoutContext& layoutContext) {
  // An elided anonymous box is not a Yoga child, but it is exactly where this
  // container's line boxes live: the container IS the run's block container.
  if (node.measuresOwnInlineRun() &&
      node.getAnonymousTextContentChildren().size() == 1) {
    const auto contentFrame = node.getLayoutMetrics().getContentFrame();
    return contentFrame.origin.y +
        node.getAnonymousTextContentChildren()[0]->baseline(
            layoutContext, contentFrame.size);
  }

  const auto& children = node.getYogaLayoutableChildren();
  for (auto it = children.rbegin(); it != children.rend(); ++it) {
    const auto& child = *it;
    if (child == nullptr) {
      continue;
    }

    // Out of flow: absolutely positioned boxes and floats are not in the
    // normal flow, so their line boxes are not the ones being asked about.
    const auto* yogaProps =
        dynamic_cast<const YogaStylableProps*>(child->getProps().get());
    if (yogaProps != nullptr) {
      const auto& style = yogaProps->yogaStyle;
      if (style.positionType() == yoga::PositionType::Absolute ||
          style.floatSide() != yoga::FloatSide::None) {
        continue;
      }
    }

    const auto* layoutableChild =
        dynamic_cast<const LayoutableShadowNode*>(child.get());
    if (layoutableChild == nullptr) {
      continue;
    }
    const auto childFrame = layoutableChild->getLayoutMetrics().frame;

    // A clipped box aligns by its bottom margin edge whatever is inside it —
    // the same escape hatch CSS2 gives the atomic inline itself, for the same
    // reason: a line box that can be scrolled or cropped out of sight is a
    // meaningless thing to align to. It still has to HAVE one, though.
    const auto* viewProps =
        child->getProps()->asBaseViewProps();
    if (viewProps != nullptr && viewProps->getClipsContentToBounds()) {
      if (subtreeHasLineBox(*child, layoutContext)) {
        return childFrame.origin.y + childFrame.size.height;
      }
      continue;
    }

    // A node that consumes the text cascade — a paragraph, or the anonymous
    // inline formatting context a View wraps its bare text children in — IS
    // where line boxes live, and its own `baseline()` is that line box's.
    if (child->getTraits().check(ShadowNodeTraits::Trait::AnonymousBox) ||
        child->getTraits().check(
            ShadowNodeTraits::Trait::TextCascadeConsumer)) {
      return childFrame.origin.y +
          layoutableChild->baseline(layoutContext, childFrame.size);
    }

    // Anything else is a box that may contain line boxes further down. A
    // child that yields nothing is skipped rather than answered for, so a
    // trailing empty block falls back to its predecessor.
    if (auto inner = lastInFlowLineBoxBaseline(*child, layoutContext)) {
      return childFrame.origin.y + *inner;
    }
  }
  return std::nullopt;
}

bool subtreeHasLineBox(
    const YogaLayoutableShadowNode& node,
    const LayoutContext& layoutContext) {
  if (node.getTraits().check(ShadowNodeTraits::Trait::AnonymousBox) ||
      node.getTraits().check(ShadowNodeTraits::Trait::TextCascadeConsumer)) {
    return true;
  }
  return lastInFlowLineBoxBaseline(node, layoutContext).has_value();
}

} // namespace

template <const char* concreteComponentName, typename ViewPropsT, typename ViewEventEmitterT>
Float AbstractViewShadowNode<concreteComponentName, ViewPropsT, ViewEventEmitterT>::baseline(
    const LayoutContext& layoutContext,
    Size size) const {
  // CSS2 §10.8.1: an inline-block's baseline is the baseline of its last
  // in-flow line box; with no line boxes it is the bottom margin edge. The
  // line boxes live in the anonymous IFC box this View wraps its inline
  // content in, so the baseline is that box's own baseline plus wherever the
  // box sits inside this one (padding, borders, preceding blocks).
  //
  // The same rule has a second escape hatch: a box whose `overflow` is not
  // `visible` also aligns by its bottom edge, whatever its content. Clipping
  // makes the last line box a meaningless thing to align to — it can be
  // scrolled or cropped out of sight entirely, which would drag the whole line
  // with it. `getClipsContentToBounds()` is exactly `overflow != visible`.
  //
  // The spec says bottom *margin* edge; this returns the bottom border edge,
  // which is the same thing here because an atomic inline is measured and
  // mounted as its border box — margin sits outside the frame the attachment
  // uses, so adding it would offset the baseline from the box actually drawn.
  // The no-line-boxes fallback below returns the same edge for the same reason.
  const auto& viewProps =
      static_cast<const ViewPropsT&>(*this->getProps().get());
  if (viewProps.getClipsContentToBounds()) {
    return size.height;
  }
  //
  // Laid out on a clone at the given size first, exactly as
  // `ParagraphShadowNode::baseline` does. This is asked DURING the parent's
  // measure pass, when this node's own children still carry stale metrics —
  // reading them directly returned a baseline of zero, which pushed the box a
  // full descent below the line instead of onto it.
  auto clonedShadowNode = this->clone({});
  auto& laidOut = static_cast<YogaLayoutableShadowNode&>(*clonedShadowNode);
  auto localLayoutContext = layoutContext;
  localLayoutContext.affectedNodes = nullptr;
  laidOut.layoutTree(
      localLayoutContext,
      LayoutConstraints{
          .minimumSize = size,
          .maximumSize = size,
          .layoutDirection = this->getLayoutMetrics().layoutDirection});

  auto baseline = lastInFlowLineBoxBaseline(laidOut, layoutContext);
  return baseline.has_value() ? *baseline : size.height;
}

template <const char* concreteComponentName, typename ViewPropsT, typename ViewEventEmitterT>
void AbstractViewShadowNode<concreteComponentName, ViewPropsT, ViewEventEmitterT>::
    updateTextRunStateIfNeeded(Float fontSizeMultiplier) {
  if (!ReactNativeFeatureFlags::enableStringChildren()) {
    return;
  }

  const auto& anonymousBoxes = this->getAnonymousTextContentChildren();

  // Zero-cost hot path (text-children-plan.md §4.2 / next-steps T3): a View that
  // has never carried anonymous text runs keeps a null `ViewState`, exactly like
  // a plain pre-text-children View. State is allocated lazily on the first runs
  // (the null -> non-null transition below); once allocated it persists —
  // possibly emptied when text is removed — for the node's life.
  if (anonymousBoxes.empty() &&
      (this->state_ == nullptr || this->getStateData().textRuns.empty())) {
    return;
  }

  this->ensureUnsealed();

  auto textRuns = std::vector<ViewState::TextRun>{};
  auto layoutManager = std::weak_ptr<const TextLayoutManager>{};
  const auto& childIndices = this->getAnonymousTextContentChildIndices();
  textRuns.reserve(anonymousBoxes.size());
  for (size_t i = 0; i < anonymousBoxes.size(); i++) {
    const auto& box = anonymousBoxes[i];
    const auto* contentAccessor =
        dynamic_cast<const InlineTextContentAccessor*>(box.get());
    if (contentAccessor == nullptr) {
      continue;
    }
    if (layoutManager.expired()) {
      layoutManager = contentAccessor->getContentTextLayoutManager();
    }
    const auto documentOrder =
        i < childIndices.size() ? childIndices[i] : static_cast<int>(i);
    const auto contentFrame = box->getLayoutMetrics().frame;
    auto contentString = contentAccessor->getContentAttributedString(fontSizeMultiplier);

    // An `outside` list marker (css-lists-3 §3.2) is painted rather than
    // measured with the content, which is what lets the content hang past it:
    // it sits in the gutter the list's `padding-inline-start` reserves, to the
    // inline-start side of the content box, so every line of the item —
    // continuations included — starts at the content edge.
    const auto marker = contentAccessor->getOutsideMarker();
    if (marker.present) {
      // The marker's glyphs sit on the content's FIRST-LINE baseline. A
      // symbolic marker renders at kSymbolicMarkerFontScale, so its own line
      // is far shorter than the content's — top-aligning the boxes floated
      // the bullet at cap height. The content baseline (LayoutableShadowNode
      // ::baseline) already includes the box's baseline-shift reserve, so
      // nothing else is added; when either baseline is unavailable, fall
      // back to the old top alignment plus that reserve.
      const auto markerShiftInk = contentString.baselineShiftInkOverflow().top;
      Float markerY = contentFrame.origin.y + markerShiftInk;
      if (marker.baseline > 0) {
        if (const auto* layoutable =
                dynamic_cast<const LayoutableShadowNode*>(box.get())) {
          const auto contentBaseline =
              layoutable->baseline(LayoutContext{}, contentFrame.size);
          if (contentBaseline > 0) {
            markerY =
                contentFrame.origin.y + contentBaseline - marker.baseline;
          }
        }
      }
      textRuns.push_back(
          ViewState::TextRun{
              .attributedString = marker.attributedString,
              .frame =
                  Rect{
                      .origin =
                          {contentFrame.origin.x - marker.size.width, markerY},
                      .size = marker.size},
              .documentOrder = documentOrder});
    }

    textRuns.push_back(
        ViewState::TextRun{
            .attributedString = std::move(contentString),
            .frame = contentFrame,
            .documentOrder = documentOrder,
            // The marker run above deliberately stays untagged: it shares
            // this box's tag and would collide in the handoff registry.
            .runTag = box->getTag()});
  }

  if (this->state_ == nullptr) {
    // First runs on a previously-stateless View: allocate the state on demand,
    // seeded from the family like `createInitialState` would (there is no prior
    // state to chain from).
    this->state_ = std::make_shared<const ConcreteState<ViewState>>(
        std::make_shared<const ViewState>(
            ViewState(std::move(textRuns), std::move(layoutManager))),
        this->getFamilyShared());
  } else if (this->getStateData().textRuns != textRuns) {
    this->setStateData(
        ViewState(std::move(textRuns), std::move(layoutManager)));
  }
}

// Explicitly instantiate the two concrete specializations so their member
// definitions above are emitted here (and linkable from other translation
// units): `<View>` and the intrinsic `<div>`.
template class AbstractViewShadowNode<ViewComponentName, ViewProps>;
template class AbstractViewShadowNode<ElementBoxComponentName, ElementBoxProps>;
template class AbstractViewShadowNode<
    ElementButtonComponentName,
    ElementButtonProps,
    ElementButtonEventEmitter>;

} // namespace facebook::react
