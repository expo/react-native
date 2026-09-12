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
 * Which Yoga style field an `env()` was written on.
 *
 * Recorded as a target and a slot rather than as the property's name, because
 * the name has to be turned into a field SOMEWHERE and doing it while the props
 * are being parsed is the one moment a string comparison is already being paid
 * for. Layout then writes the resolved value straight into the style with no
 * lookup, no parser context, and no second copy of the property list.
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

/*
 * One `env()` occurrence on one element.
 */
struct EnvironmentDependency {
  EnvironmentVariable variable{};
  EnvironmentTarget target{};
  /*
   * A `yoga::Edge`, `yoga::Dimension` or `yoga::Gutter` depending on `target`,
   * held as its index because the three are different types and which one this
   * is, is already said by `target`. Unused by `FlexBasis`.
   */
  uint8_t slot{};
  /*
   * css-values-4 §5: the second argument to `env()`. Zero when unwritten, which
   * is also the right answer for a device with no inset to report.
   */
  Float fallback{0};

  bool operator==(const EnvironmentDependency& other) const = default;
};

/*
 * Writes a resolved `env()` into the style.
 */
inline void applyEnvironmentDependency(yoga::Style& style, const EnvironmentDependency& dependency, Float value)
{
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
 * The properties an `env()` may be written on, and where each one lands.
 *
 * Every length-valued Yoga property, which is the whole set `env()` can mean
 * anything on: it resolves to a length, so a property that does not take one
 * has nothing to do with it. Written out rather than derived so that the answer
 * to "can I use `env()` here" is a list somebody can read.
 *
 * Not here, deliberately: the `*Inline`/`*Block` logical aliases and
 * `*Horizontal`/`*Vertical`, which are not Yoga fields but props resolved into
 * edges a step later (see `applyAliasedProps`). An `env()` on one of those
 * would have to be re-resolved at layout, against a writing mode that layout is
 * in the middle of deciding.
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
  for (const auto& entry : kEnvironmentTargets) {
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

/*
 * Parses `env(<name>)` or `env(<name>, <fallback>)`.
 *
 * Deliberately narrow: an `env()` that is not the WHOLE value is not
 * recognised, so `calc(env(safe-area-inset-bottom) + 8px)` parses as nothing
 * rather than as something almost right. A value that silently lost half its
 * expression would be worse than one that is visibly missing.
 *
 * DOM-CSS-LIMITATION(no-env-inside-calc): `env()` may not appear inside
 * `calc()`, so `calc(env(safe-area-inset-bottom) + 8px)` computes to nothing at
 * all. Closing it means a `calc()` evaluator for style lengths — which does not
 * exist here for any value, not just this one — plus a way to carry the
 * unevaluated expression to layout, where the `env()` is finally known.
 *
 * Returns `std::nullopt` for anything that is not an `env()`, which is the
 * common case — every ordinary string length reaches here too.
 */
inline std::optional<std::pair<EnvironmentVariable, Float>> parseEnvironmentValue(std::string_view value)
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
    auto number = trimAsciiWhitespace(inner.substr(comma + 1));
    if (number.ends_with("px")) {
      number = number.substr(0, number.size() - 2);
    }
    number = trimAsciiWhitespace(number);
    // An unparseable fallback keeps zero rather than rejecting the whole
    // declaration, so a typo in the safety net does not take the value with it.
    char* end = nullptr;
    const std::string text{number};
    const auto parsed = std::strtod(text.c_str(), &end);
    if (end != text.c_str() && *end == '\0') {
      fallback = (Float)parsed;
    }
  }

  const auto variable = environmentVariableFromName(trimAsciiWhitespace(name));
  if (!variable.has_value()) {
    return std::nullopt;
  }
  return std::make_pair(*variable, fallback);
}

/*
 * Where a conversion in progress reports the `env()`s it finds.
 *
 * A thread-local rather than a parameter because the value and the property it
 * was written on are seen by two different functions: `fromRawValue` is handed
 * the value and has no idea which property it belongs to, and only
 * `convertRawProp` — one frame up, and generic over every prop in the renderer
 * — knows the name. Threading a collector through the whole conversion API to
 * reach two length converters would touch every prop of every component.
 *
 * Null except while a `YogaStylableProps` is being built, so nothing else in
 * the renderer can be surprised by it.
 */
inline thread_local std::vector<EnvironmentDependency>* currentEnvironmentCollector = nullptr;

} // namespace facebook::react
