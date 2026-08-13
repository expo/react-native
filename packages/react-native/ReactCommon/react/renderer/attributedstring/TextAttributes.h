/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <functional>
#include <limits>
#include <optional>
#include <vector>

#include <folly/dynamic.h>
#include <react/renderer/attributedstring/primitives.h>
#include <react/renderer/components/view/AccessibilityPrimitives.h>
#include <react/renderer/core/LayoutPrimitives.h>
#include <react/renderer/core/ReactPrimitives.h>
#include <react/renderer/debug/DebugStringConvertible.h>
#include <react/renderer/graphics/Color.h>
#include <react/renderer/graphics/Float.h>
#include <react/renderer/graphics/Size.h>
#include <react/utils/hash_combine.h>

namespace facebook::react {

struct TextEffectInfo {
  std::string name;
  folly::dynamic props;
  bool operator==(const TextEffectInfo &) const = default;
};

class TextAttributes;

using SharedTextAttributes = std::shared_ptr<const TextAttributes>;

class TextAttributes : public DebugStringConvertible {
 public:
  /*
   * Returns TextAttribute object which has actual default attribute values
   * (e.g. `foregroundColor = black`), in oppose to TextAttribute's default
   * constructor which creates an object with nulled attributes.
   */
  static TextAttributes defaultTextAttributes();

#pragma mark - Fields

  // Layout of this struct is deliberate: pointer-sized members first, then
  // 4-byte members, then the small optionals — TextAttributes is copied into
  // every AttributedString fragment and TextMeasureCache key, and interleaving
  // these by topic costs real padding bytes at that volume. Group by SIZE
  // here; group by topic in the docs.

  // 8-byte-aligned
  std::string fontFamily{""};
  // Text Effects (ordered by nesting depth: index 0 = outermost = drawn first)
  std::vector<TextEffectInfo> textEffects{};

  // 4-byte-aligned
  SharedColor foregroundColor{};
  SharedColor backgroundColor{};
  SharedColor textDecorationColor{};
  SharedColor textShadowColor{};
  Float opacity{std::numeric_limits<Float>::quiet_NaN()};
  Float fontSize{std::numeric_limits<Float>::quiet_NaN()};
  Float fontSizeMultiplier{std::numeric_limits<Float>::quiet_NaN()};
  Float maxFontSizeMultiplier{std::numeric_limits<Float>::quiet_NaN()};
  Float letterSpacing{std::numeric_limits<Float>::quiet_NaN()};
  Float lineHeight{std::numeric_limits<Float>::quiet_NaN()};
  Float textShadowRadius{std::numeric_limits<Float>::quiet_NaN()};
  // TODO: Use `Point` type instead of `Size` for `textShadowOffset` attribute.
  std::optional<Size> textShadowOffset{};
  // A bitmask up to 1 << 25, so it keeps the int base (and 8-byte optional).
  std::optional<FontVariant> fontVariant{};

  // 2-byte-and-under optionals (the enums carry explicit small bases)
  std::optional<FontWeight> fontWeight{};
  std::optional<FontStyle> fontStyle{};
  std::optional<bool> allowFontScaling{};
  std::optional<DynamicTypeRamp> dynamicTypeRamp{};
  std::optional<TextTransform> textTransform{};
  // `white-space`. Inherited, so a `<pre>` passes it to every run inside it.
  std::optional<WhiteSpace> whiteSpace{};
  std::optional<TextAlignment> alignment{};
  std::optional<WritingDirection> baseWritingDirection{};
  std::optional<LineBreakStrategy> lineBreakStrategy{};
  std::optional<LineBreakMode> lineBreakMode{};
  std::optional<TextDecorationLineType> textDecorationLineType{};
  std::optional<TextDecorationStyle> textDecorationStyle{};
  std::optional<bool> isHighlighted{};
  std::optional<bool> isPressable{};
  // TODO T59221129: document where this value comes from and how it is set.
  // It's not clear if this is being used properly, or if it's being set at all.
  // Currently, it is intentionally *not* being set as part of BaseTextProps
  // construction.
  std::optional<LayoutDirection> layoutDirection{};
  std::optional<AccessibilityRole> accessibilityRole{};
  std::optional<Role> role{};

#pragma mark - Operations

  void apply(TextAttributes textAttributes);

#pragma mark - Operators

  bool operator==(const TextAttributes &rhs) const;

#pragma mark - DebugStringConvertible

#if RN_DEBUG_STRING_CONVERTIBLE
  SharedDebugStringConvertibleList getDebugProps() const override;
#endif
};

} // namespace facebook::react

namespace std {

template <>
struct hash<facebook::react::TextEffectInfo> {
  size_t operator()(const facebook::react::TextEffectInfo &info) const
  {
    return facebook::react::hash_combine(info.name, info.props);
  }
};

template <>
struct hash<facebook::react::TextAttributes> {
  size_t operator()(const facebook::react::TextAttributes &textAttributes) const
  {
    size_t textEffectsHash = 0;
    for (const auto &effect : textAttributes.textEffects) {
      facebook::react::hash_combine(textEffectsHash, effect);
    }
    return facebook::react::hash_combine(
        textAttributes.foregroundColor,
        textAttributes.backgroundColor,
        textAttributes.opacity,
        textAttributes.fontFamily,
        textAttributes.fontSize,
        textAttributes.maxFontSizeMultiplier,
        textAttributes.fontSizeMultiplier,
        textAttributes.fontWeight,
        textAttributes.fontStyle,
        textAttributes.fontVariant,
        textAttributes.allowFontScaling,
        textAttributes.letterSpacing,
        textAttributes.textTransform,
        textAttributes.whiteSpace,
        textAttributes.lineHeight,
        textAttributes.alignment,
        textAttributes.baseWritingDirection,
        textAttributes.lineBreakStrategy,
        textAttributes.lineBreakMode,
        textAttributes.textDecorationColor,
        textAttributes.textDecorationLineType,
        textAttributes.textDecorationStyle,
        textAttributes.textShadowOffset,
        textAttributes.textShadowRadius,
        textAttributes.textShadowColor,
        textAttributes.isHighlighted,
        textAttributes.isPressable,
        textAttributes.layoutDirection,
        textAttributes.accessibilityRole,
        textAttributes.role,
        textEffectsHash);
  }
};
} // namespace std
