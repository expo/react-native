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

void ExpoScrollViewShadowNode::layout(LayoutContext layoutContext) {
  ConcreteViewShadowNode::layout(layoutContext);
  updateStateIfNeeded();
}

Point ExpoScrollViewShadowNode::getContentOriginOffset(bool includeTransform) const {
  // The content is drawn shifted by the scroll position, so anything asking
  // where a descendant is has to be told about it. The INSETS are absent here on
  // purpose: they displace the content on the platform, and the platform's own
  // coordinate conversion already accounts for that.
  auto contentOffset = getStateData().contentOffset;
  auto transform = includeTransform ? getTransform() : Transform::Identity();
  auto result = transform * Vector{.x = -contentOffset.x, .y = -contentOffset.y, .z = 0.0f, .w = 1.0f};
  return {.x = result.x, .y = result.y};
}

} // namespace facebook::react
