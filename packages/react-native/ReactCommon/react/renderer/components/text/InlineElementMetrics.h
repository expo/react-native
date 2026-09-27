/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/attributedstring/AttributedString.h>
#include <react/renderer/core/LayoutableShadowNode.h>
#include <react/renderer/components/view/InlineTextContentAccessor.h>
#include <react/renderer/components/view/YogaStylableProps.h>
#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/core/ShadowNode.h>
#include <react/renderer/graphics/Rect.h>
#include <algorithm>
#include <vector>

namespace facebook::react {

/**
 * Constraints for measuring `node` OUT OF PLACE that keep the node's own
 * stated min/max dimensions in force.
 *
 * `LayoutableShadowNode::measure` lays the node out as a measurement ROOT,
 * and `layoutTree` installs the constraints' min/max over the root's own
 * style — so a bare `{0, 0}` minimum ERASES the element's stated minimums.
 * That is how `<button>`'s 44/48pt touch-target floor vanished exactly and
 * only in inline flow: the same button measured 48pt tall as a flex child
 * and 28pt as an atomic inline attachment. Percent-valued bounds are left
 * out — out of place there is no containing block to resolve them against.
 */
inline LayoutConstraints constraintsHonoringOwnBounds(
    const ShadowNode& node,
    LayoutConstraints constraints) {
  const auto* yogaProps =
      dynamic_cast<const YogaStylableProps*>(node.getProps().get());
  if (yogaProps == nullptr) {
    return constraints;
  }
  const auto& style = yogaProps->yogaStyle;
  const auto apply = [&](yoga::Dimension axis, Float& minimum, Float& maximum) {
    const auto minValue = style.minDimension(axis);
    if (minValue.isPoints() && !minValue.value().isUndefined()) {
      minimum = std::max(minimum, Float{minValue.value().unwrap()});
    }
    const auto maxValue = style.maxDimension(axis);
    if (maxValue.isPoints() && !maxValue.value().isUndefined()) {
      maximum = std::min(maximum, Float{maxValue.value().unwrap()});
    }
  };
  apply(
      yoga::Dimension::Width,
      constraints.minimumSize.width,
      constraints.maximumSize.width);
  apply(
      yoga::Dimension::Height,
      constraints.minimumSize.height,
      constraints.maximumSize.height);
  return constraints;
}

/**
 * Stamps the laid-out box of each *inline element* onto its shadow node, so
 * `getBoundingClientRect()` reports a real rect for `<b>`, `<span>`, a nested
 * `<Text>`, and friends — as it does on the web (text-children-plan.md §3.G).
 *
 * Inline elements are never laid out by Yoga: their content is folded into an
 * inline formatting context and measured as one text run. The text engine
 * reports a rect per *fragment* (`TextMeasurement::fragmentRects`), and each
 * fragment records the element it came from in `parentShadowView`, so the
 * union of an element's fragment rects is its border box. This mirrors how
 * inline `<img>` attachments are already positioned by their owning View.
 *
 * Layout is not affected in any way — nothing here feeds back into measuring
 * or painting. It only gives DOM geometry APIs something truthful to report,
 * so authored `<Text>` keeps its exact RN layout behavior.
 *
 * No-ops when the platform text engine does not report fragment rects (the
 * vector is empty), leaving elements without metrics exactly as before.
 */
/**
 * Whether `attributedString` contains any inline element to stamp at all —
 * i.e. any fragment contributed by something other than `owner` itself.
 *
 * Decidable from the string alone, which is the point: the geometry pass needs
 * a full text layout to obtain fragment rects, and for a run of plain bare
 * text there is nothing to put them on, so that entire layout is computed and
 * thrown away. Checking first is not an optimisation of the measurement — it
 * is declining to perform one whose result provably has no consumer.
 *
 * This is the overwhelmingly common shape: a View with text children and no
 * `<b>`/`<span>` inside. Measured on the iOS simulator, 100 ten-line bare
 * bodies spent 81.7ms with the measurement and 32.8ms without it.
 *
 * Note the deliberate asymmetry with the loop this guards: that one stops at
 * `min(fragments, fragmentRects)`, this one scans every fragment. The extra
 * reach can only ever say "yes" where the loop would have found nothing —
 * costing a measurement that was taken anyway before this existed. It can
 * never say "no" where the loop would have found something, because a
 * prefix cannot contain a foreign tag that the whole does not. Narrowing this
 * to match the loop's range would invert that, and is the one change here
 * that would be silently wrong.
 */
bool hasStampableInlineElements(
    const ShadowNode &owner,
    const AttributedString &attributedString);

std::vector<PendingInlineElementMetrics> stampInlineElementMetrics(
    const ShadowNode &owner,
    const AttributedString &attributedString,
    const std::vector<Rect> &fragmentRects,
    Point contentOrigin,
    const LayoutMetrics &ownerLayoutMetrics);

} // namespace facebook::react
