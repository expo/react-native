/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "ExpoScrollViewShadowNode.h"

#include <react/renderer/core/LayoutContext.h>

namespace facebook::react {

// NOLINTNEXTLINE(facebook-hte-CArray)
/*
 * The registered name follows the catalog's convention (`element-box`,
 * `element-select`), not the C++ class names: it is the tag the renderer and
 * both platform registries look up. `native-` rather than `element-` because
 * this is a `<native:*>` element — one of ours — rather than an HTML one.
 */
const char ExpoScrollViewComponentName[] = "native-scroll";

void ExpoScrollViewShadowNode::updateStateIfNeeded() {
  ensureUnsealed();

  // The scrollable overflow area (css-overflow-3 §2.2), not the content box:
  // a descendant that overflows the content — a page whose root is the
  // viewport's height holding a list taller than it, which is what a layout
  // written to scroll inside a pane becomes when the pane grows instead of
  // scrolling (DOM-CSS-LIMITATION(no-nested-vertical-scroll)) — is reachable
  // by scrolling, as it is on the web. `overflowInset` is the layout's own
  // record of how far a node's descendants reach past it. Only its reach
  // past the bottom counts: this scroll view scrolls vertically only, so a
  // descendant past the sides (a cover image wider than its box) would make
  // the page scroll sideways, and one above the top (a tooltip placed over
  // its anchor) is unreachable scrollable overflow on the web
  // (css-overflow-3 §2.2) and made the page scroll by its height.
  auto contentBoundingRect = Rect{};
  for (const auto& childNode : getLayoutableChildNodes()) {
    const auto& metrics = childNode->getLayoutMetrics();
    contentBoundingRect.unionInPlace(metrics.frame);
    const auto overflowBottom = metrics.getOverflowInsetFrame().getMaxY();
    if (overflowBottom > contentBoundingRect.getMaxY()) {
      contentBoundingRect.size.height =
          overflowBottom - contentBoundingRect.origin.y;
    }
  }

  auto state = getStateData();
  if (state.contentBoundingRect != contentBoundingRect) {
    state.contentBoundingRect = contentBoundingRect;
    setStateData(std::move(state));
  }
}

void ExpoScrollViewShadowNode::layout(LayoutContext layoutContext) {
  ConcreteViewShadowNode::layout(layoutContext);
  updateStateIfNeeded();
}

Point ExpoScrollViewShadowNode::getContentOriginOffset(
    bool includeTransform) const {
  // The content is drawn shifted by the scroll position, so anything asking
  // where a descendant is has to be told about it. The INSETS are absent here
  // on purpose: they displace the content on the platform, and the platform's
  // own coordinate conversion already accounts for that.
  auto contentOffset = getStateData().contentOffset;
  auto transform = includeTransform ? getTransform() : Transform::Identity();
  auto result = transform *
      Vector{
          .x = -contentOffset.x, .y = -contentOffset.y, .z = 0.0f, .w = 1.0f};
  return {.x = result.x, .y = result.y};
}

} // namespace facebook::react
