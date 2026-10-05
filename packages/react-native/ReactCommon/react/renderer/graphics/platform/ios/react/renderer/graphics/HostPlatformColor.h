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
#include <react/utils/hash_combine.h>
#include <CoreGraphics/CGColorSpace.h>
#include <cmath>
#include <optional>

namespace facebook::react {

struct DynamicColor {
  int32_t lightColor = 0;
  int32_t darkColor = 0;
  int32_t highContrastLightColor = 0;
  int32_t highContrastDarkColor = 0;
};

struct Color {
  Color(int32_t color);
  Color(const DynamicColor &dynamicColor);
  Color(const ColorComponents &components);
  // A color in its own space, in the CGColorSpace the OS resolves for it
  Color(const ColorSpaceValue &value);
  // Whether the color was written in its own color space rather than as sRGB
  bool isColorSpaceColor() const
  {
    return uiColor_ != nullptr && (uiColorHashValue_ & kColorSpaceColorBit) != 0;
  }
  Color() : uiColor_(nullptr) {};
  int32_t getColor() const;
  std::size_t getUIColorHash() const;

  // Returns the UndefinedColor sentinel (null underlying UIColor) on a miss, so
  // callers can tell a miss from a name that resolves to transparent. Callers
  // reaching into getUIColor() must null-check it.
  static Color createSemanticColor(std::vector<std::string> &semanticItems);

  // `DynamicColorIOS`: one of four colors by appearance and contrast
  static Color createDynamicColor(
      const Color &light,
      const Color &dark,
      const Color &highContrastLight,
      const Color &highContrastDark);

  std::shared_ptr<void> getUIColor() const
  {
    return uiColor_;
  }

  float getChannel(int channelId) const;

  // Extended-range sRGB floats matched by Core Graphics with color spaces on;
  // through the 8-bit integer otherwise
  ColorComponents getColorComponents() const;
  bool operator==(const Color &other) const;
  bool operator!=(const Color &other) const;
  operator int32_t() const
  {
    return getColor();
  }

 private:
  Color(std::shared_ptr<void> uiColor);
  std::shared_ptr<void> uiColor_;
  // The color's hash, whose top bit says whether it is a color space color:
  // kept in the hash so that the struct, which every color prop holds, doesn't
  // grow, and so that two colors that differ only in it aren't equal
  std::size_t uiColorHashValue_;
  static constexpr std::size_t kColorSpaceColorBit = std::size_t{1} << (sizeof(std::size_t) * 8 - 1);
};

/*
 * The OS's color space for `space`, asked once per space and kept: null when
 * this device's OS has no such space. Defined in HostPlatformColor.mm.
 */
CGColorSpaceRef _Nullable platformColorSpaceFor(ColorSpace space);


namespace HostPlatformColor {

#if defined(__clang__)
#define NO_DESTROY [[clang::no_destroy]]
#else
#define NO_DESTROY
#endif

NO_DESTROY static const facebook::react::Color UndefinedColor = Color();
} // namespace HostPlatformColor

inline Color hostPlatformColorFromRGBA(uint8_t r, uint8_t g, uint8_t b, uint8_t a)
{
  float ratio = 255;
  const auto colorComponents = ColorComponents{
      .red = r / ratio,
      .green = g / ratio,
      .blue = b / ratio,
      .alpha = a / ratio,
  };
  return Color(colorComponents);
}

inline Color hostPlatformColorFromComponents(ColorComponents components)
{
  return Color(components);
}

inline Color hostPlatformColorFromColorSpaceValue(const ColorSpaceValue &value)
{
  return Color(value);
}

inline bool hostPlatformColorIsColorSpaceColor(const Color &color)
{
  return color.isColorSpaceColor();
}

inline ColorComponents colorComponentsFromHostPlatformColor(Color color)
{
  return color.getColorComponents();
}

inline float alphaFromHostPlatformColor(Color color)
{
  return color.getChannel(3) * 255;
}

inline float redFromHostPlatformColor(Color color)
{
  return color.getChannel(0) * 255;
}

inline float greenFromHostPlatformColor(Color color)
{
  return color.getChannel(1) * 255;
}

inline float blueFromHostPlatformColor(Color color)
{
  return color.getChannel(2) * 255;
}

inline bool hostPlatformColorIsColorMeaningful(Color color) noexcept
{
  return alphaFromHostPlatformColor(color) > 0;
}

inline Color hostPlatformColorFromTransientColorSpaceValue(const ColorSpaceValue &value)
{
  return hostPlatformColorFromColorSpaceValue(value);
}

inline std::optional<ColorSpaceValue> hostPlatformColorSpaceValueOf(const Color & /*color*/)
{
  return std::nullopt;
}

} // namespace facebook::react

template <>
struct std::hash<facebook::react::Color> {
  size_t operator()(const facebook::react::Color &color) const
  {
    return color.getUIColorHash();
  }
};
