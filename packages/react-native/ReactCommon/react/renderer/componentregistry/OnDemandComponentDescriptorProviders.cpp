/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "OnDemandComponentDescriptorProviders.h"

#include <mutex>
#include <string>
#include <unordered_map>

namespace facebook::react {

namespace {

// Function-local statics (out-of-line, in one translation unit) so there is exactly one instance
// process-wide, even across module boundaries.
std::mutex &registryMutex() {
  static std::mutex mutex;
  return mutex;
}

std::unordered_map<std::string, ComponentDescriptorProvider> &registry() {
  static std::unordered_map<std::string, ComponentDescriptorProvider> providers;
  return providers;
}

} // namespace

void OnDemandComponentDescriptorProviders::add(
    const ComponentDescriptorProvider &provider) {
  std::scoped_lock lock(registryMutex());
  registry().insert_or_assign(std::string(provider.name), provider);
}

std::optional<ComponentDescriptorProvider>
OnDemandComponentDescriptorProviders::find(ComponentName componentName) {
  std::scoped_lock lock(registryMutex());
  auto it = registry().find(std::string(componentName));
  if (it == registry().end()) {
    return std::nullopt;
  }
  return it->second;
}

} // namespace facebook::react
