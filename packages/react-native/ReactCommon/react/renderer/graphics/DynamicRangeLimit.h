/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <cstdint>
#include <string>

namespace facebook::react {

// CSS Color HDR's `dynamic-range-limit`
// (https://drafts.csswg.org/css-color-hdr-1/#the-dynamic-range-limit-property):
// inherited, read by pictures and HDR colors
enum class DynamicRangeLimit : uint8_t { NoLimit, Constrained, Standard };

inline std::string toString(const DynamicRangeLimit &limit)
{
  switch (limit) {
    case DynamicRangeLimit::NoLimit:
      return "no-limit";
    case DynamicRangeLimit::Constrained:
      return "constrained";
    case DynamicRangeLimit::Standard:
      return "standard";
  }
  return "no-limit";
}

} // namespace facebook::react
