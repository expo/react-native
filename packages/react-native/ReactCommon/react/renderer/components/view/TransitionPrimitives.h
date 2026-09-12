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

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

namespace facebook::react {

/*
 * `transition-timing-function` (css-easing-1). Every keyword is defined as a
 * cubic Bézier or a step function, so the curve is stored rather than the
 * keyword.
 */
/*
 * Where a step easing's jumps happen, and how many of them span [0,1]
 * (css-easing-1 §2.3). `step-start` and `step-end` are the n == 1 cases of
 * `jump-start` and `jump-end`.
 */
enum class StepPosition {
  JumpStart,
  JumpEnd,
  JumpNone,
  JumpBoth,
};

struct TransitionTimingFunction {
  // Control points of the cubic Bézier, whose endpoints are fixed at (0,0) and
  // (1,1); the default is `ease`
  Float x1{0.25f};
  Float y1{0.1f};
  Float x2{0.25f};
  Float y2{1.0f};
  // `step-start`, `step-end` and `steps(n, pos)` jump rather than curve, so
  // they are stored as a flag, the jump position and the interval count. The
  // position is an enum because it decides both where the rise happens in an
  // interval and how many jumps span [0,1]: `jump-none` makes n-1 and reaches
  // both endpoints, `jump-both` makes n+1 and reaches neither.
  bool isStep{false};
  StepPosition stepPosition{StepPosition::JumpEnd};
  int32_t stepCount{1};

  bool operator==(const TransitionTimingFunction &other) const = default;

  /*
   * The eased progress for a linear progress in [0, 1]. A cubic Bézier is
   * parametric, so `x` (time) is inverted numerically to a parameter before
   * `y` (progress) is read: Newton-Raphson, with bisection where the
   * derivative is too flat.
   */
  Float evaluate(Float linearProgress) const
  {
    if (isStep) {
      // css-easing-1 §2.3, with no special case at the endpoints: `jump-both`
      // reaches neither 0 nor 1
      const auto steps = std::max(stepCount, 1);
      auto currentStep = static_cast<int32_t>(std::floor(linearProgress * steps));
      if (stepPosition == StepPosition::JumpStart || stepPosition == StepPosition::JumpBoth) {
        currentStep += 1;
      }
      if (linearProgress >= 0.0f && currentStep < 0) {
        currentStep = 0;
      }
      // How many jumps span the interval
      const auto jumps = stepPosition == StepPosition::JumpNone ? steps - 1
          : stepPosition == StepPosition::JumpBoth              ? steps + 1
                                                                : steps;
      if (jumps <= 0) {
        // `steps(1, jump-none)` is invalid in css-easing-1; treated as a
        // constant rather than dividing by zero
        return 0.0f;
      }
      if (linearProgress <= 1.0f && currentStep > jumps) {
        currentStep = jumps;
      }
      return static_cast<Float>(currentStep) / static_cast<Float>(jumps);
    }
    if (linearProgress <= 0.0f) {
      return 0.0f;
    }
    if (linearProgress >= 1.0f) {
      return 1.0f;
    }
    // `linear` and anything collinear needs no solving
    if (x1 == y1 && x2 == y2) {
      return linearProgress;
    }
    return bezierY(solveForT(linearProgress));
  }

 private:
  static Float cubic(Float a, Float b, Float t)
  {
    // The Bézier with endpoints pinned at 0 and 1, expanded
    const auto oneMinusT = 1.0f - t;
    return 3.0f * oneMinusT * oneMinusT * t * a + 3.0f * oneMinusT * t * t * b + t * t * t;
  }

  Float bezierX(Float t) const
  {
    return cubic(x1, x2, t);
  }

  Float bezierY(Float t) const
  {
    return cubic(y1, y2, t);
  }

  Float bezierDerivativeX(Float t) const
  {
    const auto oneMinusT = 1.0f - t;
    return 3.0f * oneMinusT * oneMinusT * x1 + 6.0f * oneMinusT * t * (x2 - x1) + 3.0f * t * t * (1.0f - x2);
  }

  Float solveForT(Float x) const
  {
    constexpr Float kEpsilon = 1e-6f;
    constexpr int kNewtonIterations = 8;

    Float t = x;
    for (int i = 0; i < kNewtonIterations; i++) {
      const auto error = bezierX(t) - x;
      if (std::abs(error) < kEpsilon) {
        return t;
      }
      const auto derivative = bezierDerivativeX(t);
      // Too flat for Newton to make progress without overshooting
      if (std::abs(derivative) < kEpsilon) {
        break;
      }
      t -= error / derivative;
    }

    // Bisection cannot diverge; reached only for curves with a near-flat region
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
 * The properties a transition can apply to: a closed set, since the
 * interpolator has to know how to interpolate each value. `All` is
 * `transition-property: all`. The first four are paint properties, whose
 * frames are written straight to the mounted view; `Height` and
 * `padding-bottom` are layout properties, whose frames go through a commit
 * (see `isLayoutAffecting` in `CSSTransitions.cpp`).
 */
enum class TransitionProperty {
  All,
  Opacity,
  BackgroundColor,
  BorderColor,
  Transform,
  Height,
  PaddingBottom,
};

/*
 * One entry of the `transition` shorthand
 */
struct Transition {
  TransitionProperty property{TransitionProperty::All};
  // Milliseconds; CSS's initial value for both is 0
  Float duration{0.0f};
  Float delay{0.0f};
  TransitionTimingFunction timingFunction{};

  bool operator==(const Transition &other) const = default;
};

using Transitions = std::vector<Transition>;

/*
 * One keyframe stop of a CSS animation (css-animations-1 §4). Only the
 * properties the engine can interpolate are represented.
 */
struct AnimationKeyframe {
  Float offset{0.0f};
  std::optional<Float> opacity{};
  std::optional<int32_t> backgroundColor{};
  std::optional<int32_t> borderColor{};
  std::optional<Transform> transform{};

  bool operator==(const AnimationKeyframe &other) const = default;
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

  bool operator==(const CSSAnimation &other) const = default;
};

/*
 * The entry that applies to `property`, if any: CSS resolves duplicates
 * last-wins and an explicit property beats `all`, so the search runs backwards
 * and prefers an exact match
 */
inline const Transition *findTransition(const Transitions &transitions, TransitionProperty property)
{
  const Transition *fromAll = nullptr;
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
