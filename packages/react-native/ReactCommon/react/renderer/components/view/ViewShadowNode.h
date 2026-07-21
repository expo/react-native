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
 * `ShadowNode` for <View> component.
 */
class ViewShadowNode final
    : public ConcreteViewShadowNode<ViewComponentName, ViewProps, ViewEventEmitter, ViewState> {
 public:
  ViewShadowNode(const ShadowNodeFragment &fragment, const ShadowNodeFamily::Shared &family, ShadowNodeTraits traits);

  ViewShadowNode(const ShadowNode &sourceShadowNode, const ShadowNodeFragment &fragment);

  void layout(LayoutContext layoutContext) override;

 private:
  void initialize() noexcept;

  /*
   * Publishes the laid-out anonymous text runs into `ViewState` so the
   * mounting layer can paint them (implicit-text-plan.md §3.B).
   */
  void updateTextRunStateIfNeeded();
};

} // namespace facebook::react
