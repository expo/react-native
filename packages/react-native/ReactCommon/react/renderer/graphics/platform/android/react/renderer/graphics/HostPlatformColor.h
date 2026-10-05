/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/cxxstableapi/UmbrellaGuard.h>

#include <react/renderer/graphics/ColorComponents.h>
#include <react/renderer/graphics/ColorSpaceValue.h>
#include <algorithm>
#include <mutex>
#include <optional>
#include <unordered_map>
#include <vector>
#include <react/utils/hash_combine.h>
#include <cmath>
#include <cstdint>

#ifdef RN_SERIALIZABLE_STATE
#include <folly/dynamic.h>
#endif

namespace facebook::react {

struct Color {
  int32_t value{0};
  bool isDefined{false};
  // Index plus one into `ColorSpaceValues` for a color in its own space, 0
  // for sRGB; `value` is its sRGB approximation. In the padding, so a color
  // stays 8 bytes.
  uint16_t colorSpaceValueIndex{0};

  constexpr Color() = default;
  constexpr Color(int32_t colorValue) : value(colorValue), isDefined(true) {}

  constexpr bool operator==(const Color &otherColor) const
  {
    return value == otherColor.value && isDefined == otherColor.isDefined &&
        colorSpaceValueIndex == otherColor.colorSpaceValueIndex;
  }

  constexpr bool operator!=(const Color &otherColor) const
  {
    return !(*this == otherColor);
  }

  constexpr operator int32_t() const
  {
    return value;
  }

#ifdef RN_SERIALIZABLE_STATE
  operator folly::dynamic() const
  {
    return value;
  }
#endif
};

namespace HostPlatformColor {
constexpr facebook::react::Color UndefinedColor{};
}

inline Color hostPlatformColorFromRGBA(uint8_t r, uint8_t g, uint8_t b, uint8_t a)
{
  return Color{(a & 0xff) << 24 | (r & 0xff) << 16 | (g & 0xff) << 8 | (b & 0xff)};
}

inline Color hostPlatformColorFromComponents(ColorComponents components)
{
  float ratio = 255;
  return Color{
      ((int)round(components.alpha * ratio) & 0xff) << 24 | ((int)round(components.red * ratio) & 0xff) << 16 |
      ((int)round(components.green * ratio) & 0xff) << 8 | ((int)round(components.blue * ratio) & 0xff)};
}

// The colors in their own spaces this process has parsed, interned once so a
// `Color` can name one with 16 bits; a gradient's computed stops are rounded
// so a redraw finds the same ones
class ColorSpaceValues {
 public:
  static constexpr size_t kCapacity = 65535;

  // The color's index plus one, or 0 when it can't be kept
  static uint16_t intern(const ColorSpaceValue &value)
  {
    for (float channel : value.channels) {
      if (!std::isfinite(channel)) {
        return 0;
      }
    }
    if (!std::isfinite(value.alpha)) {
      return 0;
    }
    std::lock_guard<std::mutex> lock(mutex());
    auto &table = state();
    auto found = table.indices.find(value);
    if (found != table.indices.end()) {
      return found->second;
    }
    if (table.values.size() >= kCapacity) {
      return 0;
    }
    table.values.push_back(value);
    auto index = static_cast<uint16_t>(table.values.size());
    table.indices.emplace(value, index);
    return index;
  }

  static std::optional<ColorSpaceValue> get(uint16_t indexPlusOne)
  {
    if (indexPlusOne == 0) {
      return std::nullopt;
    }
    std::lock_guard<std::mutex> lock(mutex());
    const auto &values = state().values;
    return indexPlusOne <= values.size() ? std::optional(values[indexPlusOne - 1]) : std::nullopt;
  }

 private:
  struct Hash {
    size_t operator()(const ColorSpaceValue &value) const
    {
      return facebook::react::hash_combine(
          static_cast<int>(value.space), value.channels[0], value.channels[1], value.channels[2], value.alpha);
    }
  };

  struct Table {
    std::vector<ColorSpaceValue> values;
    std::unordered_map<ColorSpaceValue, uint16_t, Hash> indices;
  };

  static Table &state()
  {
    static Table table;
    return table;
  }

  static std::mutex &mutex()
  {
    static std::mutex lock;
    return lock;
  }
};

inline bool hostPlatformColorIsColorSpaceColor(const Color &color)
{
  return color.colorSpaceValueIndex != 0;
}

// The integer is the sRGB approximation, for readers of integers; the color
// itself is kept in `ColorSpaceValues` for readers that draw its space (text)
inline Color hostPlatformColorFromColorSpaceValue(const ColorSpaceValue &value)
{
  // A dashed space has no sRGB approximation here; its integer is transparent
  auto components = toClippedSRGB(value);
  Color color =
      components.has_value() ? hostPlatformColorFromComponents(*components) : hostPlatformColorFromRGBA(0, 0, 0, 0);
  // Past the table's capacity the color is its approximation.
  // DOM-CSS-LIMITATION(android-color-table-is-finite)
  color.colorSpaceValueIndex = ColorSpaceValues::intern(value);
  if (!components.has_value() && color.colorSpaceValueIndex == 0) {
    return HostPlatformColor::UndefinedColor;
  }
  return color;
}

/*
 * A color that exists for one frame, such as a transition's: its sRGB
 * approximation only, so frames don't fill `ColorSpaceValues`.
 * DOM-CSS-LIMITATION(android-transition-frames-are-srgb)
 */
inline Color hostPlatformColorFromTransientColorSpaceValue(const ColorSpaceValue &value)
{
  auto components = toClippedSRGB(value);
  return components.has_value() ? hostPlatformColorFromComponents(*components) : HostPlatformColor::UndefinedColor;
}

inline ColorComponents colorComponentsFromHostPlatformColor(Color color)
{
  float ratio = 255;
  return ColorComponents{
      .red = (float)((color.value >> 16) & 0xff) / ratio,
      .green = (float)((color.value >> 8) & 0xff) / ratio,
      .blue = (float)((color.value >> 0) & 0xff) / ratio,
      .alpha = (float)((color.value >> 24) & 0xff) / ratio};
}

inline float alphaFromHostPlatformColor(Color color)
{
  return static_cast<float>((color.value >> 24) & 0xff);
}

inline float redFromHostPlatformColor(Color color)
{
  return static_cast<float>((color.value >> 16) & 0xff);
}

inline float greenFromHostPlatformColor(Color color)
{
  return static_cast<float>((color.value >> 8) & 0xff);
}

inline float blueFromHostPlatformColor(Color color)
{
  return static_cast<uint8_t>((color.value >> 0) & 0xff);
}

inline bool hostPlatformColorIsColorMeaningful(Color color) noexcept
{
  // A dashed space's integer stand-in is transparent; its own alpha decides
  if (color.colorSpaceValueIndex != 0) {
    auto value = ColorSpaceValues::get(color.colorSpaceValueIndex);
    return value.has_value() && value->alpha > 0;
  }
  return alphaFromHostPlatformColor(color) > 0;
}

inline std::optional<ColorSpaceValue> hostPlatformColorSpaceValueOf(const Color &color)
{
  return ColorSpaceValues::get(color.colorSpaceValueIndex);
}

} // namespace facebook::react

template <>
struct std::hash<facebook::react::Color> {
  size_t operator()(const facebook::react::Color &color) const
  {
    return facebook::react::hash_combine(color.value, color.isDefined, color.colorSpaceValueIndex);
  }
};
