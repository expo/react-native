/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "CloneWithLayoutMetrics.h"

#include <react/debug/react_native_assert.h>
#include <react/renderer/core/LayoutableShadowNode.h>

namespace facebook::react {

std::shared_ptr<ShadowNode> cloneWithLayoutMetrics(
    const ShadowNode& node,
    const LayoutMetricsByFamily& byFamily) {
  const auto& children = node.getChildren();

  // Copied only once something below actually changed: a subtree with no
  // stamped element returns nullptr and its parent keeps its own children.
  std::vector<std::shared_ptr<const ShadowNode>> newChildren;
  bool childrenChanged = false;

  for (size_t i = 0; i < children.size(); i++) {
    auto replacement = cloneWithLayoutMetrics(*children[i], byFamily);
    if (replacement == nullptr) {
      continue;
    }
    if (!childrenChanged) {
      newChildren = children;
      childrenChanged = true;
    }
    newChildren[i] = std::move(replacement);
  }

  const auto found = byFamily.find(&node.getFamily());
  const bool metricsChanged = found != byFamily.end();

  if (!childrenChanged && !metricsChanged) {
    return nullptr;
  }

  auto cloned = childrenChanged
      ? node.clone(
            {.children =
                 std::make_shared<std::vector<std::shared_ptr<const ShadowNode>>>(
                     std::move(newChildren))})
      : node.clone({});

  if (metricsChanged) {
    dynamic_cast<LayoutableShadowNode&>(*cloned).setLayoutMetrics(found->second);
  }

  // The caller adopts this subtree in place of the one it walked, so a clone
  // that changed family would silently graft a different element into the
  // tree. `clone` preserves it; saying so keeps that true if it ever stops.
  react_native_assert(
      ShadowNode::sameFamily(*cloned, node) &&
      "a metric-stamping clone must stay the same element");

  return cloned;
}

} // namespace facebook::react
