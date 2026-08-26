/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "RCTAttributedTextUtils.h"

#import <os/lock.h>

/*
 * Kept after `<sup>`/`<sub>` stopped using `kCTSuperscriptAttributeName`.
 *
 * That attribute is CoreText's rather than AppKit's — `NSSuperscriptAttributeName`
 * exists only on macOS — and this import is what made it compile. The elements
 * now carry a plain baseline offset instead, because the CoreText attribute
 * also reduces the size and the user-agent sheet already does that. The import
 * stays because the text stack here is CoreText's throughout and removing it
 * fails in a way that reads like a typo: *use of undeclared identifier* on a
 * name that is obviously a text attribute.
 */
#import <CoreText/CoreText.h>

#include <react/featureflags/ReactNativeFeatureFlags.h>
#include <react/renderer/attributedstring/TextRoleMetrics.h>
#include <react/renderer/components/view/accessibilityPropsConversions.h>
#include <react/renderer/core/LayoutableShadowNode.h>
#include <react/renderer/textlayoutmanager/RCTFontProperties.h>
#include <react/renderer/textlayoutmanager/RCTFontUtils.h>
#include <react/renderer/textlayoutmanager/RCTTextPrimitivesConversions.h>
#include <react/utils/ManagedObjectWrapper.h>
#include <array>
#include <cmath>

using namespace facebook::react;

inline static TextAlignment RCTResolveTextAlignment(TextAlignment textAlignment, bool isRTL)
{
  switch (textAlignment) {
    case TextAlignment::Natural:
      return isRTL ? TextAlignment::Right : TextAlignment::Left;
    case TextAlignment::Start:
      return isRTL ? TextAlignment::Right : TextAlignment::Left;
    case TextAlignment::End:
      return isRTL ? TextAlignment::Left : TextAlignment::Right;
    case TextAlignment::Right:
      return isRTL ? TextAlignment::Left : TextAlignment::Right;
    case TextAlignment::Left:
      return isRTL ? TextAlignment::Right : TextAlignment::Left;
    default:
      return textAlignment;
  }
}

inline static UIFontWeight RCTUIFontWeightFromInteger(NSInteger fontWeight)
{
  assert(fontWeight > 50);
  assert(fontWeight < 950);

  static auto weights = std::to_array<UIFontWeight>({/* ~100 */ UIFontWeightUltraLight,
                                                     /* ~200 */ UIFontWeightThin,
                                                     /* ~300 */ UIFontWeightLight,
                                                     /* ~400 */ UIFontWeightRegular,
                                                     /* ~500 */ UIFontWeightMedium,
                                                     /* ~600 */ UIFontWeightSemibold,
                                                     /* ~700 */ UIFontWeightBold,
                                                     /* ~800 */ UIFontWeightHeavy,
                                                     /* ~900 */ UIFontWeightBlack});
  // The expression is designed to convert something like 760 or 830 to 7.
  return weights[(fontWeight + 50) / 100 - 1];
}

inline static UIFontTextStyle RCTUIFontTextStyleForDynamicTypeRamp(const DynamicTypeRamp &dynamicTypeRamp)
{
  switch (dynamicTypeRamp) {
    case DynamicTypeRamp::Caption2:
      return UIFontTextStyleCaption2;
    case DynamicTypeRamp::Caption1:
      return UIFontTextStyleCaption1;
    case DynamicTypeRamp::Footnote:
      return UIFontTextStyleFootnote;
    case DynamicTypeRamp::Subheadline:
      return UIFontTextStyleSubheadline;
    case DynamicTypeRamp::Callout:
      return UIFontTextStyleCallout;
    case DynamicTypeRamp::Body:
      return UIFontTextStyleBody;
    case DynamicTypeRamp::Headline:
      return UIFontTextStyleHeadline;
    case DynamicTypeRamp::Title3:
      return UIFontTextStyleTitle3;
    case DynamicTypeRamp::Title2:
      return UIFontTextStyleTitle2;
    case DynamicTypeRamp::Title1:
      return UIFontTextStyleTitle1;
    case DynamicTypeRamp::LargeTitle:
// UIFontTextStyleLargeTitle is not available on tvOS.
#if !TARGET_OS_TV
      return UIFontTextStyleLargeTitle;
#else
      return UIFontTextStyleTitle1;
#endif
  }
}

/*
 * The font the platform itself uses for a text style, at the DEFAULT content
 * size.
 *
 * Asked, not tabulated, which is the whole point of a text ROLE: the OS owns
 * these numbers, and a copy of them is right until the day it moves.
 * `preferredFontForTextStyle:` also answers with the WEIGHT, which a table of
 * sizes cannot — Headline is semibold and Body is not, at the same 17pt.
 *
 * Deliberately alongside `RCTBaseSizeForDynamicTypeRamp` rather than replacing
 * it. That function is React Native's, it has its own callers and its own
 * documented behaviour for `<Text dynamicTypeRamp>`, and changing what it
 * returns would change what every existing app using that prop renders. This
 * serves the element path only.
 *
 * At the DEFAULT content size deliberately. The caller scales it through
 * `UIFontMetrics` for the same style, which is where the user's Dynamic Type
 * setting is applied; taking the size at the CURRENT size as well would apply
 * that scaling twice.
 */
inline static UIFont *RCTPreferredFontForDynamicTypeRamp(const DynamicTypeRamp &dynamicTypeRamp)
{
  /*
   * MEMOISED, because this is asked once per text run per layout and the answer
   * does not move.
   *
   * Measured on this simulator: `preferredFontForTextStyle:` costs ~300ns, a
   * cached lookup ~17ns. Three hundred nanoseconds is nothing once and
   * something else entirely when every string child on a screen asks for it —
   * and our path asks twice, for the size and for the weight. At a few thousand
   * runs rebuilt a few times a commit that is milliseconds off a frame budget,
   * to re-derive a value that cannot have changed.
   *
   * It cannot have changed because we ask at the DEFAULT content size, on
   * purpose: the user's Dynamic Type setting is applied afterwards through
   * `UIFontMetrics`, so what this returns is a property of the OS rather than
   * of the moment. The one thing that does move it is the Bold Text
   * accessibility setting, which changes the system font itself — hence the
   * two slots rather than one.
   *
   * The fill is unsynchronised deliberately: two threads racing here compute
   * the same font and store the same pointer, so the race is benign and a lock
   * on a text-layout hot path would cost more than the work it guards.
   */
  static UIFont *cache[2][12];
  const size_t slot = UIAccessibilityIsBoldTextEnabled() ? 1 : 0;
  const size_t index = (size_t)dynamicTypeRamp;
  if (index >= 12) {
    return nil;
  }
  UIFont *cached = cache[slot][index];
  if (cached != nil) {
    return cached;
  }
  static UITraitCollection *defaultContentSize;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    defaultContentSize =
        [UITraitCollection traitCollectionWithPreferredContentSizeCategory:UIContentSizeCategoryLarge];
  });
  UIFont *font = [UIFont preferredFontForTextStyle:RCTUIFontTextStyleForDynamicTypeRamp(dynamicTypeRamp)
                      compatibleWithTraitCollection:defaultContentSize];
  cache[slot][index] = font;
  return font;
}

