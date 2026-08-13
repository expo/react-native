/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "ComponentDescriptorProviderRegistry.h"

#include <react/renderer/componentregistry/OnDemandComponentDescriptorProviders.h>

namespace facebook::react {

void ComponentDescriptorProviderRegistry::add(
    const ComponentDescriptorProvider& provider) const {
  std::unique_lock lock(mutex_);

  /*
  // TODO: T57583139
  The assert is temporarily disabled to reduce the volume of the signal.
  assert(
      componentDescriptorProviders_.find(provider.handle) ==
          componentDescriptorProviders_.end() &&
      "Attempt to register an already registered ComponentDescriptorProvider.");
  */

  if (componentDescriptorProviders_.find(provider.handle) !=
      componentDescriptorProviders_.end()) {
    // Re-registering a provider makes no sense because it's copyable: already
    // registered one is as good as any new can be.
    return;
  }

  componentDescriptorProviders_.insert({provider.handle, provider});

  for (const auto& weakRegistry : componentDescriptorRegistries_) {
    auto registry = weakRegistry.lock();
    if (!registry) {
      continue;
    }

    registry->add(provider);
  }
}

void ComponentDescriptorProviderRegistry::setComponentDescriptorProviderRequest(
    ComponentDescriptorProviderRequest componentDescriptorProviderRequest)
    const {
  std::shared_lock lock(mutex_);
  componentDescriptorProviderRequest_ =
      std::move(componentDescriptorProviderRequest);
}

void ComponentDescriptorProviderRegistry::request(
    ComponentName componentName) const {
  ComponentDescriptorProviderRequest componentDescriptorProviderRequest;

  {
    std::shared_lock lock(mutex_);
    componentDescriptorProviderRequest = componentDescriptorProviderRequest_;
  }

  // A library may register component descriptor providers to be resolved lazily, on first request for
  // the name (see OnDemandComponentDescriptorProviders). This is the timing-safe way out-of-core /
  // intrinsic components (e.g. expo-intrinsics) register — the request fires at commit, after all
  // init. It is consulted BEFORE the platform request handler so an intrinsic (e.g. the <u> text
  // element) wins over that handler's unknown-component fallbacks (Paper interop / UnimplementedView),
  // which would otherwise claim the name as a plain view and drop its text.
  auto onDemand = OnDemandComponentDescriptorProviders::find(componentName);
  if (onDemand) {
    add(*onDemand);
    return;
  }

  if (componentDescriptorProviderRequest) {
    componentDescriptorProviderRequest(componentName);
  }
}

ComponentDescriptorRegistry::Shared
ComponentDescriptorProviderRegistry::createComponentDescriptorRegistry(
    const ComponentDescriptorParameters& parameters) const {
  std::shared_lock lock(mutex_);

  auto registry = std::make_shared<const ComponentDescriptorRegistry>(
      parameters, *this, parameters.contextContainer);

  for (const auto& pair : componentDescriptorProviders_) {
    registry->add(pair.second);
  }

  componentDescriptorRegistries_.push_back(registry);

  return registry;
}

} // namespace facebook::react
