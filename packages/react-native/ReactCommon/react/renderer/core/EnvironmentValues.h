/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <optional>
#include <string_view>

#include <react/renderer/graphics/Float.h>
#include <react/renderer/graphics/RectangleEdges.h>

namespace facebook::react {

/*
 * The values `env()` resolves against, for one surface (css-env-1): the safe
 * area the system's own furniture draws over. An `env()` travels as an
 * unresolved symbol and is resolved during layout against a value that arrives
 * with the surface's layout constraints, so there is no first frame laid out
 * against an unknown inset. Surface-level, as the spec says: a per-element
 * answer would depend on where the element landed, the output of the very
 * layout the answer is an input to.
 */
enum class EnvironmentVariable {
  SafeAreaInsetTop,
  SafeAreaInsetRight,
  SafeAreaInsetBottom,
  SafeAreaInsetLeft,
};

struct EnvironmentValues {
  EdgeInsets safeAreaInsets{};

  /*
   * How many times the values have changed for this surface, stamped by
   * `SurfaceHandler`. A shadow node remembers the environment it was laid out
   * against as this four-byte count rather than the sixteen-byte values, since
   * `ViewShadowNode` sits on its memory budget. Zero means nothing has been
   * published yet, the one state in which an `env()` keeps its fallback; a
   * published all-zero safe area has answered.
   */
  uint32_t generation{0};

  bool operator==(const EnvironmentValues &other) const = default;

  Float resolve(EnvironmentVariable variable) const
  {
    switch (variable) {
      case EnvironmentVariable::SafeAreaInsetTop:
        return safeAreaInsets.top;
      case EnvironmentVariable::SafeAreaInsetRight:
        return safeAreaInsets.right;
      case EnvironmentVariable::SafeAreaInsetBottom:
        return safeAreaInsets.bottom;
      case EnvironmentVariable::SafeAreaInsetLeft:
        return safeAreaInsets.left;
    }
    return 0;
  }
};

inline std::optional<EnvironmentVariable> environmentVariableFromName(std::string_view name)
{
  if (name == "safe-area-inset-top") {
    return EnvironmentVariable::SafeAreaInsetTop;
  }
  if (name == "safe-area-inset-right") {
    return EnvironmentVariable::SafeAreaInsetRight;
  }
  if (name == "safe-area-inset-bottom") {
    return EnvironmentVariable::SafeAreaInsetBottom;
  }
  if (name == "safe-area-inset-left") {
    return EnvironmentVariable::SafeAreaInsetLeft;
  }
  return std::nullopt;
}

} // namespace facebook::react