inline static CGFloat RCTBaseSizeForDynamicTypeRamp(const DynamicTypeRamp &dynamicTypeRamp)
{
  // Values taken from
  // https://developer.apple.com/design/human-interface-guidelines/foundations/typography/#specifications
  switch (dynamicTypeRamp) {
    case DynamicTypeRamp::Caption2:
      return 11.0;
    case DynamicTypeRamp::Caption1:
      return 12.0;
    case facebook::react::DynamicTypeRamp::Footnote:
      return 13.0;
    case facebook::react::DynamicTypeRamp::Subheadline:
      return 15.0;
    case facebook::react::DynamicTypeRamp::Callout:
      return 16.0;
    case facebook::react::DynamicTypeRamp::Body:
      return 17.0;
    case facebook::react::DynamicTypeRamp::Headline:
      return 17.0;
    case facebook::react::DynamicTypeRamp::Title3:
      return 20.0;
    case facebook::react::DynamicTypeRamp::Title2:
      return 22.0;
    case facebook::react::DynamicTypeRamp::Title1:
      return 28.0;
    case facebook::react::DynamicTypeRamp::LargeTitle:
      return 34.0;
  }
}

/** The weight the platform gives that style, or NaN where it states none. */
inline static CGFloat RCTWeightForDynamicTypeRamp(const DynamicTypeRamp &dynamicTypeRamp)
{
  UIFontDescriptor *descriptor = RCTPreferredFontForDynamicTypeRamp(dynamicTypeRamp).fontDescriptor;
  NSDictionary *traits = [descriptor objectForKey:UIFontDescriptorTraitsAttribute];
  NSNumber *weight = traits[UIFontWeightTrait];
  return weight != nil ? (CGFloat)weight.doubleValue : (CGFloat)NAN;
}


/*
 * The Dynamic Type multiplier for a role at a size, MEMOISED.
 *
 * Measured on this simulator, per text run: `metricsForTextStyle:` costs 132ns
 * and `scaledValueForValue:` 930ns, and both run for every run carrying a role,
 * every time an attributed string is built. A screen of a few hundred runs
 * rebuilt a couple of times per commit spends milliseconds re-deriving numbers
 * that did not move.
 *
 * Keyed by the SIZE as well as the role, because the multiplier is not constant
 * within a role. `scaledValueForValue:` rounds to whole points, so at XXXL a
 * Body 13 scales x1.3077 and a Body 8 scales x1.3333 — one entry per role would
 * quietly hand one size another size's scaling.
 *
 * Cleared when the user changes their text size, which is the only thing that
 * moves the answer. Getting that wrong would leave every `<Text>` on a stale
 * scale until relaunch, so the invalidation is a notification rather than a
 * guess about lifetimes.
 *
 * Capped, because a size can be animated: an app driving `fontSize` from a
 * gesture would otherwise grow this without limit. Past the cap the answer is
 * still correct, just uncached.
 */
inline static CGFloat RCTScaledMultiplierForRamp(const DynamicTypeRamp &dynamicTypeRamp, CGFloat requestedSize)
{
  static os_unfair_lock lock = OS_UNFAIR_LOCK_INIT;
  static NSMutableDictionary<NSNumber *, NSNumber *> *cache;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    cache = [NSMutableDictionary new];
    [[NSNotificationCenter defaultCenter] addObserverForName:UIContentSizeCategoryDidChangeNotification
                                                      object:nil
                                                       queue:nil
                                                  usingBlock:^(NSNotification *_Nonnull) {
                                                    os_unfair_lock_lock(&lock);
                                                    [cache removeAllObjects];
                                                    os_unfair_lock_unlock(&lock);
                                                  }];
  });

  NSNumber *key = @(((uint64_t)dynamicTypeRamp << 32) ^ (uint64_t)llround(requestedSize * 100.0));
  os_unfair_lock_lock(&lock);
  NSNumber *hit = cache[key];
  os_unfair_lock_unlock(&lock);
  if (hit != nil) {
    return (CGFloat)hit.doubleValue;
  }

  UIFontMetrics *fontMetrics =
      [UIFontMetrics metricsForTextStyle:RCTUIFontTextStyleForDynamicTypeRamp(dynamicTypeRamp)];
  const CGFloat multiplier = [fontMetrics scaledValueForValue:requestedSize] / requestedSize;

  os_unfair_lock_lock(&lock);
  static const NSUInteger kMaxEntries = 256;
  if (cache.count < kMaxEntries) {
    cache[key] = @(multiplier);
  }
  os_unfair_lock_unlock(&lock);
  return multiplier;
}

/*
 * Tells the layout layer how big each text role currently is.
 *
 * The sizes here are the ones text is actually drawn at — the platform's base
 * size for the role, scaled by the user's Dynamic Type setting — because what
 * reads them is a margin that has to sit correctly beside that text. See
 * `TextRoleMetrics`.
 *
 * Published rather than looked up because the reader cannot ask: resolving a
 * role needs UIKit, and layout does not run on a UI thread. This is the side of
 * the boundary that can ask.
 *
 * Every ramp, not just the six a heading uses. The property accepts all eleven,
 * and a role that resolved to nothing here would leave its element computing a
 * margin from the fallback while its text used the platform's size — the
 * two would disagree, and only for the roles nobody thought to list.
 */
void RCTPublishTextRoleMetrics(void)
{
  for (size_t index = 0; index < kDynamicTypeRampCount; index++) {
    const DynamicTypeRamp ramp = (DynamicTypeRamp)index;
    UIFont *font = RCTPreferredFontForDynamicTypeRamp(ramp);
    if (font == nil) {
      continue;
    }
    // The same two steps the text itself takes: the base size at the default
    // content size, then the scaling for the user's setting. Taking
    // `preferredFontForTextStyle:` at the CURRENT size instead would look
    // simpler and would double-apply the scaling, which is the mistake the
    // memo above exists to avoid.
    const CGFloat base = font.pointSize;
    TextRoleMetrics::publish(ramp, (Float)(base * RCTScaledMultiplierForRamp(ramp, base)));
  }

  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    // The published sizes are only right for the text size in force when they
    // were taken. Without this, changing the text size in Settings would resize
    // every heading and leave its margins at the old scale.
    [[NSNotificationCenter defaultCenter] addObserverForName:UIContentSizeCategoryDidChangeNotification
                                                      object:nil
                                                       queue:[NSOperationQueue mainQueue]
                                                  usingBlock:^(NSNotification *_Nonnull) {
                                                    RCTPublishTextRoleMetrics();
                                                  }];
  });
}

