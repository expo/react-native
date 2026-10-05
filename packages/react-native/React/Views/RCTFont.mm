/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "RCTFont.h"
#import "RCTFont+Private.h"

#import "RCTAssert.h"
#import "RCTLog.h"

#import <CoreText/CoreText.h>

RCTFontWeight RCTGetFontWeight(UIFont *font)
{
  static NSArray<NSString *> *weightSuffixes;
  static NSArray<NSNumber *> *fontWeights;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    // We use two arrays instead of one map because
    // the order is important for suffix matching.
    weightSuffixes = @[
      @"normal",
      @"ultralight",
      @"extralight",
      @"thin",
      @"light",
      @"regular",
      @"medium",
      @"semibold",
      @"demibold",
      @"extrabold",
      @"ultrabold",
      @"bold",
      @"heavy",
      @"black"
    ];
    fontWeights = @[
      @(UIFontWeightRegular),
      @(UIFontWeightUltraLight),
      @(UIFontWeightUltraLight),
      @(UIFontWeightThin),
      @(UIFontWeightLight),
      @(UIFontWeightRegular),
      @(UIFontWeightMedium),
      @(UIFontWeightSemibold),
      @(UIFontWeightSemibold),
      @(UIFontWeightHeavy),
      @(UIFontWeightHeavy),
      @(UIFontWeightBold),
      @(UIFontWeightHeavy),
      @(UIFontWeightBlack)
    ];
  });

  NSString *fontName = font.fontName;
  NSInteger i = 0;
  for (NSString *suffix in weightSuffixes) {
    // CFStringFind is much faster than any variant of rangeOfString: because it does not use a locale.
    auto options = kCFCompareCaseInsensitive | kCFCompareAnchored | kCFCompareBackwards;
    if (CFStringFind((CFStringRef)fontName, (CFStringRef)suffix, options).location != kCFNotFound) {
      return (RCTFontWeight)fontWeights[i].doubleValue;
    }
    i++;
  }

  auto traits = (__bridge_transfer NSDictionary *)CTFontCopyTraits((CTFontRef)font);
  return (RCTFontWeight)[traits[UIFontWeightTrait] doubleValue];
}

static BOOL isItalicFont(UIFont *font)
{
  return (CTFontGetSymbolicTraits((CTFontRef)font) & kCTFontTraitItalic) != 0;
}

static BOOL isCondensedFont(UIFont *font)
{
  return (CTFontGetSymbolicTraits((CTFontRef)font) & kCTFontTraitCondensed) != 0;
}

static RCTFontHandler defaultFontHandler;

void RCTSetDefaultFontHandler(RCTFontHandler handler)
{
  defaultFontHandler = handler;
}

BOOL RCTHasFontHandlerSet()
{
  return defaultFontHandler != nil;
}

// We pass a string description of the font weight to the defaultFontHandler because UIFontWeight
// is not defined pre-iOS 8.2.
// Furthermore, UIFontWeight's are lossy floats, so we must use an inexact compare to figure out
// which one we actually have.
static inline BOOL CompareFontWeights(UIFontWeight firstWeight, UIFontWeight secondWeight)
{
  return fabs(firstWeight - secondWeight) < 0.01;
}

static NSString *FontWeightDescriptionFromUIFontWeight(UIFontWeight fontWeight)
{
  if (CompareFontWeights(fontWeight, UIFontWeightUltraLight)) {
    return @"ultralight";
  } else if (CompareFontWeights(fontWeight, UIFontWeightThin)) {
    return @"thin";
  } else if (CompareFontWeights(fontWeight, UIFontWeightLight)) {
    return @"light";
  } else if (CompareFontWeights(fontWeight, UIFontWeightRegular)) {
    return @"regular";
  } else if (CompareFontWeights(fontWeight, UIFontWeightMedium)) {
    return @"medium";
  } else if (CompareFontWeights(fontWeight, UIFontWeightSemibold)) {
    return @"semibold";
  } else if (CompareFontWeights(fontWeight, UIFontWeightBold)) {
    return @"bold";
  } else if (CompareFontWeights(fontWeight, UIFontWeightHeavy)) {
    return @"heavy";
  } else if (CompareFontWeights(fontWeight, UIFontWeightBlack)) {
    return @"black";
  }
  RCTAssert(NO, @"Unknown UIFontWeight passed in: %f", fontWeight);
  return @"regular";
}

