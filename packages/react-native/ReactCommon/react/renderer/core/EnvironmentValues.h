/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <array>
#include <bit>
#include <optional>
#include <string_view>

#include <react/renderer/graphics/Float.h>
#include <react/renderer/graphics/RectangleEdges.h>

namespace facebook::react {

/*
 * The document values `env()` resolves against (css-env-1). The surface's
 * layout constraints provide the default safe area. An embedded document can
 * declare its own environment in host props before layout, alongside its
 * viewport. An `env()` remains unresolved until layout uses that environment.
 * Values are never inferred from an individual element's resulting position:
 * that would make a layout input depend on the output of the same layout.
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

  // A host declares a document environment before layout; it is not inferred
  // from each element's resulting position. Nodes retain only this compact
  // revision, while the declaration itself lives in props.
  EnvironmentValues withSafeAreaInsets(const EdgeInsets &insets) const
  {
    uint32_t revision = generation ^ 2166136261u;
    for (Float value : {insets.top, insets.right, insets.bottom, insets.left}) {
      for (uint8_t byte : std::bit_cast<std::array<uint8_t, sizeof(Float)>>(value)) {
        revision = (revision ^ byte) * 16777619u;
      }
    }
    return {.safeAreaInsets = insets, .generation = revision == 0 ? 1 : revision};
  }

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
