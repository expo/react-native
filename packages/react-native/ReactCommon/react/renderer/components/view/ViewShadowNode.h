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
   * Where this box's baseline sits, measured from its top — what an atomic
   * inline exposes to the line it sits in (CSS2 §10.8.1): the baseline of its
   * last in-flow line box, or its bottom edge when it has none.
   */
  Float baseline(const LayoutContext &layoutContext, Size size) const override;

 private:
  void initialize() noexcept;

  /*
   * Positions the atomic inline-level children of this View's anonymous inline
   * boxes at the frames their run's line layout gave them.
   */
  void layoutInlineAttachments(LayoutContext layoutContext);
};

} // namespace facebook::react
