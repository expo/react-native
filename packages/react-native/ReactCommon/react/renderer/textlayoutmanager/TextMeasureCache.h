/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/attributedstring/AttributedString.h>
#include <react/renderer/attributedstring/ParagraphAttributes.h>
#include <react/renderer/core/LayoutConstraints.h>
#include <react/utils/FloatComparison.h>
#include <react/utils/SimpleThreadSafeCache.h>
#include <react/utils/hash_combine.h>

namespace facebook::react {

struct LineMeasurement {
  std::string text;
  Rect frame;
  Float descender;
  Float capHeight;
  Float ascender;
  Float xHeight;

  LineMeasurement(std::string text, Rect frame, Float descender, Float capHeight, Float ascender, Float xHeight);

  LineMeasurement(const folly::dynamic &data);

  bool operator==(const LineMeasurement &rhs) const;

  static inline Float baseline(const std::vector<LineMeasurement> &lines)
  {
    if (!lines.empty()) {
      return lines[0].ascender;
    }
    return 0;
  }
};

using LinesMeasurements = std::vector<LineMeasurement>;

/*
 * Describes a result of text measuring.
 */
class TextMeasurement final {
 public:
  class Attachment final {
   public:
    Rect frame;
    bool isClipped;
  };

  using Attachments = std::vector<Attachment>;

  Size size;
  Attachments attachments;

