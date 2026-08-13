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
      const std::function<bool(const std::string &)> &filterObjectKeys = nullptr,
      // Text-vocabulary props (ParagraphProps) pass false: their BaseTextProps
      // parse already probes the same style keys into `textAttributes`, and
      // re-probing them here doubled the parse cost of every <Text>. They copy
      // the parsed values into the inherited* fields instead (zero probes).
      bool parseInheritedTextProps = true);

  void
  setProp(const PropsParserContext &context, RawPropsPropNameHash hash, const char *propName, const RawValue &value);

 private:
  // Tag for the delegated constructor below. The public constructor reads
  // `enableStringChildren` ONCE and forwards the answer; this one takes it as
  // a plain bool.
  //
  // Reading the flag at each of the twelve probe sites instead cost more than
  // the probes did: the getter is a cross-module call that ends in a
  // sequentially-consistent atomic load, it does not inline, and it is paid
  // whether the flag is on or off. Twelve of them per View, on every props
  // construction, measured about 0.4ms on a 1,365-View mount — larger than
  // the entire cost of the feature it was gating.
  struct ResolvedFlag {};

  BaseViewProps(
      const PropsParserContext &context,
      const BaseViewProps &sourceProps,
      const RawProps &rawProps,
      const std::function<bool(const std::string &)> &filterObjectKeys,
      bool parseInheritedTextProps,
      bool stringChildrenEnabled,
      ResolvedFlag);

 public:

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
   * Whether ANY inheritable text prop above is set — computed once at parse.
   * The cascade's hot paths (the clone-path differ, the per-configure fold)
   * run for every View on every commit, and for the overwhelming majority the
   * answer is "nothing to do"; this bit is that answer in one load.
   */
  bool hasInheritedTextProps{false};

  bool computeHasInheritedTextProps() const;

  /*
   * CSS `all` (css-cascade-4 §3.2), scoped to the inherited text set — the
   * only cascading properties this renderer has. The parsed keyword is kept
   * verbatim; what it MEANS depends on the element's user-agent origin, so
   * resolution happens in `isInheritanceBoundary(bool)` below, against the
   * UACascadeBoundary trait. Catalog UA styles merged into props on the JS
   * side are author-level from this cascade's point of view; the UA origin
   * here is exclusively the trait-declared one.
   */
  enum class CascadeReset : uint8_t { None, Initial, Revert, Unset };
  CascadeReset cascadeReset{CascadeReset::None};

  /*
   * Resolves the authored `all` against the element's user-agent declaration
   * (`uaDeclaresBoundary` = the node's UACascadeBoundary trait), per
   * css-cascade-4 §7.3: `initial` is a boundary and `unset` is not, from any
   * origin's default; `revert` rolls the author declaration back to the UA
   * origin; and an absent declaration leaves the UA origin in force. Root
   * <Text> (UA `all: 'initial'`) therefore stays a boundary under `revert`
   * and loses it under `unset`; every other element inherits under both.
   */
  bool isInheritanceBoundary(bool uaDeclaresBoundary) const override {
    switch (cascadeReset) {
      case CascadeReset::Initial:
        return true;
      case CascadeReset::Unset:
        return false;
      case CascadeReset::Revert:
      case CascadeReset::None:
        return uaDeclaresBoundary;
    }
    return uaDeclaresBoundary;
  }

  /**
   * Everything `transition` and `animation` authored on this view
   * (css-transitions-1, css-animations-1), behind one pointer.
   *
   * Side-allocated because it is 368 bytes — eleven `std::string`s of authored
   * longhands, the zipped `Transitions`, and an `optional<CSSAnimation>` — and
   * on essentially every view in essentially every app, all of it is empty.
   * Inline, that is 368 bytes per view of nothing, copied again on every props
   * clone. As a pointer it is 8, and a clone of a view with no motion copies a
   * null pointer.
   *
   * The raw strings are kept, and are why this cannot simply be the parsed
   * values: a props clone only carries the keys that CHANGED, so without
   * somewhere to fall back to, an update would re-parse from nothing and
   * silently drop the transitions of every view that did not restate them —
   * which is every view, every time.
   *
   * Null means none authored. Read through `transitions()` and `animation()`,
   * which answer the same way whether or not anything was.
   */
  struct CssMotion {
    std::string transitionPropertyRaw{};
    std::string transitionDurationRaw{};
    std::string transitionDelayRaw{};
    std::string transitionTimingFunctionRaw{};
    Transitions transitions{};

    std::string animationKeyframesRaw{};
    std::string animationDurationRaw{};
    std::string animationDelayRaw{};
    std::string animationTimingFunctionRaw{};
    std::string animationIterationCountRaw{};
    std::string animationDirectionRaw{};
    std::string animationFillModeRaw{};
    std::optional<CSSAnimation> animation{};

    /** Whether anything was authored, i.e. whether this is worth allocating. */
    bool isEmpty() const
    {
      return transitionPropertyRaw.empty() && transitionDurationRaw.empty() && transitionDelayRaw.empty() &&
          transitionTimingFunctionRaw.empty() && animationKeyframesRaw.empty() && animationDurationRaw.empty() &&
          animationDelayRaw.empty() && animationTimingFunctionRaw.empty() && animationIterationCountRaw.empty() &&
          animationDirectionRaw.empty() && animationFillModeRaw.empty();
    }

    /** Whether the authored longhands are the same ones, so the clone can share. */
    bool rawsEqual(const CssMotion &other) const
    {
      return transitionPropertyRaw == other.transitionPropertyRaw &&
          transitionDurationRaw == other.transitionDurationRaw && transitionDelayRaw == other.transitionDelayRaw &&
          transitionTimingFunctionRaw == other.transitionTimingFunctionRaw &&
          animationKeyframesRaw == other.animationKeyframesRaw &&
          animationDurationRaw == other.animationDurationRaw && animationDelayRaw == other.animationDelayRaw &&
          animationTimingFunctionRaw == other.animationTimingFunctionRaw &&
          animationIterationCountRaw == other.animationIterationCountRaw &&
          animationDirectionRaw == other.animationDirectionRaw && animationFillModeRaw == other.animationFillModeRaw;
    }
  };

  std::shared_ptr<const CssMotion> cssMotion{};

  /** The view's transitions; empty when none were authored. */
  const Transitions &transitions() const
  {
    static const Transitions kNone{};
    return cssMotion == nullptr ? kNone : cssMotion->transitions;
  }

  /** The view's animation; absent when none was authored. */
  const std::optional<CSSAnimation> &animation() const
  {
    static const std::optional<CSSAnimation> kNone{};
    return cssMotion == nullptr ? kNone : cssMotion->animation;
  }

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

  /*
   * `user-select` (css-ui-4 §5.1) — whether the anonymous text runs this View
   * paints can be selected and copied. Per-element, like `<Text selectable>`:
   * it does not cascade to descendant Views (see the note on the enum).
   */
  UserSelect userSelect{UserSelect::Auto};

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
