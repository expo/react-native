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
template <const char *concreteComponentName, typename ViewPropsT = ViewProps>
class AbstractViewShadowNode
    : public ConcreteViewShadowNode<concreteComponentName, ViewPropsT, ViewEventEmitter, ViewState> {
  using BaseShadowNode = ConcreteViewShadowNode<concreteComponentName, ViewPropsT, ViewEventEmitter, ViewState>;

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

  void layout(LayoutContext layoutContext) override;

  /*
   * Where this box's baseline sits, measured from its top — what an atomic
   * inline exposes to the line it sits in (CSS2 §10.8.1): the baseline of its
   * last in-flow line box, or its bottom edge when it has none.
   */
  Float baseline(const LayoutContext &layoutContext, Size size) const override;

 private:
  void initialize() noexcept;

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
};

/*
 * `ShadowNode` for the <View> component.
 */
using ViewShadowNode = AbstractViewShadowNode<ViewComponentName, ViewProps>;

} // namespace facebook::react
