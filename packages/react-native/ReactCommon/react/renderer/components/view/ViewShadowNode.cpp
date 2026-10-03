/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "ViewShadowNode.h"
#include <react/featureflags/ReactNativeFeatureFlags.h>
#include <react/renderer/components/view/HostPlatformViewTraitsInitializer.h>
#include <react/renderer/components/view/InlineTextContentAccessor.h>
#include <react/renderer/components/view/primitives.h>
#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/core/LayoutContext.h>

#include <functional>
#include <limits>
#include <optional>
#include <unordered_map>

namespace facebook::react {

// NOLINTNEXTLINE(facebook-hte-CArray,modernize-avoid-c-arrays)
const char ViewComponentName[] = "View";

ViewShadowNode::ViewShadowNode(
    const ShadowNodeFragment& fragment,
    const ShadowNodeFamily::Shared& family,
    ShadowNodeTraits traits)
    : ConcreteViewShadowNode(fragment, family, traits) {
  initialize();
}

ViewShadowNode::ViewShadowNode(
    const ShadowNode& sourceShadowNode,
    const ShadowNodeFragment& fragment)
    : ConcreteViewShadowNode(sourceShadowNode, fragment) {
  initialize();
}

void ViewShadowNode::initialize() noexcept {
  auto& viewProps = static_cast<const ViewProps&>(*props_);

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
    traits_.set(ShadowNodeTraits::Trait::FormsView);
  } else {
    traits_.unset(ShadowNodeTraits::Trait::FormsView);
  }

  if (formsStackingContext) {
    traits_.set(ShadowNodeTraits::Trait::FormsStackingContext);
  } else {
    traits_.unset(ShadowNodeTraits::Trait::FormsStackingContext);
  }

  if (!viewProps.collapsableChildren) {
    traits_.set(ShadowNodeTraits::Trait::ChildrenFormStackingContext);
  } else {
    traits_.unset(ShadowNodeTraits::Trait::ChildrenFormStackingContext);
  }
}

void ViewShadowNode::layout(LayoutContext layoutContext) {
  YogaLayoutableShadowNode::layout(layoutContext);
  layoutInlineAttachments(layoutContext);
}

void ViewShadowNode::layoutInlineAttachments(LayoutContext layoutContext) {
  if (!ReactNativeFeatureFlags::enableStringChildren()) {
    return;
  }
  const auto& boxes = getAnonymousTextContentChildren();
  if (boxes.empty()) {
    return;
  }

  // Clone-and-position each atomic inline (non-Yoga children) at its exact
  // offset within the run. The run box resolves each attachment's frame via
  // its line layout; the attachment is placed at the box origin plus that
  // frame, so it sits in its line and follows wrapping, like an atomic inline
  // in a web line box.
  ViewShadowNode* current = this;
  auto owning = std::shared_ptr<ShadowNode>{};

  for (const auto& box : boxes) {
    const auto boxFrame = box->getLayoutMetrics().frame;
    const auto* accessor =
        dynamic_cast<const InlineTextContentAccessor*>(box.get());

    const auto placements = accessor != nullptr
        ? accessor->getInlineAttachmentPlacements(layoutContext)
        : std::vector<InlineAttachmentPlacement>{};

    // Attachment candidates are the run's direct children plus descendants
    // reached through span-like inline boxes (whose contents flow into this
    // run rather than forming their own).
    std::vector<std::shared_ptr<const ShadowNode>> attachmentCandidates;
    const std::function<void(const ShadowNode&)> collectCandidates =
        [&](const ShadowNode& parent) {
          for (const auto& child : parent.getChildren()) {
            if (YogaLayoutableShadowNode::isInlineFlowContent(*child)) {
              collectCandidates(*child);
            } else {
              attachmentCandidates.push_back(child);
            }
          }
        };
    collectCandidates(*box);

    // One attachment can be looked up per candidate; a linear scan per
    // candidate is O(attachments²) in an attachment-heavy run.
    std::unordered_map<const ShadowNodeFamily*, const Rect*> placementsByFamily;
    placementsByFamily.reserve(placements.size());
    for (const auto& placement : placements) {
      placementsByFamily.emplace(placement.family, &placement.frame);
    }

    for (const auto& runChild : attachmentCandidates) {
      const auto* layoutable =
          dynamic_cast<const LayoutableShadowNode*>(runChild.get());
      if (layoutable == nullptr ||
          !YogaLayoutableShadowNode::isAtomicInline(*runChild)) {
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
        current = static_cast<ViewShadowNode*>(owning.get());
      }
    }
  }

  if (current != this) {
    children_ = current->children_;
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

Float ViewShadowNode::baseline(const LayoutContext& layoutContext, Size size)
    const {
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
  const auto& viewProps = static_cast<const ViewProps&>(*getProps().get());
  if (viewProps.getClipsContentToBounds()) {
    return size.height;
  }

  // Laid out on a clone at the given size first, exactly as
  // `ParagraphShadowNode::baseline` does. This is asked DURING the parent's
  // measure pass, when this node's own children still carry stale metrics —
  // reading them directly returned a baseline of zero, which pushed the box a
  // full descent below the line instead of onto it.
  auto clonedShadowNode = clone({});
  auto& laidOut = static_cast<YogaLayoutableShadowNode&>(*clonedShadowNode);
  auto localLayoutContext = layoutContext;
  localLayoutContext.affectedNodes = nullptr;
  laidOut.layoutTree(
      localLayoutContext,
      LayoutConstraints{
          .minimumSize = size,
          .maximumSize = size,
          .layoutDirection = getLayoutMetrics().layoutDirection});

  auto baseline = lastInFlowLineBoxBaseline(laidOut, layoutContext);
  return baseline.has_value() ? *baseline : size.height;
}

} // namespace facebook::react
