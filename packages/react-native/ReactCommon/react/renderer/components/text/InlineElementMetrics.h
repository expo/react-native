/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/attributedstring/AttributedString.h>
#include <react/renderer/core/LayoutableShadowNode.h>
#include <react/renderer/core/ShadowNode.h>
#include <react/renderer/graphics/Rect.h>
#include <vector>

namespace facebook::react {

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
void stampInlineElementMetrics(
    const ShadowNode &owner,
    const AttributedString &attributedString,
    const std::vector<Rect> &fragmentRects,
    Point contentOrigin,
    const LayoutMetrics &ownerLayoutMetrics);

} // namespace facebook::react
