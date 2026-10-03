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

} // namespace facebook::react
