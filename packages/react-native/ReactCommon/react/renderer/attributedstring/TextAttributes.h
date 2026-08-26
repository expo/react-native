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

/*
 * `vertical-align` as it applies to TEXT, which is a different thing from the
 * box-level `AtomicInlineVerticalAlign` next door: that one places a whole
 * atomic inline on a line, this one shifts glyphs off the baseline within a
 * run.
 *
 * Deliberately an enum rather than an offset in points. Both platforms have
 * first-class superscript support that derives the shift AND the size
 * reduction from the font's own metrics — `NSSuperscriptAttributeName` on iOS,
 * `SuperscriptSpan`/`SubscriptSpan` on Android. A hand-computed `0.33em` would
 * be a guess that goes wrong on every font whose designer chose otherwise.
 */
enum class TextVerticalAlign : uint8_t {
  Baseline,
  Super,
  Sub,
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

  /*
   * `font-size`'s initial value — the platform's body text size.
   *
   * Reading it through `defaultTextAttributes()` copies the whole struct,
   * including a `std::string` and a `std::vector`, to get at one float. The
   * cascade asks for this per element.
   */
  static Float initialFontSize();

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
  /*
   * A font size given in `em`: a multiple of the INHERITED font size, which is
   * what `em` means in CSS (css-values-4 5.1.1). Resolved when this element's
   * attributes are folded onto its parent's, because that is the only point
   * where the inherited size is known. `rem` needs no such treatment — the
   * root size is a constant the sheet can write directly.
   */
  Float fontSizeEm{std::numeric_limits<Float>::quiet_NaN()};
  Float fontSizeRem{std::numeric_limits<Float>::quiet_NaN()};

  /*
   * The USER-AGENT sheet's `em` factor for this element's font size — the same
   * value as `fontSizeEm` beside it, in a channel an author never writes.
   *
   * The split is the cascade's origins. The sheet gives `<pre>` and `<sup>`
   * `font-size: 0.8125em` and `0.8333em`; an author writing
   * `<sup style={{fontSize: 10}}>` states an AUTHOR-origin declaration, which
   * beats a user-agent one (css-cascade-4 §6.1). Sharing one property makes
   * that unexpressible — two values in one slot, with nothing to say which
   * origin spoke.
   */
  Float uaFontSizeEm{std::numeric_limits<Float>::quiet_NaN()};


  /*
   * Decides one element's computed `font-size`, for every path that has to.
   *
   * There are two — a block container folds the cascade in
   * `BaseViewProps::applyInheritedTextAttributes`, a text node in
   * `TextAttributes::apply` — and they must reach the same answer, or one
   * stylesheet means two things depending on which kind of element it lands on.
   *
   * The order is css-cascade-4 §6.1 — author origin over user-agent origin —
   * and, within the author's, css-values-4 §5.1.1 for what each unit resolves
   * against:
   *
   *   1. the author's `em`, against the INHERITED size;
   *   2. the author's `rem`, against the ROOT's — which is font-size's INITIAL
   *      value, and not a number this has to be told. React Native's root
   *      element is the surface root, which no app-rendered element is and
   *      which an app has no way to state a font size on
   *      (`DOM-CSS-LIMITATION(rem-root-is-the-unstylable-surface-root)`), so
   *      the root's computed size is the initial value for the life of the
   *      surface. Carrying it as a value was four bytes and a propagation pass
   *      spent on a number that could not differ;
   *   3. the author's absolute `fontSize`;
   *   4. a platform text role, which supersedes any user-agent size;
   *   5. the user-agent sheet's `em`, against the inherited size;
   *   6. nothing stated — inherit.
   *
   * Returns `nullopt` for (6), meaning leave the inherited size alone. For (4)
   * it returns an engaged NaN, which means something quite different from "no
   * size": it means ASK THE PLATFORM'S FONT, which carries the weight and the
   * leading a number cannot express. Collapsing those two is how a role that
   * failed to resolve once left text with no size at all, and surfaced far away
   * as `FontSize should be a positive value`.
   */
  static std::optional<Float> resolveFontSize(
      Float declaredFontSize,
      Float declaredFontSizeEm,
      Float declaredFontSizeRem,
      Float userAgentFontSizeEm,
      bool platformSuppliesSize,
      Float inheritedFontSize);
  Float fontSizeMultiplier{std::numeric_limits<Float>::quiet_NaN()};
  Float maxFontSizeMultiplier{std::numeric_limits<Float>::quiet_NaN()};
  Float letterSpacing{std::numeric_limits<Float>::quiet_NaN()};
  // `<sup>`/`<sub>`: a baseline shift the platform's text engine computes.
  std::optional<TextVerticalAlign> verticalAlign{};
  /*
   * A NUMERIC baseline shift in points; positive raises the glyphs. Unlike
   * `verticalAlign`, whose amount each platform derives from its font, this
   * states the distance — what a symbolic list marker needs to centre its
   * ink on the x-height midpoint the way browsers paint theirs, and what
   * `vertical-align: <length>` will need. iOS: NSBaselineOffset; Android: a
   * MetricAffecting span adjusting TextPaint.baselineShift.
   */
  Float baselineShift{std::numeric_limits<Float>::quiet_NaN()};
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

  /*
   * The URL an `<a href>` points at, carried down to the run that draws it.
   *
   * A link is not a view. Inside a paragraph it is a RANGE OF GLYPHS, so the
   * only thing that can hold its destination is the text attributes of the
   * fragment those glyphs came from — the same route
   * `accessibilityRole: 'link'` already takes to reach VoiceOver.
   *
   * Native rather than JavaScript-only because the platform's own link
   * interaction needs it: on iOS this becomes `NSLinkAttributeName`, which is
   * UIKit's own key for "this range is a link", and the context-menu
   * interaction reads it back at the touched point. JavaScript never sees this
   * copy; the component keeps its own `href` prop for the click default.
   *
   * NOT INHERITED, unlike most attributes here. A link's destination belongs to
   * the anchor, and cascading it would make every nested run — a `<b>` inside
   * the link, and then anything after it that happened to share attributes —
   * claim the same URL.
   */
  std::string href{};

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
        textAttributes.baselineShift,
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
