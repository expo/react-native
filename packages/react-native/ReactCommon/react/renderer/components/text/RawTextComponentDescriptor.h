/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/text/ImplicitTextContent.h>
#include <react/renderer/components/text/RawTextShadowNode.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>

namespace facebook::react {

class RawTextComponentDescriptor : public ConcreteComponentDescriptor<RawTextShadowNode> {
 public:
  explicit RawTextComponentDescriptor(const ComponentDescriptorParameters &parameters)
      : ConcreteComponentDescriptor<RawTextShadowNode>(parameters)
  {
    // A RawText descriptor exists iff text nodes can exist in a tree, which
    // makes it the reliable installation point for the anonymous-box factory
    // that renders bare text children of Views (implicit-text-plan.md §3.A).
    ensureImplicitTextContentFactoryInstalled(parameters);
  }
};

} // namespace facebook::react
