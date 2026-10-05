/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/cxxstableapi/UmbrellaGuard.h>

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/components/view/ViewState.h>

namespace facebook::react {

// NOLINTNEXTLINE(modernize-avoid-c-arrays)
extern const char ViewComponentName[];

using ViewShadowNodeProps = ViewProps;

/*
 * Shared `ShadowNode` implementation for block-level view containers that host
 * an anonymous inline formatting context: `<View>` and the intrinsic `<div>`.
 * Templated on the component name and props so both share one copy of the
 * text-children layout and paint machinery; the only difference is the
 * concrete props default (`<div>` forces `displayBlock`).
 */
template <
    const char *concreteComponentName,
    typename ViewPropsT = ViewProps,
    // Interactive elements carry a richer emitter than a plain view: `<button>`
    // reports press state. Templated rather than fixed so they can do that
    // without giving up the text-children layout and paint machinery below,
    // which is what makes `<button>Save</button>` render its own text.
    typename ViewEventEmitterT = ViewEventEmitter>
class AbstractViewShadowNode
    : public ConcreteViewShadowNode<concreteComponentName, ViewPropsT, ViewEventEmitterT, ViewState> {
  using BaseShadowNode = ConcreteViewShadowNode<concreteComponentName, ViewPropsT, ViewEventEmitterT, ViewState>;

 public:
  AbstractViewShadowNode(
      const ShadowNodeFragment &fragment,
      const ShadowNodeFamily::Shared &family,
      ShadowNodeTraits traits)
      : BaseShadowNode(fragment, family, traits)
  {
    initialize();
  }

  AbstractViewShadowNode(const ShadowNode &sourceShadowNode, const ShadowNodeFragment &fragment)
      : BaseShadowNode(sourceShadowNode, fragment)
  {
    initialize();
  }

  // A View with an HDR color consumes `dynamic-range-limit` and publishes the
  // effective value in its state; it reads `receivedCascade()` rather than
  // storing a copy, so the node stays within its size budget
  void setInheritedCascade(const std::shared_ptr<const TextAttributes> &cascade) override;

  /*
   * Told when a child arrives, because the constructor is too early to ask.
   *
   * `initialize()` runs before the initial tree's children are appended, so a
   * row containing an `<input type="radio">` looked childless there and was
   * flattened away exactly as if it held nothing — the list never appeared at
   * all on first mount, and only a clone would have noticed. A clone carries
   * its children in the fragment, so `initialize()` DOES see them there; this
   * covers the other half.
   *
   * Both halves are needed and neither is redundant: one path builds a node
   * with children, the other appends them afterwards.
   */
  void appendChild(const std::shared_ptr<const ShadowNode> &child) override;

  void layout(LayoutContext layoutContext) override;

  /*
   * Where this box's baseline sits, measured from its top — what an atomic
   * inline exposes to the line it sits in (CSS2 §10.8.1): the baseline of its
   * last in-flow line box, or its bottom edge when it has none.
   */
  Float baseline(const LayoutContext &layoutContext, Size size) const override;

 private:
  void initialize() noexcept;

  /** The user-agent row padding, where the platform draws a list. */
  void applyRadioRowPaddingIfNeeded();

  /*
   * Resolves the user-agent sheet's block margin against the font-size the
   * element is ACTUALLY drawn at.
   *
   * See `BaseViewProps::uaMarginBlockEm`: the sheet states the spec's `em`
   * factor and the size comes from the platform, so the multiplication has to
   * happen somewhere that can see both. This is that place.
   *
   * `emBase` and `remBase` are the two bases css-values-4 §5.1.1 defines; NaN
   * for either means the walk has not decided one, and the function falls back
   * as documented at its definition.
   */
  void applyRelativeBlockMarginIfNeeded(Float emBase, Float remBase);

  void applyCascadeDependentStyles(Float emBase, Float remBase) override
  {
    applyRelativeBlockMarginIfNeeded(emBase, remBase);
  }

  /*
   * Whether the element's OWN style stated a block margin, asked before any
   * user-agent value was written over it.
   *
   * The question has to be captured rather than re-asked, because answering it
   * means looking at the Yoga style — and by the second configure pass the
   * only block margin there may be one this class wrote itself. Re-asking
   * would see that and conclude the author had stated it, so a user-agent
   * margin would freeze at whatever the first pass computed and never follow
   * the font size again.
   */
  bool authoredBlockMargin_{false};

  /*
   * Positions the atomic inline-level children of this View's anonymous inline
   * boxes, such as the replaced `<img>` and atomic `display: 'inline'`
   * elements, at the frames their run's line layout gave them.
   */
  void layoutInlineAttachments(LayoutContext layoutContext);

  /*
   * Publishes this View's anonymous text runs, laid out, in `ViewState` for
   * the mounting layer to paint. A View without runs keeps a null state.
   */
  void updateTextRunStateIfNeeded(Float fontSizeMultiplier);

  // The element's own, else the cascade's, else CSS's initial; empty for a
  // View with no HDR color
  std::optional<DynamicRangeLimit> effectiveDynamicRangeLimit() const;
  void updateDynamicRangeLimitStateIfNeeded();
};

/*
 * `ShadowNode` for the <View> component.
 */
using ViewShadowNode = AbstractViewShadowNode<ViewComponentName, ViewProps>;

} // namespace facebook::react
