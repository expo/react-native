/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include <react/renderer/graphics/fromRawValueShared.h>

#include <react/debug/react_native_expect.h>
#include <react/featureflags/ReactNativeFeatureFlags.h>
#include <react/renderer/css/CSSColor.h>
#include <react/renderer/css/CSSValueParser.h>
#include <react/renderer/graphics/ColorSpaceValue.h>

#include <algorithm>
#include <optional>

namespace facebook::react {

namespace {

std::optional<float> numberField(
    const std::unordered_map<std::string, RawValue>& items,
    const char* key) {
  auto item = items.find(key);
  if (item == items.end() || !item->second.hasType<double>()) {
    return std::nullopt;
  }
  return static_cast<float>((double)item->second);
}

// `processColor`'s object: the space's name, the channels by CSS's relative
// color names (r g b, l a b, l c h, x y z) and `alpha`; an RGB object may
// spell alpha `a`, as the earlier Display P3 objects do
std::optional<ColorSpaceValue> colorSpaceValueFromRawValue(
    const std::unordered_map<std::string, RawValue>& items) {
  const auto& spaceItem = items.at("space");
  if (!spaceItem.hasType<std::string>()) {
    return std::nullopt;
  }
  auto space = colorSpaceFromName((std::string)spaceItem);
  if (!space.has_value()) {
    return std::nullopt;
  }
  std::array<const char*, 3> names;
  switch (colorModelOf(*space)) {
    case ColorModel::RGB:
      names = {"r", "g", "b"};
      break;
    case ColorModel::Lab:
      names = {"l", "a", "b"};
      break;
    case ColorModel::LCH:
      names = {"l", "c", "h"};
      break;
    case ColorModel::XYZ:
      names = {"x", "y", "z"};
      break;
  }
  ColorSpaceValue value{.space = *space};
  for (size_t index = 0; index < names.size(); index++) {
    auto channel = numberField(items, names[index]);
    if (!channel.has_value()) {
      return std::nullopt;
    }
    value.channels[index] = *channel;
  }
  auto alpha = numberField(items, "alpha");
  if (!alpha.has_value() && colorModelOf(*space) == ColorModel::RGB) {
    alpha = numberField(items, "a");
  }
  value.alpha = std::clamp(alpha.value_or(1.0f), 0.0f, 1.0f);
  return value;
}

} // namespace

void fromRawValueShared(
    const ContextContainer& contextContainer,
    int32_t surfaceId,
    const RawValue& value,
    SharedColor& result,
    parsePlatformColorFn parsePlatformColor) {
  ColorComponents colorComponents = {
      .red = 0, .green = 0, .blue = 0, .alpha = 0};

  if (ReactNativeFeatureFlags::enableNativeCSSParsing() &&
      value.hasType<std::string>()) {
    auto cssColor = parseCSSProperty<CSSColor>((std::string)value);
    if (std::holds_alternative<CSSColor>(cssColor)) {
      auto c = std::get<CSSColor>(cssColor);
      result = hostPlatformColorFromRGBA(c.r, c.g, c.b, c.a);
      return;
    }
    // Unparseable string - fall through to parsePlatformColor
    result = parsePlatformColor(contextContainer, surfaceId, value);
  } else if (value.hasType<int>()) {
    auto argb = (int64_t)value;
    auto ratio = 255.f;
    colorComponents.alpha = ((argb >> 24) & 0xFF) / ratio;
    colorComponents.red = ((argb >> 16) & 0xFF) / ratio;
    colorComponents.green = ((argb >> 8) & 0xFF) / ratio;
    colorComponents.blue = (argb & 0xFF) / ratio;
    // An integer is untagged, so sRGB (CSS Color 4 §4.1), whatever the
    // default space says
    if (ReactNativeFeatureFlags::enableColorSpaces()) {
      colorComponents.colorSpace = ColorSpace::sRGB;
    }

    result = colorFromComponents(colorComponents);
  } else if (value.hasType<std::vector<float>>()) {
    auto items = (std::vector<float>)value;
    auto length = items.size();
    react_native_expect(length == 3 || length == 4);
    colorComponents.red = items.at(0);
    colorComponents.green = items.at(1);
    colorComponents.blue = items.at(2);
    colorComponents.alpha = length == 4 ? items.at(3) : 1.0f;

    result = colorFromComponents(colorComponents);
  } else {
    if (value.hasType<std::unordered_map<std::string, RawValue>>()) {
      const auto& items = (std::unordered_map<std::string, RawValue>)value;
      if (items.find("space") != items.end()) {
        if (ReactNativeFeatureFlags::enableColorSpaces()) {
          auto colorSpaceValue = colorSpaceValueFromRawValue(items);
          result = colorSpaceValue.has_value()
              ? colorFromColorSpaceValue(*colorSpaceValue)
              : SharedColor{};
          return;
        }
        colorComponents.red = (float)items.at("r");
        colorComponents.green = (float)items.at("g");
        colorComponents.blue = (float)items.at("b");
        colorComponents.alpha = (float)items.at("a");
        colorComponents.colorSpace = getDefaultColorSpace();
        std::string space = (std::string)items.at("space");
        if (space == "display-p3") {
          colorComponents.colorSpace = ColorSpace::DisplayP3;
        } else if (space == "srgb") {
          colorComponents.colorSpace = ColorSpace::sRGB;
        }
        result = colorFromComponents(colorComponents);
        return;
      }
    }
    result = parsePlatformColor(contextContainer, surfaceId, value);
  }
}

} // namespace facebook::react
