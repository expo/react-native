/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "RNTesterFeatureFlags.h"

#include <react/featureflags/ReactNativeFeatureFlags.h>
#include <react/featureflags/ReactNativeFeatureFlagsOverridesOSSStable.h>
#include <memory>

namespace {

// RNTester runs the native Yoga block formatting context (YGDisplayBlock)
// instead of the flex emulation, so the demos exercise real block layout:
// block-child stacking and sizing and CSS2 §8.3.1 margin collapsing. Subclasses
// the OSS-Stable overrides (what `RCTReactNativeFactory` installs for this app)
// so the standard stable flags are preserved.
class RNTesterFeatureFlagsOverrides
    : public facebook::react::ReactNativeFeatureFlagsOverridesOSSStable {
 public:
  bool enableYogaDisplayBlock() override {
    return true;
  }

  // The shared C++ animation backend, which drives prop updates from a display
  // link WITHOUT going through React's JavaScript pipeline. Both flags are
  // needed: the backend itself, and the C++ Animated implementation that owns
  // it. Upstream has these default-off with `expectedReleaseValue: true`.
  bool useSharedAnimatedBackend() override {
    return true;
  }

  bool cxxNativeAnimatedEnabled() override {
    return true;
  }
};

} // namespace

void RNTesterOverrideFeatureFlags(void) {
  facebook::react::ReactNativeFeatureFlags::dangerouslyForceOverride(
      std::make_unique<RNTesterFeatureFlagsOverrides>());
}
