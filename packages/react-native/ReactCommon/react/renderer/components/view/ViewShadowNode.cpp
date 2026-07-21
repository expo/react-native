/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "ViewShadowNode.h"
#include <limits>
#include <string_view>
#include <react/featureflags/ReactNativeFeatureFlags.h>
#include <react/renderer/components/view/DivShadowNode.h>
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

// The intrinsic `<div>` tag (implicit-text-plan.md §3.C); see DivShadowNode.h.
// NOLINTNEXTLINE(facebook-hte-CArray,modernize-avoid-c-arrays)
const char DivComponentName[] = "div";

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

  if (!getAnonymousTextContentChildren().empty()) {
    // Text-bearing Views paint their runs and must not be flattened away
    // (implicit-text-plan.md §3.B).
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
  layoutInlineImageAttachments(layoutContext);
  updateTextRunStateIfNeeded();
}

void ViewShadowNode::layoutInlineImageAttachments(LayoutContext layoutContext) {
  if (!ReactNativeFeatureFlags::enableImplicitTextChildren()) {
    return;
  }
  const auto& boxes = getAnonymousTextContentChildren();
  if (boxes.empty()) {
    return;
  }

  // Clone-and-position each inline `<img>` (a non-Yoga child) at its run box's
  // origin with its own measured size. Precise inter-character offset within the
  // run is a follow-up; this makes the image mount and render inline.
  auto* current = this;
  auto owning = std::shared_ptr<ShadowNode>{};

  for (const auto& box : boxes) {
    const auto boxFrame = box->getLayoutMetrics().frame;
    for (const auto& runChild : box->getChildren()) {
      if (std::string_view{runChild->getComponentName()} != "img") {
        continue;
      }
      const auto* layoutable =
          dynamic_cast<const LayoutableShadowNode*>(runChild.get());
      if (layoutable == nullptr) {
        continue;
      }
      auto imageSize = layoutable->getLayoutMetrics().frame.size;
      if (imageSize.width == 0 && imageSize.height == 0) {
        imageSize = layoutable->measure(
            layoutContext,
            LayoutConstraints{
                .minimumSize = {0, 0},
                .maximumSize = {
                    std::numeric_limits<Float>::infinity(),
                    std::numeric_limits<Float>::infinity()}});
      }

      owning = current->cloneTree(
          runChild->getFamily(), [&](const ShadowNode& oldShadowNode) {
            auto cloned = oldShadowNode.clone({});
            auto& clonedLayoutable =
                dynamic_cast<LayoutableShadowNode&>(*cloned);
            clonedLayoutable.layoutTree(
                layoutContext,
                LayoutConstraints{
                    .minimumSize = imageSize, .maximumSize = imageSize});
            auto metrics = clonedLayoutable.getLayoutMetrics();
            metrics.frame.origin = boxFrame.origin;
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

void ViewShadowNode::updateTextRunStateIfNeeded() {
  if (!ReactNativeFeatureFlags::enableImplicitTextChildren()) {
    return;
  }

  const auto& anonymousBoxes = getAnonymousTextContentChildren();

  // Zero-cost hot path (implicit-text-plan.md §4.2 / next-steps T3): a View that
  // has never carried anonymous text runs keeps a null `ViewState`, exactly like
  // a plain pre-implicit-text View. State is allocated lazily on the first runs
  // (the null -> non-null transition below); once allocated it persists —
  // possibly emptied when text is removed — for the node's life.
  if (anonymousBoxes.empty() &&
      (state_ == nullptr || getStateData().textRuns.empty())) {
    return;
  }

  ensureUnsealed();

  auto textRuns = std::vector<ViewState::TextRun>{};
  auto layoutManager = std::weak_ptr<const TextLayoutManager>{};
  const auto& childIndices = getAnonymousTextContentChildIndices();
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
    textRuns.push_back(
        ViewState::TextRun{
            .attributedString = contentAccessor->getContentAttributedString(),
            .frame = box->getLayoutMetrics().frame,
            .documentOrder = i < childIndices.size()
                ? childIndices[i]
                : static_cast<int>(i)});
  }

  if (state_ == nullptr) {
    // First runs on a previously-stateless View: allocate the state on demand,
    // seeded from the family like `createInitialState` would (there is no prior
    // state to chain from).
    state_ = std::make_shared<const ConcreteState>(
        std::make_shared<const ViewState>(
            ViewState{
                .textRuns = std::move(textRuns),
                .layoutManager = std::move(layoutManager)}),
        getFamilyShared());
  } else if (getStateData().textRuns != textRuns) {
    setStateData(
        ViewState{
            .textRuns = std::move(textRuns),
            .layoutManager = std::move(layoutManager)});
  }
}

} // namespace facebook::react