UIFont *RCTGetLegacyDefaultFont(CGFloat size, UIFontWeight fontWeight)
{
  if (defaultFontHandler != nil) {
    return defaultFontHandler(size, FontWeightDescriptionFromUIFontWeight(fontWeight));
  } else {
    return nil;
  }
}

static UIFont *cachedSystemFont(CGFloat size, RCTFontWeight weight)
{
  static NSCache<NSValue *, UIFont *> *fontCache = [NSCache new];

  struct __attribute__((__packed__)) CacheKey {
    CGFloat size;
    RCTFontWeight weight;
  };

  CacheKey key{.size = size, .weight = weight};
  NSValue *cacheKey = [[NSValue alloc] initWithBytes:&key objCType:@encode(CacheKey)];
  UIFont *font = [fontCache objectForKey:cacheKey];

  if (font == nil) {
    if (defaultFontHandler != nil) {
      NSString *fontWeightDescription = FontWeightDescriptionFromUIFontWeight(weight);
      font = defaultFontHandler(size, fontWeightDescription);
    } else {
      font = [UIFont systemFontOfSize:size weight:weight];
    }

    [fontCache setObject:font forKey:cacheKey];
  }

  return font;
}

// Caching wrapper around expensive +[UIFont fontNamesForFamilyName:]
static NSArray<NSString *> *fontNamesForFamilyName(NSString *familyName)
{
  static NSCache<NSString *, NSArray<NSString *> *> *cache;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    cache = [NSCache new];
    [NSNotificationCenter.defaultCenter
        addObserverForName:(NSNotificationName)kCTFontManagerRegisteredFontsChangedNotification
                    object:nil
                     queue:nil
                usingBlock:^(NSNotification *) {
                  [cache removeAllObjects];
                }];
  });

  auto names = [cache objectForKey:familyName];
  if (!names) {
    names = [UIFont fontNamesForFamilyName:familyName] ?: [NSArray new];
    [cache setObject:names forKey:familyName];
  }
  return names;
}

/**
 * The family a CSS generic family name stands for on this platform, or nil for
 * a name that is not one. `sans-serif` and the system aliases are the system
 * font; the others are the faces iOS ships for the purpose.
 */
static NSString *RCTPlatformFamilyForGeneric(NSString *name, NSString *systemFamily)
{
  static NSDictionary<NSString *, NSString *> *faces;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    faces = @{
      @"monospace" : @"Menlo",
      @"serif" : @"Times New Roman",
      @"cursive" : @"Snell Roundhand",
      @"fantasy" : @"Papyrus",
    };
  });
  NSString *key = name.lowercaseString;
  if ([key isEqualToString:@"sans-serif"] || [key isEqualToString:@"ui-sans-serif"] ||
      [key isEqualToString:@"system-ui"] || [key isEqualToString:@"-apple-system"] ||
      [key isEqualToString:@"blinkmacsystemfont"]) {
    return systemFamily;
  }
  // The system designs: the text layout manager's lookup turns these into a
  // descriptor design, so they pass through as written
  if ([key isEqualToString:@"ui-serif"] || [key isEqualToString:@"ui-rounded"] ||
      [key isEqualToString:@"ui-monospace"]) {
    return name;
  }
  return faces[key];
}

/**
 * A `font-family` value as CSS writes it — a list of families, the first one the
 * device has winning (css-fonts-4 §2.1), generic families among them standing
 * for the platform's own — reduced to the one family name the lookup below
 * takes. A list is read per family, whole: the web's per-character fallback,
 * where a glyph the first family lacks comes from the next, is the text
 * system's own, which handles it as it always has. A value with no comma is a
 * family or font name as before, a generic family resolved the same way.
 */
static NSString *RCTFirstAvailableFontFamily(NSString *value, NSString *systemFamily)
{
  if (value == nil) {
    return nil;
  }
  NSArray<NSString *> *candidates = [value componentsSeparatedByString:@","];
  NSMutableCharacterSet *trimmed = [[NSCharacterSet whitespaceAndNewlineCharacterSet] mutableCopy];
  [trimmed addCharactersInString:@"\"'"];
  NSString *first = nil;
  for (NSString *raw in candidates) {
    NSString *name = [raw stringByTrimmingCharactersInSet:trimmed];
    if (name.length == 0) {
      continue;
    }
    if (first == nil) {
      first = name;
    }
    NSString *generic = RCTPlatformFamilyForGeneric(name, systemFamily);
    if (generic != nil) {
      return generic;
    }
    if (fontNamesForFamilyName(name).count > 0 || [UIFont fontWithName:name size:12] != nil) {
      return name;
    }
  }
  // Nothing available: the first name, whose absence the lookup reports as it did
  return first ?: value;
}

