/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "HostPlatformColor.h"

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <objc/runtime.h>
#import <react/renderer/graphics/RCTPlatformColorUtils.h>
#import <react/featureflags/ReactNativeFeatureFlags.h>
#import <react/utils/ManagedObjectWrapper.h>
#import <algorithm>
#import <array>
#import <cmath>
#import <mutex>
#import <string>
#import <unordered_map>

using namespace facebook::react;

NS_ASSUME_NONNULL_BEGIN

namespace facebook::react {

namespace {

bool UIColorIsP3ColorSpace(const std::shared_ptr<void> &uiColor)
{
  UIColor *color = unwrapManagedObject(uiColor);
  CGColorSpaceRef colorSpace = CGColorGetColorSpace(color.CGColor);

  if (CGColorSpaceGetModel(colorSpace) == kCGColorSpaceModelRGB) {
    CFStringRef name = CGColorSpaceGetName(colorSpace);
    if (name != NULL && (CFEqual(name, kCGColorSpaceDisplayP3) != 0u)) {
      return true;
    }
  }
  return false;
}

UIColor *_Nullable UIColorFromInt32(int32_t intColor)
{
  CGFloat a = CGFloat((intColor >> 24) & 0xFF) / 255.0;
  CGFloat r = CGFloat((intColor >> 16) & 0xFF) / 255.0;
  CGFloat g = CGFloat((intColor >> 8) & 0xFF) / 255.0;
  CGFloat b = CGFloat(intColor & 0xFF) / 255.0;

  UIColor *color = [UIColor colorWithRed:r green:g blue:b alpha:a];
  return color;
}

UIColor *_Nullable UIColorFromDynamicColor(const facebook::react::DynamicColor &dynamicColor)
{
  int32_t light = dynamicColor.lightColor;
  int32_t dark = dynamicColor.darkColor;
  int32_t highContrastLight = dynamicColor.highContrastLightColor;
  int32_t highContrastDark = dynamicColor.highContrastDarkColor;

  UIColor *lightColor = UIColorFromInt32(light);
  UIColor *darkColor = UIColorFromInt32(dark);
  UIColor *highContrastLightColor = UIColorFromInt32(highContrastLight);
  UIColor *highContrastDarkColor = UIColorFromInt32(highContrastDark);

  if (lightColor != nil && darkColor != nil) {
    UIColor *color = [UIColor colorWithDynamicProvider:^UIColor *_Nonnull(UITraitCollection *_Nonnull collection) {
      if (collection.userInterfaceStyle == UIUserInterfaceStyleDark) {
        if (collection.accessibilityContrast == UIAccessibilityContrastHigh && highContrastDark != 0) {
          return highContrastDarkColor;
        } else {
          return darkColor;
        }
      } else {
        if (collection.accessibilityContrast == UIAccessibilityContrastHigh && highContrastLight != 0) {
          return highContrastLightColor;
        } else {
          return lightColor;
        }
      }
    }];
    return color;
  } else {
    return nil;
  }

  return nil;
}

int32_t ColorFromColorComponents(const facebook::react::ColorComponents &components)
{
  float ratio = 255;
  auto color = ((int32_t)std::round((float)components.alpha * ratio) & 0xff) << 24 |
      ((int)std::round((float)components.red * ratio) & 0xff) << 16 |
      ((int)std::round((float)components.green * ratio) & 0xff) << 8 |
      ((int)std::round((float)components.blue * ratio) & 0xff);
  return color;
}

// Matched by Core Graphics: `-getRed:green:blue:alpha:` fails for a non-RGB space such as Lab
ColorComponents ExtendedSRGBComponentsFromUIColor(UIColor *color)
{
  static CGColorSpaceRef extendedSRGB = CGColorSpaceCreateWithName(kCGColorSpaceExtendedSRGB);
  CGColorRef matched =
      CGColorCreateCopyByMatchingToColorSpace(extendedSRGB, kCGRenderingIntentDefault, color.CGColor, nullptr);
  if (matched == nullptr) {
    return {};
  }
  const CGFloat *components = CGColorGetComponents(matched);
  ColorComponents result{
      .red = (float)components[0],
      .green = (float)components[1],
      .blue = (float)components[2],
      .alpha = (float)components[3],
      .colorSpace = ColorSpace::sRGB};
  CGColorRelease(matched);
  return result;
}

int32_t ColorFromUIColor(UIColor *color)
{
  if (ReactNativeFeatureFlags::enableColorSpaces()) {
    // Clamped: masking an extended component would wrap it
    auto components = ExtendedSRGBComponentsFromUIColor(color);
    auto clamp = [](float value) { return std::clamp(value, 0.0f, 1.0f); };
    return ColorFromColorComponents(
        {.red = clamp(components.red),
         .green = clamp(components.green),
         .blue = clamp(components.blue),
         .alpha = clamp(components.alpha)});
  }
  CGFloat rgba[4];
  [color getRed:&rgba[0] green:&rgba[1] blue:&rgba[2] alpha:&rgba[3]];
  return ColorFromColorComponents(
      {.red = (float)rgba[0], .green = (float)rgba[1], .blue = (float)rgba[2], .alpha = (float)rgba[3]});
}

CFStringRef _Nullable CGColorSpaceNameFor(ColorSpace space)
{
  switch (space) {
    case ColorSpace::sRGB:
      return kCGColorSpaceExtendedSRGB;
    case ColorSpace::DisplayP3:
      return kCGColorSpaceExtendedDisplayP3;
    case ColorSpace::SRGBLinear:
      return kCGColorSpaceExtendedLinearSRGB;
    case ColorSpace::DisplayP3Linear:
      return kCGColorSpaceExtendedLinearDisplayP3;
    case ColorSpace::A98RGB:
      return kCGColorSpaceAdobeRGB1998;
    case ColorSpace::ProPhotoRGB:
      return kCGColorSpaceROMMRGB;
    case ColorSpace::Rec2020:
      return kCGColorSpaceExtendedITUR_2020;
    case ColorSpace::Rec2100PQ:
      return kCGColorSpaceITUR_2100_PQ;
    case ColorSpace::Rec2100HLG:
      return kCGColorSpaceITUR_2100_HLG;
    case ColorSpace::Rec2100Linear:
      return kCGColorSpaceExtendedLinearITUR_2020;
    case ColorSpace::DCIP3:
      return kCGColorSpaceDCIP3;
    case ColorSpace::Rec709:
      return kCGColorSpaceITUR_709;
    case ColorSpace::Rec2020SRGBTransfer:
      return kCGColorSpaceITUR_2020_sRGBGamma;
    case ColorSpace::Rec2020Linear:
      return kCGColorSpaceLinearITUR_2020;
    case ColorSpace::DisplayP3PQ:
      return kCGColorSpaceDisplayP3_PQ;
    case ColorSpace::DisplayP3HLG:
      return kCGColorSpaceDisplayP3_HLG;
    case ColorSpace::Rec709PQ:
      return kCGColorSpaceITUR_709_PQ;
    case ColorSpace::Rec709HLG:
      return kCGColorSpaceITUR_709_HLG;
    case ColorSpace::ACEScg:
      return kCGColorSpaceACESCGLinear;
    case ColorSpace::GrayGamma22:
      return kCGColorSpaceGenericGrayGamma2_2;
    case ColorSpace::GrayLinear:
      return kCGColorSpaceLinearGray;
    default:
      return nullptr;
  }
}

// Asked of the OS once per space; null where this OS has none
CGColorSpaceRef _Nullable CGColorSpaceFor(ColorSpace space)
{
  static std::mutex mutex;
  static std::unordered_map<int, CGColorSpaceRef> spaces;
  std::lock_guard<std::mutex> lock(mutex);
  auto key = static_cast<int>(space);
  auto found = spaces.find(key);
  if (found != spaces.end()) {
    return found->second;
  }
  // No Lab space: Core Graphics gamut-maps Lab into the destination, so Lab and LCH take CSS's
  // arithmetic, which keeps them unclipped
  CGColorSpaceRef colorSpace = nullptr;
  if (CFStringRef name = CGColorSpaceNameFor(space)) {
    colorSpace = CGColorSpaceCreateWithName(name);
  }
  spaces[key] = colorSpace;
  return colorSpace;
}

/*
 * The color drawn in the OS's own space for it where the OS has one, else in
 * extended linear sRGB by CSS's arithmetic, which leaves it unclipped. Nil
 * for a space neither covers.
 *
 * DOM-CSS-LIMITATION(hdr-colors-draw-at-sdr-white): a color brighter than SDR
 * white (`rec2100-pq`, values above 1 in a linear space) keeps its value, but
 * the layers it fills are SDR, so it draws at SDR white. Drawing it brighter
 * needs an EDR layer for the fill and its `dynamic-range-limit`.
 */
UIColor *_Nullable UIColorFromColorSpaceValue(const ColorSpaceValue &value)
{
  CGColorSpaceRef colorSpace = CGColorSpaceFor(value.space);
  if (colorSpace != nullptr) {
    const auto &channels = value.channels;
    size_t count = CGColorSpaceGetNumberOfComponents(colorSpace);
    CGFloat components[4] = {channels[0], channels[1], channels[2], value.alpha};
    if (count == 1) {
      components[1] = value.alpha;
    }
    CGColorRef cgColor = CGColorCreate(colorSpace, components);
    if (cgColor == nullptr) {
      return nil;
    }
    UIColor *color = [UIColor colorWithCGColor:cgColor];
    CGColorRelease(cgColor);
    return color;
  }
  auto linear = toExtendedLinearSRGB(value);
  if (!linear.has_value()) {
    return nil;
  }
  static CGColorSpaceRef extendedLinearSRGB = CGColorSpaceCreateWithName(kCGColorSpaceExtendedLinearSRGB);
  CGFloat components[4] = {(*linear)[0], (*linear)[1], (*linear)[2], value.alpha};
  CGColorRef cgColor = CGColorCreate(extendedLinearSRGB, components);
  UIColor *color = [UIColor colorWithCGColor:cgColor];
  CGColorRelease(cgColor);
  return color;
}

int32_t ColorFromUIColorForSpecificTraitCollection(
    const std::shared_ptr<void> &uiColor,
    UITraitCollection *traitCollection)
{
  UIColor *color = (UIColor *)unwrapManagedObject(uiColor);
  if (color != nullptr) {
    color = [color resolvedColorWithTraitCollection:traitCollection];
    return ColorFromUIColor(color);
  }

  return 0;
}

int32_t ColorFromUIColor(const std::shared_ptr<void> &uiColor)
{
  return ColorFromUIColorForSpecificTraitCollection(uiColor, [UITraitCollection currentTraitCollection]);
}

UIColor *_Nullable UIColorFromComponentsColor(const facebook::react::ColorComponents &components)
{
  UIColor *uiColor = nil;
  if (components.colorSpace == ColorSpace::DisplayP3) {
    uiColor = [UIColor colorWithDisplayP3Red:components.red
                                       green:components.green
                                        blue:components.blue
                                       alpha:components.alpha];
  } else {
    uiColor = [UIColor colorWithRed:components.red green:components.green blue:components.blue alpha:components.alpha];
  }

  return uiColor;
}

std::size_t hashFromUIColor(const std::shared_ptr<void> &uiColor)
{
  if (uiColor == nullptr) {
    return 0;
  }

  static UITraitCollection *darkModeTraitCollection =
      [UITraitCollection traitCollectionWithUserInterfaceStyle:UIUserInterfaceStyleDark];
  auto darkColor = ColorFromUIColorForSpecificTraitCollection(uiColor, darkModeTraitCollection);

  static UITraitCollection *lightModeTraitCollection =
      [UITraitCollection traitCollectionWithUserInterfaceStyle:UIUserInterfaceStyleLight];
  auto lightColor = ColorFromUIColorForSpecificTraitCollection(uiColor, lightModeTraitCollection);

  static UITraitCollection *darkModeAccessibilityContrastTraitCollection =
      [UITraitCollection traitCollectionWithTraitsFromCollections:@[
        darkModeTraitCollection,
        [UITraitCollection traitCollectionWithAccessibilityContrast:UIAccessibilityContrastHigh]
      ]];
  auto darkAccessibilityContrastColor =
      ColorFromUIColorForSpecificTraitCollection(uiColor, darkModeAccessibilityContrastTraitCollection);

  static UITraitCollection *lightModeAccessibilityContrastTraitCollection =
      [UITraitCollection traitCollectionWithTraitsFromCollections:@[
        lightModeTraitCollection,
        [UITraitCollection traitCollectionWithAccessibilityContrast:UIAccessibilityContrastHigh]
      ]];
  auto lightAccessibilityContrastColor =
      ColorFromUIColorForSpecificTraitCollection(uiColor, lightModeAccessibilityContrastTraitCollection);
  return facebook::react::hash_combine(
      darkColor,
      lightColor,
      darkAccessibilityContrastColor,
      lightAccessibilityContrastColor,
      UIColorIsP3ColorSpace(uiColor));
}

} // anonymous namespace

Color::Color(int32_t color)
{
  uiColor_ = wrapManagedObject(UIColorFromInt32(color));
  uiColorHashValue_ = facebook::react::hash_combine(color, 0) & ~kColorSpaceColorBit;
}

Color::Color(const DynamicColor &dynamicColor)
{
  uiColor_ = wrapManagedObject(UIColorFromDynamicColor(dynamicColor));
  uiColorHashValue_ = facebook::react::hash_combine(
      dynamicColor.darkColor,
      dynamicColor.lightColor,
      dynamicColor.highContrastDarkColor,
      dynamicColor.highContrastLightColor,
      0);
  uiColorHashValue_ &= ~kColorSpaceColorBit;
}

Color::Color(const ColorComponents &components)
{
  uiColor_ = wrapManagedObject(UIColorFromComponentsColor(components));
  uiColorHashValue_ = facebook::react::hash_combine(
      ColorFromColorComponents(components), components.colorSpace == ColorSpace::DisplayP3);
  uiColorHashValue_ &= ~kColorSpaceColorBit;
}

Color::Color(const ColorSpaceValue &value)
{
  UIColor *color = UIColorFromColorSpaceValue(value);
  uiColor_ = color != nil ? wrapManagedObject(color) : nullptr;
  uiColorHashValue_ = facebook::react::hash_combine(
                          static_cast<int>(value.space), value.channels[0], value.channels[1], value.channels[2], value.alpha) |
      kColorSpaceColorBit;
}

ColorComponents Color::getColorComponents() const
{
  if (ReactNativeFeatureFlags::enableColorSpaces()) {
    UIColor *color = (UIColor *)unwrapManagedObject(uiColor_);
    if (color == nil) {
      return {};
    }
    return ExtendedSRGBComponentsFromUIColor([color resolvedColorWithTraitCollection:[UITraitCollection currentTraitCollection]]);
  }
  float ratio = 255;
  int32_t primitiveColor = getColor();
  return ColorComponents{
      .red = (float)((primitiveColor >> 16) & 0xff) / ratio,
      .green = (float)((primitiveColor >> 8) & 0xff) / ratio,
      .blue = (float)((primitiveColor >> 0) & 0xff) / ratio,
      .alpha = (float)((primitiveColor >> 24) & 0xff) / ratio};
}

Color::Color(std::shared_ptr<void> uiColor)
{
  UIColor *color = ((UIColor *)unwrapManagedObject(uiColor));
  if (color != nullptr) {
    auto colorHash = hashFromUIColor(uiColor);
    uiColorHashValue_ = colorHash & ~kColorSpaceColorBit;
  }
  uiColor_ = std::move(uiColor);
}

bool Color::operator==(const Color &other) const
{
  return (!uiColor_ && !other.uiColor_) ||
      (uiColor_ && other.uiColor_ && (uiColorHashValue_ == other.uiColorHashValue_));
}

bool Color::operator!=(const Color &other) const
{
  return !(*this == other);
}

int32_t Color::getColor() const
{
  return ColorFromUIColor(uiColor_);
}

float Color::getChannel(int channelId) const
{
  if (ReactNativeFeatureFlags::enableColorSpaces()) {
    // Alpha needs no matching; `isColorMeaningful` reads it on every frame
    if (channelId == 3) {
      UIColor *color = (UIColor *)unwrapManagedObject(uiColor_);
      return color != nil ? static_cast<float>(CGColorGetAlpha(color.CGColor)) : 0;
    }
    auto components = getColorComponents();
    std::array<float, 4> rgba{components.red, components.green, components.blue, components.alpha};
    return rgba[channelId];
  }
  CGFloat rgba[4];
  UIColor *color = (__bridge UIColor *)getUIColor().get();
  [color getRed:&rgba[0] green:&rgba[1] blue:&rgba[2] alpha:&rgba[3]];
  return static_cast<float>(rgba[channelId]);
}

std::size_t Color::getUIColorHash() const
{
  return uiColorHashValue_;
}

Color Color::createDynamicColor(
    const Color &light,
    const Color &dark,
    const Color &highContrastLight,
    const Color &highContrastDark)
{
  UIColor *lightColor = (UIColor *)unwrapManagedObject(light.getUIColor());
  UIColor *darkColor = (UIColor *)unwrapManagedObject(dark.getUIColor());
  UIColor *highContrastLightColor = (UIColor *)unwrapManagedObject(highContrastLight.getUIColor());
  UIColor *highContrastDarkColor = (UIColor *)unwrapManagedObject(highContrastDark.getUIColor());
  if (lightColor == nil || darkColor == nil) {
    return HostPlatformColor::UndefinedColor;
  }
  UIColor *color = [UIColor colorWithDynamicProvider:^UIColor *_Nonnull(UITraitCollection *_Nonnull collection) {
    bool highContrast = collection.accessibilityContrast == UIAccessibilityContrastHigh;
    if (collection.userInterfaceStyle == UIUserInterfaceStyleDark) {
      return highContrast && highContrastDarkColor != nil ? highContrastDarkColor : darkColor;
    }
    return highContrast && highContrastLightColor != nil ? highContrastLightColor : lightColor;
  }];
  Color result(wrapManagedObject(color));
  auto hashOf = [](const Color &variant) { return variant.getUIColor() ? variant.getUIColorHash() : 0; };
  bool anyColorSpaceColor = light.isColorSpaceColor() || dark.isColorSpaceColor() ||
      highContrastLight.isColorSpaceColor() || highContrastDark.isColorSpaceColor();
  result.uiColorHashValue_ =
      facebook::react::hash_combine(hashOf(light), hashOf(dark), hashOf(highContrastLight), hashOf(highContrastDark));
  result.uiColorHashValue_ = anyColorSpaceColor ? result.uiColorHashValue_ | kColorSpaceColorBit
                                                : result.uiColorHashValue_ & ~kColorSpaceColorBit;
  return result;
}

Color Color::createSemanticColor(std::vector<std::string> &semanticItems)
{
  UIColor *semanticColor = RCTPlatformColorFromSemanticItemsOrNil(semanticItems);
  if (semanticColor == nil) {
    // Undefined-color sentinel on a miss, distinct from a name that resolves to
    // transparent (getColor() is still 0, preserving the old render).
    return HostPlatformColor::UndefinedColor;
  }
  return Color(wrapManagedObject(semanticColor));
}

} // namespace facebook::react

NS_ASSUME_NONNULL_END
