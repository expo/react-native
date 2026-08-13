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
