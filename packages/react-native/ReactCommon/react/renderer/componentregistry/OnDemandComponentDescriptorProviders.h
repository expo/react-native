/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <optional>

#include <react/renderer/componentregistry/ComponentDescriptorProvider.h>

namespace facebook::react {

/*
 * Process-wide registry of component descriptor providers that resolve LAZILY — the first time a
 * component of that name is needed (i.e. when its shadow node is first created, during a commit).
 *
 * This is the timing-safe seam for out-of-core / intrinsic components (e.g. the expo-intrinsics DOM
 * elements). A library registers its providers here at load; RN core's
 * `ComponentDescriptorProviderRegistry::request` consults it on a miss. Because the miss happens at
 * commit — long after all native init on every platform — registration is never in a race with
 * component-registry setup (unlike eager registration such as a paragraph's supplemental providers).
 *
 * It is shared C++, so a single registration works on iOS, Android, and Fantom with no per-platform
 * wiring, and RN core names no specific component.
 */
class OnDemandComponentDescriptorProviders {
 public:
  /*
   * Register a provider to be resolved on the first request for `provider.name`. Populate before the
   * first commit (e.g. at library load / app startup). Idempotent by component name.
   */
  static void add(const ComponentDescriptorProvider &provider);

  /*
   * The provider registered for `componentName`, or `std::nullopt`.
   */
  static std::optional<ComponentDescriptorProvider> find(ComponentName componentName);
};

} // namespace facebook::react
