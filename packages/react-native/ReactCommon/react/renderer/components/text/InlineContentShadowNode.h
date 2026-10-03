/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <vector>

#include <react/renderer/attributedstring/TextAttributes.h>
#include <react/renderer/components/view/InlineTextContentAccessor.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/components/view/YogaLayoutableShadowNode.h>
#include <react/renderer/core/ConcreteShadowNode.h>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>

namespace facebook::react {

extern const char InlineContentComponentName[];

/*
 * Anonymous box establishing an inline formatting context for a run of
 * inline-level children of a block container (CSS2 §9.2.1.1). Box-tree only:
 * instances live in the Yoga children of their containing View but never in
 * the shadow tree's `children_`, so they are invisible to the differ,
 * mounting, events, and DOM APIs.
 *
 * The run's lines are laid out by the platform text layout manager: text
 * nodes and inline text elements contribute their text, each atomic inline is
 * an attachment, sized by measuring it, and the line layout decides where
 * everything lands. White space collapses as CSS's `white-space: normal` says.
 */
class InlineContentShadowNode final
    : public ConcreteShadowNode<InlineContentComponentName, YogaLayoutableShadowNode, ViewProps>,
      public InlineTextContentAccessor {
 public:
  InlineContentShadowNode(
      const ShadowNodeFragment &fragment,
      const ShadowNodeFamily::Shared &family,
      ShadowNodeTraits traits)
      : ConcreteShadowNode(fragment, family, traits)
  {
  }

  InlineContentShadowNode(const ShadowNode &sourceShadowNode, const ShadowNodeFragment &fragment)
      : ConcreteShadowNode(sourceShadowNode, fragment),
        // A clone must keep the cascade its source was stamped with: boxes
        // are cloned by state progression, and a fresh default here is text
        // dropping to the default font on re-render.
        inheritedCascade_(static_cast<const InlineContentShadowNode &>(sourceShadowNode).inheritedCascade_)
  {
  }

  void setInheritedCascade(const std::shared_ptr<const TextAttributes> &cascade) override
  {
    inheritedCascade_ = cascade;
  }

  const std::shared_ptr<const TextAttributes> *getStoredCascade() const override
  {
    return &inheritedCascade_;
  }

  /*
   * The effective inherited cascade, stamped by the owning View's configure
   * pass (or, for a box rebuilt during a layout clone, copied from the source
   * box). An anonymous IFC box measures and paints its runs from this at
   * measure time, so it stores its own copy; ordinary Views do not.
   */
  std::shared_ptr<const TextAttributes> inheritedCascade_{YogaLayoutableShadowNode::defaultCascadeTextAttributes()};

  /*
   * The inherited cascade with this box's RESOLVED inline direction stamped
   * on it — what every content build starts from.
   *
   * `ParagraphShadowNode` does exactly this before building its own string,
   * and a run needs it for the same reasons: the text engines resolve
   * `textAlign: 'auto'` against it, and atomic inlines are placed from the
   * inline-start edge, which is the right one under RTL. It cannot live in
   * the cascade itself — that is copy-on-write state shared between nodes and
   * stamped during configure, long before Yoga has resolved a direction.
   */
  TextAttributes baseTextAttributes() const
  {
    auto textAttributes = *inheritedCascade_;
    textAttributes.layoutDirection = YGNodeLayoutGetDirection(&yogaNode_) == YGDirectionRTL
        ? LayoutDirection::RightToLeft
        : LayoutDirection::LeftToRight;
    return textAttributes;
  }

  static ShadowNodeTraits BaseTraits()
  {
    auto traits = ConcreteShadowNode::BaseTraits();
    traits.set(ShadowNodeTraits::Trait::LeafYogaNode);
    traits.set(ShadowNodeTraits::Trait::MeasurableYogaNode);
    traits.set(ShadowNodeTraits::Trait::AnonymousBox);
    // An anonymous IFC box measures and paints its runs straight from the
    // inherited cascade.
    traits.set(ShadowNodeTraits::Trait::TextCascadeConsumer);
    return traits;
  }

  void setTextLayoutManager(std::shared_ptr<const TextLayoutManager> textLayoutManager);

#pragma mark - LayoutableShadowNode

  Size measureContent(const LayoutContext &layoutContext, const LayoutConstraints &layoutConstraints) const override;

  /*
   * The distance from this box's top to the baseline of its first line, which
   * flex and grid baseline alignment use. An atomic inline containing the box
   * exposes `lastLineBaseline` to the line it sits in instead (CSS2 §10.8.1).
   */
  Float baseline(const LayoutContext &layoutContext, Size size) const override;

  Float lastLineBaseline(const LayoutContext &layoutContext, Size size) const override;

#pragma mark - InlineTextContentAccessor

  AttributedString getContentAttributedString(Float fontSizeMultiplier) const override;

  std::shared_ptr<const TextLayoutManager> getContentTextLayoutManager() const override
  {
    return textLayoutManager_;
  }

  // Re-runs the run's line layout at the box's final laid-out size and returns
  // the resolved frame of each atomic inline. Empty when the run has no
  // attachments or the platform layout manager reports none.
  std::vector<InlineAttachmentPlacement> getInlineAttachmentPlacements(
      const LayoutContext &layoutContext) const override;

 private:
  // The baseline of the run's first or last line.
  Float lineBaseline(const LayoutContext &layoutContext, Size size, bool lastLine) const;

  std::shared_ptr<const TextLayoutManager> textLayoutManager_;
};

} // namespace facebook::react
