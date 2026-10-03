/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "ViewShadowNode.h"

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

#include <functional>
#include <limits>
#include <optional>
#include <unordered_map>
#include <vector>

#ifdef __APPLE__
#include <TargetConditionals.h>
#endif

namespace facebook::react {

// NOLINTNEXTLINE(facebook-hte-CArray,modernize-avoid-c-arrays)
const char ViewComponentName[] = "View";

// NOLINTNEXTLINE(facebook-hte-CArray,modernize-avoid-c-arrays)
// Not JSX-addressable: the renderer swaps an element onto this component when
// its display generates a box (ElementBoxShadowNode.h).
const char ElementBoxComponentName[] = "element-box";

#if defined(__APPLE__) && defined(__aarch64__) && defined(NDEBUG)
// Memory budgets. Every View in every shadow-tree generation is one of these,
// so growth here is a per-node cost on whole trees. If a deliberate change
// trips one, re-measure the sizes and move the bound consciously.
//
// Checked in optimised builds (`NDEBUG`) only. A debug build's standard-library
// types are larger (hardened containers, no empty-base collapsing), so a
// ceiling measured in Release says nothing about a Debug build, and holding a
// Debug build to it would stop it from compiling.
//
// The ceilings are per-OS: iOS types are larger (SharedColor carries a platform
// color object there, not a packed int32), so the same structs measure bigger
// under an iphoneos or iphonesimulator target.
#if TARGET_OS_OSX || (!TARGET_OS_IPHONE && !TARGET_OS_TV && !TARGET_OS_WATCH)
static_assert(
    sizeof(ViewShadowNode) <= 1016,
    "ViewShadowNode grew past its memory budget");
static_assert(
    sizeof(TextAttributes) <= 200,
    "TextAttributes grew; it is copied and compared throughout the text stack");
static_assert(
    sizeof(ViewProps) <= 1376,
    "ViewProps grew; every mounted View holds one, plus one per pending "
    "generation during commits");
#else
static_assert(
    sizeof(ViewShadowNode) <= 1072,
    "ViewShadowNode grew past its memory budget");
static_assert(
    // Sized for the numeric `baselineShift`, which symbolic list markers use
    // to centre their ink and which `vertical-align: <length>` will also use
    sizeof(TextAttributes) <= 320,
    "TextAttributes grew; it is copied and compared throughout the text stack");
static_assert(
    sizeof(ViewProps) <= 1888,
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
    // Text-bearing Views paint their runs and must not be flattened away.
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

namespace {

// A view the mounting layer mounts among a View's children, with what decides
// where it lands among them
struct MountedView {
  int orderIndex;
  bool isStatic;
  size_t childIndex;
};

/*
 * Collects the views the mounting layer mounts for `node`, the child at
 * `childIndex`, mirroring view flattening in `sliceChildShadowNodeViewPairs`:
 * a node that forms a view mounts as one, and a flattened node's children
 * mount in its place.
 */
void collectMountedViews(
    const ShadowNode& node,
    bool parentChildrenFormStackingContext,
    size_t childIndex,
    std::vector<MountedView>& mountedViews) {
  const auto traits = node.getTraits();
  if (
#ifdef ANDROID
      ReactNativeFeatureFlags::useTraitHiddenOnAndroid() &&
#endif
      traits.check(ShadowNodeTraits::Trait::Hidden)) {
    return;
  }
  const bool forceFlatten =
      traits.check(ShadowNodeTraits::Trait::ForceFlattenView);
  const bool isConcreteView =
      (traits.check(ShadowNodeTraits::Trait::FormsView) ||
       parentChildrenFormStackingContext) &&
      !forceFlatten;
  const bool areChildrenFlattened =
      (!traits.check(ShadowNodeTraits::Trait::FormsStackingContext) &&
       !parentChildrenFormStackingContext) ||
      forceFlatten;
  if (isConcreteView) {
    const auto* layoutableNode =
        traits.check(ShadowNodeTraits::Trait::YogaLayoutableKind)
        ? static_cast<const LayoutableShadowNode*>(&node)
        : dynamic_cast<const LayoutableShadowNode*>(&node);
    mountedViews.push_back(
        {.orderIndex = node.getOrderIndex(),
         .isStatic = layoutableNode != nullptr &&
             layoutableNode->getLayoutMetrics().positionType ==
                 PositionType::Static,
         .childIndex = childIndex});
  }
  if (areChildrenFlattened) {
    const bool childrenFormStackingContext =
        traits.check(ShadowNodeTraits::Trait::ChildrenFormStackingContext);
    for (const auto& child : node.getChildren()) {
      collectMountedViews(
          *child, childrenFormStackingContext, childIndex, mountedViews);
    }
  }
}

/*
 * For each run, the number of the View's mounted views that paint below it,
 * which is where the platforms place the run among them.
 *
 * The mounting layer mounts views with `position: 'static'` before the rest
 * and then stable-sorts everything by `zIndex`. A run paints like a
 * non-static view with no `zIndex`: above every static view and every view
 * with a negative `zIndex`, among the other views in document order, and
 * below every view with a positive `zIndex`.
 */
std::vector<int> paintPositionsOfRuns(
    const ShadowNode& view,
    const std::vector<size_t>& runChildIndices) {
  std::vector<MountedView> mountedViews;
  const bool childrenFormStackingContext = view.getTraits().check(
      ShadowNodeTraits::Trait::ChildrenFormStackingContext);
  const auto& children = view.getChildren();
  for (size_t i = 0; i < children.size(); i++) {
    collectMountedViews(
        *children[i], childrenFormStackingContext, i, mountedViews);
  }

  std::vector<int> positions;
  positions.reserve(runChildIndices.size());
  for (auto runChildIndex : runChildIndices) {
    int position = 0;
    for (const auto& mountedView : mountedViews) {
      if (mountedView.orderIndex < 0 ||
          (mountedView.orderIndex == 0 &&
           (mountedView.isStatic || mountedView.childIndex < runChildIndex))) {
        position++;
      }
    }
    positions.push_back(position);
  }
  return positions;
}

} // namespace

template <const char* concreteComponentName, typename ViewPropsT>
void AbstractViewShadowNode<concreteComponentName, ViewPropsT>::
    updateTextRunStateIfNeeded(Float fontSizeMultiplier) {
  if (!ReactNativeFeatureFlags::enableStringChildren()) {
    return;
  }

  const auto& anonymousBoxes = this->getAnonymousTextContentChildren();

  // Zero-cost hot path: a View that has never carried anonymous text runs
  // keeps a null `ViewState`, exactly like a plain View. State is allocated
  // lazily on the first runs (the null -> non-null transition below); once
  // allocated it persists — possibly emptied when text is removed — for the
  // node's life.
  if (anonymousBoxes.empty() &&
      (this->state_ == nullptr || this->getStateData().textRuns.empty())) {
    return;
  }

  this->ensureUnsealed();

  auto textRuns = std::vector<ViewState::TextRun>{};
  auto layoutManager = std::weak_ptr<const TextLayoutManager>{};
  const auto paintPositions =
      paintPositionsOfRuns(*this, this->getAnonymousTextContentChildIndices());
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
        i < paintPositions.size() ? paintPositions[i] : static_cast<int>(i);
    const auto contentFrame = box->getLayoutMetrics().frame;

    // An `outside` list marker (css-lists-3 §3.2) is painted rather than
    // measured with the content, which is what lets the content hang past it:
    // it sits in the gutter the list's `padding-inline-start` reserves, to the
    // inline-start side of the content box, so every line of the item —
    // continuations included — starts at the content edge.
    const auto marker = contentAccessor->getOutsideMarker();
    if (marker.present) {
      // Sit the marker's glyphs on the content's first-line baseline rather
      // than top-aligning the boxes, because a symbolic marker renders at
      // kSymbolicMarkerFontScale and its own line is far shorter than the
      // content's. The content baseline (`LayoutableShadowNode::baseline`)
      // already includes the box's baseline-shift reserve, so nothing else is
      // added. When either baseline is unavailable, top-align the boxes.
      Float markerY = contentFrame.origin.y;
      if (marker.baseline > 0) {
        if (const auto* layoutable =
                dynamic_cast<const LayoutableShadowNode*>(box.get())) {
          const auto contentBaseline =
              layoutable->baseline(LayoutContext{}, contentFrame.size);
          if (contentBaseline > 0) {
            markerY = contentFrame.origin.y + contentBaseline - marker.baseline;
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
            .attributedString =
                contentAccessor->getContentAttributedString(fontSizeMultiplier),
            .frame = contentFrame,
            .documentOrder = documentOrder,
            // Leave the marker run above untagged: it shares this box's tag
            // and would collide in the run-layout handoff registry
            .runTag = box->getTag()});
  }

  if (this->state_ == nullptr) {
    // First runs on a previously-stateless View: allocate the state on demand,
    // seeded from the family like `createInitialState` would (there is no
    // prior state to chain from).
    this->state_ = std::make_shared<const ConcreteState<ViewState>>(
        std::make_shared<const ViewState>(
            ViewState(std::move(textRuns), std::move(layoutManager))),
        this->getFamilyShared());
  } else if (this->getStateData().textRuns != textRuns) {
    this->setStateData(
        ViewState(std::move(textRuns), std::move(layoutManager)));
  }
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

  // Clone-and-position each atomic inline (non-Yoga children), such as the
  // replaced `<img>` and atomic `display: 'inline'` elements, at its exact
  // offset within the run. The run box resolves each attachment's frame via
  // its line layout; the attachment is placed at the box origin plus that
  // frame, so it sits in its line and follows wrapping, like an atomic inline
  // in a web line box.
  auto* current = this;
  auto owning = std::shared_ptr<ShadowNode>{};

  for (const auto& box : boxes) {
    const auto boxFrame = box->getLayoutMetrics().frame;
    const auto* accessor =
        dynamic_cast<const InlineTextContentAccessor*>(box.get());

    // Give the run's inline elements (`<b>`, `<span>`, …) a real box to report
    // from `getBoundingClientRect()`. It has no effect on layout or paint, and
    // goes through the accessor so this module keeps no text dependency.
    // The frames stamped on sealed inline elements, which are applied to
    // clones and so are not visible on the nodes of `box`
    std::unordered_map<const ShadowNodeFamily*, Rect> pendingFrames;
    if (accessor != nullptr) {
      // Elements whose nodes are unsealed are stamped in place; the rest come
      // back here to be applied by cloning the path to them, as the
      // attachment loop below repositions an atomic inline. Without this, an
      // inline element keeps reporting its previous line's rect after a resize
      // rewraps the run around it.
      for (const auto& stamp : accessor->stampInlineElementMetrics(
               layoutContext, boxFrame.origin, this->getLayoutMetrics())) {
        pendingFrames.emplace(stamp.family, stamp.metrics.frame);
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

    // Attachment candidates are the run's direct children plus descendants
    // reached through span-like inline boxes (whose contents flow into this
    // run rather than forming their own). A span-like box mounts as a view at
    // the frame stamped on it, so a candidate inside one is placed relative
    // to that frame: `parentOrigin` is where the candidate's parent sits in
    // this View's coordinate space.
    struct AttachmentCandidate {
      std::shared_ptr<const ShadowNode> node;
      Point parentOrigin;
    };
    std::vector<AttachmentCandidate> attachmentCandidates;
    const std::function<void(const ShadowNode&, Point)> collectCandidates =
        [&](const ShadowNode& parent, Point parentOrigin) {
          for (const auto& child : parent.getChildren()) {
            if (YogaLayoutableShadowNode::isInlineFlowContent(*child)) {
              auto frame = static_cast<const LayoutableShadowNode&>(*child)
                               .getLayoutMetrics()
                               .frame;
              if (auto it = pendingFrames.find(&child->getFamily());
                  it != pendingFrames.end()) {
                frame = it->second;
              }
              collectCandidates(
                  *child,
                  Point{
                      parentOrigin.x + frame.origin.x,
                      parentOrigin.y + frame.origin.y});
            } else {
              attachmentCandidates.push_back({child, parentOrigin});
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

    for (const auto& [runChild, parentOrigin] : attachmentCandidates) {
      const auto* layoutable =
          dynamic_cast<const LayoutableShadowNode*>(runChild.get());
      if (layoutable == nullptr) {
        continue;
      }

      // The line layout's frame for this attachment is authoritative for both
      // offset and size; fall back to the box origin and a fresh measure only
      // if the platform layout manager reported no attachment frame.
      const Rect* attachmentFrame = nullptr;
      if (auto it = placementsByFamily.find(&runChild->getFamily());
          it != placementsByFamily.end()) {
        attachmentFrame = it->second;
      }

      // Treat a reported placement as proof that this candidate is an
      // attachment, since the line layout measured it into the run. A backing
      // component need not declare the traits: the expo-image `<img>` carries
      // neither InlineReplaced nor an inline display, and gating on them would
      // drop the frame the run reserved for it and mount the picture at the
      // line's start. The traits decide only for candidates the layout did
      // not place.
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

      auto attachmentOrigin = Point{
          boxFrame.origin.x - parentOrigin.x,
          boxFrame.origin.y - parentOrigin.y};
      if (attachmentFrame != nullptr) {
        attachmentOrigin.x += attachmentFrame->origin.x;
        attachmentOrigin.y += attachmentFrame->origin.y;
      }

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

    // A node with line boxes of its own — the anonymous inline formatting
    // context a View wraps its inline content in, or a node that reports its
    // own baseline, such as a paragraph or a text input — IS where line boxes
    // live, and its own `baseline()` is that line box's.
    if (child->getTraits().check(ShadowNodeTraits::Trait::AnonymousBox) ||
        child->getTraits().check(ShadowNodeTraits::Trait::BaselineYogaNode)) {
      return childFrame.origin.y +
          layoutableChild->lastLineBaseline(layoutContext, childFrame.size);
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
      node.getTraits().check(ShadowNodeTraits::Trait::BaselineYogaNode)) {
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

// Instantiate the two concrete specializations explicitly so their member
// definitions above are emitted here and linkable from other translation
// units: `<View>` and the intrinsic `<div>`.
template class AbstractViewShadowNode<ViewComponentName, ViewProps>;
template class AbstractViewShadowNode<ElementBoxComponentName, ElementBoxProps>;

} // namespace facebook::react
