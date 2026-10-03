/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <cmath>
#include <optional>
#include <string>
#include <vector>

#include <react/renderer/attributedstring/AttributedString.h>
#include <react/renderer/attributedstring/TextAttributes.h>
#include <react/renderer/components/view/InlineTextContentAccessor.h>
#include <react/renderer/components/view/ListStyle.h>
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
      public InlineTextContentAccessor,
      public ListMarkerSink {
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
        inheritedCascade_(static_cast<const InlineContentShadowNode &>(sourceShadowNode).inheritedCascade_),
        // Content depends only on children (fixed at construction; state
        // clones keep them), the cascade, and the list marker — the clone
        // shares its source's memoized build until either changes.
        cachedContent_(static_cast<const InlineContentShadowNode &>(sourceShadowNode).cachedContent_)
  {
  }

  void setInheritedCascade(const std::shared_ptr<const TextAttributes> &cascade) override
  {
    inheritedCascade_ = cascade;
    // The cascade is a content input; a stale build must not survive it.
    cachedContent_ = nullptr;
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

  /*
   * Memoized content build, so measurement, state publishing and attachment
   * placement do not each rebuild the run from scratch (fold, attachment
   * measurement, white-space collapsing) in the same commit. The attributed
   * string is reusable only for attachment-free content (attachment
   * measurement depends on per-call layout constraints); `hasAttachments`
   * itself is structural and lets the placement pass skip building entirely.
   *
   * Threading: this memo is written from layout, on a node that a concurrent
   * commit may share with another revision — `ShadowTree::tryCommit` lays out
   * before it takes the revision lock, so two commits can reach the same
   * shared node. The write is a `shared_ptr` store, so it is a data race in
   * the language sense, but not the same hazard as mutating a node's layout
   * metrics in place:
   *
   *  - the payload is immutable and content-derived, so both threads compute
   *    the SAME value; the loser of a store is a lost cache update, and the
   *    next caller rebuilds. Nothing observable differs.
   *  - metrics, by contrast, are read by the mounting thread for the tree on
   *    screen, so writing them into a shared node shows the wrong geometry.
   *
   * Upstream's `ParagraphShadowNode::measuredLayouts_` has the same shape and
   * the same exposure. Making it airtight would take an atomic store here.
   */
  struct CachedContent {
    Float fontSizeMultiplier;
    /*
     * Part of the key, not decoration: the build resolves the inline
     * direction into the base attributes AND into which physical edge an
     * inline element's `inline-start` padding lands on. A `direction` flip on
     * an ancestor re-layouts without touching this box's cascade or children,
     * so nothing else here would notice it.
     */
    std::optional<LayoutDirection> layoutDirection;
    bool hasAttachments;
    AttributedString attributedString; // valid only when !hasAttachments
  };

  /*
   * Whether a memoized build is still the one the current inputs would
   * produce. `fontSizeMultiplier` legitimately holds NaN ("unset"), and IEEE
   * NaN != NaN would silently turn every probe into a miss.
   */
  bool cachedContentMatches(const TextAttributes &textAttributes) const
  {
    if (cachedContent_ == nullptr) {
      return false;
    }
    const auto cached = cachedContent_->fontSizeMultiplier;
    const auto wanted = textAttributes.fontSizeMultiplier;
    return (cached == wanted || (std::isnan(cached) && std::isnan(wanted))) &&
        cachedContent_->layoutDirection == textAttributes.layoutDirection;
  }
  mutable std::shared_ptr<const CachedContent> cachedContent_;

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

  /*
   * The distance from this box's top to the baseline of its first line, which
   * flex and grid baseline alignment use. An atomic inline containing the box
   * exposes `lastLineBaseline` to the line it sits in instead (CSS2 §10.8.1).
   */
  Float baseline(const LayoutContext &layoutContext, Size size) const override;

  Float lastLineBaseline(const LayoutContext &layoutContext, Size size) const override;

#pragma mark - InlineTextContentAccessor

  AttributedString getContentAttributedString(Float fontSizeMultiplier) const override;

  OutsideMarker getOutsideMarker() const override;

  std::shared_ptr<const TextLayoutManager> getContentTextLayoutManager() const override
  {
    return textLayoutManager_;
  }

  // Re-runs the run's line layout at the box's final laid-out size and returns
  // the resolved frame of each atomic inline. Empty when the run has no
  // attachments or the platform layout manager reports none.
  std::vector<InlineAttachmentPlacement> getInlineAttachmentPlacements(
      const LayoutContext &layoutContext) const override;

  std::vector<PendingInlineElementMetrics> stampInlineElementMetrics(
      const LayoutContext &layoutContext,
      Point contentOrigin,
      const LayoutMetrics &ownerLayoutMetrics) const override;

 private:
  // The baseline of the run's first or last line.
  Float lineBaseline(const LayoutContext &layoutContext, Size size, bool lastLine) const;

  void appendListMarkerIfNeeded(AttributedString &attributedString, const TextAttributes &textAttributes) const;

  std::shared_ptr<const TextLayoutManager> textLayoutManager_;
  ListMarker listMarker_{};
};

} // namespace facebook::react
