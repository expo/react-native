/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <string>

#include <vector>

#include <react/renderer/components/view/InlineTextContentAccessor.h>
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
 * See text-children-plan.md §3.A.
 */
class InlineContentShadowNode final
    : public ConcreteShadowNode<InlineContentComponentName, YogaLayoutableShadowNode, ViewProps>,
      public InlineTextContentAccessor {
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

  /*
   * The marker text a `display: list-item` container renders before its
   * content — `<li>`'s bullet.
   *
   * Set by whoever creates this anonymous box, because only they know the
   * element it belongs to: this node's own props are plain `ViewProps`, so the
   * owning tag is not visible from in here. It has to be part of the content
   * the box MEASURES, not something painted afterwards, or the marker would
   * overlap the first line instead of displacing it.
   */
  void setListMarker(std::string listMarker);

#pragma mark - LayoutableShadowNode

  Size measureContent(const LayoutContext &layoutContext, const LayoutConstraints &layoutConstraints) const override;

#pragma mark - InlineTextContentAccessor

  AttributedString getContentAttributedString() const override;

  std::shared_ptr<const TextLayoutManager> getContentTextLayoutManager() const override
  {
    return textLayoutManager_;
  }

  // Re-runs the run's text layout at the box's final laid-out size and returns
  // the resolved frame of each inline replaced element (`<img>`). Empty when the
  // run has no attachments or the platform layout manager reports none.
  std::vector<InlineAttachmentPlacement> getInlineAttachmentPlacements(
      const LayoutContext &layoutContext) const override;

  void stampInlineElementMetrics(
      const LayoutContext &layoutContext,
      Point contentOrigin,
      const LayoutMetrics &ownerLayoutMetrics) const override;

 private:
  void appendListMarkerIfNeeded(
      AttributedString &attributedString,
      const TextAttributes &textAttributes) const;

  std::shared_ptr<const TextLayoutManager> textLayoutManager_;
  std::string listMarker_;
};

} // namespace facebook::react
