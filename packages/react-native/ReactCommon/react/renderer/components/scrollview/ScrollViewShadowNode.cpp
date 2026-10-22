/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "ScrollViewShadowNode.h"

#include <react/debug/react_native_assert.h>
#include <react/renderer/core/LayoutMetrics.h>

namespace facebook::react {

// NOLINTNEXTLINE(facebook-hte-CArray)
const char ScrollViewComponentName[] = "ScrollView";

void ScrollViewShadowNode::updateStateIfNeeded() {
  ensureUnsealed();

  auto contentBoundingRect = Rect{};
  for (const auto& childNode : getLayoutableChildNodes()) {
    contentBoundingRect.unionInPlace(childNode->getLayoutMetrics().frame);
  }

  auto state = getStateData();

  if (state.contentBoundingRect != contentBoundingRect) {
    state.contentBoundingRect = contentBoundingRect;
    setStateData(std::move(state));
  }
}

void ScrollViewShadowNode::updateScrollContentOffsetIfNeeded() {
#ifndef ANDROID
  if (getLayoutMetrics().layoutDirection == LayoutDirection::RightToLeft) {
    // Yoga places `contentView` on the right side of `scrollView` when RTL
    // layout is enforced. To correct for this, in RTL setting, correct the
    // frame's origin. React Native Classic does this as well in
    // `RCTScrollContentShadowView.m`.
    for (auto layoutableNode : getLayoutableChildNodes()) {
      auto layoutMetrics = layoutableNode->getLayoutMetrics();
      if (layoutMetrics.frame.origin.x != 0) {
        layoutMetrics.frame.origin.x = 0;
        layoutableNode->setLayoutMetrics(layoutMetrics);
      }
    }
  }
#endif
}

ScrollViewState ScrollViewShadowNode::initialStateData(
    const Props::Shared& props,
    const ShadowNodeFamily::Shared& /*family*/,
    const ComponentDescriptor& /*componentDescriptor*/) {
  return {static_cast<const ScrollViewProps&>(*props).contentOffset, {}, 0};
}

#pragma mark - LayoutableShadowNode

void ScrollViewShadowNode::layout(LayoutContext layoutContext) {
  ConcreteViewShadowNode::layout(layoutContext);
  updateScrollContentOffsetIfNeeded();
  extendContentOverOverflowIfNeeded();
  updateStateIfNeeded();
}

/*
 * With `contentSizeIncludesOverflow`, the content container's frame reaches
 * over what its content overflows it by toward the end of the scroll axis (a
 * row's for a horizontal scroll view), the platform views' scrolling extent
 * on both platforms. CSS lays a scroll container's content out at its width
 * and scrolls to what overflows it (css-overflow-3 §2.2); laid out at its
 * max-content width instead, a paragraph in a sideways scroller never wrapped
 * and a table at `width: 100%` was measured against no width at all.
 * DOM-CSS-LIMITATION(scroll-overflow-end-edge): only the overflow past the
 * end edge is reached, so a `direction: rtl` scroller's overflow, past its
 * left edge, is not, and the scroll container's end padding is not added
 * past its content's overflow as css-overflow-3 §2.2 adds it.
 */
void ScrollViewShadowNode::extendContentOverOverflowIfNeeded() {
  if (!getConcreteProps().contentSizeIncludesOverflow) {
    return;
  }
  const auto direction = getConcreteProps().yogaStyle.flexDirection();
  const bool horizontal = direction == yoga::FlexDirection::Row ||
      direction == yoga::FlexDirection::RowReverse;
  for (const auto& childNode : getLayoutableChildNodes()) {
    auto metrics = childNode->getLayoutMetrics();
    const Float overflow = horizontal ? -metrics.overflowInset.right
                                      : -metrics.overflowInset.bottom;
    // A child this pass did not lay out is shared with a committed tree, and
    // keeps the frame it was given when it was laid out
    if (overflow <= 0 || childNode->isPublished()) {
      continue;
    }
    if (horizontal) {
      metrics.frame.size.width += overflow;
      metrics.overflowInset.right = 0;
    } else {
      metrics.frame.size.height += overflow;
      metrics.overflowInset.bottom = 0;
    }
    childNode->setLayoutMetrics(metrics);
  }
}

Point ScrollViewShadowNode::getContentOriginOffset(
    bool includeTransform) const {
  auto stateData = getStateData();
  auto contentOffset = stateData.contentOffset;
  auto transform = includeTransform ? getTransform() : Transform::Identity();
  auto result = transform *
      Vector{
          .x = -contentOffset.x, .y = -contentOffset.y, .z = 0.0f, .w = 1.0f};

  return {
      .x = result.x,
      .y = result.y + static_cast<float>(stateData.scrollAwayPaddingTop)};
}
} // namespace facebook::react
