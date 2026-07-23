/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/components/view/ViewState.h>

namespace facebook::react {

// NOLINTNEXTLINE(modernize-avoid-c-arrays)
extern const char ViewComponentName[];

using ViewShadowNodeProps = ViewProps;

/*
 * Shared `ShadowNode` implementation for block-level view containers that host
 * an anonymous inline formatting context: `<View>` and the intrinsic `<div>`
 * (implicit-text-plan.md §3). Templated on the component name and props so both
 * share one copy of the implicit-text layout/paint machinery; the only
 * difference is the concrete props default (`<div>` forces `displayBlock`).
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
      : BaseShadowNode(fragment, family, traits) {
    initialize();
  }

  AbstractViewShadowNode(const ShadowNode &sourceShadowNode, const ShadowNodeFragment &fragment)
      : BaseShadowNode(sourceShadowNode, fragment) {
    initialize();
  }

  void layout(LayoutContext layoutContext) override;

 private:
  void initialize() noexcept;

  /*
   * Publishes the laid-out anonymous text runs into `ViewState` so the
   * mounting layer can paint them (implicit-text-plan.md §3.B).
   */
  void updateTextRunStateIfNeeded();

  /*
   * Lays out and positions inline replaced `<img>` children within their run
   * (implicit-text-plan.md §3.C), mirroring `ParagraphShadowNode`'s inline
   * attachment layout: each `<img>` is not a Yoga child, so its frame is set
   * here (from the run box it belongs to) by cloning it and stamping its
   * `layoutMetrics`, which the differ then mounts.
   */
  void layoutInlineImageAttachments(LayoutContext layoutContext);
};

/*
 * `ShadowNode` for the <View> component.
 */
using ViewShadowNode = AbstractViewShadowNode<ViewComponentName, ViewProps>;

} // namespace facebook::react
