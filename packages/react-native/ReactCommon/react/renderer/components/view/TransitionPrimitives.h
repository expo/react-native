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

// Where a step easing jumps, and how many jumps span [0,1] (css-easing-1 §2.3)
enum class StepPosition {
  JumpStart,
  JumpEnd,
  JumpNone,
  JumpBoth,
};

/*
 * `transition-timing-function` (css-easing-1): a cubic Bézier with endpoints
 * pinned at (0,0) and (1,1), default `ease`, or a step function
 */
struct TransitionTimingFunction {
  Float x1{0.25f};
  Float y1{0.1f};
  Float x2{0.25f};
  Float y2{1.0f};
  // A step function is not a Bézier: the position decides both where a jump
  // happens and how many span [0,1] (`jump-none` n-1, `jump-both` n+1)
  bool isStep{false};
  StepPosition stepPosition{StepPosition::JumpEnd};
  int32_t stepCount{1};

  bool operator==(const TransitionTimingFunction &other) const = default;

  /*
   * The eased progress for a linear progress in [0, 1]. The Bézier is
   * parametric, so x (time) is inverted numerically — Newton-Raphson, with
   * bisection where the curve is too flat for it.
   */
  Float evaluate(Float linearProgress) const
  {
    if (isStep) {
      // css-easing-1 §2.3 literally: `jump-both` reaches neither endpoint
      const auto steps = std::max(stepCount, 1);
      auto currentStep = static_cast<int32_t>(std::floor(linearProgress * steps));
      if (stepPosition == StepPosition::JumpStart || stepPosition == StepPosition::JumpBoth) {
        currentStep += 1;
      }
      if (linearProgress >= 0.0f && currentStep < 0) {
        currentStep = 0;
      }
      const auto jumps = stepPosition == StepPosition::JumpNone ? steps - 1
          : stepPosition == StepPosition::JumpBoth              ? steps + 1
                                                                : steps;
      if (jumps <= 0) {
        // `steps(1, jump-none)` is invalid in css-easing-1; a constant here
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
    if (x1 == y1 && x2 == y2) {
      return linearProgress;
    }
    return bezierY(solveForT(linearProgress));
  }

 private:
  static Float cubic(Float a, Float b, Float t)
  {
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
      if (std::abs(derivative) < kEpsilon) {
        break;
      }
      t -= error / derivative;
    }

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

// The properties the engine interpolates; `All` covers every one of them
enum class TransitionProperty {
  All,
  Opacity,
  BackgroundColor,
  BorderColor,
  Transform,
};

// One entry of the `transition` shorthand; times in milliseconds
struct Transition {
  TransitionProperty property{TransitionProperty::All};
  Float duration{0.0f};
  Float delay{0.0f};
  TransitionTimingFunction timingFunction{};

  bool operator==(const Transition &other) const = default;
};

using Transitions = std::vector<Transition>;

// A keyframe (css-animations-1 §4): its offset and the properties it pins
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

// A parsed `animation`; `iterations < 0` is `infinite`
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

// The entry for `property`: last wins, and an exact match beats `all`
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
