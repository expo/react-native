/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <limits>

#include <react/renderer/attributedstring/TextAttributes.h>
#include <react/renderer/attributedstring/primitives.h>
#include <react/renderer/components/view/AccessibilityProps.h>
#include <react/renderer/components/view/YogaStylableProps.h>
#include <react/renderer/components/view/TransitionPrimitives.h>
#include <react/renderer/components/view/primitives.h>
#include <react/renderer/core/LayoutMetrics.h>
#include <react/renderer/core/Props.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/graphics/BackgroundImage.h>
#include <react/renderer/graphics/BackgroundPosition.h>
#include <react/renderer/graphics/BackgroundRepeat.h>
#include <react/renderer/graphics/BackgroundSize.h>
#include <react/renderer/graphics/BlendMode.h>
#include <react/renderer/graphics/BoxShadow.h>
#include <react/renderer/graphics/Color.h>
#include <react/renderer/graphics/Filter.h>
#include <react/renderer/graphics/Isolation.h>
#include <react/renderer/graphics/Transform.h>

#include <optional>

namespace facebook::react {

class BaseViewProps : public YogaStylableProps, public AccessibilityProps {
 public:
  BaseViewProps() = default;
  BaseViewProps(
      const PropsParserContext &context,
      const BaseViewProps &sourceProps,
      const RawProps &rawProps,
      const std::function<bool(const std::string &)> &filterObjectKeys = nullptr);

  void
  setProp(const PropsParserContext &context, RawPropsPropNameHash hash, const char *propName, const RawValue &value);

#pragma mark - Props

  // Color
  Float opacity{1.0};
  SharedColor backgroundColor{};

  // Inheritable text attributes (text-children-plan.md §3.D): cascade to
  // descendant text content when enableStringChildren is on. Keys mirror
  // the CSS inherited text-property set. Parsed here on every View (inert
  // unless the flag is on); folded into the cascade in `configureYogaTree`.
  SharedColor inheritedColor{};
  Float inheritedFontSize{std::numeric_limits<Float>::quiet_NaN()};
  std::string inheritedFontFamily{""};
  std::optional<FontWeight> inheritedFontWeight{};
  std::optional<FontStyle> inheritedFontStyle{};
  std::optional<FontVariant> inheritedFontVariant{};
  Float inheritedLetterSpacing{std::numeric_limits<Float>::quiet_NaN()};
  Float inheritedLineHeight{std::numeric_limits<Float>::quiet_NaN()};
  std::optional<TextAlignment> inheritedTextAlign{};
  std::optional<TextTransform> inheritedTextTransform{};
  // `white-space`, inherited like the rest of these: a `<pre>` sets it and
  // every run inside keeps it.
  std::optional<WhiteSpace> inheritedWhiteSpace{};

  /*
   * `transition` (css-transitions-1). Which properties animate when their
   * value changes, and along what curve. Zipped from the four longhands at
   * parse time so the renderer never re-parses strings while a frame is being
   * interpolated. Empty for the overwhelming majority of views, which is what
   * makes checking for one cheap.
   */
  // The four longhands as authored. Kept because a props clone only carries
  // the keys that CHANGED: without somewhere to fall back to, an update would
  // re-parse from nothing and silently drop the transitions of every view that
  // did not restate them — which is every view, every time.
  std::string transitionPropertyRaw{};
  std::string transitionDurationRaw{};
  std::string transitionDelayRaw{};
  std::string transitionTimingFunctionRaw{};
  Transitions transitions{};

  /*
   * Folds the set inheritable text props above into `textAttributes`. Single
   * source for the two consumers: the element-tree cascade
   * (`YogaLayoutableShadowNode::configureYogaTree`, §3.D) and span-like
   * `display:'inline'` boxes whose contents join a run with their props
   * applied (`BaseTextShadowNode::buildAttributedString`).
   */
  void applyInheritedTextAttributes(TextAttributes &textAttributes) const;

  // Borders
  CascadedBorderRadii borderRadii{};
  CascadedBorderColors borderColors{};
  CascadedBorderCurves borderCurves{}; // iOS only?
  CascadedBorderStyles borderStyles{};

  // Outline
  SharedColor outlineColor{};
  Float outlineOffset{};
  OutlineStyle outlineStyle{OutlineStyle::Solid};
  Float outlineWidth{};

  // Shadow
  SharedColor shadowColor{};
  Size shadowOffset{0, -3};
  Float shadowOpacity{};
  Float shadowRadius{3};

  Cursor cursor{};

  // Box shadow
  std::vector<BoxShadow> boxShadow{};

  // Filter
  std::vector<FilterFunction> filter{};

  // Background Image
  std::vector<BackgroundImage> backgroundImage{};

  // Background Size
  std::vector<BackgroundSize> backgroundSize{};

  // Background Position
  std::vector<BackgroundPosition> backgroundPosition{};

  // Background Repeat
  std::vector<BackgroundRepeat> backgroundRepeat{};

  // MixBlendMode
  BlendMode mixBlendMode{BlendMode::Normal};

  // Isolate
  Isolation isolation{Isolation::Auto};

  // Transform
  Transform transform{};
  TransformOrigin transformOrigin{};
  BackfaceVisibility backfaceVisibility{};
  bool shouldRasterize{};
  std::optional<int> zIndex{};

  // Events
  PointerEventsMode pointerEvents{};
  EdgeInsets hitSlop{};
  bool onLayout{};

  ViewEvents events{};

  bool collapsable{true};
  bool collapsableChildren{true};

  bool removeClippedSubviews{false};

#pragma mark - Convenience Methods

  CascadedBorderWidths getBorderWidths() const;
  BorderMetrics resolveBorderMetrics(const LayoutMetrics &layoutMetrics) const;
  Transform resolveTransform(const LayoutMetrics &layoutMetrics) const;
  bool getClipsContentToBounds() const;

  static Transform
  resolveTransform(const Size &frameSize, const Transform &transform, const TransformOrigin &transformOrigin);

#if RN_DEBUG_STRING_CONVERTIBLE
  SharedDebugStringConvertibleList getDebugProps() const override;
#endif
};

} // namespace facebook::react