inline static CGFloat RCTEffectiveFontSizeMultiplierFromTextAttributes(const TextAttributes &textAttributes)
{
  if (textAttributes.allowFontScaling.value_or(true)) {
    CGFloat fontSizeMultiplier = !isnan(textAttributes.fontSizeMultiplier) ? textAttributes.fontSizeMultiplier : 1.0;
    if (textAttributes.dynamicTypeRamp.has_value()) {
      DynamicTypeRamp dynamicTypeRamp = textAttributes.dynamicTypeRamp.value();
      // Using a specific font size reduces rounding errors from -scaledValueForValue:
      CGFloat requestedSize =
          isnan(textAttributes.fontSize) ? RCTBaseSizeForDynamicTypeRamp(dynamicTypeRamp) : textAttributes.fontSize;
      fontSizeMultiplier = RCTScaledMultiplierForRamp(dynamicTypeRamp, requestedSize);
    }
    CGFloat maxFontSizeMultiplier =
        !isnan(textAttributes.maxFontSizeMultiplier) ? textAttributes.maxFontSizeMultiplier : 0.0;
    return maxFontSizeMultiplier >= 1.0 ? fminf(maxFontSizeMultiplier, fontSizeMultiplier) : fontSizeMultiplier;
  } else {
    return 1.0;
  }
}

inline static UIFont *RCTEffectiveFontFromTextAttributes(const TextAttributes &textAttributes)
{
  NSString *fontFamily = [NSString stringWithUTF8String:textAttributes.fontFamily.c_str()];

  RCTFontProperties fontProperties;
  fontProperties.family = fontFamily;
  fontProperties.size = textAttributes.fontSize;
  fontProperties.style = textAttributes.fontStyle.has_value()
      ? RCTFontStyleFromFontStyle(textAttributes.fontStyle.value())
      : RCTFontStyleUndefined;
  fontProperties.variant = textAttributes.fontVariant.has_value()
      ? RCTFontVariantFromFontVariant(textAttributes.fontVariant.value())
      : RCTFontVariantUndefined;
  fontProperties.weight = textAttributes.fontWeight.has_value()
      ? RCTUIFontWeightFromInteger((NSInteger)textAttributes.fontWeight.value())
      : NAN;

  /*
   * A text ROLE supplies whatever the author did not.
   *
   * The role is the platform's own name for this text — `title1`, `headline` —
   * and the platform answers it with a font, not a number. Size and weight are
   * taken from that font ONLY where nothing has already decided them, so an
   * author's `font-size` or `font-weight` still wins: the platform is the
   * initial value, not an override.
   *
   * The weight is the half a size table cannot express. Headline is 17pt
   * SEMIBOLD and Body is 17pt regular — the same size, different text. Before
   * this, asking for the Headline ramp got the size and lost the semibold.
   */
  if (textAttributes.dynamicTypeRamp.has_value()) {
    if (isnan(fontProperties.size)) {
      fontProperties.size = RCTPreferredFontForDynamicTypeRamp(textAttributes.dynamicTypeRamp.value()).pointSize;
    }
    if (isnan(fontProperties.weight)) {
      /*
       * Stated only when the platform's answer is not REGULAR.
       *
       * `UIFontWeightRegular` is 0 and an unstated weight already means
       * regular, so naming it says nothing that was not already true. Every
       * Title in the iOS scale is regular, so the common case is the one that
       * would carry the redundant declaration.
       *
       * No measurable cost either way — I looked, expecting naming a weight to
       * bypass a font cache, and the numbers did not support it. This is here
       * because it is redundant, not because it is slow.
       *
       * Headline's semibold IS stated, because there it is the whole
       * difference between Headline and Body.
       */
      const CGFloat platformWeight = RCTWeightForDynamicTypeRamp(textAttributes.dynamicTypeRamp.value());
      if (!isnan(platformWeight) && fabs(platformWeight - UIFontWeightRegular) > 0.001) {
        fontProperties.weight = platformWeight;
      }
    }
  }

  fontProperties.sizeMultiplier = RCTEffectiveFontSizeMultiplierFromTextAttributes(textAttributes);

  return RCTFontWithFontProperties(fontProperties);
}

inline static UIColor *RCTEffectiveForegroundColorFromTextAttributes(const TextAttributes &textAttributes)
{
  UIColor *effectiveForegroundColor = RCTUIColorFromSharedColor(textAttributes.foregroundColor) ?: [UIColor blackColor];

  if (!isnan(textAttributes.opacity)) {
    effectiveForegroundColor = [effectiveForegroundColor
        colorWithAlphaComponent:CGColorGetAlpha(effectiveForegroundColor.CGColor) * textAttributes.opacity];
  }

  return effectiveForegroundColor;
}

inline static UIColor *RCTEffectiveBackgroundColorFromTextAttributes(const TextAttributes &textAttributes)
{
  UIColor *effectiveBackgroundColor = RCTUIColorFromSharedColor(textAttributes.backgroundColor);

  if (effectiveBackgroundColor && !isnan(textAttributes.opacity)) {
    effectiveBackgroundColor = [effectiveBackgroundColor
        colorWithAlphaComponent:CGColorGetAlpha(effectiveBackgroundColor.CGColor) * textAttributes.opacity];
  }

  return effectiveBackgroundColor ?: [UIColor clearColor];
}

