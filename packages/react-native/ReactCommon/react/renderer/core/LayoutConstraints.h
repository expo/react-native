/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <limits>
#include <vector>

#include <react/renderer/core/LayoutPrimitives.h>
#include <react/renderer/graphics/Size.h>
#include <react/utils/hash_combine.h>

namespace facebook::react {

/*
 * A band of the block axis where a float narrows the lines beside it
 * (CSS2 §9.5). Coordinates are relative to the measured content's own top, and
 * the insets are how far each side is eaten into.
 *
 * A line box shortens where it overlaps one of these; a block box does not,
 * which is why this describes LINES rather than a smaller available width.
 *
 * UNITS: the renderer's device-independent unit, like every other `Float` in
 * a `LayoutMetrics`. That IS the iOS point, so `NSTextContainer` takes these
 * numbers unconverted — but it is the Android DIP, and an Android `Layout`
 * measures in physical pixels, so that side must convert. Handing these
 * straight to `setIndents` indented by a 2.625th of the intended amount and
 * looked like a layout bug rather than a unit one.
 */
struct FloatExclusion {
  Float blockStart{0};
  Float blockEnd{0};
  Float leftInset{0};
  Float rightInset{0};

  bool operator==(const FloatExclusion &other) const = default;
};

/*
 * Unified layout constraints for measuring.
 */
struct LayoutConstraints {
  Size minimumSize{.width = 0, .height = 0};
  Size maximumSize{.width = std::numeric_limits<Float>::infinity(), .height = std::numeric_limits<Float>::infinity()};
  LayoutDirection layoutDirection{LayoutDirection::Undefined};
  /*
   * The floats intruding on this content. Part of the constraints, not a
   * side-channel, because measurements are CACHED against them: the same box
   * beside a float and away from one measures differently, and a cache that
   * could not tell those apart would serve one for the other.
   */
  std::vector<FloatExclusion> floatExclusions{};

  /*
   * Clamps the provided `Size` between the `minimumSize` and `maximumSize`
   * bounds of this `LayoutConstraints`.
   */
  Size clamp(const Size &size) const;
};

inline bool operator==(const LayoutConstraints &lhs, const LayoutConstraints &rhs)
{
  return std::tie(lhs.minimumSize, lhs.maximumSize, lhs.layoutDirection) ==
             std::tie(rhs.minimumSize, rhs.maximumSize, rhs.layoutDirection) &&
      lhs.floatExclusions == rhs.floatExclusions;
}

} // namespace facebook::react

namespace std {
template <>
struct hash<facebook::react::LayoutConstraints> {
  size_t operator()(const facebook::react::LayoutConstraints &constraints) const
  {
    auto seed = facebook::react::hash_combine(
        constraints.minimumSize, constraints.maximumSize, constraints.layoutDirection);
    for (const auto &exclusion : constraints.floatExclusions) {
      facebook::react::hash_combine(
          seed,
          exclusion.blockStart,
          exclusion.blockEnd,
          exclusion.leftInset,
          exclusion.rightInset);
    }
    return seed;
  }
};
} // namespace std