/**
 * The system design a `ui-*` generic family names (css-fonts-4 §2.1.3), or
 * nil: `ui-serif`, `ui-rounded` and `ui-monospace` are the system font in
 * that design rather than families of their own.
 */
static UIFontDescriptorSystemDesign RCTSystemDesignForFamily(NSString *familyName)
{
  NSString *key = familyName.lowercaseString;
  if ([key isEqualToString:@"ui-serif"]) {
    return UIFontDescriptorSystemDesignSerif;
  }
  if ([key isEqualToString:@"ui-rounded"]) {
    return UIFontDescriptorSystemDesignRounded;
  }
  if ([key isEqualToString:@"ui-monospace"]) {
    return UIFontDescriptorSystemDesignMonospaced;
  }
  return nil;
}

@implementation RCTFont (FontFamilyList)

+ (NSString *)firstAvailableFontFamily:(NSString *)fontFamily
{
  static NSString *systemFamily;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    systemFamily = [UIFont systemFontOfSize:14].familyName;
  });
  return RCTFirstAvailableFontFamily(fontFamily, systemFamily);
}

@end

@implementation RCTConvert (RCTFont)

+ (UIFont *)UIFont:(id)json
{
  json = [self NSDictionary:json];
  return [RCTFont updateFont:nil
                  withFamily:[RCTConvert NSString:json[@"fontFamily"]]
                        size:[RCTConvert NSNumber:json[@"fontSize"]]
                      weight:[RCTConvert NSString:json[@"fontWeight"]]
                       style:[RCTConvert NSString:json[@"fontStyle"]]
                     variant:[RCTConvert NSStringArray:json[@"fontVariant"]]
             scaleMultiplier:1];
}

RCT_ENUM_CONVERTER(
    RCTFontWeight,
    (@{
      @"normal" : @(UIFontWeightRegular),
      @"bold" : @(UIFontWeightBold),
      @"100" : @(UIFontWeightUltraLight),
      @"200" : @(UIFontWeightThin),
      @"300" : @(UIFontWeightLight),
      @"400" : @(UIFontWeightRegular),
      @"500" : @(UIFontWeightMedium),
      @"600" : @(UIFontWeightSemibold),
      @"700" : @(UIFontWeightBold),
      @"800" : @(UIFontWeightHeavy),
      @"900" : @(UIFontWeightBlack),
    }),
    UIFontWeightRegular,
    doubleValue)

using RCTFontStyle = BOOL;
RCT_ENUM_CONVERTER(
    RCTFontStyle,
    (@{
      @"normal" : @NO,
      @"italic" : @YES,
      @"oblique" : @YES,
    }),
    NO,
    boolValue)