NSMutableDictionary<NSAttributedStringKey, id> *RCTNSTextAttributesFromTextAttributes(
    const TextAttributes &textAttributes)
{
  NSMutableDictionary<NSAttributedStringKey, id> *attributes = [NSMutableDictionary dictionaryWithCapacity:10];

  // Font
  UIFont *font = RCTEffectiveFontFromTextAttributes(textAttributes);
  if (font) {
    attributes[NSFontAttributeName] = font;
  }

  // Colors
  UIColor *effectiveForegroundColor = RCTEffectiveForegroundColorFromTextAttributes(textAttributes);

  if (textAttributes.foregroundColor || !isnan(textAttributes.opacity)) {
    attributes[NSForegroundColorAttributeName] = effectiveForegroundColor;
  }

  if (textAttributes.backgroundColor || !isnan(textAttributes.opacity)) {
    attributes[NSBackgroundColorAttributeName] = RCTEffectiveBackgroundColorFromTextAttributes(textAttributes);
  }

  // Kerning
  if (!isnan(textAttributes.letterSpacing)) {
    attributes[NSKernAttributeName] = @(textAttributes.letterSpacing);
  }

  // A numeric baseline shift (positive raises), stated in points — the
  // symbolic list markers use it to centre their ink at the x-height
  // midpoint the way browsers paint theirs.
  if (!isnan(textAttributes.baselineShift)) {
    attributes[NSBaselineOffsetAttributeName] = @(textAttributes.baselineShift);
  }

  /*
   * `<sup>` / `<sub>`: the SHIFT only. The size is the sheet's.
   *
   * This used `kCTSuperscriptAttributeName`, and that attribute does two jobs
   * at once — CoreText reads the font's superscript metrics and derives both
   * the shift AND a size reduction, substituting superior/inferior glyphs.
   * The user-agent sheet already states `font-size: 0.8333em` for these
   * elements, exactly as a browser does, so the text was reduced TWICE on iOS
   * and rendered near half the body size where the web puts it at 0.83.
   *
   * Measured in real Safari on `x<sup>2</sup>`: `getComputedStyle` reports the
   * superscript at 13.333px against a 16px parent — 0.8333, the sheet's number
   * to four figures. So the sheet owns the size and the platform owns the
   * shift, which is the split Android already had: `SuperscriptSpan` shifts
   * without resizing and the sheet supplies the size there.
   *
   * The offset is derived from the font rather than guessed at as an em
   * fraction — the original comment was right about that, and it is why this
   * mirrors Android's rule (half the ascent of the already-reduced font)
   * rather than inventing a constant.
   */
  if (textAttributes.verticalAlign.has_value() &&
      *textAttributes.verticalAlign != TextVerticalAlign::Baseline) {
    UIFont *shiftedFont = attributes[NSFontAttributeName];
    if (shiftedFont != nil) {
      const CGFloat magnitude = shiftedFont.ascender / 2;
      attributes[NSBaselineOffsetAttributeName] =
          @(*textAttributes.verticalAlign == TextVerticalAlign::Super ? magnitude : -magnitude);
    }
  }

  // Paragraph Style
  NSMutableParagraphStyle *paragraphStyle = [NSMutableParagraphStyle new];
  BOOL isParagraphStyleUsed = NO;
  const bool isRTL = textAttributes.layoutDirection == LayoutDirection::RightToLeft;
  if (textAttributes.alignment.has_value() || isRTL) {
    TextAlignment textAlignment =
        RCTResolveTextAlignment(textAttributes.alignment.value_or(TextAlignment::Natural), isRTL);

    paragraphStyle.alignment = RCTNSTextAlignmentFromTextAlignment(textAlignment);
    isParagraphStyleUsed = YES;
  }

  if (textAttributes.baseWritingDirection.has_value()) {
    paragraphStyle.baseWritingDirection =
        RCTNSWritingDirectionFromWritingDirection(textAttributes.baseWritingDirection.value());
    isParagraphStyleUsed = YES;
  }

  if (textAttributes.lineBreakStrategy.has_value()) {
    paragraphStyle.lineBreakStrategy =
        RCTNSLineBreakStrategyFromLineBreakStrategy(textAttributes.lineBreakStrategy.value());
    isParagraphStyleUsed = YES;
  }

  if (textAttributes.lineBreakMode.has_value()) {
    paragraphStyle.lineBreakMode = RCTNSLineBreakModeFromLineBreakMode(textAttributes.lineBreakMode.value());
    isParagraphStyleUsed = YES;
  }

  if (!isnan(textAttributes.lineHeight)) {
    CGFloat lineHeight = textAttributes.lineHeight * RCTEffectiveFontSizeMultiplierFromTextAttributes(textAttributes);
    paragraphStyle.minimumLineHeight = lineHeight;
    paragraphStyle.maximumLineHeight = lineHeight;
    isParagraphStyleUsed = YES;
  }

  if (isParagraphStyleUsed) {
    attributes[NSParagraphStyleAttributeName] = paragraphStyle;
  }

  // Decoration
  if (textAttributes.textDecorationLineType.value_or(TextDecorationLineType::None) != TextDecorationLineType::None) {
    auto textDecorationLineType = textAttributes.textDecorationLineType.value();
    auto textDecorationStyleValue = textAttributes.textDecorationStyle.value_or(TextDecorationStyle::Solid);
    UIColor *textDecorationColor = RCTUIColorFromSharedColor(textAttributes.textDecorationColor);

    // Custom drawing for styles UIKit can't render faithfully: wavy (no
    // native value), and dotted/dashed (UIKit's pattern bits don't match
    // browser geometry). The other styles continue to use NSUnderlineStyle.
    bool needsCustomDrawing = textDecorationStyleValue == TextDecorationStyle::Wavy ||
        textDecorationStyleValue == TextDecorationStyle::Dotted ||
        textDecorationStyleValue == TextDecorationStyle::Dashed;
    if (needsCustomDrawing) {
      UIColor *strokeColor = (textDecorationColor != nil) ? textDecorationColor
                                                          : RCTUIColorFromSharedColor(textAttributes.foregroundColor);
      NSMutableArray<NSString *> *lines = [NSMutableArray array];
      if (textDecorationLineType == TextDecorationLineType::Underline ||
          textDecorationLineType == TextDecorationLineType::UnderlineStrikethrough) {
        [lines addObject:@"underline"];
      }
      if (textDecorationLineType == TextDecorationLineType::Strikethrough ||
          textDecorationLineType == TextDecorationLineType::UnderlineStrikethrough) {
        [lines addObject:@"line-through"];
      }
      NSString *styleKey = textDecorationStyleValue == TextDecorationStyle::Wavy
          ? @"wavy"
          : (textDecorationStyleValue == TextDecorationStyle::Dotted ? @"dotted" : @"dashed");
      attributes[RCTCustomDecorationAttributeName] = @{
        @"lines" : lines,
        @"color" : (strokeColor != nil) ? strokeColor : [UIColor labelColor],
        @"style" : styleKey
      };
    } else {
      NSUnderlineStyle style = RCTNSUnderlineStyleFromTextDecorationStyle(textDecorationStyleValue);

      // Underline
      if (textDecorationLineType == TextDecorationLineType::Underline ||
          textDecorationLineType == TextDecorationLineType::UnderlineStrikethrough) {
        attributes[NSUnderlineStyleAttributeName] = @(style);

        if (textDecorationColor != nil) {
          attributes[NSUnderlineColorAttributeName] = textDecorationColor;
        }
      }

      // Strikethrough
      if (textDecorationLineType == TextDecorationLineType::Strikethrough ||
          textDecorationLineType == TextDecorationLineType::UnderlineStrikethrough) {
        attributes[NSStrikethroughStyleAttributeName] = @(style);

        if (textDecorationColor != nil) {
          attributes[NSStrikethroughColorAttributeName] = textDecorationColor;
        }
      }
    }
  }

  // Shadow
  if (textAttributes.textShadowOffset.has_value()) {
    auto textShadowOffset = textAttributes.textShadowOffset.value();
    NSShadow *shadow = [NSShadow new];
    shadow.shadowOffset = CGSize{textShadowOffset.width, textShadowOffset.height};
    if (!isnan(textAttributes.textShadowRadius)) {
      shadow.shadowBlurRadius = textAttributes.textShadowRadius;
    }
    if (textAttributes.textShadowColor) {
      shadow.shadowColor = RCTUIColorFromSharedColor(textAttributes.textShadowColor);
    }
    attributes[NSShadowAttributeName] = shadow;
  }

  // Special
  if (textAttributes.isHighlighted.value_or(false)) {
    attributes[RCTAttributedStringIsHighlightedAttributeName] = @YES;
  }

  if (textAttributes.role.has_value()) {
    std::string roleStr = toString(textAttributes.role.value());
    attributes[RCTTextAttributesAccessibilityRoleAttributeName] = [NSString stringWithUTF8String:roleStr.c_str()];
  } else if (textAttributes.accessibilityRole.has_value()) {
    std::string roleStr = toString(textAttributes.accessibilityRole.value());
    attributes[RCTTextAttributesAccessibilityRoleAttributeName] = [NSString stringWithUTF8String:roleStr.c_str()];
  }

  return attributes;
}

