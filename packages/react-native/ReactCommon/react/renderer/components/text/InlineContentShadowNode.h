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
#include <react/renderer/components/view/ListStyle.h>
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
      public InlineTextContentAccessor,
      public ListMarkerSink {
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
  void setListMarker(ListMarker listMarker) override;

  bool listMarkerEquals(const ListMarker &other) const
  {
    return listMarker_ == other;
  }

  /*
   * The marker to paint in the gutter, empty unless this box has an `outside`
   * marker. Read by the owning View when it publishes its text runs.
   */
  const ListMarker &getListMarker() const override
  {
    return listMarker_;
  }

#pragma mark - LayoutableShadowNode

  Size measureContent(const LayoutContext &layoutContext, const LayoutConstraints &layoutConstraints) const override;

#pragma mark - InlineTextContentAccessor

  AttributedString getContentAttributedString() const override;

  OutsideMarker getOutsideMarker() const override;

  /*
   * The distance from this box's top to the baseline of its FIRST line, which
   * is what an atomic inline containing it exposes to the line it sits in
   * (CSS2 §10.8.1).
   */
  Float baseline(const LayoutContext &layoutContext, Size size) const override;

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
  ListMarker listMarker_{};
};

} // namespace facebook::react