using RCTFontVariantDescriptor = NSDictionary;
+ (RCTFontVariantDescriptor *)RCTFontVariantDescriptor:(id)json
{
  static NSDictionary *mapping;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    mapping = @{
      @"small-caps" : @{
        UIFontFeatureTypeIdentifierKey : @(kLowerCaseType),
        UIFontFeatureSelectorIdentifierKey : @(kLowerCaseSmallCapsSelector),
      },
      @"oldstyle-nums" : @{
        UIFontFeatureTypeIdentifierKey : @(kNumberCaseType),
        UIFontFeatureSelectorIdentifierKey : @(kLowerCaseNumbersSelector),
      },
      @"lining-nums" : @{
        UIFontFeatureTypeIdentifierKey : @(kNumberCaseType),
        UIFontFeatureSelectorIdentifierKey : @(kUpperCaseNumbersSelector),
      },
      @"tabular-nums" : @{
        UIFontFeatureTypeIdentifierKey : @(kNumberSpacingType),
        UIFontFeatureSelectorIdentifierKey : @(kMonospacedNumbersSelector),
      },
      @"proportional-nums" : @{
        UIFontFeatureTypeIdentifierKey : @(kNumberSpacingType),
        UIFontFeatureSelectorIdentifierKey : @(kProportionalNumbersSelector),
      },
      @"common-ligatures" : @{
        UIFontFeatureTypeIdentifierKey : @(kLigaturesType),
        UIFontFeatureSelectorIdentifierKey : @(kCommonLigaturesOnSelector),
      },
      @"no-common-ligatures" : @{
        UIFontFeatureTypeIdentifierKey : @(kLigaturesType),
        UIFontFeatureSelectorIdentifierKey : @(kCommonLigaturesOffSelector),
      },
      @"discretionary-ligatures" : @{
        UIFontFeatureTypeIdentifierKey : @(kLigaturesType),
        UIFontFeatureSelectorIdentifierKey : @(kRareLigaturesOnSelector),
      },
      @"no-discretionary-ligatures" : @{
        UIFontFeatureTypeIdentifierKey : @(kLigaturesType),
        UIFontFeatureSelectorIdentifierKey : @(kRareLigaturesOffSelector),
      },
      @"historical-ligatures" : @{
        UIFontFeatureTypeIdentifierKey : @(kLigaturesType),
        UIFontFeatureSelectorIdentifierKey : @(kHistoricalLigaturesOnSelector),
      },
      @"no-historical-ligatures" : @{
        UIFontFeatureTypeIdentifierKey : @(kLigaturesType),
        UIFontFeatureSelectorIdentifierKey : @(kHistoricalLigaturesOffSelector),
      },
      @"contextual" : @{
        UIFontFeatureTypeIdentifierKey : @(kContextualAlternatesType),
        UIFontFeatureSelectorIdentifierKey : @(kContextualAlternatesOnSelector),
      },
      @"no-contextual" : @{
        UIFontFeatureTypeIdentifierKey : @(kContextualAlternatesType),
        UIFontFeatureSelectorIdentifierKey : @(kContextualAlternatesOffSelector),
      },
      @"stylistic-one" : @{
        UIFontFeatureTypeIdentifierKey : @(kStylisticAlternativesType),
        UIFontFeatureSelectorIdentifierKey : @(kStylisticAltOneOnSelector),
      },
      @"stylistic-two" : @{
        UIFontFeatureTypeIdentifierKey : @(kStylisticAlternativesType),
        UIFontFeatureSelectorIdentifierKey : @(kStylisticAltTwoOnSelector),
      },
      @"stylistic-three" : @{
        UIFontFeatureTypeIdentifierKey : @(kStylisticAlternativesType),
        UIFontFeatureSelectorIdentifierKey : @(kStylisticAltThreeOnSelector),
      },
      @"stylistic-four" : @{
        UIFontFeatureTypeIdentifierKey : @(kStylisticAlternativesType),
        UIFontFeatureSelectorIdentifierKey : @(kStylisticAltFourOnSelector),
      },
      @"stylistic-five" : @{
        UIFontFeatureTypeIdentifierKey : @(kStylisticAlternativesType),
        UIFontFeatureSelectorIdentifierKey : @(kStylisticAltFiveOnSelector),
      },
      @"stylistic-six" : @{
        UIFontFeatureTypeIdentifierKey : @(kStylisticAlternativesType),
        UIFontFeatureSelectorIdentifierKey : @(kStylisticAltSixOnSelector),
      },
      @"stylistic-seven" : @{
        UIFontFeatureTypeIdentifierKey : @(kStylisticAlternativesType),
        UIFontFeatureSelectorIdentifierKey : @(kStylisticAltSevenOnSelector),
      },
      @"stylistic-eight" : @{
        UIFontFeatureTypeIdentifierKey : @(kStylisticAlternativesType),
        UIFontFeatureSelectorIdentifierKey : @(kStylisticAltEightOnSelector),
      },
      @"stylistic-nine" : @{
        UIFontFeatureTypeIdentifierKey : @(kStylisticAlternativesType),
        UIFontFeatureSelectorIdentifierKey : @(kStylisticAltNineOnSelector),
      },
      @"stylistic-ten" : @{
        UIFontFeatureTypeIdentifierKey : @(kStylisticAlternativesType),
        UIFontFeatureSelectorIdentifierKey : @(kStylisticAltTenOnSelector),
      },
      @"stylistic-eleven" : @{
        UIFontFeatureTypeIdentifierKey : @(kStylisticAlternativesType),
        UIFontFeatureSelectorIdentifierKey : @(kStylisticAltElevenOnSelector),
      },
      @"stylistic-twelve" : @{
        UIFontFeatureTypeIdentifierKey : @(kStylisticAlternativesType),
        UIFontFeatureSelectorIdentifierKey : @(kStylisticAltTwelveOnSelector),
      },
      @"stylistic-thirteen" : @{
        UIFontFeatureTypeIdentifierKey : @(kStylisticAlternativesType),
        UIFontFeatureSelectorIdentifierKey : @(kStylisticAltThirteenOnSelector),
      },
      @"stylistic-fourteen" : @{
        UIFontFeatureTypeIdentifierKey : @(kStylisticAlternativesType),
        UIFontFeatureSelectorIdentifierKey : @(kStylisticAltFourteenOnSelector),
      },
      @"stylistic-fifteen" : @{
        UIFontFeatureTypeIdentifierKey : @(kStylisticAlternativesType),
        UIFontFeatureSelectorIdentifierKey : @(kStylisticAltFifteenOnSelector),
      },
      @"stylistic-sixteen" : @{
        UIFontFeatureTypeIdentifierKey : @(kStylisticAlternativesType),
        UIFontFeatureSelectorIdentifierKey : @(kStylisticAltSixteenOnSelector),
      },
      @"stylistic-seventeen" : @{
        UIFontFeatureTypeIdentifierKey : @(kStylisticAlternativesType),
        UIFontFeatureSelectorIdentifierKey : @(kStylisticAltSeventeenOnSelector),
      },
      @"stylistic-eighteen" : @{
        UIFontFeatureTypeIdentifierKey : @(kStylisticAlternativesType),
        UIFontFeatureSelectorIdentifierKey : @(kStylisticAltEighteenOnSelector),
      },
      @"stylistic-nineteen" : @{
        UIFontFeatureTypeIdentifierKey : @(kStylisticAlternativesType),
        UIFontFeatureSelectorIdentifierKey : @(kStylisticAltNineteenOnSelector),
      },
      @"stylistic-twenty" : @{
        UIFontFeatureTypeIdentifierKey : @(kStylisticAlternativesType),
        UIFontFeatureSelectorIdentifierKey : @(kStylisticAltTwentyOnSelector),
      }
    };
  });
  RCTFontVariantDescriptor *value = mapping[json];
  if (RCT_DEBUG && !value && [json description].length > 0) {
    RCTLogInfo(
        @"Invalid RCTFontVariantDescriptor '%@'. should be one of: %@",
        json,
        [[mapping allKeys] sortedArrayUsingSelector:@selector(caseInsensitiveCompare:)]);
  }
  return value;
}