static void RCTApplyBaselineOffsetForRange(NSMutableAttributedString *attributedText, NSRange attributedTextRange)
{
  __block CGFloat maximumLineHeight = 0;

  [attributedText enumerateAttribute:NSParagraphStyleAttributeName
                             inRange:attributedTextRange
                             options:NSAttributedStringEnumerationLongestEffectiveRangeNotRequired
                          usingBlock:^(NSParagraphStyle *paragraphStyle, __unused NSRange range, __unused BOOL *stop) {
                            if (!paragraphStyle) {
                              return;
                            }

                            maximumLineHeight = MAX(paragraphStyle.maximumLineHeight, maximumLineHeight);
                          }];

  if (maximumLineHeight == 0) {
    // `lineHeight` was not specified, nothing to do.
    return;
  }

  __block CGFloat maximumFontLineHeight = 0;

  [attributedText enumerateAttribute:NSFontAttributeName
                             inRange:attributedTextRange
                             options:NSAttributedStringEnumerationLongestEffectiveRangeNotRequired
                          usingBlock:^(UIFont *font, NSRange range, __unused BOOL *stop) {
                            if (!font) {
                              return;
                            }

                            maximumFontLineHeight = MAX(font.lineHeight, maximumFontLineHeight);
                          }];

  if (maximumLineHeight < maximumFontLineHeight && !ReactNativeFeatureFlags::enableIOSCompressedTextFrameAdjustment()) {
    return;
  }

  CGFloat baseLineOffset = (maximumLineHeight - maximumFontLineHeight) / 2.0;

  /*
   * ADDED to whatever is already there, not written over it.
   *
   * `<sup>`/`<sub>` carry their own baseline offset on their own range (see
   * the superscript block above), and this centring pass runs over the WHOLE
   * string afterwards. A plain `addAttribute:` would replace those per-run
   * values and silently drop the shift, leaving superscripts sitting on the
   * baseline. The two offsets are independent and compose: one centres the run
   * within its line, the other raises or lowers a fragment within the run.
   */
  [attributedText enumerateAttribute:NSBaselineOffsetAttributeName
                             inRange:attributedTextRange
                             options:0
                          usingBlock:^(NSNumber *existing, NSRange range, __unused BOOL *stop) {
                            const CGFloat total = baseLineOffset + (existing != nil ? existing.doubleValue : 0);
                            [attributedText addAttribute:NSBaselineOffsetAttributeName
                                                   value:@(total)
                                                   range:range];
                          }];
}

void RCTApplyBaselineOffset(NSMutableAttributedString *attributedText)
{
  if (ReactNativeFeatureFlags::enableIOSTextBaselineOffsetPerLine()) {
    [attributedText.string
        enumerateSubstringsInRange:NSMakeRange(0, attributedText.length)
                           options:NSStringEnumerationByLines | NSStringEnumerationSubstringNotRequired
                        usingBlock:^(
                            NSString *_Nullable substring,
                            NSRange substringRange,
                            NSRange enclosingRange,
                            BOOL *_Nonnull stop) {
                          RCTApplyBaselineOffsetForRange(attributedText, enclosingRange);
                        }];
  } else {
    RCTApplyBaselineOffsetForRange(attributedText, NSMakeRange(0, attributedText.length));
  }
}

