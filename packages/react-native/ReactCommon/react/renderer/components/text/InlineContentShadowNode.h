/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/components/view/YogaLayoutableShadowNode.h>
#include <react/renderer/core/ConcreteShadowNode.h>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>

namespace facebook::react {

extern const char InlineContentComponentName[];

/*
 * Anonymous box establishing an inline formatting context for a run of
 * inline-level children (text nodes, inline text elements) of a block
 * container. Box-tree only: instances live in the Yoga children of their
 * containing View but never in the shadow tree's `children_`, so they are
 * invisible to the differ, mounting, events, and DOM APIs.
 * See implicit-text-plan.md §3.A.
 */
class InlineContentShadowNode final
    : public ConcreteShadowNode<InlineContentComponentName, YogaLayoutableShadowNode, ViewProps> {
 public:
  using ConcreteShadowNode::ConcreteShadowNode;

  static ShadowNodeTraits BaseTraits()
  {
    auto traits = ConcreteShadowNode::BaseTraits();
    traits.set(ShadowNodeTraits::Trait::LeafYogaNode);
    traits.set(ShadowNodeTraits::Trait::MeasurableYogaNode);
    traits.set(ShadowNodeTraits::Trait::AnonymousBox);
    return traits;
  }

  void setTextLayoutManager(std::shared_ptr<const TextLayoutManager> textLayoutManager);

#pragma mark - LayoutableShadowNode

  Size measureContent(const LayoutContext &layoutContext, const LayoutConstraints &layoutConstraints) const override;

 private:
  std::shared_ptr<const TextLayoutManager> textLayoutManager_;
};

} // namespace facebook::react
