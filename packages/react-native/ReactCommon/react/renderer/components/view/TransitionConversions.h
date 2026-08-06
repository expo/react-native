/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/view/TransitionPrimitives.h>
#include <react/renderer/components/view/conversions.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawValue.h>

#include <folly/dynamic.h>
#include <folly/json.h>

#include <optional>
#include <string>
#include <vector>

namespace facebook::react {

/*
 * Reading the `transition-*` longhands (css-transitions-1 §2).
 *
 * Each is a comma-separated list, and the lists are zipped by index to make
 * the individual transitions. Where one list is shorter than
 * `transition-property` its values repeat, so a single duration applies to
 * every property — which is how the shorthand is almost always written.
 */

inline std::vector<std::string> splitTransitionList(const std::string& value) {
  std::vector<std::string> parts;
  size_t start = 0;
  while (start <= value.size()) {
    auto comma = value.find(',', start);
    auto end = comma == std::string::npos ? value.size() : comma;
    auto part = value.substr(start, end - start);
    // Trim, since `opacity, transform` is as valid as `opacity,transform`.
    auto first = part.find_first_not_of(" \t\n");
    auto last = part.find_last_not_of(" \t\n");
    if (first != std::string::npos) {
      parts.push_back(part.substr(first, last - first + 1));
    }
    if (comma == std::string::npos) {
      break;
    }
    start = comma + 1;
  }
  return parts;
}

inline std::optional<TransitionProperty> parseTransitionProperty(
    const std::string& value) {
  if (value == "all") {
    return TransitionProperty::All;
  }
  if (value == "opacity") {
    return TransitionProperty::Opacity;
  }
  if (value == "background-color" || value == "backgroundColor") {
    return TransitionProperty::BackgroundColor;
  }
  if (value == "border-color" || value == "borderColor") {
    return TransitionProperty::BorderColor;
  }
  if (value == "transform") {
    return TransitionProperty::Transform;
  }
  // `none`, and every property this cannot interpolate. Not an error: CSS says
  // an unsupported property simply does not transition, and the value still
  // applies immediately.
  return std::nullopt;
}

/*
 * A CSS <time>: `200ms`, `0.2s`, or a bare number, which React Native styles
 * use for milliseconds elsewhere and so does this.
 */
inline Float parseTransitionTime(const std::string& value) {
  try {
    size_t consumed = 0;
    const auto number = std::stof(value, &consumed);
    const auto unit = value.substr(consumed);
    if (unit == "s") {
      return number * 1000.0f;
    }
    return number;
  } catch (...) {
    return 0.0f;
  }
}

inline TransitionTimingFunction parseTransitionTimingFunction(
    const std::string& value) {
  if (value == "linear") {
    return {0.0f, 0.0f, 1.0f, 1.0f};
  }
  if (value == "ease-in") {
    return {0.42f, 0.0f, 1.0f, 1.0f};
  }
  if (value == "ease-out") {
    return {0.0f, 0.0f, 0.58f, 1.0f};
  }
  if (value == "ease-in-out") {
    return {0.42f, 0.0f, 0.58f, 1.0f};
  }
  if (value == "step-start") {
    return {0.0f, 0.0f, 0.0f, 0.0f, true, true, 1};
  }
  if (value == "step-end") {
    return {0.0f, 0.0f, 0.0f, 0.0f, true, false, 1};
  }
  if (value.rfind("steps", 0) == 0) {
    const auto open = value.find('(');
    const auto close = value.find(')');
    if (open != std::string::npos && close != std::string::npos &&
        close > open) {
      const auto args =
          splitTransitionList(value.substr(open + 1, close - open - 1));
      if (!args.empty()) {
        int32_t count = 1;
        try {
          count = std::max(1, std::stoi(args[0]));
        } catch (...) {
          return {};
        }
        // css-easing-1: `start`/`jump-start` jump at each interval's
        // beginning; `end`/`jump-end` (the default) at its end. jump-none and
        // jump-both are not supported and take the default.
        const bool atStart = args.size() > 1 &&
            (args[1] == "start" || args[1] == "jump-start");
        return {0.0f, 0.0f, 0.0f, 0.0f, true, atStart, count};
      }
    }
    return {};
  }
  if (value.rfind("cubic-bezier", 0) == 0) {
    const auto open = value.find('(');
    const auto close = value.find(')');
    if (open != std::string::npos && close != std::string::npos &&
        close > open) {
      const auto args =
          splitTransitionList(value.substr(open + 1, close - open - 1));
      if (args.size() == 4) {
        try {
          return {
              std::stof(args[0]),
              std::stof(args[1]),
              std::stof(args[2]),
              std::stof(args[3])};
        } catch (...) {
          // Falls through to `ease`.
        }
      }
    }
  }
  // `ease`, and anything unrecognised.
  return {};
}

/*
 * Builds the zipped transition list from the four longhands.
 *
 * `transition-property` drives the count: a duration without a property to
 * apply it to animates nothing, which is what CSS says and also what avoids
 * running an interpolator over a property nobody asked about.
 */
inline Transitions buildTransitions(
    const std::string& properties,
    const std::string& durations,
    const std::string& delays,
    const std::string& timingFunctions) {
  const auto propertyList = splitTransitionList(properties);
  if (propertyList.empty()) {
    return {};
  }
  const auto durationList = splitTransitionList(durations);
  const auto delayList = splitTransitionList(delays);
  const auto timingFunctionList = splitTransitionList(timingFunctions);

  Transitions transitions;
  transitions.reserve(propertyList.size());
  for (size_t i = 0; i < propertyList.size(); i++) {
    const auto property = parseTransitionProperty(propertyList[i]);
    if (!property.has_value()) {
      continue;
    }
    Transition transition;
    transition.property = *property;
    // Shorter lists repeat, per css-transitions-1 §2: the values are matched
    // up by index modulo their own length.
    if (!durationList.empty()) {
      transition.duration =
          parseTransitionTime(durationList[i % durationList.size()]);
    }
    if (!delayList.empty()) {
      transition.delay = parseTransitionTime(delayList[i % delayList.size()]);
    }
    if (!timingFunctionList.empty()) {
      transition.timingFunction = parseTransitionTimingFunction(
          timingFunctionList[i % timingFunctionList.size()]);
    }
    // A zero-duration transition is indistinguishable from no transition, and
    // keeping it would start an interpolator that finishes on its first frame.
    if (transition.duration > 0.0f) {
      transitions.push_back(transition);
    }
  }
  return transitions;
}

/*
 * Building a CSS animation from the wire format: `animationKeyframes` is a
 * JSON array of stops (offset + resolved declarations, colors already ints,
 * transforms as CSS strings), and the longhands are the same CSS strings the
 * transition parser reads.
 */
inline std::optional<CSSAnimation> buildAnimation(
    const std::string& keyframesJson,
    const std::string& duration,
    const std::string& delay,
    const std::string& timingFunction,
    const std::string& iterationCount,
    const std::string& direction,
    const std::string& fillMode) {
  if (keyframesJson.empty()) {
    return std::nullopt;
  }
  folly::dynamic parsed;
  try {
    parsed = folly::parseJson(keyframesJson);
  } catch (...) {
    return std::nullopt;
  }
  if (!parsed.isArray() || parsed.empty()) {
    return std::nullopt;
  }

  CSSAnimation animation;
  for (const auto& stop : parsed) {
    if (!stop.isObject() || stop.find("offset") == stop.items().end()) {
      continue;
    }
    AnimationKeyframe keyframe;
    keyframe.offset = static_cast<Float>(stop["offset"].asDouble());
    if (auto* v = stop.get_ptr("opacity"); v != nullptr && v->isNumber()) {
      keyframe.opacity = static_cast<Float>(v->asDouble());
    }
    if (auto* v = stop.get_ptr("backgroundColor");
        v != nullptr && v->isNumber()) {
      keyframe.backgroundColor = static_cast<int32_t>(v->asInt());
    }
    if (auto* v = stop.get_ptr("borderColor"); v != nullptr && v->isNumber()) {
      keyframe.borderColor = static_cast<int32_t>(v->asInt());
    }
    if (auto* v = stop.get_ptr("transform"); v != nullptr && v->isString()) {
      Transform transform;
      parseUnprocessedTransformString(v->getString(), transform);
      keyframe.transform = transform;
    }
    animation.keyframes.push_back(std::move(keyframe));
  }
  if (animation.keyframes.size() < 2) {
    // A single stop animates nothing; css-animations needs somewhere to go.
    return std::nullopt;
  }

  animation.duration = parseTransitionTime(duration);
  if (animation.duration <= 0.0f) {
    return std::nullopt;
  }
  animation.delay = parseTransitionTime(delay);
  animation.timingFunction = parseTransitionTimingFunction(timingFunction);

  if (iterationCount == "infinite") {
    animation.iterations = -1.0f;
  } else if (!iterationCount.empty()) {
    try {
      animation.iterations = std::stof(iterationCount);
    } catch (...) {
      animation.iterations = 1.0f;
    }
  }

  if (direction == "reverse") {
    animation.direction = AnimationDirection::Reverse;
  } else if (direction == "alternate") {
    animation.direction = AnimationDirection::Alternate;
  } else if (direction == "alternate-reverse") {
    animation.direction = AnimationDirection::AlternateReverse;
  }

  if (fillMode == "forwards") {
    animation.fillMode = AnimationFillMode::Forwards;
  } else if (fillMode == "backwards") {
    animation.fillMode = AnimationFillMode::Backwards;
  } else if (fillMode == "both") {
    animation.fillMode = AnimationFillMode::Both;
  }

  return animation;
}

} // namespace facebook::react
