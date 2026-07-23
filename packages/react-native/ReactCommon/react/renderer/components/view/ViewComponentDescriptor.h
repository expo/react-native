/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/view/ViewShadowNode.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/State.h>

namespace facebook::react {

class ViewComponentDescriptor : public ConcreteComponentDescriptor<ViewShadowNode> {
 public:
  ViewComponentDescriptor(const ComponentDescriptorParameters &parameters)
      : ConcreteComponentDescriptor<ViewShadowNode>(parameters)
  {
  }

  /*
   * Views start stateless. Although `ViewShadowNode` declares a `ViewState`
   * (to paint anonymous text runs), a plain View has no runs and needs no
   * state — so a `ViewState` is allocated lazily, on the first runs, rather
   * than for every View at construction (implicit-text-plan.md §4.2 /
   * next-steps T3). This keeps the pre-implicit-text hot path zero-cost: a
   * prop-less, textless View allocates no state object, exactly as before the
   * feature. `ViewShadowNode::updateTextRunStateIfNeeded` performs the
   * null -> non-null transition when runs appear.
   */
  State::Shared createInitialState(
      const Props::Shared & /*props*/,
      const ShadowNodeFamily::Shared & /*family*/) const override
  {
    return nullptr;
  }
};

} // namespace facebook::react