RCT_ARRAY_CONVERTER(RCTFontVariantDescriptor)

@end

@implementation RCTFont

+ (UIFont *)updateFont:(UIFont *)font
            withFamily:(NSString *)family
                  size:(NSNumber *)size
                weight:(NSString *)weight
                 style:(NSString *)style
               variant:(NSArray<RCTFontVariantDescriptor *> *)variant
       scaleMultiplier:(CGFloat)scaleMultiplier
{
  // Defaults
  static NSString *defaultFontFamily;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    defaultFontFamily = [UIFont systemFontOfSize:14].familyName;
  });
  const RCTFontWeight defaultFontWeight = UIFontWeightRegular;
  const CGFloat defaultFontSize = 14;

  // Initialize properties to defaults
  CGFloat fontSize = defaultFontSize;
  RCTFontWeight fontWeight = defaultFontWeight;
  NSString *familyName = defaultFontFamily;
  BOOL isItalic = NO;
  BOOL isCondensed = NO;

  if (font) {
    familyName = font.familyName ?: defaultFontFamily;
    fontSize = font.pointSize ?: defaultFontSize;
    fontWeight = RCTGetFontWeight(font);
    isItalic = isItalicFont(font);
    isCondensed = isCondensedFont(font);
  }

  // Get font attributes
  fontSize = [RCTConvert CGFloat:size] ?: fontSize;
  if (scaleMultiplier > 0.0 && scaleMultiplier != 1.0) {
    fontSize = round(fontSize * scaleMultiplier);
  }
  familyName = [RCTFont firstAvailableFontFamily:[RCTConvert NSString:family]] ?: familyName;
  isItalic = style ? [RCTConvert RCTFontStyle:style] : isItalic;
  fontWeight = weight ? [RCTConvert RCTFontWeight:weight] : fontWeight;
  isCondensed = isCondensed || [familyName isEqualToString:@"SystemCondensed"];

  BOOL didFindFont = NO;

  // Handle system font as special case. This ensures that we preserve
  // the specific metrics of the standard system font as closely as possible.
  // A `ui-*` generic family is the system font in a design.
  UIFontDescriptorSystemDesign design = RCTSystemDesignForFamily(familyName);
  if (design != nil || [familyName isEqual:defaultFontFamily] || [familyName isEqualToString:@"System"] ||
      [familyName isEqualToString:@"SystemCondensed"]) {
    font = cachedSystemFont(fontSize, fontWeight);
    if (font) {
      didFindFont = YES;

      if (design != nil) {
        UIFontDescriptor *designed = [[font fontDescriptor] fontDescriptorWithDesign:design];
        if (designed != nil) {
          font = [UIFont fontWithDescriptor:designed size:fontSize];
        }
      }
      if (isItalic || isCondensed) {
        UIFontDescriptor *fontDescriptor = [font fontDescriptor];
        UIFontDescriptorSymbolicTraits symbolicTraits = fontDescriptor.symbolicTraits;
        if (isItalic) {
          symbolicTraits |= UIFontDescriptorTraitItalic;
        }
        if (isCondensed) {
          symbolicTraits |= UIFontDescriptorTraitCondensed;
        }
        fontDescriptor = [fontDescriptor fontDescriptorWithSymbolicTraits:symbolicTraits];
        font = [UIFont fontWithDescriptor:fontDescriptor size:fontSize];
      }
    }
  }

  // Gracefully handle being given a font name rather than font family, for
  // example: "Helvetica Light Oblique" rather than just "Helvetica".
  if (!didFindFont && fontNamesForFamilyName(familyName).count == 0) {
    font = [UIFont fontWithName:familyName size:fontSize];
    if (font) {
      // It's actually a font name, not a font family name,
      // but we'll do what was meant, not what was said.
      familyName = font.familyName;
      fontWeight = weight ? fontWeight : RCTGetFontWeight(font);
      isItalic = style ? isItalic : isItalicFont(font);
      isCondensed = isCondensedFont(font);
    } else {
      // Not a valid font or family
      RCTLogInfo(@"Unrecognized font family '%@'", familyName);
      if ([UIFont respondsToSelector:@selector(systemFontOfSize:weight:)]) {
        font = [UIFont systemFontOfSize:fontSize weight:fontWeight];
      } else if (fontWeight > UIFontWeightRegular) {
        font = [UIFont boldSystemFontOfSize:fontSize];
      } else {
        font = [UIFont systemFontOfSize:fontSize];
      }
    }
  }

  NSArray<NSString *> *names = fontNamesForFamilyName(familyName);
  if (!didFindFont) {
    // Get the closest font that matches the given weight for the fontFamily
    CGFloat closestWeight = INFINITY;
    for (NSString *name in names) {
      UIFont *match = [UIFont fontWithName:name size:fontSize];
      if (isItalic == isItalicFont(match) && isCondensed == isCondensedFont(match)) {
        CGFloat testWeight = RCTGetFontWeight(match);
        if (ABS(testWeight - fontWeight) < ABS(closestWeight - fontWeight)) {
          font = match;
          closestWeight = testWeight;
        }
      }
    }
  }

  // If we still don't have a match at least return the first font in the fontFamily
  // This is to support built-in font Zapfino and other custom single font families like Impact
  if (!font && names.count > 0) {
    font = [UIFont fontWithName:names[0] size:fontSize];
  }

  // Apply font variants to font object
  if (variant) {
    NSArray *fontFeatures = [RCTConvert RCTFontVariantDescriptorArray:variant];
    UIFontDescriptor *fontDescriptor = [font.fontDescriptor
        fontDescriptorByAddingAttributes:@{UIFontDescriptorFeatureSettingsAttribute : fontFeatures}];
    font = [UIFont fontWithDescriptor:fontDescriptor size:fontSize];
  }

  return font;
}

+ (UIFont *)updateFont:(UIFont *)font withFamily:(NSString *)family
{
  return [self updateFont:font withFamily:family size:nil weight:nil style:nil variant:nil scaleMultiplier:1];
}

+ (UIFont *)updateFont:(UIFont *)font withSize:(NSNumber *)size
{
  return [self updateFont:font withFamily:nil size:size weight:nil style:nil variant:nil scaleMultiplier:1];
}

+ (UIFont *)updateFont:(UIFont *)font withWeight:(NSString *)weight
{
  return [self updateFont:font withFamily:nil size:nil weight:weight style:nil variant:nil scaleMultiplier:1];
}

+ (UIFont *)updateFont:(UIFont *)font withStyle:(NSString *)style
{
  return [self updateFont:font withFamily:nil size:nil weight:nil style:style variant:nil scaleMultiplier:1];
}

@end