static NSMutableAttributedString *RCTNSAttributedStringFragmentFromFragment(
    const AttributedString::Fragment &fragment,
    UIImage *placeholderImage)
{
  if (fragment.isAttachment()) {
    auto layoutMetrics = fragment.parentShadowView.layoutMetrics;
    // TextKit reads `bounds.origin.y` as the attachment's offset from the
    // BASELINE: 0 drops the box's bottom onto it. That is only right for a box
    // with no line boxes of its own. CSS2 §10.8.1 puts an atomic inline's own
    // baseline on the line's, so a box whose baseline sits above its bottom
    // edge has to hang the difference below the line's baseline.
    // How far the box hangs below the line's baseline, so its OWN baseline
    // lands on the line's (CSS2 §10.8.1).
    //
    CGFloat descentBelowBaseline = layoutMetrics.frame.size.height - fragment.atomicInlineBaseline;

    // An enclosing inline box's leading/trailing space has to occupy advance,
    // and for an attachment it has to do so HERE.
    //
    // Everywhere else that space is expressed as kerning on the neighbouring
    // character (see RCTApplyInlineBoxSpacing, which explains why no spacer is
    // injected). An `NSTextAttachment` takes its advance from `bounds` and
    // ignores kerning, so `<span style="padding-left:10px"><img></span>` lost
    // the padding entirely: the image sat where the padding should be and
    // everything after it was short by both edges. Folding the space into the
    // attachment's own width is the one way it survives.
    //
    // The box is then drawn inset by the leading edge — see the placement in
    // RCTTextLayoutManager, which steps over it — so the space is reserved
    // without the picture growing into it.
    CGFloat leadingSpace = fragment.leadingInlineSpace();
    CGFloat trailingSpace = fragment.trailingInlineSpace();
    CGFloat boundsOffsetY = -descentBelowBaseline;

    // A box aligned to an EDGE of the line must not move the line's baseline.
    //
    // TextKit derives a line's baseline from the maximum ascent on it, and an
    // attachment's ascent is whatever its bounds put above the baseline. Left
    // hanging from the baseline like a baseline-aligned box, a 40pt
    // `vertical-align: top` box dragged the baseline down to 40 — which placed
    // the box itself correctly (it is repositioned against the line fragment
    // later) but corrupted the baseline everything else on the line is measured
    // from. `middle`, which is defined relative to that baseline, came out 24pt
    // low.
    //
    // So an edge-aligned box is given bounds that reach exactly the strut's
    // ascent and hang the remainder below: the line still grows to fit it, and
    // the baseline stays where the strut put it. This is the same model the C++
    // measurer uses, where edge-aligned boxes contribute to the line's height
    // without contributing ascent.
    if (fragment.atomicInlineVerticalAlign != 0) {
      UIFont *font = RCTEffectiveFontFromTextAttributes(fragment.textAttributes);
      CGFloat height = layoutMetrics.frame.size.height;
      if (fragment.atomicInlineVerticalAlign == 3) {
        // `middle` IS positioned relative to the baseline — half the parent's
        // x-height above it — so its contribution is exact: half the box above
        // that point, half below. Left baseline-aligned it claimed its whole
        // height as ascent and pushed the baseline down by the difference,
        // which inflated the line by the font's descent and took the box with
        // it.
        CGFloat xHeight = font != nil ? font.xHeight : 0;
        boundsOffsetY = -(height / 2 - xHeight / 2);
      } else {
        // `top` and `bottom` are positioned against the line's edges, so they
        // must not claim ascent at all: reaching exactly the strut's ascent and
        // hanging the rest below lets the line grow to fit without moving the
        // baseline.
        CGFloat ascent = font != nil ? std::abs(font.ascender) : 0;
        CGFloat descent = font != nil ? std::abs(font.descender) : 0;
        CGFloat strutAscent = ascent;
        if (!isnan(fragment.textAttributes.lineHeight)) {
          CGFloat lineHeight = fragment.textAttributes.lineHeight *
              RCTEffectiveFontSizeMultiplierFromTextAttributes(fragment.textAttributes);
          // Half-leading above the font's ascent, as CSS distributes it.
          strutAscent = ascent + (lineHeight - (ascent + descent)) / 2;
        }
        boundsOffsetY = strutAscent - height;
      }
    }

    // A BASELINE-aligned box has to leave room for the strut's descent below
    // it.
    //
    // TextKit takes an attachment's line metrics entirely from its bounds, so a
    // line carrying only this box had the box's own ascent and NO descent — a
    // 40pt box made a 40pt line where a browser makes it 44, because the box
    // sits on the baseline and the strut still hangs below it. (That gap under
    // an image is the familiar one `vertical-align: top` removes.)
    //
    // The strut's descent is added to the bounds and the origin moved down by
    // the same amount: the ascent is unchanged, so the box does not move, and
    // the line gains exactly the descent it was missing. The addition is
    // recorded so the placement can report the real box rather than the
    // inflated one.
    CGFloat extraDescent = 0;
    if (fragment.atomicInlineVerticalAlign == 0) {
      UIFont *font = RCTEffectiveFontFromTextAttributes(fragment.textAttributes);
      CGFloat fontDescent = font != nil ? std::abs(font.descender) : 0;
      CGFloat strutDescent = fontDescent;
      if (font != nil && !isnan(fragment.textAttributes.lineHeight)) {
        CGFloat ascent = std::abs(font.ascender);
        CGFloat lineHeight = fragment.textAttributes.lineHeight *
            RCTEffectiveFontSizeMultiplierFromTextAttributes(fragment.textAttributes);
        strutDescent = fontDescent + (lineHeight - (ascent + fontDescent)) / 2;
      }
      extraDescent = std::max<CGFloat>(0, strutDescent - descentBelowBaseline);
      boundsOffsetY -= extraDescent;
    }

    CGRect bounds = {
        .origin = {.x = layoutMetrics.frame.origin.x, .y = boundsOffsetY},
        .size = {
            .width = layoutMetrics.frame.size.width + leadingSpace + trailingSpace,
            .height = layoutMetrics.frame.size.height + extraDescent}};

    NSTextAttachment *attachment = [NSTextAttachment new];
    attachment.image = placeholderImage;
    attachment.bounds = bounds;

    NSMutableAttributedString *attachmentString =
        [[NSMutableAttributedString attributedStringWithAttachment:attachment] mutableCopy];

    // An attachment character carries the run's text attributes like any other
    // character.
    //
    // It looks like it should not need them — nothing about it is drawn from a
    // font. But the PARAGRAPH STYLE lives in those attributes, and that is what
    // gives the line its strut: `minimumLineHeight` is what makes a line with a
    // 10pt box on it still occupy the 20pt its `line-height` asks for (CSS2
    // §10.8). Without them a line containing only atomic inlines had no strut
    // at all and collapsed to the height of its tallest box — a `<div>` of 10pt
    // boxes measured 10pt where every browser reports 20.
    //
    // Only lines made *entirely* of attachments were affected, because a single
    // text fragment anywhere on the line brought the paragraph style with it —
    // the same shape as the other inline bugs this month, where the box path
    // quietly lacked what the text path had.
    [attachmentString addAttributes:RCTNSTextAttributesFromTextAttributes(fragment.textAttributes)
                              range:NSMakeRange(0, attachmentString.length)];

    if (extraDescent > 0) {
      [attachmentString addAttribute:RCTAtomicInlineExtraDescentAttributeName
                               value:@(extraDescent)
                               range:NSMakeRange(0, attachmentString.length)];
    }
    if (leadingSpace > 0) {
      [attachmentString addAttribute:RCTAtomicInlineLeadingSpaceAttributeName
                               value:@(leadingSpace)
                               range:NSMakeRange(0, attachmentString.length)];
    }
    if (trailingSpace > 0) {
      [attachmentString addAttribute:RCTAtomicInlineTrailingSpaceAttributeName
                               value:@(trailingSpace)
                               range:NSMakeRange(0, attachmentString.length)];
    }

    // Where this box asked to sit on the line — see the attribute's declaration.
    if (fragment.atomicInlineVerticalAlign != 0) {
      [attachmentString addAttribute:RCTAtomicInlineVerticalAlignAttributeName
                               value:@(fragment.atomicInlineVerticalAlign)
                               range:NSMakeRange(0, attachmentString.length)];
    }

    return attachmentString;
  } else {
    NSString *string = [NSString stringWithUTF8String:fragment.string.c_str()];

    if (fragment.textAttributes.textTransform.has_value()) {
      auto textTransform = fragment.textAttributes.textTransform.value();
      string = RCTNSStringFromStringApplyingTextTransform(string, textTransform);
    }

    NSMutableDictionary<NSAttributedStringKey, id> *attributes =
        RCTNSTextAttributesFromTextAttributes(fragment.textAttributes);
    if (!fragment.inlineBox.isEmpty()) {
      // A fragment with box decorations gets its background from
      // drawInlineBoxDecorations, which paints the element's whole border box
      // — the attribute covers glyph advances only, which starts AFTER the
      // left padding (G3 kerns it onto the preceding character) and spills
      // over the right margin. Both painting the box and keeping the
      // attribute would double-paint a translucent colour.
      [attributes removeObjectForKey:NSBackgroundColorAttributeName];
    }

    return [[NSMutableAttributedString alloc] initWithString:string attributes:attributes];
  }
}

static NSMutableAttributedString *RCTNSAttributedStringFragmentWithAttributesFromFragment(
    const AttributedString::Fragment &fragment,
    UIImage *placeholderImage)
{
  auto nsAttributedStringFragment = RCTNSAttributedStringFragmentFromFragment(fragment, placeholderImage);

  if (fragment.parentShadowView.componentHandle) {
    auto eventEmitterWrapper = RCTWrapEventEmitter(fragment.parentShadowView.eventEmitter);

    NSDictionary<NSAttributedStringKey, id> *additionalTextAttributes =
        @{RCTAttributedStringEventEmitterKey : eventEmitterWrapper};

    [nsAttributedStringFragment addAttributes:additionalTextAttributes
                                        range:NSMakeRange(0, nsAttributedStringFragment.length)];
  }

  return nsAttributedStringFragment;
}

