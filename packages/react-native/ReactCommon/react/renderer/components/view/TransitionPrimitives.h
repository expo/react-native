/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawValue.h>
#include <react/renderer/graphics/Float.h>
#include <react/renderer/graphics/Transform.h>

#include <cmath>
#include <string>
#include <vector>

namespace facebook::react {

/*
 * `transition-timing-function` (css-easing-1). Every keyword is defined as a
 * cubic Bézier or a step function, so both are stored rather than the keyword:
 * by the time a frame is being interpolated, what matters is the curve.
 */
struct TransitionTimingFunction {
  // Control points of the cubic Bézier, whose endpoints are fixed at (0,0) and
  // (1,1). The default is `ease`.
  Float x1{0.25f};
  Float y1{0.1f};
  Float x2{0.25f};
  Float y2{1.0f};
  // `step-start` and `step-end` are not Béziers; they jump. Stored as a flag
  // plus the position of the jump rather than approximated by a steep curve,
  // which would be wrong at exactly 0 and 1 — the only places they differ.
  bool isStep{false};
  bool stepAtStart{false};

  bool operator==(const TransitionTimingFunction& other) const = default;

  /*
   * The eased progress for a linear progress in [0, 1].
   *
   * A cubic Bézier easing curve is a parametric curve, so `x` (time) has to be
   * inverted to a parameter before `y` (progress) can be read off it. There is
   * no closed form, so this solves numerically — Newton-Raphson, which
   * converges in a couple of iterations for the well-behaved curves CSS
   * allows, falling back to bisection where the derivative is too flat for
   * Newton to be trusted.
   */
  Float evaluate(Float linearProgress) const {
    if (isStep) {
      return stepAtStart ? (linearProgress > 0.0f ? 1.0f : 0.0f)
                         : (linearProgress >= 1.0f ? 1.0f : 0.0f);
    }
    if (linearProgress <= 0.0f) {
      return 0.0f;
    }
    if (linearProgress >= 1.0f) {
      return 1.0f;
    }
    // `linear` and anything collinear needs no solving.
    if (x1 == y1 && x2 == y2) {
      return linearProgress;
    }
    return bezierY(solveForT(linearProgress));
  }

 private:
  static Float cubic(Float a, Float b, Float t) {
    // The Bézier with endpoints pinned at 0 and 1, expanded.
    const auto oneMinusT = 1.0f - t;
    return 3.0f * oneMinusT * oneMinusT * t * a + 3.0f * oneMinusT * t * t * b +
        t * t * t;
  }

  Float bezierX(Float t) const {
    return cubic(x1, x2, t);
  }

  Float bezierY(Float t) const {
    return cubic(y1, y2, t);
  }

  Float bezierDerivativeX(Float t) const {
    const auto oneMinusT = 1.0f - t;
    return 3.0f * oneMinusT * oneMinusT * x1 +
        6.0f * oneMinusT * t * (x2 - x1) + 3.0f * t * t * (1.0f - x2);
  }

  Float solveForT(Float x) const {
    constexpr Float kEpsilon = 1e-6f;
    constexpr int kNewtonIterations = 8;

    Float t = x;
    for (int i = 0; i < kNewtonIterations; i++) {
      const auto error = bezierX(t) - x;
      if (std::abs(error) < kEpsilon) {
        return t;
      }
      const auto derivative = bezierDerivativeX(t);
      // Too flat for Newton to make progress without overshooting wildly.
      if (std::abs(derivative) < kEpsilon) {
        break;
      }
      t -= error / derivative;
    }

    // Bisection: slower, but cannot diverge. Only reached for curves with a
    // near-flat region, where Newton is the one that misbehaves.
    Float low = 0.0f;
    Float high = 1.0f;
    t = x;
    while (low < high) {
      const auto value = bezierX(t);
      if (std::abs(value - x) < kEpsilon) {
        return t;
      }
      if (value < x) {
        low = t;
      } else {
        high = t;
      }
      const auto next = (low + high) / 2.0f;
      if (std::abs(next - t) < kEpsilon) {
        break;
      }
      t = next;
    }
    return t;
  }
};

/*
 * The properties a transition can apply to.
 *
 * A closed set rather than a string, because a frame-by-frame interpolator has
 * to know how to interpolate the value, and only these are both animatable and
 * carried by the shared animation backend. `All` is CSS's `transition-property:
 * all`, which covers every member of this set.
 */
enum class TransitionProperty {
  All,
  Opacity,
  BackgroundColor,
  BorderColor,
  Transform,
};

/*
 * One entry of the `transition` shorthand: what to animate, for how long,
 * after what delay, along which curve.
 */
struct Transition {
  TransitionProperty property{TransitionProperty::All};
  // Milliseconds. CSS's initial value for both is 0, which means a change
  // applies immediately — the same as having no transition at all.
  Float duration{0.0f};
  Float delay{0.0f};
  TransitionTimingFunction timingFunction{};

  bool operator==(const Transition& other) const = default;
};

using Transitions = std::vector<Transition>;

/*
 * One keyframe stop of a CSS animation (css-animations-1 §4): where in the
 * animation it sits, and the values it pins there. Only the properties the
 * engine can interpolate are represented; anything else in the authored
 * keyframe was dropped at resolution.
 */
struct AnimationKeyframe {
  Float offset{0.0f};
  std::optional<Float> opacity{};
  std::optional<int32_t> backgroundColor{};
  std::optional<int32_t> borderColor{};
  std::optional<Transform> transform{};

  bool operator==(const AnimationKeyframe& other) const = default;
};

enum class AnimationDirection {
  Normal,
  Reverse,
  Alternate,
  AlternateReverse,
};

enum class AnimationFillMode {
  None,
  Forwards,
  Backwards,
  Both,
};

/*
 * A parsed CSS animation: the stops plus the parameters that schedule them.
 * `iterations < 0` encodes `infinite`.
 */
struct CSSAnimation {
  std::vector<AnimationKeyframe> keyframes{};
  Float duration{0.0f};
  Float delay{0.0f};
  Float iterations{1.0f};
  AnimationDirection direction{AnimationDirection::Normal};
  AnimationFillMode fillMode{AnimationFillMode::None};
  TransitionTimingFunction timingFunction{};

  bool operator==(const CSSAnimation& other) const = default;
};

/*
 * Whether this set of transitions has anything to say about `property`, and if
 * so which entry wins.
 *
 * CSS resolves duplicates last-wins, and an explicit property beats `all`, so
 * the search runs backwards and prefers an exact match.
 */
inline const Transition* findTransition(
    const Transitions& transitions,
    TransitionProperty property) {
  const Transition* fromAll = nullptr;
  for (auto it = transitions.rbegin(); it != transitions.rend(); ++it) {
    if (it->property == property) {
      return &*it;
    }
    if (it->property == TransitionProperty::All && fromAll == nullptr) {
      fromAll = &*it;
    }
  }
  return fromAll;
}

} // namespace facebook::react
