/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "TextAttributes.h"

#include <react/renderer/attributedstring/conversions.h>
#include <react/renderer/core/conversions.h>
#include <react/renderer/core/graphicsConversions.h>
#include <react/utils/FloatComparison.h>
#include <cmath>

#include <react/renderer/debug/debugStringConvertibleUtils.h>

namespace facebook::react {

std::optional<Float> TextAttributes::resolveFontSize(
    Float declaredFontSize,
    Float declaredFontSizeEm,
    Float declaredFontSizeRem,
    Float userAgentFontSizeEm,
    bool platformSuppliesSize,
    Float inheritedFontSize) {
  // The size a relative unit multiplies is never allowed to be absent: an
  // element with no inherited size would otherwise turn a valid `0.8em` into
  // NaN and take the crash a long way from here.
  const Float inherited = !std::isnan(inheritedFontSize)
      ? inheritedFontSize
      : TextAttributes::initialFontSize();
  // The root's size IS font-size's initial value here: React Native's root
  // element is the surface root, which an app cannot state a size on. See the
  // declaration for why that is a constant rather than a value to carry.
  const Float root = TextAttributes::initialFontSize();

  if (!std::isnan(declaredFontSizeEm)) {
    return declaredFontSizeEm * inherited;
  }
  if (!std::isnan(declaredFontSizeRem)) {
    return declaredFontSizeRem * root;
  }
  if (!std::isnan(declaredFontSize)) {
    return declaredFontSize;
  }
  if (platformSuppliesSize) {
    return std::numeric_limits<Float>::quiet_NaN();
  }
  if (!std::isnan(userAgentFontSizeEm)) {
    return userAgentFontSizeEm * inherited;
  }
  return std::nullopt;
}

void TextAttributes::apply(TextAttributes textAttributes) {
  // Color
  foregroundColor = textAttributes.foregroundColor
      ? textAttributes.foregroundColor
      : foregroundColor;
  backgroundColor = textAttributes.backgroundColor
      ? textAttributes.backgroundColor
      : backgroundColor;
  opacity =
      !std::isnan(textAttributes.opacity) ? textAttributes.opacity : opacity;

  // Font
  fontFamily = !textAttributes.fontFamily.empty() ? textAttributes.fontFamily
                                                  : fontFamily;
  // `em` multiplies what was inherited; an absolute size replaces it. At this
  // point `fontSize` still holds the parent's computed size, which is exactly
  // what `em` resolves against.
  /*
   * `fontSize` still holds the INHERITED size at this point, which is what an
   * `em` resolves against — and the assignment below is what ends that, so
   * everything the decision needs is read before it is made.
   *
   * A text node is never the thing a platform text ROLE resolves for: that
   * happens on the element, in `BaseViewProps::applyInheritedTextAttributes`,
   * which passes the answer down as a cleared size. Saying so here rather than
   * plumbing a flag keeps `<Text>` on exactly the path it was on.
   */
  if (const auto resolved = resolveFontSize(
          textAttributes.fontSize,
          textAttributes.fontSizeEm,
          textAttributes.fontSizeRem,
          textAttributes.uaFontSizeEm,
          /* platformSuppliesSize */ false,
          fontSize)) {
    fontSize = *resolved;
  }
  fontSizeEm = !std::isnan(textAttributes.fontSizeEm) ? textAttributes.fontSizeEm
                                                     : fontSizeEm;
  fontSizeRem = !std::isnan(textAttributes.fontSizeRem)
      ? textAttributes.fontSizeRem
      : fontSizeRem;
  uaFontSizeEm = !std::isnan(textAttributes.uaFontSizeEm)
      ? textAttributes.uaFontSizeEm
      : uaFontSizeEm;
  fontSizeMultiplier = !std::isnan(textAttributes.fontSizeMultiplier)
      ? textAttributes.fontSizeMultiplier
      : fontSizeMultiplier;
  fontWeight = textAttributes.fontWeight.has_value() ? textAttributes.fontWeight
                                                     : fontWeight;
  fontStyle = textAttributes.fontStyle.has_value() ? textAttributes.fontStyle
                                                   : fontStyle;
  fontVariant = textAttributes.fontVariant.has_value()
      ? textAttributes.fontVariant
      : fontVariant;
  allowFontScaling = textAttributes.allowFontScaling.has_value()
      ? textAttributes.allowFontScaling
      : allowFontScaling;
  maxFontSizeMultiplier = !std::isnan(textAttributes.maxFontSizeMultiplier)
      ? textAttributes.maxFontSizeMultiplier
      : maxFontSizeMultiplier;
  dynamicTypeRamp = textAttributes.dynamicTypeRamp.has_value()
      ? textAttributes.dynamicTypeRamp
      : dynamicTypeRamp;
  letterSpacing = !std::isnan(textAttributes.letterSpacing)
      ? textAttributes.letterSpacing
      : letterSpacing;
  verticalAlign = textAttributes.verticalAlign.has_value()
      ? textAttributes.verticalAlign
      : verticalAlign;
  baselineShift = !std::isnan(textAttributes.baselineShift)
      ? textAttributes.baselineShift
      : baselineShift;
  textTransform = textAttributes.textTransform.has_value()
      ? textAttributes.textTransform
      : textTransform;
  whiteSpace = textAttributes.whiteSpace.has_value() ? textAttributes.whiteSpace
                                                     : whiteSpace;

  // Paragraph Styles
  lineHeight = !std::isnan(textAttributes.lineHeight)
      ? textAttributes.lineHeight
      : lineHeight;
  alignment = textAttributes.alignment.has_value() ? textAttributes.alignment
                                                   : alignment;
  baseWritingDirection = textAttributes.baseWritingDirection.has_value()
      ? textAttributes.baseWritingDirection
      : baseWritingDirection;
  lineBreakStrategy = textAttributes.lineBreakStrategy.has_value()
      ? textAttributes.lineBreakStrategy
      : lineBreakStrategy;
  lineBreakMode = textAttributes.lineBreakMode.has_value()
      ? textAttributes.lineBreakMode
      : lineBreakMode;

  // Decoration
  textDecorationColor = textAttributes.textDecorationColor
      ? textAttributes.textDecorationColor
      : textDecorationColor;
  textDecorationLineType = textAttributes.textDecorationLineType.has_value()
      ? textAttributes.textDecorationLineType
      : textDecorationLineType;
  textDecorationStyle = textAttributes.textDecorationStyle.has_value()
      ? textAttributes.textDecorationStyle
      : textDecorationStyle;

  // Shadow
  textShadowOffset = textAttributes.textShadowOffset.has_value()
      ? textAttributes.textShadowOffset
      : textShadowOffset;
  textShadowRadius = !std::isnan(textAttributes.textShadowRadius)
      ? textAttributes.textShadowRadius
      : textShadowRadius;
  textShadowColor = textAttributes.textShadowColor
      ? textAttributes.textShadowColor
      : textShadowColor;

  // Special
  isHighlighted = textAttributes.isHighlighted.has_value()
      ? textAttributes.isHighlighted
      : isHighlighted;
  // TextAttributes "inherits" the isPressable value from ancestors, so this
  // only applies the current node's value for isPressable if it is truthy.
  isPressable =
      textAttributes.isPressable.has_value() && *textAttributes.isPressable
      ? textAttributes.isPressable
      : isPressable;
  layoutDirection = textAttributes.layoutDirection.has_value()
      ? textAttributes.layoutDirection
      : layoutDirection;
  accessibilityRole = textAttributes.accessibilityRole.has_value()
      ? textAttributes.accessibilityRole
      : accessibilityRole;
  role = textAttributes.role.has_value() ? textAttributes.role : role;
  textEffects = !textAttributes.textEffects.empty() ? textAttributes.textEffects
                                                    : textEffects;
}

#pragma mark - Operators

bool TextAttributes::operator==(const TextAttributes& rhs) const {
  return std::tie(
             foregroundColor,
             backgroundColor,
             fontFamily,
             fontWeight,
             fontStyle,
             fontVariant,
             allowFontScaling,
             dynamicTypeRamp,
             alignment,
             baseWritingDirection,
             lineBreakStrategy,
             textDecorationColor,
             textDecorationLineType,
             textDecorationStyle,
             textShadowOffset,
             textShadowColor,
             isHighlighted,
             isPressable,
             layoutDirection,
             accessibilityRole,
             role,
             textTransform,
             whiteSpace,
             textEffects) ==
      std::tie(
             rhs.foregroundColor,
             rhs.backgroundColor,
             rhs.fontFamily,
             rhs.fontWeight,
             rhs.fontStyle,
             rhs.fontVariant,
             rhs.allowFontScaling,
             rhs.dynamicTypeRamp,
             rhs.alignment,
             rhs.baseWritingDirection,
             rhs.lineBreakStrategy,
             rhs.textDecorationColor,
             rhs.textDecorationLineType,
             rhs.textDecorationStyle,
             rhs.textShadowOffset,
             rhs.textShadowColor,
             rhs.isHighlighted,
             rhs.isPressable,
             rhs.layoutDirection,
             rhs.accessibilityRole,
             rhs.role,
             rhs.textTransform,
             rhs.whiteSpace,
             rhs.textEffects) &&
      floatEquality(maxFontSizeMultiplier, rhs.maxFontSizeMultiplier) &&
      floatEquality(opacity, rhs.opacity) &&
      floatEquality(fontSize, rhs.fontSize) &&
      floatEquality(fontSizeEm, rhs.fontSizeEm) &&
      floatEquality(fontSizeRem, rhs.fontSizeRem) &&
      floatEquality(uaFontSizeEm, rhs.uaFontSizeEm) &&
      floatEquality(fontSizeMultiplier, rhs.fontSizeMultiplier) &&
      floatEquality(letterSpacing, rhs.letterSpacing) &&
      verticalAlign == rhs.verticalAlign &&
      floatEquality(baselineShift, rhs.baselineShift) &&
      floatEquality(lineHeight, rhs.lineHeight) &&
      floatEquality(textShadowRadius, rhs.textShadowRadius);
}

/*
 * The default body text size — the size text renders at when nothing sets one.
 *
 * React Native's historical default is 14, which is neither the web's 16px root
 * nor what either platform uses for body copy: iOS sets body text at 17pt
 * (`UIFont.systemFontSize`, and what `preferredFont(forTextStyle: .body)`
 * returns at the default content size), and Material's `bodyLarge` is 16sp.
 * Prose left at 14 reads noticeably small next to any other app on the phone.
 *
 * Native wins over the web here deliberately, and the deviation from 16px is
 * stated in the user-agent stylesheet's `ROOT_FONT_SIZE`, which must stay in
 * step with this.
 *
 * ## Why this is here and not in the element cascade
 *
 * It was tried there first, on the reasoning that only *documents* should get
 * the native size and a plain `<Text>` should keep 14. That split is
 * inconsistent, and a test named the invariant it breaks:
 * `<View>{'hi'}</View>` must measure the same as `<View><Text>hi</Text></View>`
 * — the premise string children rests on. Seeding only the cascade gave the
 * bare string 17pt and the `<Text>` 20pt of line box at 14, because a
 * paragraph takes its base attributes from HERE rather than from the cascade.
 * One default in one place is the only version of this that holds together.
 */
#if defined(__APPLE__)
static constexpr Float kDefaultFontSize = 17.0;
#else
static constexpr Float kDefaultFontSize = 16.0;
#endif

Float TextAttributes::initialFontSize() {
  return kDefaultFontSize;
}

TextAttributes TextAttributes::defaultTextAttributes() {
  static auto textAttributes = [] {
    auto defaultAttrs = TextAttributes{};
    // Non-obvious (can be different among platforms) default text attributes.
    defaultAttrs.foregroundColor = blackColor();
    defaultAttrs.backgroundColor = clearColor();
    defaultAttrs.fontSize = initialFontSize();
    defaultAttrs.fontSizeMultiplier = 1.0;
    return defaultAttrs;
  }();
  return textAttributes;
}

#pragma mark - DebugStringConvertible

#if RN_DEBUG_STRING_CONVERTIBLE
SharedDebugStringConvertibleList TextAttributes::getDebugProps() const {
  const auto& textAttributes = TextAttributes::defaultTextAttributes();
  return {
      // Color
      debugStringConvertibleItem(
          "backgroundColor", backgroundColor, textAttributes.backgroundColor),
      debugStringConvertibleItem(
          "foregroundColor", foregroundColor, textAttributes.foregroundColor),
      debugStringConvertibleItem("opacity", opacity, textAttributes.opacity),

      // Font
      debugStringConvertibleItem(
          "fontFamily", fontFamily, textAttributes.fontFamily),
      debugStringConvertibleItem("fontSize", fontSize, textAttributes.fontSize),
      debugStringConvertibleItem(
          "fontSizeMultiplier",
          fontSizeMultiplier,
          textAttributes.fontSizeMultiplier),
      debugStringConvertibleItem(
          "fontWeight", fontWeight, textAttributes.fontWeight),
      debugStringConvertibleItem(
          "fontStyle", fontStyle, textAttributes.fontStyle),
      debugStringConvertibleItem(
          "fontVariant", fontVariant, textAttributes.fontVariant),
      debugStringConvertibleItem(
          "allowFontScaling",
          allowFontScaling,
          textAttributes.allowFontScaling),
      debugStringConvertibleItem(
          "maxFontSizeMultiplier",
          maxFontSizeMultiplier,
          textAttributes.maxFontSizeMultiplier),
      debugStringConvertibleItem(
          "dynamicTypeRamp", dynamicTypeRamp, textAttributes.dynamicTypeRamp),
      debugStringConvertibleItem(
          "letterSpacing", letterSpacing, textAttributes.letterSpacing),
      debugStringConvertibleItem(
          "verticalAlign", verticalAlign, textAttributes.verticalAlign),

      // Paragraph Styles
      debugStringConvertibleItem(
          "lineHeight", lineHeight, textAttributes.lineHeight),
      debugStringConvertibleItem(
          "alignment", alignment, textAttributes.alignment),
      debugStringConvertibleItem(
          "writingDirection",
          baseWritingDirection,
          textAttributes.baseWritingDirection),
      debugStringConvertibleItem(
          "lineBreakStrategyIOS",
          lineBreakStrategy,
          textAttributes.lineBreakStrategy),
      debugStringConvertibleItem(
          "lineBreakModeIOS", lineBreakMode, textAttributes.lineBreakMode),

      // Decoration
      debugStringConvertibleItem(
          "textDecorationColor",
          textDecorationColor,
          textAttributes.textDecorationColor),
      debugStringConvertibleItem(
          "textDecorationLineType",
          textDecorationLineType,
          textAttributes.textDecorationLineType),
      debugStringConvertibleItem(
          "textDecorationStyle",
          textDecorationStyle,
          textAttributes.textDecorationStyle),

      // Shadow
      debugStringConvertibleItem(
          "textShadowOffset",
          textShadowOffset,
          textAttributes.textShadowOffset),
      debugStringConvertibleItem(
          "textShadowRadius",
          textShadowRadius,
          textAttributes.textShadowRadius),
      debugStringConvertibleItem(
          "textShadowColor", textShadowColor, textAttributes.textShadowColor),

      // Special
      debugStringConvertibleItem(
          "isHighlighted", isHighlighted, textAttributes.isHighlighted),
      debugStringConvertibleItem(
          "isPressable", isPressable, textAttributes.isPressable),
      debugStringConvertibleItem(
          "layoutDirection", layoutDirection, textAttributes.layoutDirection),
      debugStringConvertibleItem(
          "accessibilityRole",
          accessibilityRole,
          textAttributes.accessibilityRole),
      debugStringConvertibleItem("role", role, textAttributes.role),
  };
}
#endif

} // namespace facebook::react
