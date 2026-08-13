/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/text/AnonymousTextContent.h>
#include <react/renderer/components/text/TextNodeShadowNode.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>

namespace facebook::react {

/*
 * Internal descriptor for the first-class text node (text-children-plan.md §3.F).
 * It is registered so `UIManager::createTextNode` can build the node with a real
 * `ShadowNodeFamily`, but is never resolved from JS by name. Like the old
 * `RawTextComponentDescriptor`, it is the reliable install point for the
 * anonymous-box factory that renders bare text under Views (§3.A).
 */
class TextNodeComponentDescriptor : public ConcreteComponentDescriptor<TextNodeShadowNode> {
 public:
  explicit TextNodeComponentDescriptor(const ComponentDescriptorParameters &parameters)
      : ConcreteComponentDescriptor<TextNodeShadowNode>(parameters)
  {
    ensureAnonymousTextContentFactoryInstalled(parameters);
  }
};

} // namespace facebook::react
