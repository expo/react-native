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
#include <cmath>
#include <optional>
#include <cstdint>

namespace facebook::react {

using Color = int32_t;

namespace HostPlatformColor {
constexpr facebook::react::Color UndefinedColor = 0;
}

inline Color hostPlatformColorFromRGBA(uint8_t r, uint8_t g, uint8_t b, uint8_t a)
{
  return (a & 0xff) << 24 | (r & 0xff) << 16 | (g & 0xff) << 8 | (b & 0xff);
}

inline Color hostPlatformColorFromComponents(ColorComponents components)
{
  float ratio = 255;
  auto channel = [&](float value) { return static_cast<uint8_t>(std::round(std::clamp(value, 0.0f, 1.0f) * ratio)); };
  return hostPlatformColorFromRGBA(
      channel(components.red), channel(components.green), channel(components.blue), channel(components.alpha));
}

/*
 * This host draws 8-bit sRGB only, so a color in another space is converted
 * by CSS's arithmetic and clipped to sRGB, and a space CSS doesn't define
 * can't be shown
 */
// An 8-bit host color keeps no color space, so it is always sRGB
inline bool hostPlatformColorIsColorSpaceColor(const Color & /*color*/)
{
  return false;
}

inline Color hostPlatformColorFromColorSpaceValue(const ColorSpaceValue &value)
{
  auto components = toClippedSRGB(value);
  return components.has_value() ? hostPlatformColorFromComponents(*components) : HostPlatformColor::UndefinedColor;
}

inline float alphaFromHostPlatformColor(Color color)
{
  return static_cast<float>((color >> 24) & 0xff);
}

inline float redFromHostPlatformColor(Color color)
{
  return static_cast<float>((color >> 16) & 0xff);
}

inline float greenFromHostPlatformColor(Color color)
{
  return static_cast<float>((color >> 8) & 0xff);
}

inline float blueFromHostPlatformColor(Color color)
{
  return static_cast<uint8_t>((color >> 0) & 0xff);
}

inline bool hostPlatformColorIsColorMeaningful(Color color) noexcept
{
  return alphaFromHostPlatformColor(color) > 0;
}

inline ColorComponents colorComponentsFromHostPlatformColor(Color color)
{
  float ratio = 255;
  return ColorComponents{
      .red = static_cast<float>(redFromHostPlatformColor(color)) / ratio,
      .green = static_cast<float>(greenFromHostPlatformColor(color)) / ratio,
      .blue = static_cast<float>(blueFromHostPlatformColor(color)) / ratio,
      .alpha = static_cast<float>(alphaFromHostPlatformColor(color)) / ratio};
}

inline Color hostPlatformColorFromTransientColorSpaceValue(const ColorSpaceValue &value)
{
  return hostPlatformColorFromColorSpaceValue(value);
}

} // namespace facebook::react
