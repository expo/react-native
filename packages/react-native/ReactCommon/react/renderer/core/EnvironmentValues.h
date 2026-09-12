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
 * The values `env()` resolves against, for one surface.
 *
 * css-env-1 defines `env()` as a lookup into a set of values the user agent
 * publishes about the environment it is drawing into. The one that matters here
 * is the safe area: the part of the surface the system's own furniture — a
 * status bar, a notch, a home indicator — is drawing over.
 *
 * The whole point of spelling a length this way is WHERE it gets resolved. A
 * safe area read in JavaScript can only enter layout by way of a render, so the
 * first frame is laid out against a value that is not yet known and a second one
 * corrects it — the launch shift every `useSafeAreaInsets()` screen shows. An
 * `env()` travels as an unresolved symbol and is resolved during layout, against
 * a value the layout pass is already holding, because it arrives with the
 * surface's layout constraints. There is no frame in between to be wrong.
 *
 * Surface-level rather than per-element, which is what css-env-1 specifies: the
 * safe area describes the viewport, not the box asking about it. That is also
 * what makes it resolvable BEFORE layout rather than after — a per-element
 * answer would depend on where the element landed, which is the output of the
 * very layout the answer is an input to. An element that is not at the edge of
 * the surface — a screen below a native navigator's header — says so with the
 * edge it leaves out, not by asking a different question.
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
   * Counts how many times the values above have changed for this surface.
   *
   * Stamped by `SurfaceHandler`, which is the one place that sees both the
   * incoming values and the previous ones, on every platform.
   *
   * It exists so that a shadow node can remember which environment it was laid
   * out against in four bytes instead of sixteen. That sounds like a small
   * thing and is not: the record has to be per node — the configure walk skips
   * whole subtrees, so "has this one seen the current environment" cannot be
   * answered anywhere else — and `ViewShadowNode` sits exactly on its declared
   * memory budget, which every mounted view pays. Sixteen bytes took it 1088 →
   * 1120. Four fit in padding it was already carrying.
   *
   * ZERO means nothing has been published yet, and that is load-bearing rather
   * than incidental: it is the one state in which an `env()` keeps its fallback
   * instead of resolving. A surface that publishes an all-zero safe area is a
   * different thing — it has answered, and the answer is zero.
   */
  uint32_t generation{0};

  bool operator==(const EnvironmentValues& other) const = default;

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
