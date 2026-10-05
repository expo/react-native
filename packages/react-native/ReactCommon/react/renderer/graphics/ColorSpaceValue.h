/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/cxxstableapi/UmbrellaGuard.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <optional>
#include <string_view>

#include <react/renderer/graphics/ColorComponents.h>

namespace facebook::react {

enum class ColorModel { RGB, Lab, LCH, XYZ };

// A color in the space it was written in: the model's channels in CSS's
// order (r g b, l a b, l c h, x y z), unclipped
struct ColorSpaceValue {
  ColorSpace space{ColorSpace::sRGB};
  std::array<float, 3> channels{};
  float alpha{1};

  bool operator==(const ColorSpaceValue &other) const = default;
};

struct ColorSpaceDescription {
  std::string_view name;
  ColorSpace space;
  ColorModel model;
};

// CSS Color 4 and CSS Color HDR's names, and dashed names for the spaces CSS
// doesn't predefine; which of them a device can show is asked at run time
inline constexpr std::array<ColorSpaceDescription, 30> kColorSpaces{{
    {"srgb", ColorSpace::sRGB, ColorModel::RGB},
    {"display-p3", ColorSpace::DisplayP3, ColorModel::RGB},
    {"srgb-linear", ColorSpace::SRGBLinear, ColorModel::RGB},
    {"display-p3-linear", ColorSpace::DisplayP3Linear, ColorModel::RGB},
    {"a98-rgb", ColorSpace::A98RGB, ColorModel::RGB},
    {"prophoto-rgb", ColorSpace::ProPhotoRGB, ColorModel::RGB},
    {"rec2020", ColorSpace::Rec2020, ColorModel::RGB},
    {"rec2100-pq", ColorSpace::Rec2100PQ, ColorModel::RGB},
    {"rec2100-hlg", ColorSpace::Rec2100HLG, ColorModel::RGB},
    {"rec2100-linear", ColorSpace::Rec2100Linear, ColorModel::RGB},
    {"xyz-d50", ColorSpace::XYZD50, ColorModel::XYZ},
    {"xyz-d65", ColorSpace::XYZD65, ColorModel::XYZ},
    {"lab", ColorSpace::Lab, ColorModel::Lab},
    {"lch", ColorSpace::LCH, ColorModel::LCH},
    {"oklab", ColorSpace::OKLab, ColorModel::Lab},
    {"oklch", ColorSpace::OKLCH, ColorModel::LCH},
    {"--dci-p3", ColorSpace::DCIP3, ColorModel::RGB},
    {"--rec709", ColorSpace::Rec709, ColorModel::RGB},
    {"--rec2020-srgb-transfer", ColorSpace::Rec2020SRGBTransfer, ColorModel::RGB},
    {"--rec2020-linear", ColorSpace::Rec2020Linear, ColorModel::RGB},
    {"--display-p3-pq", ColorSpace::DisplayP3PQ, ColorModel::RGB},
    {"--display-p3-hlg", ColorSpace::DisplayP3HLG, ColorModel::RGB},
    {"--rec709-pq", ColorSpace::Rec709PQ, ColorModel::RGB},
    {"--rec709-hlg", ColorSpace::Rec709HLG, ColorModel::RGB},
    {"--aces", ColorSpace::ACES, ColorModel::RGB},
    {"--aces-cg", ColorSpace::ACEScg, ColorModel::RGB},
    {"--ntsc-1953", ColorSpace::NTSC1953, ColorModel::RGB},
    {"--smpte-c", ColorSpace::SMPTEC, ColorModel::RGB},
    {"--gray-gamma-2.2", ColorSpace::GrayGamma22, ColorModel::RGB},
    {"--gray-linear", ColorSpace::GrayLinear, ColorModel::RGB},
}};

inline const ColorSpaceDescription *describeColorSpace(ColorSpace space)
{
  for (const auto &description : kColorSpaces) {
    if (description.space == space) {
      return &description;
    }
  }
  return nullptr;
}

inline std::optional<ColorSpace> colorSpaceFromName(std::string_view name)
{
  for (const auto &description : kColorSpaces) {
    if (description.name == name) {
      return description.space;
    }
  }
  return std::nullopt;
}

inline ColorModel colorModelOf(ColorSpace space)
{
  const auto *description = describeColorSpace(space);
  return description != nullptr ? description->model : ColorModel::RGB;
}

// CSS Color 4 §10's conversions (CSS Color HDR's for rec2100), for the spaces
// CSS defines; not color management
namespace colorspace {

using Vector3 = std::array<double, 3>;
using Matrix3 = std::array<Vector3, 3>;

inline Vector3 multiply(const Matrix3 &m, const Vector3 &v)
{
  return {
      m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
      m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
      m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  };
}

inline constexpr Matrix3 kXYZD65ToLinearSRGB{{
    {3.2409699419045226, -1.537383177570094, -0.4986107602930034},
    {-0.9692436362808796, 1.8759675015077202, 0.04155505740717559},
    {0.05563007969699366, -0.20397695888897652, 1.0569715142428786},
}};

inline constexpr Matrix3 kLinearSRGBToXYZD65{{
    {0.41239079926595934, 0.357584339383878, 0.1804807884018343},
    {0.21263900587151027, 0.715168678767756, 0.07219231536073371},
    {0.01933081871559182, 0.11919477979462598, 0.9505321522496607},
}};

inline constexpr Matrix3 kLinearDisplayP3ToXYZD65{{
    {0.4865709486482162, 0.26566769316909306, 0.1982172852343625},
    {0.2289745640697488, 0.6917385218365064, 0.079286914093745},
    {0.0, 0.04511338185890264, 1.043944368900976},
}};

inline constexpr Matrix3 kLinearA98RGBToXYZD65{{
    {0.5766690429101305, 0.1855582379065463, 0.1882286462349947},
    {0.29734497525053605, 0.6273635662554661, 0.07529145849399788},
    {0.02703136138641234, 0.07068885253582723, 0.9913375368376388},
}};

inline constexpr Matrix3 kLinearProPhotoToXYZD50{{
    {0.7977666449006423, 0.13518129740053308, 0.0313477341283922},
    {0.2880748288194013, 0.711835234241873, 0.00008993693872564},
    {0.0, 0.0, 0.8251046025104602},
}};

inline constexpr Matrix3 kLinearRec2020ToXYZD65{{
    {0.6369580483012914, 0.14461690358620832, 0.1688809751641721},
    {0.2627002120112671, 0.6779980715188708, 0.05930171646986196},
    {0.0, 0.028072693049087428, 1.060985057710791},
}};

// Bradford chromatic adaptation from the D50 white point to D65
inline constexpr Matrix3 kD50ToD65{{
    {0.955473421488075, -0.02309845494876471, 0.06325924320057072},
    {-0.0283697093338637, 1.0099953980813041, 0.021041441191917323},
    {0.012314014864481998, -0.020507649298898964, 1.330365926242124},
}};

inline constexpr Matrix3 kOKLabToLMS{{
    {1.0, 0.3963377773761749, 0.2158037573099136},
    {1.0, -0.1055613458156586, -0.0638541728258133},
    {1.0, -0.0894841775298119, -1.2914855480194092},
}};

inline constexpr Matrix3 kLMSToLinearSRGB{{
    {4.0767416360759583, -3.3077115392580629, 0.2309699031821043},
    {-1.2684379732850315, 2.6097573492876882, -0.3413193760026570},
    {-0.0041960761386756, -0.7034186179359363, 1.7076146940746117},
}};

// The D50 white point CSS uses for Lab and XYZ-D50
inline constexpr Vector3 kD50White{0.3457 / 0.3585, 1.0, (1.0 - 0.3457 - 0.3585) / 0.3585};

// sRGB's transfer, extended by symmetry to negative values (CSS Color 4 §10.2)
inline double srgbToLinear(double value)
{
  double magnitude = std::abs(value);
  double sign = value < 0 ? -1 : 1;
  return magnitude <= 0.04045 ? value / 12.92 : sign * std::pow((magnitude + 0.055) / 1.055, 2.4);
}

inline double linearToSRGB(double value)
{
  double magnitude = std::abs(value);
  double sign = value < 0 ? -1 : 1;
  return magnitude <= 0.0031308 ? value * 12.92 : sign * (1.055 * std::pow(magnitude, 1 / 2.4) - 0.055);
}

inline double a98ToLinear(double value)
{
  double sign = value < 0 ? -1 : 1;
  return sign * std::pow(std::abs(value), 563.0 / 256.0);
}

inline double proPhotoToLinear(double value)
{
  double magnitude = std::abs(value);
  double sign = value < 0 ? -1 : 1;
  return magnitude <= 16.0 / 512.0 ? value / 16.0 : sign * std::pow(magnitude, 1.8);
}

inline double rec2020ToLinear(double value)
{
  constexpr double alpha = 1.09929682680944;
  constexpr double beta = 0.018053968510807;
  double magnitude = std::abs(value);
  double sign = value < 0 ? -1 : 1;
  return magnitude < beta * 4.5 ? value / 4.5 : sign * std::pow((magnitude + alpha - 1) / alpha, 1 / 0.45);
}

/*
 * The PQ transfer (SMPTE ST 2084), scaled so that 1.0 is CSS Color HDR's
 * reference white of 203 cd/m²
 */
inline double pqToLinear(double value)
{
  constexpr double m1 = 2610.0 / 16384.0;
  constexpr double m2 = 2523.0 / 4096.0 * 128.0;
  constexpr double c1 = 3424.0 / 4096.0;
  constexpr double c2 = 2413.0 / 4096.0 * 32.0;
  constexpr double c3 = 2392.0 / 4096.0 * 32.0;
  double power = std::pow(std::max(value, 0.0), 1 / m2);
  double nits = 10000.0 * std::pow(std::max(power - c1, 0.0) / (c2 - c3 * power), 1 / m1);
  return nits / 203.0;
}

/*
 * The HLG inverse OETF (ITU-R BT.2100), scaled so that CSS Color HDR's
 * reference white, a signal of 0.75, is 1.0
 */
inline double hlgToLinear(double value)
{
  constexpr double a = 0.17883277;
  constexpr double b = 1 - 4 * a;
  const double c = 0.5 - a * std::log(4 * a);
  auto inverseOETF = [&](double signal) {
    return signal <= 0.5 ? signal * signal / 3 : (std::exp((signal - c) / a) + b) / 12;
  };
  return inverseOETF(std::max(value, 0.0)) / inverseOETF(0.75);
}

inline Vector3 applyTransfer(const Vector3 &v, double (*transfer)(double))
{
  return {transfer(v[0]), transfer(v[1]), transfer(v[2])};
}

// Lab with D50 white to XYZ-D50 (CSS Color 4 §9.3)
inline Vector3 labToXYZD50(const Vector3 &lab)
{
  constexpr double kappa = 24389.0 / 27.0;
  constexpr double epsilon = 216.0 / 24389.0;
  double f1 = (lab[0] + 16) / 116;
  double f0 = lab[1] / 500 + f1;
  double f2 = f1 - lab[2] / 200;
  double x = std::pow(f0, 3) > epsilon ? std::pow(f0, 3) : (116 * f0 - 16) / kappa;
  double y = lab[0] > kappa * epsilon ? std::pow((lab[0] + 16) / 116, 3) : lab[0] / kappa;
  double z = std::pow(f2, 3) > epsilon ? std::pow(f2, 3) : (116 * f2 - 16) / kappa;
  return {x * kD50White[0], y * kD50White[1], z * kD50White[2]};
}

// A polar color (lightness, chroma, hue in degrees) to its rectangular form
inline Vector3 polarToRectangular(const Vector3 &lch)
{
  double hue = lch[2] * M_PI / 180;
  return {lch[0], lch[1] * std::cos(hue), lch[1] * std::sin(hue)};
}

inline constexpr Matrix3 kLinearSRGBToLMS{{
    {0.4122214708, 0.5363325363, 0.0514459929},
    {0.2119034982, 0.6806995451, 0.1073969566},
    {0.0883024619, 0.2817188376, 0.6299787005},
}};

inline constexpr Matrix3 kLMSToOKLab{{
    {0.2104542553, 0.7936177850, -0.0040720468},
    {1.9779984951, -2.4285922050, 0.4505937099},
    {0.0259040371, 0.7827717662, -0.8086757660},
}};

inline Vector3 linearSRGBToOKLab(const Vector3 &linear)
{
  auto lms = multiply(kLinearSRGBToLMS, linear);
  return multiply(kLMSToOKLab, {std::cbrt(lms[0]), std::cbrt(lms[1]), std::cbrt(lms[2])});
}

inline Vector3 oklabToLinearSRGB(const Vector3 &oklab)
{
  auto lms = multiply(kOKLabToLMS, oklab);
  return multiply(kLMSToLinearSRGB, {lms[0] * lms[0] * lms[0], lms[1] * lms[1] * lms[1], lms[2] * lms[2] * lms[2]});
}

} // namespace colorspace

// The color in extended linear sRGB by CSS's arithmetic, unclipped; empty for
// a dashed space, which CSS doesn't define
inline std::optional<std::array<float, 3>> toExtendedLinearSRGB(const ColorSpaceValue &value)
{
  using namespace colorspace;
  Vector3 c{value.channels[0], value.channels[1], value.channels[2]};
  Vector3 linear;
  switch (value.space) {
    case ColorSpace::sRGB:
      linear = applyTransfer(c, srgbToLinear);
      break;
    case ColorSpace::SRGBLinear:
      linear = c;
      break;
    case ColorSpace::DisplayP3:
      linear = multiply(kXYZD65ToLinearSRGB, multiply(kLinearDisplayP3ToXYZD65, applyTransfer(c, srgbToLinear)));
      break;
    case ColorSpace::DisplayP3Linear:
      linear = multiply(kXYZD65ToLinearSRGB, multiply(kLinearDisplayP3ToXYZD65, c));
      break;
    case ColorSpace::A98RGB:
      linear = multiply(kXYZD65ToLinearSRGB, multiply(kLinearA98RGBToXYZD65, applyTransfer(c, a98ToLinear)));
      break;
    case ColorSpace::ProPhotoRGB:
      linear = multiply(
          kXYZD65ToLinearSRGB,
          multiply(kD50ToD65, multiply(kLinearProPhotoToXYZD50, applyTransfer(c, proPhotoToLinear))));
      break;
    case ColorSpace::Rec2020:
      linear = multiply(kXYZD65ToLinearSRGB, multiply(kLinearRec2020ToXYZD65, applyTransfer(c, rec2020ToLinear)));
      break;
    case ColorSpace::Rec2100PQ:
      linear = multiply(kXYZD65ToLinearSRGB, multiply(kLinearRec2020ToXYZD65, applyTransfer(c, pqToLinear)));
      break;
    case ColorSpace::Rec2100HLG:
      linear = multiply(kXYZD65ToLinearSRGB, multiply(kLinearRec2020ToXYZD65, applyTransfer(c, hlgToLinear)));
      break;
    case ColorSpace::Rec2100Linear:
      linear = multiply(kXYZD65ToLinearSRGB, multiply(kLinearRec2020ToXYZD65, c));
      break;
    case ColorSpace::XYZD65:
      linear = multiply(kXYZD65ToLinearSRGB, c);
      break;
    case ColorSpace::XYZD50:
      linear = multiply(kXYZD65ToLinearSRGB, multiply(kD50ToD65, c));
      break;
    case ColorSpace::Lab:
      linear = multiply(kXYZD65ToLinearSRGB, multiply(kD50ToD65, labToXYZD50(c)));
      break;
    case ColorSpace::LCH:
      linear = multiply(kXYZD65ToLinearSRGB, multiply(kD50ToD65, labToXYZD50(polarToRectangular(c))));
      break;
    case ColorSpace::OKLab:
      linear = oklabToLinearSRGB(c);
      break;
    case ColorSpace::OKLCH:
      linear = oklabToLinearSRGB(polarToRectangular(c));
      break;
    default:
      return std::nullopt;
  }
  return std::array<float, 3>{
      static_cast<float>(linear[0]), static_cast<float>(linear[1]), static_cast<float>(linear[2])};
}

// XYZ-D65 to linear Rec. 2020 (ITU-R BT.2020), the inverse of
// `kLinearRec2020ToXYZD65`
inline constexpr colorspace::Matrix3 kXYZD65ToLinearRec2020{{
    {1.7166511879712674, -0.35567078377639233, -0.25336628137365974},
    {-0.6666843518324892, 1.6164812366349395, 0.015768545813911124},
    {0.017639857445310783, -0.042770613257808524, 0.9421031212354739},
}};

// Whether any channel is above 1 in linear Rec. 2020, the widest standard
// gamut: `srgb-linear 2 2 2` is, P3 red isn't. False for a dashed space.
inline bool isHighDynamicRange(const ColorSpaceValue &value)
{
  auto linear = toExtendedLinearSRGB(value);
  if (!linear.has_value()) {
    return false;
  }
  using namespace colorspace;
  const Vector3 srgb{(*linear)[0], (*linear)[1], (*linear)[2]};
  const Vector3 rec2020 = multiply(kXYZD65ToLinearRec2020, multiply(kLinearSRGBToXYZD65, srgb));
  // A hair above 1, so rounding in a conversion doesn't make an SDR white HDR
  constexpr double threshold = 1.001;
  return rec2020[0] > threshold || rec2020[1] > threshold || rec2020[2] > threshold;
}

// Gamma-encoded sRGB, clipped to its gamut; empty where `toExtendedLinearSRGB` is
inline std::optional<ColorComponents> toClippedSRGB(const ColorSpaceValue &value)
{
  auto linear = toExtendedLinearSRGB(value);
  if (!linear.has_value()) {
    return std::nullopt;
  }
  auto encode = [](float channel) {
    return static_cast<float>(std::clamp(colorspace::linearToSRGB(channel), 0.0, 1.0));
  };
  return ColorComponents{
      .red = encode((*linear)[0]),
      .green = encode((*linear)[1]),
      .blue = encode((*linear)[2]),
      .alpha = std::clamp(value.alpha, 0.0f, 1.0f),
      .colorSpace = ColorSpace::sRGB};
}

// CSS Color 4 §12: premultiplied Oklab, from extended sRGB components to
// extended linear sRGB, unclipped
inline ColorSpaceValue interpolateInOKLab(const ColorComponents &from, const ColorComponents &to, float progress)
{
  using namespace colorspace;
  auto toOKLab = [](const ColorComponents &c) {
    return linearSRGBToOKLab(applyTransfer({c.red, c.green, c.blue}, srgbToLinear));
  };
  auto fromLab = toOKLab(from);
  auto toLab = toOKLab(to);
  double alpha = from.alpha + (to.alpha - from.alpha) * progress;
  Vector3 mixed;
  for (size_t i = 0; i < 3; i++) {
    double premultiplied = fromLab[i] * from.alpha + (toLab[i] * to.alpha - fromLab[i] * from.alpha) * progress;
    mixed[i] = alpha == 0 ? 0 : premultiplied / alpha;
  }
  auto linear = oklabToLinearSRGB(mixed);
  return ColorSpaceValue{
      .space = ColorSpace::SRGBLinear,
      .channels = {static_cast<float>(linear[0]), static_cast<float>(linear[1]), static_cast<float>(linear[2])},
      .alpha = static_cast<float>(alpha)};
}

} // namespace facebook::react
