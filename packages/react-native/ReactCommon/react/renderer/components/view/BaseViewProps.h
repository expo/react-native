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
  // Reading the flag at each probe site instead would cost more than the probes
  // do. The getter is a cross-module call ending in a sequentially-consistent
  // atomic load, it does not inline, and it is paid whether the flag is on or
  // off — so asking it once per View is cheaper than asking it once per
  // property.
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
  /*
   * `font-size` stated in `em` and `rem` — factors, resolved against the
   * inherited size and the root's respectively (css-values-4 §5.1.1).
   *
   * They live beside `inheritedFontSize` rather than being folded into it,
   * because neither can be resolved where a style is parsed: one needs the
   * cascade and the other the root, and a prop object has seen neither. Both
   * are resolved in `applyInheritedTextAttributes`, which runs at the one
   * point in the walk that holds both.
   *
   * Their absence here is what made `<pre>`'s `font-size: 0.8125em` vanish: the
   * factor reached `<Text>` (whose props DO carry one) and nothing else, so a
   * block element stating an `em` size passed its parent's size through
   * untouched, and every descendant resolved against a size `<pre>` was not
   * drawn in.
   */
  Float inheritedFontSizeEm{std::numeric_limits<Float>::quiet_NaN()};
  Float inheritedFontSizeRem{std::numeric_limits<Float>::quiet_NaN()};
  std::string inheritedFontFamily{""};
  std::optional<FontWeight> inheritedFontWeight{};
  std::optional<FontStyle> inheritedFontStyle{};
  std::optional<FontVariant> inheritedFontVariant{};
  Float inheritedLetterSpacing{std::numeric_limits<Float>::quiet_NaN()};
  Float inheritedLineHeight{std::numeric_limits<Float>::quiet_NaN()};
  std::optional<TextAlignment> inheritedTextAlign{};
  std::optional<TextTransform> inheritedTextTransform{};
  /*
   * The platform's own name for this text's ROLE — `title1`, `headline` — from
   * which the platform supplies the font.
   *
   * Not a size and not a weight, which is the point: `[UIFont
   * preferredFontForTextStyle:]` answers with the size, the weight, the family
   * and the leading together, and with whatever else Apple attaches to that
   * role in a later release. A table of numbers copied out of the Human
   * Interface Guidelines gets none of that and goes stale silently — React
   * Native ships one, `RCTBaseSizeForDynamicTypeRamp`, with the spec's URL in
   * a comment above it.
   *
   * Inherited, because the role belongs to the ELEMENT and the text is a run
   * inside it: `<h1>Title</h1>` is a View with an anonymous run, so a role set
   * on the heading has to reach the run the same way its colour does.
   */
  std::optional<DynamicTypeRamp> inheritedDynamicTypeRamp{};
  // `white-space`, inherited like the rest of these: a `<pre>` sets it and
  // every run inside keeps it.
  std::optional<WhiteSpace> inheritedWhiteSpace{};

  /*
   * # The user-agent origin
   *
   * What the user-agent stylesheet declares, carried in properties AN AUTHOR
   * NEVER WRITES. That separation is the whole point of them.
   *
   * CSS resolves a conflict between a user-agent rule and an author's by their
   * ORIGIN — the author wins, always, whatever the specificity. This renderer
   * has nowhere to put an origin: `uaStyle` is merged into `props.style` before
   * anything native sees it, so by then a user-agent value and an author's are
   * the same bytes in the same slot and no amount of care downstream can tell
   * them apart.
   *
   * These give the sheet its own slot for the three declarations where that
   * actually bites. Because an author writes `marginBlock`, `fontSize` and
   * `fontWeight` — never these — the renderer can see which of the two spoke,
   * and can let the author win and the platform win while still having the
   * sheet's value to fall back on.
   *
   * That is what removed the stylesheet's branch on which host it was running
   * on. It used to ask whether anything could resolve a text role and state a
   * size only where nothing could, because a stated size was indistinguishable
   * from an author's; with a channel of its own it states the size ALWAYS, and
   * the renderer decides. One declaration, right on every host.
   *
   * Not inherited. Each belongs to the element the sheet matched.
   */

  /*
   * The spec's own-`em` factor for this element's block margin —
   * `h1 { margin-block: 0.67em }` is 0.67 here.
   *
   * A FACTOR rather than a length, because `em` in a margin resolves against
   * the element's own font-size and the stylesheet does not know what that is:
   * the platform decides it from the text role. Stating the product, as it did,
   * means an h1 rendered at Title 1's 28pt carrying a margin computed for 34.
   */
  Float uaMarginBlockEm{std::numeric_limits<Float>::quiet_NaN()};

  /*
   * The same declaration stated in `rem` — resolved against the ROOT element's
   * font size rather than this element's own.
   *
   * A separate slot rather than a unit tag beside the factor, because the two
   * differ only in which size they multiply and a slot each says that without
   * anything having to be decoded. An element states one or the other; stating
   * both is a stylesheet bug and is asserted against where they are read.
   */
  Float uaMarginBlockRem{std::numeric_limits<Float>::quiet_NaN()};

  /*
   * The spec's `em` factor for this element's own font-size —
   * `h1 { font-size: 2em }` is 2 here.
   *
   * Used only where the text ROLE this element names resolves to nothing: on a
   * host with no type scale to ask, and on any platform where a role fails to
   * resolve. The second case used to leave text with NO SIZE AT ALL, which
   * surfaces as `FontSize should be a positive value` from a letter-spacing
   * calculation — a crash reachable from a plain, valid stylesheet. With a
   * value in this channel it is not reachable at all.
   *
   * A FACTOR, like `uaMarginBlockEm` beside it, but resolved against a
   * DIFFERENT size — and that difference is the whole of css-values-4 §5.1.1.
   * `em` in a margin is the element's OWN font size; `em` in a font-size is
   * the size it INHERITED, because the property being resolved is the one that
   * would otherwise be the answer. So a heading inside a 20pt container is
   * 40pt, and its margin is `0.67 × 40`, not `0.67 × 20`.
   *
   * A factor rather than a resolved size for a second reason too: the root is
   * defined on both sides of the JS/C++ boundary and the two need not agree —
   * under Fantom they are 17 and 16. A factor carries no root to disagree
   * about.
   */
  Float uaFontSizeEm{std::numeric_limits<Float>::quiet_NaN()};

  /*
   * The sheet's own font-weight — `bold` for a heading, on the web.
   *
   * Used on the same condition as [uaFontSizeEm]: only where the role resolves
   * to nothing. It cannot simply be STATED, because that is what the platform
   * branch it replaced was avoiding — both platforms carry weight at the BOTTOM
   * of their heading scale, the inverse of the web. Every iOS Title is regular
   * and Material is regular through Display, Headline and Title Large, so a
   * stated `bold` would override the platform's own answer on exactly the
   * elements the role exists to style.
   */
  std::optional<FontWeight> uaFontWeight{};

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
  /**
   * `corner-shape` and its longhands.
   *
   * `border-radius` says how big a corner is; this says what curve it is. The
   * two values a layer can draw itself — `round` and `squircle` — are handed to
   * Core Animation's own corner; everything else is clipped to a path.
   */
  CascadedCornerShapes cornerShapes{};
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

  /**
   * `background-attachment`, as a single value rather than one per layer.
   *
   * `true` is CSS's `fixed`: the background POSITIONING AREA becomes the
   * viewport instead of this element's own box, so every element sharing the
   * declaration is a window onto one background and pixels at the same screen
   * position are the same colour. `false` is `scroll`, the default, where the
   * background belongs to the box.
   *
   * This is what a chat's message bubbles are made of. The platform's own chat
   * draws one gradient across the window and the balloons are windows onto it,
   * which is why a bubble visibly changes shade as it climbs the screen and why
   * two bubbles at different heights differ — a gradient layer that tracks each
   * balloon's position.
   *
   * DOM-CSS-LIMITATION(background-attachment-single-layer): CSS takes a
   * comma-separated list, one entry per background layer, and `local` is a third
   * value (the positioning area is the element's SCROLLED content). Neither has
   * come up, and a bool keeps the per-frame work on the paint path down to one
   * branch.
   *
   * DOM-CSS-LIMITATION(ios-only-fixed-background): honoured on iOS only. The
   * prop reaches the shadow node on both platforms and Android ignores it, so a
   * fixed background there scrolls with its box. Closing it is an Android
   * drawable that resolves its bounds against the window and is invalidated as
   * the scroll moves — the same two pieces as the iOS path.
   */
  bool backgroundAttachmentFixed{false};

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