namespace {

// Adds to any kerning already on that character (letterSpacing) rather than
// replacing it.
void RCTAddKern(NSMutableAttributedString *string, NSUInteger index, CGFloat amount)
{
  NSRange range = NSMakeRange(index, 1);
  NSNumber *existing = [string attribute:NSKernAttributeName atIndex:index effectiveRange:nullptr];
  [string addAttribute:NSKernAttributeName value:@(existing.doubleValue + amount) range:range];
}

} // namespace

void RCTApplyInlineBoxSpacing(NSMutableAttributedString *string, const AttributedString &attributedString)
{
  // box-model-scope.md G3. An inline element's inline-axis margin/border/
  // padding has to occupy real advance, but TextKit has no notion of "padding
  // on a range".
  //
  // It is expressed as *kerning*, never as injected characters. A zero-width
  // spacer character would be simpler, but the string built here is also what
  // `RCTParagraphComponentView.attributedText` hands to copy/selection and to
  // accessibility, so any character added for layout would leak into text the
  // user reads and copies. Kerning also has the property we want regardless:
  // it is part of a glyph's advance, so line breaking accounts for it and it
  // cannot be collapsed away as whitespace.
  //
  // The leading space therefore hangs off the *preceding* character, which
  // puts it outside the element's own glyph range — consumers computing an
  // element's box have to add it back (see drawInlineBoxDecorations).
  NSUInteger location = 0;
  for (const auto &fragment : attributedString.getFragments()) {
    NSUInteger length;
    if (fragment.isAttachment()) {
      length = 1;
    } else {
      NSString *text = [NSString stringWithUTF8String:fragment.string.c_str()];
      length = text != nil ? text.length : 0;
    }
    if (length == 0 || location + length > string.length) {
      location += length;
      continue;
    }

    auto leading = fragment.leadingInlineSpace();
    if (leading > 0) {
      if (location > 0) {
        RCTAddKern(string, location - 1, leading);
      } else {
        // Nothing precedes the element, so there is no glyph to hang the
        // space on. The element necessarily starts the first line, which is
        // exactly what `firstLineHeadIndent` indents — and it correctly leaves
        // wrapped lines alone, since the leading edge applies only once.
        NSMutableParagraphStyle *paragraphStyle =
            [[string attribute:NSParagraphStyleAttributeName
                       atIndex:0
                effectiveRange:nullptr] ?: [NSParagraphStyle defaultParagraphStyle] mutableCopy];
        paragraphStyle.firstLineHeadIndent += leading;
        [string addAttribute:NSParagraphStyleAttributeName
                       value:paragraphStyle
                       range:NSMakeRange(0, string.length)];
      }
    }

    auto trailing = fragment.trailingInlineSpace();
    if (trailing > 0) {
      RCTAddKern(string, location + length - 1, trailing);
    }

    location += length;
  }
}

/*
 * `line-height` is the strut's height, not a ceiling on the line box.
 *
 * React Native normally emulates `line-height` by pinning `minimumLineHeight`
 * AND `maximumLineHeight` to it, which is exactly right for text: every line
 * ends up that tall. It is wrong the moment an atomic inline is on the line,
 * because a box taller than the strut must GROW the line box (CSS2 §10.8 — the
 * line box is the union of everything on it, and the strut is only one of them).
 *
 * With the clamp left in place a 50pt box on a 20pt line did not make the line
 * 50pt: the line stayed 20 and the box overflowed *upwards* out of it, landing
 * at y = -30 and painting over whatever preceded it.
 *
 * So the ceiling is lifted for any string containing an attachment, while the
 * floor stays — which is what `line-height` actually means. Text-only strings
 * are untouched and keep the exact emulation they had.
 */
static void RCTUnclampLineHeightForAtomicInlines(
    NSMutableAttributedString *string,
    const AttributedString &attributedString)
{
  __block CGFloat tallestAttachment = 0;
  for (const auto &fragment : attributedString.getFragments()) {
    if (fragment.isAttachment()) {
      tallestAttachment =
          MAX(tallestAttachment, (CGFloat)fragment.parentShadowView.layoutMetrics.frame.size.height);
    }
  }
  if (tallestAttachment == 0 || string.length == 0) {
    return;
  }

  [string enumerateAttribute:NSParagraphStyleAttributeName
                     inRange:NSMakeRange(0, string.length)
                     options:0
                  usingBlock:^(NSParagraphStyle *paragraphStyle, NSRange range, BOOL *stop) {
                    if (paragraphStyle == nil || paragraphStyle.maximumLineHeight == 0) {
                      return;
                    }
                    /*
                     * Only for a box the line cannot already hold.
                     *
                     * Lifting the ceiling is not free: with no maximum, the
                     * baseline offset that centres the glyphs in their strut
                     * GROWS the line instead of moving them within it, so
                     * `RCTApplyBaselineOffset` declines to apply it at all —
                     * and every run with an attachment lost its half-leading
                     * and drew its text high. Reported as text sitting too high
                     * in shadcn's buttons and tabs, which are the components
                     * with icons in them.
                     *
                     * An attachment that FITS needs nothing lifted: the strut
                     * is already as tall as the line has to be, and the clamp
                     * can stay so the centring still happens. Only a box taller
                     * than the strut has to be able to push the line open
                     * (CSS2 §10.8), and that is the case this was written for —
                     * a 50pt box on a 20pt line, which overflowed upwards and
                     * painted over the line above.
                     */
                    if (tallestAttachment <= paragraphStyle.maximumLineHeight) {
                      return;
                    }
                    NSMutableParagraphStyle *unclamped = [paragraphStyle mutableCopy];
                    // 0 means "no maximum" to TextKit. The minimum is left
                    // alone: that is the strut, and it is what keeps a line of
                    // short boxes as tall as `line-height` asks.
                    unclamped.maximumLineHeight = 0;
                    [string addAttribute:NSParagraphStyleAttributeName value:unclamped range:range];
                  }];
}

NSAttributedString *RCTNSAttributedStringFromAttributedString(const AttributedString &attributedString)
{
  static UIImage *placeholderImage;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    placeholderImage = [UIImage new];
  });

  NSMutableAttributedString *nsAttributedString = [NSMutableAttributedString new];

  [nsAttributedString beginEditing];

  for (auto fragment : attributedString.getFragments()) {
    NSMutableAttributedString *nsAttributedStringFragment =
        RCTNSAttributedStringFragmentWithAttributesFromFragment(fragment, placeholderImage);

    [nsAttributedString appendAttributedString:nsAttributedStringFragment];
  }
  RCTApplyInlineBoxSpacing(nsAttributedString, attributedString);
  RCTUnclampLineHeightForAtomicInlines(nsAttributedString, attributedString);
  [nsAttributedString endEditing];

  return nsAttributedString;
}

NSAttributedString *RCTNSAttributedStringFromAttributedStringBox(const AttributedStringBox &attributedStringBox)
{
  switch (attributedStringBox.getMode()) {
    case AttributedStringBox::Mode::Value:
      return RCTNSAttributedStringFromAttributedString(attributedStringBox.getValue());
    case AttributedStringBox::Mode::OpaquePointer:
      return (NSAttributedString *)unwrapManagedObject(attributedStringBox.getOpaquePointer());
  }
}

