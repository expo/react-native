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

namespace facebook::react {

// NOLINTNEXTLINE(modernize-avoid-c-arrays)
extern const char ViewComponentName[];

using ViewShadowNodeProps = ViewProps;

/*
 * `ShadowNode` for <View> component.
 */
class ViewShadowNode final : public ConcreteViewShadowNode<ViewComponentName, ViewProps, ViewEventEmitter> {
 public:
  ViewShadowNode(const ShadowNodeFragment &fragment, const ShadowNodeFamily::Shared &family, ShadowNodeTraits traits);

  ViewShadowNode(const ShadowNode &sourceShadowNode, const ShadowNodeFragment &fragment);

  void layout(LayoutContext layoutContext) override;

  /*
   * The first baseline, which flex baseline alignment and an inline-flex box's
   * line use. A flex container exports its first flex item's (css-flexbox-1
   * §8.5); any other box answers as `YogaLayoutableShadowNode` does.
   */
  Float baseline(const LayoutContext &layoutContext, Size size) const override;

  /*
   * Where this box's baseline sits as an inline-block, measured from its top
   * (CSS2 §10.8.1): the baseline of its last in-flow line box, or its bottom
   * edge when it has none or clips its content.
   */
  Float lastLineBaseline(const LayoutContext &layoutContext, Size size) const override;

 private:
  void initialize() noexcept;

  /*
   * Positions the atomic inline-level children of this View's anonymous inline
   * boxes at the frames their run's line layout gave them.
   */
  void layoutInlineAttachments(LayoutContext layoutContext);
};

} // namespace facebook::react
