/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/core/LayoutMetrics.h>
#include <react/renderer/core/ShadowNode.h>

#include <memory>
#include <unordered_map>

namespace facebook::react {

using LayoutMetricsByFamily =
    std::unordered_map<const ShadowNodeFamily*, LayoutMetrics>;

/*
 * Clones `node`'s subtree with new layout metrics applied to every node whose
 * family appears in `byFamily`, in a single pass.
 *
 * `ShadowNode::cloneTree` takes one family per call, and each call searches the
 * subtree for that family and then rebuilds the spine down to it. Calling it
 * once per element makes stamping a paragraph's inline elements quadratic in
 * their number: N searches and N spine rebuilds over the same nodes.
 *
 * Returns nullptr when nothing in the subtree matched, so a caller with no
 * changes keeps the tree it already has.
 */
std::shared_ptr<ShadowNode> cloneWithLayoutMetrics(
    const ShadowNode& node,
    const LayoutMetricsByFamily& byFamily);

} // namespace facebook::react
