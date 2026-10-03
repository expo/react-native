/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/view/YogaStylableProps.h>
#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/core/ShadowNode.h>
#include <algorithm>

namespace facebook::react {

/**
 * Constraints for measuring `node` OUT OF PLACE that keep the node's own
 * stated min/max dimensions in force.
 *
 * `LayoutableShadowNode::measure` lays the node out as a measurement ROOT,
 * and `layoutTree` installs the constraints' min/max over the root's own
 * style — so a bare `{0, 0}` minimum ERASES the element's stated minimums,
 * and a View with `minHeight: 48` would measure shorter as an atomic inline
 * than as a flex child. Percent-valued bounds are left out — out of place
 * there is no containing block to resolve them against.
 */
inline LayoutConstraints constraintsHonoringOwnBounds(const ShadowNode &node, LayoutConstraints constraints)
{
  const auto *yogaProps = dynamic_cast<const YogaStylableProps *>(node.getProps().get());
  if (yogaProps == nullptr) {
    return constraints;
  }
  const auto &style = yogaProps->yogaStyle;
  const auto apply = [&](yoga::Dimension axis, Float &minimum, Float &maximum) {
    const auto minValue = style.minDimension(axis);
    if (minValue.isPoints() && !minValue.value().isUndefined()) {
      minimum = std::max(minimum, Float{minValue.value().unwrap()});
    }
    const auto maxValue = style.maxDimension(axis);
    if (maxValue.isPoints() && !maxValue.value().isUndefined()) {
      maximum = std::min(maximum, Float{maxValue.value().unwrap()});
    }
  };
  apply(yoga::Dimension::Width, constraints.minimumSize.width, constraints.maximumSize.width);
  apply(yoga::Dimension::Height, constraints.minimumSize.height, constraints.maximumSize.height);
  return constraints;
}

} // namespace facebook::react