  /*
   * The laid-out rect of each fragment of the measured `AttributedString`,
   * parallel to its fragment list and relative to the text frame's origin.
   *
   * This is what gives an *inline element* (`<b>`, `<span>`, a nested
   * `<Text>`) a box to report from `getBoundingClientRect()`: fragments carry
   * their owning element in `parentShadowView`, so the rects of the fragments
   * belonging to one element union into that element's border box, which the
   * containing Paragraph/View then stamps onto it (text-children-plan.md
   * §3.G "Geometry APIs").
   *
   * Empty when the platform text engine has not implemented it — consumers
   * must treat it as "unknown" and leave the element without metrics, which
   * is the pre-existing behavior.
   */
  std::vector<Rect> fragmentRects;
};

// The Key type that is used for Text Measure Cache.
// The equivalence and hashing operations of this are defined to respect the
// nature of text measuring.
class TextMeasureCacheKey final {
 public:
  AttributedString attributedString{};
  ParagraphAttributes paragraphAttributes{};
  LayoutConstraints layoutConstraints{};
  // The measured size depends on the pixel scale factor because layout metrics
  // are rounded to the pixel grid. Two otherwise-identical measures at different
  // densities are not interchangeable, so the scale factor is part of the key.
  Float pointScaleFactor{};
  // Whether the entry carries `fragmentRects`. Two measures of the same string
  // at the same size are the same SIZE, but not the same ENTRY: one of them
  // has the per-fragment geometry and the other does not, and handing the
  // rect-less one to a caller that asked for rects loses every inline
  // element's box silently. Cheap to carry — only a string that is measured
  // both ways ever occupies two entries, which is a paragraph with an inline
  // element in it.
  bool needsFragmentRects{false};
};

// The Key type that is used for Line Measure Cache.
// The equivalence and hashing operations of this are defined to respect the
// nature of text measuring.
class LineMeasureCacheKey final {
 public:
  AttributedString attributedString{};
  ParagraphAttributes paragraphAttributes{};
  Size size{};
};

/**
 * Cache key, mapping an AttributedString under given constraints, to a prepared
 * (laid out and drawable) representation of the text.
 */
class PreparedTextCacheKey final {
 public:
  AttributedString attributedString{};
  ParagraphAttributes paragraphAttributes{};
  LayoutConstraints layoutConstraints{};
  // A prepared layout is rounded to the pixel grid, so it is only reusable at
  // the pixel scale factor it was laid out at.
  Float pointScaleFactor{};
  // Whether the layout carries per-fragment rects. A layout prepared without
  // them must not be handed to a caller that needs them: the entry is a
  // complete answer to a different question, and reusing it silently loses
  // every inline element's box. Same reason it is in TextMeasureCacheKey.
  bool needsFragmentRects{false};
};

/*
 * Maximum size of the Cache.
 * The number was empirically chosen based on approximation of an average amount
 * of meaningful measures per surface.
 */
constexpr auto kSimpleThreadSafeCacheSizeCap = size_t{1024};

/*
 * Thread-safe, evicting hash table designed to store text measurement
 * information.
 */
using TextMeasureCache = SimpleThreadSafeCache<TextMeasureCacheKey, TextMeasurement, kSimpleThreadSafeCacheSizeCap>;

/*
 * Thread-safe, evicting hash table designed to store line measurement
 * information.
 */
using LineMeasureCache = SimpleThreadSafeCache<LineMeasureCacheKey, LinesMeasurements, kSimpleThreadSafeCacheSizeCap>;

inline bool areTextAttributesEquivalentLayoutWise(const TextAttributes &lhs, const TextAttributes &rhs)
{
  // Here we check all attributes that affect layout metrics and don't check any
  // attributes that affect only a decorative aspect of displayed text (like
  // colors).
  return std::tie(
             lhs.fontFamily,
             lhs.fontWeight,
             lhs.fontStyle,
             lhs.fontVariant,
             lhs.allowFontScaling,
             lhs.dynamicTypeRamp,
             lhs.alignment) ==
      std::tie(
             rhs.fontFamily,
             rhs.fontWeight,
             rhs.fontStyle,
             rhs.fontVariant,
             rhs.allowFontScaling,
             rhs.dynamicTypeRamp,
             rhs.alignment) &&
      floatEquality(lhs.fontSize, rhs.fontSize) && floatEquality(lhs.fontSizeMultiplier, rhs.fontSizeMultiplier) &&
      floatEquality(lhs.letterSpacing, rhs.letterSpacing) && floatEquality(lhs.lineHeight, rhs.lineHeight) &&
      floatEquality(lhs.maxFontSizeMultiplier, rhs.maxFontSizeMultiplier);
}

inline size_t textAttributesHashLayoutWise(const TextAttributes &textAttributes)
{
  // Taking into account the same props as
  // `areTextAttributesEquivalentLayoutWise` mentions.
  return facebook::react::hash_combine(
      textAttributes.fontFamily,
      textAttributes.fontSize,
      textAttributes.fontSizeMultiplier,
      textAttributes.fontWeight,
      textAttributes.fontStyle,
      textAttributes.fontVariant,
      textAttributes.allowFontScaling,
      textAttributes.maxFontSizeMultiplier,
      textAttributes.dynamicTypeRamp,
      textAttributes.letterSpacing,
      textAttributes.lineHeight,
      textAttributes.alignment);
}

inline bool areAttributedStringFragmentsEquivalentLayoutWise(
    const AttributedString::Fragment &lhs,
    const AttributedString::Fragment &rhs)
{
  return lhs.string == rhs.string && areTextAttributesEquivalentLayoutWise(lhs.textAttributes, rhs.textAttributes) &&
      // An inline element's inline-axis margin/border/padding is reserved as
      // real advance (box-model-scope.md G3), so it changes the measured size
      // and two runs differing only by it are NOT interchangeable. Only the
      // inline axis is compared: block-axis padding and border overflow the
      // line box rather than growing it (CSS2 §10.6.1), so they genuinely do
      // not affect layout — comparing them would only cost cache misses.
      lhs.leadingInlineSpace() == rhs.leadingInlineSpace() &&
      lhs.trailingInlineSpace() == rhs.trailingInlineSpace() &&
      lhs.atomicInlineVerticalAlign == rhs.atomicInlineVerticalAlign &&
      // LayoutMetrics of an attachment fragment affects the size of a measured
      // attributed string.
      (!lhs.isAttachment() || (lhs.parentShadowView.layoutMetrics == rhs.parentShadowView.layoutMetrics));
}

inline bool areAttributedStringFragmentsEquivalentDisplayWise(
    const AttributedString::Fragment &lhs,
    const AttributedString::Fragment &rhs)
{
  return lhs.isContentEqual(rhs) &&
      // LayoutMetrics of an attachment fragment affects the size of a measured
      // attributed string.
      (!lhs.isAttachment() || (lhs.parentShadowView.layoutMetrics == rhs.parentShadowView.layoutMetrics));
}

inline size_t attributedStringFragmentHashLayoutWise(const AttributedString::Fragment &fragment)
{
  // Here we are not taking `isAttachment` and `layoutMetrics` into account
  // because they are logically interdependent and this can break an invariant
  // between hash and equivalence functions (and cause cache misses).
  // Must stay in sync with `areAttributedStringFragmentsEquivalentLayoutWise`:
  // equal fragments have to hash equal, so the inline-axis spacing it compares
  // is hashed here too.
  return facebook::react::hash_combine(
      fragment.string,
      textAttributesHashLayoutWise(fragment.textAttributes),
      fragment.leadingInlineSpace(),
      fragment.trailingInlineSpace(),
      fragment.atomicInlineVerticalAlign);
}

inline size_t attributedStringFragmentHashDisplayWise(const AttributedString::Fragment &fragment)
{
  // Here we are not taking `isAttachment` and `layoutMetrics` into account
  // because they are logically interdependent and this can break an invariant
  // between hash and equivalence functions (and cause cache misses).
  return facebook::react::hash_combine(fragment.string, fragment.textAttributes);
}

inline bool areAttributedStringsEquivalentLayoutWise(const AttributedString &lhs, const AttributedString &rhs)
{
  auto &lhsFragment = lhs.getFragments();
  auto &rhsFragment = rhs.getFragments();

  if (lhsFragment.size() != rhsFragment.size()) {
    return false;
  }

  auto size = lhsFragment.size();
  for (auto i = size_t{0}; i < size; i++) {
    if (!areAttributedStringFragmentsEquivalentLayoutWise(lhsFragment.at(i), rhsFragment.at(i))) {
      return false;
    }
  }

  return true;
}

inline bool areAttributedStringsEquivalentDisplayWise(const AttributedString &lhs, const AttributedString &rhs)
{
  auto &lhsFragment = lhs.getFragments();
  auto &rhsFragment = rhs.getFragments();

  if (lhsFragment.size() != rhsFragment.size()) {
    return false;
  }

  auto size = lhsFragment.size();
  for (size_t i = 0; i < size; i++) {
    if (!areAttributedStringFragmentsEquivalentDisplayWise(lhsFragment.at(i), rhsFragment.at(i))) {
      return false;
    }
  }

  return true;
}

inline size_t attributedStringHashLayoutWise(const AttributedString &attributedString)
{
  auto seed = size_t{0};

  for (const auto &fragment : attributedString.getFragments()) {
    facebook::react::hash_combine(seed, attributedStringFragmentHashLayoutWise(fragment));
  }

  return seed;
}

inline size_t attributedStringHashDisplayWise(const AttributedString &attributedString)
{
  size_t seed = 0;

  for (const auto &fragment : attributedString.getFragments()) {
    facebook::react::hash_combine(seed, attributedStringFragmentHashDisplayWise(fragment));
  }

  return seed;
}

inline bool operator==(const TextMeasureCacheKey &lhs, const TextMeasureCacheKey &rhs)
{
  return areAttributedStringsEquivalentLayoutWise(lhs.attributedString, rhs.attributedString) &&
      lhs.paragraphAttributes == rhs.paragraphAttributes && lhs.layoutConstraints == rhs.layoutConstraints &&
      floatEquality(lhs.pointScaleFactor, rhs.pointScaleFactor) && lhs.needsFragmentRects == rhs.needsFragmentRects;
}

inline bool operator==(const LineMeasureCacheKey &lhs, const LineMeasureCacheKey &rhs)
{
  return areAttributedStringsEquivalentLayoutWise(lhs.attributedString, rhs.attributedString) &&
      lhs.paragraphAttributes == rhs.paragraphAttributes && lhs.size == rhs.size;
}

inline bool operator==(const PreparedTextCacheKey &lhs, const PreparedTextCacheKey &rhs)
{
  return areAttributedStringsEquivalentDisplayWise(lhs.attributedString, rhs.attributedString) &&
      lhs.paragraphAttributes == rhs.paragraphAttributes && lhs.layoutConstraints == rhs.layoutConstraints &&
      floatEquality(lhs.pointScaleFactor, rhs.pointScaleFactor) && lhs.needsFragmentRects == rhs.needsFragmentRects;
}

} // namespace facebook::react

namespace std {

template <>
struct hash<facebook::react::TextMeasureCacheKey> {
  size_t operator()(const facebook::react::TextMeasureCacheKey &key) const
  {
    return facebook::react::hash_combine(
        attributedStringHashLayoutWise(key.attributedString),
        key.paragraphAttributes,
        key.layoutConstraints,
        key.pointScaleFactor,
        key.needsFragmentRects);
  }
};

template <>
struct hash<facebook::react::LineMeasureCacheKey> {
  size_t operator()(const facebook::react::LineMeasureCacheKey &key) const
  {
    return facebook::react::hash_combine(
        attributedStringHashLayoutWise(key.attributedString), key.paragraphAttributes, key.size);
  }
};

template <>
struct hash<facebook::react::PreparedTextCacheKey> {
  size_t operator()(const facebook::react::PreparedTextCacheKey &key) const
  {
    return facebook::react::hash_combine(
        attributedStringHashDisplayWise(key.attributedString),
        key.paragraphAttributes,
        key.layoutConstraints,
        key.pointScaleFactor,
        key.needsFragmentRects);
  }
};

} // namespace std
