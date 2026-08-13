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
 * Registration entry point for the intrinsic DOM elements — the native half of
 * the DOM-elements catalog (text-children-plan.md §3.C). This is the single
 * place that names every element descriptor, so the platform component
 * registries (iOS Paragraph supplemental providers, Android
 * CoreComponentsRegistry, the Fantom stub registry) call these helpers instead
 * of enumerating the descriptor types themselves.
 *
 * Deliberately self-contained so it can one day move to its own
 * `components/dom/` directory / package. The string-children and text-node
 * engine these elements render against stays in react-native and is NOT
 * registered here — text nodes (`#text`) belong to react-native, not to the DOM
 * element catalog.
 *
 * NOTE: header-only on purpose — it introduces no new compilation unit, so no
 * build-system wiring is required at any of the call sites.
 */

/*
 * Inline text elements — resolve inside a paragraph's inline formatting context:
 *   <b>/<i> (styled variants of the inline text element) and the generic
 *   inline text backing itself, which is also where unregistered tags go. Used where only inline-level elements are valid, e.g. the iOS
 *   Paragraph `supplementalComponentDescriptorProviders`.
 */
inline std::vector<ComponentDescriptorProvider> inlineTextElementProviders() {
  return {
      concreteComponentDescriptorProvider<InlineTextComponentDescriptor>(),
  };
}

/*
 * Every intrinsic DOM element: the inline text elements plus <img> (an inline
 * replaced element, Image-backed) and <div> (a block-level container). Used by
 * the app-level component registries that hold the full component set.
 */
inline std::vector<ComponentDescriptorProvider> allElementProviders() {
  auto providers = inlineTextElementProviders();
  providers.push_back(
      concreteComponentDescriptorProvider<ImgTagComponentDescriptor>());
  // The generic box: what backs every block element, and what an inline
  // element is swapped onto when its `display` establishes a formatting
  // context.
  providers.push_back(
      concreteComponentDescriptorProvider<ElementBoxComponentDescriptor>());
  return providers;
}

/*
 * Adds every intrinsic DOM element descriptor to a provider registry. Convenience
 * for the `add()`-shaped registries (Fantom stub, Android CoreComponentsRegistry).
 */
inline void addAllElementDescriptors(
    const ComponentDescriptorProviderRegistry& registry) {
  for (const auto& provider : allElementProviders()) {
    registry.add(provider);
  }
}

} // namespace facebook::react::dom
