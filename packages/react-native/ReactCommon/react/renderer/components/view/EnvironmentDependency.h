/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <array>
#include <cstdlib>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include <react/renderer/core/EnvironmentValues.h>
#include <yoga/style/Style.h>

namespace facebook::react {

/*
 * Which Yoga style field an `env()` was written on, recorded as a target and a
 * slot rather than the property's name: the name is resolved while the props
 * are parsed, where a string comparison is already paid for, and layout writes
 * the resolved value straight into the style.
 */
enum class EnvironmentTarget {
  Padding,
  Margin,
  Position,
  Border,
  Gap,
  Dimension,
  MinDimension,
  MaxDimension,
  FlexBasis,
};

// One `env()` occurrence on one element
struct EnvironmentDependency {
  EnvironmentVariable variable{};
  EnvironmentTarget target{};
  // A `yoga::Edge`, `yoga::Dimension` or `yoga::Gutter`, as `target` says; unused
  // by `FlexBasis`
  uint8_t slot{};
  // The second argument to `env()` (css-values-4 §5); zero when unwritten
  Float fallback{0};
  // From `calc(env(<name>) + <length>)`
  Float offset{0};

  bool operator==(const EnvironmentDependency &other) const = default;
};

inline void applyEnvironmentDependency(yoga::Style &style, const EnvironmentDependency &dependency, Float variable)
{
  const Float value = variable + dependency.offset;
  const auto length = yoga::StyleLength::points((float)value);
  const auto sizeLength = yoga::StyleSizeLength::points((float)value);
  switch (dependency.target) {
    case EnvironmentTarget::Padding:
      style.setPadding((yoga::Edge)dependency.slot, length);
      return;
    case EnvironmentTarget::Margin:
      style.setMargin((yoga::Edge)dependency.slot, length);
      return;
    case EnvironmentTarget::Position:
      style.setPosition((yoga::Edge)dependency.slot, length);
      return;
    case EnvironmentTarget::Border:
      style.setBorder((yoga::Edge)dependency.slot, length);
      return;
    case EnvironmentTarget::Gap:
      style.setGap((yoga::Gutter)dependency.slot, length);
      return;
    case EnvironmentTarget::Dimension:
      style.setDimension((yoga::Dimension)dependency.slot, sizeLength);
      return;
    case EnvironmentTarget::MinDimension:
      style.setMinDimension((yoga::Dimension)dependency.slot, sizeLength);
      return;
    case EnvironmentTarget::MaxDimension:
      style.setMaxDimension((yoga::Dimension)dependency.slot, sizeLength);
      return;
    case EnvironmentTarget::FlexBasis:
      style.setFlexBasis(sizeLength);
      return;
  }
}

/*
 * Every length-valued Yoga property an `env()` may be written on, written out
 * so the answer to "can I use `env()` here" is a list. The `*Inline`/`*Block`
 * logical aliases are absent: they are resolved into edges a step later
 * (`applyAliasedProps`), against a writing mode layout is still deciding.
 */
struct EnvironmentTargetForProperty {
  std::string_view name;
  EnvironmentTarget target;
  uint8_t slot;
};

inline constexpr auto kEnvironmentTargets = std::to_array<EnvironmentTargetForProperty>({
    {"padding", EnvironmentTarget::Padding, (uint8_t)yoga::Edge::All},
    {"paddingLeft", EnvironmentTarget::Padding, (uint8_t)yoga::Edge::Left},
    {"paddingTop", EnvironmentTarget::Padding, (uint8_t)yoga::Edge::Top},
    {"paddingRight", EnvironmentTarget::Padding, (uint8_t)yoga::Edge::Right},
    {"paddingBottom", EnvironmentTarget::Padding, (uint8_t)yoga::Edge::Bottom},
    {"paddingStart", EnvironmentTarget::Padding, (uint8_t)yoga::Edge::Start},
    {"paddingEnd", EnvironmentTarget::Padding, (uint8_t)yoga::Edge::End},
    {"paddingHorizontal", EnvironmentTarget::Padding, (uint8_t)yoga::Edge::Horizontal},
    {"paddingVertical", EnvironmentTarget::Padding, (uint8_t)yoga::Edge::Vertical},

    {"margin", EnvironmentTarget::Margin, (uint8_t)yoga::Edge::All},
    {"marginLeft", EnvironmentTarget::Margin, (uint8_t)yoga::Edge::Left},
    {"marginTop", EnvironmentTarget::Margin, (uint8_t)yoga::Edge::Top},
    {"marginRight", EnvironmentTarget::Margin, (uint8_t)yoga::Edge::Right},
    {"marginBottom", EnvironmentTarget::Margin, (uint8_t)yoga::Edge::Bottom},
    {"marginStart", EnvironmentTarget::Margin, (uint8_t)yoga::Edge::Start},
    {"marginEnd", EnvironmentTarget::Margin, (uint8_t)yoga::Edge::End},
    {"marginHorizontal", EnvironmentTarget::Margin, (uint8_t)yoga::Edge::Horizontal},
    {"marginVertical", EnvironmentTarget::Margin, (uint8_t)yoga::Edge::Vertical},

    {"left", EnvironmentTarget::Position, (uint8_t)yoga::Edge::Left},
    {"top", EnvironmentTarget::Position, (uint8_t)yoga::Edge::Top},
    {"right", EnvironmentTarget::Position, (uint8_t)yoga::Edge::Right},
    {"bottom", EnvironmentTarget::Position, (uint8_t)yoga::Edge::Bottom},
    {"start", EnvironmentTarget::Position, (uint8_t)yoga::Edge::Start},
    {"end", EnvironmentTarget::Position, (uint8_t)yoga::Edge::End},
    {"inset", EnvironmentTarget::Position, (uint8_t)yoga::Edge::All},

    {"borderWidth", EnvironmentTarget::Border, (uint8_t)yoga::Edge::All},
    {"borderLeftWidth", EnvironmentTarget::Border, (uint8_t)yoga::Edge::Left},
    {"borderTopWidth", EnvironmentTarget::Border, (uint8_t)yoga::Edge::Top},
    {"borderRightWidth", EnvironmentTarget::Border, (uint8_t)yoga::Edge::Right},
    {"borderBottomWidth", EnvironmentTarget::Border, (uint8_t)yoga::Edge::Bottom},
    {"borderStartWidth", EnvironmentTarget::Border, (uint8_t)yoga::Edge::Start},
    {"borderEndWidth", EnvironmentTarget::Border, (uint8_t)yoga::Edge::End},

    {"gap", EnvironmentTarget::Gap, (uint8_t)yoga::Gutter::All},
    {"rowGap", EnvironmentTarget::Gap, (uint8_t)yoga::Gutter::Row},
    {"columnGap", EnvironmentTarget::Gap, (uint8_t)yoga::Gutter::Column},

    {"width", EnvironmentTarget::Dimension, (uint8_t)yoga::Dimension::Width},
    {"height", EnvironmentTarget::Dimension, (uint8_t)yoga::Dimension::Height},
    {"minWidth", EnvironmentTarget::MinDimension, (uint8_t)yoga::Dimension::Width},
    {"minHeight", EnvironmentTarget::MinDimension, (uint8_t)yoga::Dimension::Height},
    {"maxWidth", EnvironmentTarget::MaxDimension, (uint8_t)yoga::Dimension::Width},
    {"maxHeight", EnvironmentTarget::MaxDimension, (uint8_t)yoga::Dimension::Height},

    {"flexBasis", EnvironmentTarget::FlexBasis, 0},
});

inline std::optional<EnvironmentTargetForProperty> environmentTargetForProperty(std::string_view name)
{
  for (const auto &entry : kEnvironmentTargets) {
    if (entry.name == name) {
      return entry;
    }
  }
  return std::nullopt;
}

inline std::string_view trimAsciiWhitespace(std::string_view text)
{
  const auto first = text.find_first_not_of(" \t\r\n\f");
  if (first == std::string_view::npos) {
    return {};
  }
  const auto last = text.find_last_not_of(" \t\r\n\f");
  return text.substr(first, last - first + 1);
}

// A parsed `env()`: the variable, its fallback, and a length added to it
struct EnvironmentValue {
  EnvironmentVariable variable{};
  Float fallback{0};
  Float offset{0};
};

// `8px` or `8`, as a whole string
inline std::optional<Float> parsePixelLength(std::string_view text)
{
  auto number = trimAsciiWhitespace(text);
  if (number.ends_with("px")) {
    number = trimAsciiWhitespace(number.substr(0, number.size() - 2));
  }
  char *end = nullptr;
  const std::string string{number};
  const auto parsed = std::strtod(string.c_str(), &end);
  if (string.empty() || end != string.c_str() + string.size()) {
    return std::nullopt;
  }
  return (Float)parsed;
}

// `env(<name>)` or `env(<name>, <fallback>)`, as a whole value
inline std::optional<EnvironmentValue> parseEnvironmentFunction(std::string_view value)
{
  constexpr std::string_view prefix{"env("};
  const auto trimmed = trimAsciiWhitespace(value);
  if (!trimmed.starts_with(prefix) || !trimmed.ends_with(")")) {
    return std::nullopt;
  }

  auto inner = trimmed.substr(prefix.size(), trimmed.size() - prefix.size() - 1);
  auto name = inner;
  Float fallback = 0;

  if (const auto comma = inner.find(','); comma != std::string_view::npos) {
    name = inner.substr(0, comma);
    // An unparseable fallback keeps zero rather than rejecting the declaration
    fallback = parsePixelLength(inner.substr(comma + 1)).value_or(0);
  }

  const auto variable = environmentVariableFromName(trimAsciiWhitespace(name));
  if (!variable.has_value()) {
    return std::nullopt;
  }
  return EnvironmentValue{.variable = *variable, .fallback = fallback};
}

/*
 * `env()` on its own, or `calc()` adding or subtracting a pixel length
 * (`calc(env(safe-area-inset-bottom) + 8px)`, `calc(8px + env(…))`).
 * DOM-CSS-LIMITATION(env-calc-is-an-offset): no other `calc()` around an
 * `env()` is understood, nor `min()`, `max()` or `clamp()`; such a value
 * computes to nothing. `std::nullopt` for anything that is not an `env()`.
 */
inline std::optional<EnvironmentValue> parseEnvironmentValue(std::string_view value)
{
  constexpr std::string_view calc{"calc("};
  const auto trimmed = trimAsciiWhitespace(value);
  if (!trimmed.starts_with(calc) || !trimmed.ends_with(")")) {
    return parseEnvironmentFunction(trimmed);
  }
  const auto inner = trimAsciiWhitespace(trimmed.substr(calc.size(), trimmed.size() - calc.size() - 1));
  const auto envStart = inner.find("env(");
  const auto envEnd = envStart == std::string_view::npos ? envStart : inner.find(')', envStart);
  if (envEnd == std::string_view::npos) {
    return std::nullopt;
  }
  auto environment = parseEnvironmentFunction(inner.substr(envStart, envEnd - envStart + 1));
  if (!environment.has_value()) {
    return std::nullopt;
  }
  const auto before = trimAsciiWhitespace(inner.substr(0, envStart));
  const auto after = trimAsciiWhitespace(inner.substr(envEnd + 1));
  std::optional<Float> offset;
  if (before.empty() && (after.starts_with('+') || after.starts_with('-'))) {
    offset = parsePixelLength(after.substr(1));
    if (offset.has_value() && after.starts_with('-')) {
      offset = -*offset;
    }
  } else if (after.empty() && before.ends_with('+')) {
    offset = parsePixelLength(before.substr(0, before.size() - 1));
  }
  if (!offset.has_value()) {
    return std::nullopt;
  }
  environment->offset = *offset;
  return environment;
}

/*
 * Where a conversion in progress reports the `env()`s it finds. A thread-local
 * rather than a parameter because `fromRawValue` sees the value and only
 * `convertRawProp`, one frame up and generic over every prop, knows the
 * property. Null except while a `YogaStylableProps` is being built.
 */
inline thread_local std::vector<EnvironmentDependency> *currentEnvironmentCollector = nullptr;

} // namespace facebook::react