AttributedStringBox RCTAttributedStringBoxFromNSAttributedString(NSAttributedString *nsAttributedString)
{
  return nsAttributedString.length ? AttributedStringBox{wrapManagedObject(nsAttributedString)} : AttributedStringBox{};
}

static NSString *capitalizeText(NSString *text)
{
  NSArray *words = [text componentsSeparatedByString:@" "];
  NSMutableArray *newWords = [NSMutableArray new];
  NSNumberFormatter *num = [NSNumberFormatter new];
  for (NSString *item in words) {
    NSString *word;
    if ([item length] > 0 && [num numberFromString:[item substringWithRange:NSMakeRange(0, 1)]] == nil) {
      word = [item capitalizedString];
    } else {
      word = [item lowercaseString];
    }
    [newWords addObject:word];
  }
  return [newWords componentsJoinedByString:@" "];
}

NSString *RCTNSStringFromStringApplyingTextTransform(NSString *string, TextTransform textTransform)
{
  switch (textTransform) {
    case TextTransform::Uppercase:
      return [string uppercaseString];
    case TextTransform::Lowercase:
      return [string lowercaseString];
    case TextTransform::Capitalize:
      return capitalizeText(string);
    default:
      return string;
  }
}

static BOOL RCTIsParagraphStyleEffectivelySame(
    NSParagraphStyle *style1,
    NSParagraphStyle *style2,
    const TextAttributes &baseTextAttributes)
{
  if (style1 == nil || style2 == nil) {
    return style1 == nil && style2 == nil;
  }

  // The NSParagraphStyle included as part of typingAttributes may eventually resolve "natural" directions to
  // physical direction, so we should compare resolved directions
  auto naturalAlignment =
      baseTextAttributes.layoutDirection.value_or(LayoutDirection::LeftToRight) == LayoutDirection::LeftToRight
      ? NSTextAlignmentLeft
      : NSTextAlignmentRight;

  NSWritingDirection naturalBaseWritingDirection = baseTextAttributes.baseWritingDirection.has_value()
      ? RCTNSWritingDirectionFromWritingDirection(baseTextAttributes.baseWritingDirection.value())
      : [NSParagraphStyle defaultWritingDirectionForLanguage:nil];

  if (style1.alignment == NSTextAlignmentNatural || style1.baseWritingDirection == NSWritingDirectionNatural) {
    NSMutableParagraphStyle *mutableStyle1 = [style1 mutableCopy];
    style1 = mutableStyle1;

    if (mutableStyle1.alignment == NSTextAlignmentNatural) {
      mutableStyle1.alignment = naturalAlignment;
    }

    if (mutableStyle1.baseWritingDirection == NSWritingDirectionNatural) {
      mutableStyle1.baseWritingDirection = naturalBaseWritingDirection;
    }
  }

  if (style2.alignment == NSTextAlignmentNatural || style2.baseWritingDirection == NSWritingDirectionNatural) {
    NSMutableParagraphStyle *mutableStyle2 = [style2 mutableCopy];
    style2 = mutableStyle2;

    if (mutableStyle2.alignment == NSTextAlignmentNatural) {
      mutableStyle2.alignment = naturalAlignment;
    }

    if (mutableStyle2.baseWritingDirection == NSWritingDirectionNatural) {
      mutableStyle2.baseWritingDirection = naturalBaseWritingDirection;
    }
  }

  return [style1 isEqual:style2];
}

static BOOL RCTIsAttributeEffectivelySame(
    NSAttributedStringKey attributeKey,
    NSDictionary<NSAttributedStringKey, id> *attributes1,
    NSDictionary<NSAttributedStringKey, id> *attributes2,
    NSDictionary<NSAttributedStringKey, id> *insensitiveAttributes,
    const TextAttributes &baseTextAttributes)
{
  id attribute1 = attributes1[attributeKey] ?: insensitiveAttributes[attributeKey];
  id attribute2 = attributes2[attributeKey] ?: insensitiveAttributes[attributeKey];

  // Normalize attributes which can inexact but still effectively the same
  if ([attributeKey isEqualToString:NSParagraphStyleAttributeName]) {
    return RCTIsParagraphStyleEffectivelySame(attribute1, attribute2, baseTextAttributes);
  }

  // Otherwise rely on built-in comparison
  return [attribute1 isEqual:attribute2];
}

BOOL RCTIsAttributedStringEffectivelySame(
    NSAttributedString *text1,
    NSAttributedString *text2,
    NSDictionary<NSAttributedStringKey, id> *insensitiveAttributes,
    const TextAttributes &baseTextAttributes)
{
  if (![text1.string isEqualToString:text2.string]) {
    return NO;
  }

  // We check that for every fragment in the old string
  // 1. The new string's fragment overlapping the first spans the same characters
  // 2. The attributes of each matching fragment are the same, ignoring those which match insensitive attibutes
  __block BOOL areAttributesSame = YES;
  [text1 enumerateAttributesInRange:NSMakeRange(0, text1.length)
                            options:0
                         usingBlock:^(
                             NSDictionary<NSAttributedStringKey, id> *text1Attributes,
                             NSRange text1Range,
                             BOOL *text1Stop) {
                           [text2 enumerateAttributesInRange:text1Range
                                                     options:0
                                                  usingBlock:^(
                                                      NSDictionary<NSAttributedStringKey, id> *text2Attributes,
                                                      NSRange text2Range,
                                                      BOOL *text2Stop) {
                                                    if (!NSEqualRanges(text1Range, text2Range)) {
                                                      areAttributesSame = NO;
                                                      *text1Stop = YES;
                                                      *text2Stop = YES;
                                                      return;
                                                    }

                                                    // Compare every attribute in text1 to the corresponding attribute
                                                    // in text2, or the set of insensitive attributes if not present
                                                    for (NSAttributedStringKey key in text1Attributes) {
                                                      if (!RCTIsAttributeEffectivelySame(
                                                              key,
                                                              text1Attributes,
                                                              text2Attributes,
                                                              insensitiveAttributes,
                                                              baseTextAttributes)) {
                                                        areAttributesSame = NO;
                                                        *text1Stop = YES;
                                                        *text2Stop = YES;
                                                        return;
                                                      }
                                                    }

                                                    for (NSAttributedStringKey key in text2Attributes) {
                                                      // We have already compared this attribute if it is present in
                                                      // both
                                                      if (text1Attributes[key] != nil) {
                                                        continue;
                                                      }

                                                      // But we still need to compare attributes if it is only present
                                                      // in text 2, to compare against insensitive attributes
                                                      if (!RCTIsAttributeEffectivelySame(
                                                              key,
                                                              text1Attributes,
                                                              text2Attributes,
                                                              insensitiveAttributes,
                                                              baseTextAttributes)) {
                                                        areAttributesSame = NO;
                                                        *text1Stop = YES;
                                                        *text2Stop = YES;
                                                        return;
                                                      }
                                                    }
                                                  }];
                         }];

  return areAttributesSame;
}
