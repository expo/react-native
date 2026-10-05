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

#include <optional>
#include <string>
#include <vector>

namespace facebook::react {

// A comma-separated CSS list, split at the top level only: `steps(4, jump-end)`
// is one value
inline std::vector<std::string> splitTransitionList(const std::string &value)
{
  std::vector<std::string> parts;
  size_t start = 0;
  int depth = 0;
  const auto flush = [&](size_t end) {
    auto part = value.substr(start, end - start);
    auto first = part.find_first_not_of(" \t\n");
    auto last = part.find_last_not_of(" \t\n");
    if (first != std::string::npos) {
      parts.push_back(part.substr(first, last - first + 1));
    }
  };
  for (size_t i = 0; i < value.size(); i++) {
    const char c = value[i];
    if (c == '(') {
      depth++;
    } else if (c == ')') {
      if (depth > 0) {
        depth--;
      }
    } else if (c == ',' && depth == 0) {
      flush(i);
      start = i + 1;
    }
  }
  flush(value.size());
  return parts;
}

inline std::optional<TransitionProperty> parseTransitionProperty(const std::string &value)
{
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
  // `none`, and a property this can't interpolate: it applies immediately
  return std::nullopt;
}

// A CSS <time>, or a bare number of milliseconds
inline Float parseTransitionTime(const std::string &value)
{
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

inline TransitionTimingFunction parseTransitionTimingFunction(const std::string &value)
{
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
    return {0.0f, 0.0f, 0.0f, 0.0f, true, StepPosition::JumpStart, 1};
  }
  if (value == "step-end") {
    return {0.0f, 0.0f, 0.0f, 0.0f, true, StepPosition::JumpEnd, 1};
  }
  if (value.rfind("steps", 0) == 0) {
    const auto open = value.find('(');
    const auto close = value.find(')');
    if (open != std::string::npos && close != std::string::npos && close > open) {
      const auto args = splitTransitionList(value.substr(open + 1, close - open - 1));
      if (!args.empty()) {
        int32_t count = 1;
        try {
          count = std::max(1, std::stoi(args[0]));
        } catch (...) {
          return {};
        }
        auto position = StepPosition::JumpEnd;
        if (args.size() > 1) {
          if (args[1] == "start" || args[1] == "jump-start") {
            position = StepPosition::JumpStart;
          } else if (args[1] == "jump-none") {
            position = StepPosition::JumpNone;
          } else if (args[1] == "jump-both") {
            position = StepPosition::JumpBoth;
          }
        }
        return {0.0f, 0.0f, 0.0f, 0.0f, true, position, count};
      }
    }
    return {};
  }
  if (value.rfind("cubic-bezier", 0) == 0) {
    const auto open = value.find('(');
    const auto close = value.find(')');
    if (open != std::string::npos && close != std::string::npos && close > open) {
      const auto args = splitTransitionList(value.substr(open + 1, close - open - 1));
      if (args.size() == 4) {
        try {
          return {std::stof(args[0]), std::stof(args[1]), std::stof(args[2]), std::stof(args[3])};
        } catch (...) {
        }
      }
    }
  }
  // `ease`, and anything unrecognized
  return {};
}

/*
 * The transitions the four longhands declare (css-transitions-1 §2):
 * `transition-property` drives the count, and a shorter list repeats
 */
inline Transitions buildTransitions(
    const std::string &properties,
    const std::string &durations,
    const std::string &delays,
    const std::string &timingFunctions)
{
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
    if (!durationList.empty()) {
      transition.duration = parseTransitionTime(durationList[i % durationList.size()]);
    }
    if (!delayList.empty()) {
      transition.delay = parseTransitionTime(delayList[i % delayList.size()]);
    }
    if (!timingFunctionList.empty()) {
      transition.timingFunction = parseTransitionTimingFunction(timingFunctionList[i % timingFunctionList.size()]);
    }
    // A zero-duration transition is no transition
    if (transition.duration > 0.0f) {
      transitions.push_back(transition);
    }
  }
  return transitions;
}

} // namespace facebook::react
