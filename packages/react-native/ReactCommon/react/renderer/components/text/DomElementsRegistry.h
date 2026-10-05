/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <vector>

#include <react/renderer/componentregistry/ComponentDescriptorProvider.h>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>

#include <react/renderer/components/image/ImageShadowNode.h>
#include <react/renderer/components/text/InlineTextTagShadowNodes.h>
#include <react/renderer/components/view/ElementBoxShadowNode.h>

namespace facebook::react::dom {

/*
 * The one list of DOM element descriptors; the platform component registries
 * call these instead of naming the descriptor types. Text nodes (`#text`) are
 * react-native's own and are registered with the core text components.
 */

// The elements valid inside a paragraph's inline formatting context
inline std::vector<ComponentDescriptorProvider> inlineTextElementProviders()
{
  return {
      concreteComponentDescriptorProvider<InlineTextComponentDescriptor>(),
  };
}

inline std::vector<ComponentDescriptorProvider> allElementProviders()
{
  auto providers = inlineTextElementProviders();
  providers.push_back(concreteComponentDescriptorProvider<ImgTagComponentDescriptor>());
  providers.push_back(concreteComponentDescriptorProvider<ElementBoxComponentDescriptor>());
  return providers;
}

inline void addAllElementDescriptors(const ComponentDescriptorProviderRegistry &registry)
{
  for (const auto &provider : allElementProviders()) {
    registry.add(provider);
  }
}

} // namespace facebook::react::dom
