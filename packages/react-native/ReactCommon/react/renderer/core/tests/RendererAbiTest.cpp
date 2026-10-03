/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include <gtest/gtest.h>
#include <react/renderer/core/RendererAbi.h>

using namespace facebook::react;

TEST(RendererAbiTest, matchesTheHeadersItIsCompiledAgainst) {
  EXPECT_TRUE(rendererAbiMatchesHeaders());
  EXPECT_EQ(rendererAbiVersionOfLibrary(), kRendererAbiVersion);
}

TEST(RendererAbiTest, reportsHeadersOfAnotherVersion) {
  // The version a caller compiled against stale headers passes
  EXPECT_FALSE(rendererAbiMatchesHeaders(kRendererAbiVersion - 1));
  EXPECT_FALSE(rendererAbiMatchesHeaders(kRendererAbiVersion + 1));
}
