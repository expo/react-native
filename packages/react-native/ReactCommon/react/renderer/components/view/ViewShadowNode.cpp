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

// The intrinsic `<div>` tag (text-children-plan.md §3.C); see DivShadowNode.h.
// NOLINTNEXTLINE(facebook-hte-CArray,modernize-avoid-c-arrays)
const char DivComponentName[] = "div";

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
  layoutInlineImageAttachments(layoutContext);
  updateTextRunStateIfNeeded();
}

template <const char* concreteComponentName, typename ViewPropsT>
void AbstractViewShadowNode<concreteComponentName, ViewPropsT>::
    layoutInlineImageAttachments(LayoutContext layoutContext) {
  if (!ReactNativeFeatureFlags::enableStringChildren()) {
    return;
  }
  const auto& boxes = this->getAnonymousTextContentChildren();
  if (boxes.empty()) {
    return;
  }

  // Clone-and-position each inline `<img>` (a non-Yoga child) at its exact
  // inline offset within the run. The run box resolves each attachment's frame
  // via the text layout; the image is placed at the box origin plus that frame,
  // so it sits between the surrounding glyphs and follows wrapping — like a
  // replaced element in a web line box (text-children-plan.md §3.C).
  auto* current = this;
  auto owning = std::shared_ptr<ShadowNode>{};

  for (const auto& box : boxes) {
    const auto boxFrame = box->getLayoutMetrics().frame;
    const auto* accessor =
        dynamic_cast<const InlineTextContentAccessor*>(box.get());
    const auto placements = accessor != nullptr
        ? accessor->getInlineAttachmentPlacements(layoutContext)
        : std::vector<InlineAttachmentPlacement>{};

    for (const auto& runChild : box->getChildren()) {
      if (std::string_view{runChild->getComponentName()} != "img") {
        continue;
      }
      const auto* layoutable =
          dynamic_cast<const LayoutableShadowNode*>(runChild.get());
      if (layoutable == nullptr) {
        continue;
      }

      // The text layout's frame for this image is authoritative for both offset
      // and size; fall back to the box origin and a fresh measure only if the
      // platform layout manager reported no attachment frame (e.g. the
      // deterministic test manager).
      const Rect* attachmentFrame = nullptr;
      for (const auto& placement : placements) {
        if (placement.family == &runChild->getFamily()) {
          attachmentFrame = &placement.frame;
          break;
        }
      }

      auto imageSize = attachmentFrame != nullptr &&
              (attachmentFrame->size.width != 0 ||
               attachmentFrame->size.height != 0)
          ? attachmentFrame->size
          : layoutable->getLayoutMetrics().frame.size;
      if (imageSize.width == 0 && imageSize.height == 0) {
        imageSize = layoutable->measure(
            layoutContext,
            LayoutConstraints{
                .minimumSize = {0, 0},
                .maximumSize = {
                    std::numeric_limits<Float>::infinity(),
                    std::numeric_limits<Float>::infinity()}});
      }

      auto imageOrigin = boxFrame.origin;
      if (attachmentFrame != nullptr) {
        imageOrigin.x += attachmentFrame->origin.x;
        imageOrigin.y += attachmentFrame->origin.y;
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
            metrics.frame.origin = imageOrigin;
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

template <const char* concreteComponentName, typename ViewPropsT>
void AbstractViewShadowNode<concreteComponentName, ViewPropsT>::
    updateTextRunStateIfNeeded() {
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
    textRuns.push_back(
        ViewState::TextRun{
            .attributedString = contentAccessor->getContentAttributedString(),
            .frame = box->getLayoutMetrics().frame,
            .documentOrder = i < childIndices.size()
                ? childIndices[i]
                : static_cast<int>(i)});
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
template class AbstractViewShadowNode<DivComponentName, DivProps>;

} // namespace facebook::react
