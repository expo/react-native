/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "ViewShadowNode.h"

#include <react/renderer/animationbackend/CSSTransitionsTrace.h>
#include <functional>
#include <limits>
#include <optional>
#include <string_view>
#include <unordered_map>
#include <vector>
#include <react/featureflags/ReactNativeFeatureFlags.h>
#include <react/renderer/components/view/BaseViewProps.h>
#include <react/renderer/components/view/ElementBoxShadowNode.h>
#include <react/renderer/components/view/HostPlatformViewTraitsInitializer.h>
#include <react/renderer/components/view/InlineTextContentAccessor.h>
#include <react/renderer/components/view/primitives.h>
#include <react/renderer/core/ConcreteState.h>
#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/core/LayoutContext.h>
#include <react/renderer/core/LayoutableShadowNode.h>

namespace facebook::react {

// NOLINTNEXTLINE(facebook-hte-CArray,modernize-avoid-c-arrays)
const char ViewComponentName[] = "View";

// NOLINTNEXTLINE(facebook-hte-CArray,modernize-avoid-c-arrays)
// Not JSX-addressable: the renderer swaps an element onto this component when
// its display generates a box (ElementBoxShadowNode.h).
const char ElementBoxComponentName[] = "element-box";

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
    sizeof(TextAttributes) <= 176,
    "TextAttributes grew; it is copied and compared throughout the text stack");
static_assert(
    sizeof(ViewProps) <= 1900,
    "ViewProps grew; every mounted View holds one, plus one per pending "
    "generation during commits");
#else
static_assert(
    sizeof(ViewShadowNode) <= 1200,
    "ViewShadowNode grew past its memory budget");
static_assert(
    sizeof(TextAttributes) <= 288,
    "TextAttributes grew; it is copied and compared throughout the text stack");
static_assert(
    sizeof(ViewProps) <= 2400,
    "ViewProps grew; every mounted View holds one, plus one per pending "
    "generation during commits");
#endif
#endif

template <const char* concreteComponentName, typename ViewPropsT>
void AbstractViewShadowNode<concreteComponentName, ViewPropsT>::
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

template <const char* concreteComponentName, typename ViewPropsT>
void AbstractViewShadowNode<concreteComponentName, ViewPropsT>::layout(
    LayoutContext layoutContext) {
  YogaLayoutableShadowNode::layout(layoutContext);
  layoutInlineAttachments(layoutContext);
  updateTextRunStateIfNeeded(layoutContext.fontSizeMultiplier);
}

template <const char* concreteComponentName, typename ViewPropsT>
void AbstractViewShadowNode<concreteComponentName, ViewPropsT>::
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
      for (const auto& stamp : accessor->stampInlineElementMetrics(
               layoutContext, boxFrame.origin, this->getLayoutMetrics())) {
        stampedOrigins[stamp.family] = stamp.metrics.frame.origin;
        owning = current->cloneTree(
            *stamp.family, [&](const ShadowNode& oldShadowNode) {
              auto cloned = oldShadowNode.clone({});
              dynamic_cast<LayoutableShadowNode&>(*cloned).setLayoutMetrics(
                  stamp.metrics);
              return cloned;
            });
        if (owning != nullptr) {
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
      if (!runChild->getTraits().check(
              ShadowNodeTraits::Trait::InlineReplaced) &&
          !YogaLayoutableShadowNode::isAtomicInline(*runChild)) {
        continue;
      }
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
        dynamic_cast<const BaseViewProps*>(child->getProps().get());
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

template <const char* concreteComponentName, typename ViewPropsT>
Float AbstractViewShadowNode<concreteComponentName, ViewPropsT>::baseline(
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

template <const char* concreteComponentName, typename ViewPropsT>
void AbstractViewShadowNode<concreteComponentName, ViewPropsT>::
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
      textRuns.push_back(
          ViewState::TextRun{
              .attributedString = marker.attributedString,
              .frame =
                  Rect{
                      .origin =
                          {contentFrame.origin.x - marker.size.width,
                           contentFrame.origin.y},
                      .size = marker.size},
              .documentOrder = documentOrder});
    }

    // Publication tripwire: a run built from DEFAULT text attributes while
    // its box sits under a styled cascade is the "text lost its styling" bug
    // being born. Log enough state to name the reachability gap.
    if (!contentString.getFragments().empty()) {
      const auto& firstAttrs = contentString.getFragments()[0].textAttributes;
      // The DEFAULT attributes carry fontSize 14 (not NaN), black, no
      // family, no weight — match that signature, since it is exactly what
      // unstyled paints report.
      const bool looksDefault = firstAttrs.fontSize == 14.0 &&
          !firstAttrs.fontWeight.has_value() && firstAttrs.fontFamily.empty();
      if (looksDefault && contentString.getString().size() > 2) {
        const auto* yogaBox =
            YogaLayoutableShadowNode::asYogaLayoutable(*box);
        CSSTransitionsTrace::shared()->log(
            "unstyled-pub t=" + std::to_string(this->getTag()) +
            " cfg=" + std::to_string(this->debugYogaTreeConfigured() ? 1 : 0) +
            " boxCfg=" +
            (yogaBox != nullptr
                 ? std::to_string(yogaBox->debugYogaTreeConfigured() ? 1 : 0)
                 : std::string("?")) +
            " '" + contentString.getString().substr(0, 10) + "'");
      }
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

} // namespace facebook::react
