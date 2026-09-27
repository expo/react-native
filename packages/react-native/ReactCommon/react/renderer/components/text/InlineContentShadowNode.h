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
  InlineContentShadowNode(
      const ShadowNodeFragment& fragment,
      const ShadowNodeFamily::Shared& family,
      ShadowNodeTraits traits)
      : ConcreteShadowNode(fragment, family, traits) {}

  InlineContentShadowNode(
      const ShadowNode& sourceShadowNode,
      const ShadowNodeFragment& fragment)
      : ConcreteShadowNode(sourceShadowNode, fragment),
        // A clone must keep the cascade its source was stamped with: boxes
        // are cloned by state progression, and a fresh default here is the
        // "text drops to 14pt black on re-render" bug.
        inheritedCascade_(
            static_cast<const InlineContentShadowNode&>(sourceShadowNode)
                .inheritedCascade_),
        // Content depends only on children (fixed at construction; state
        // clones keep them), the cascade, and the list marker — the clone
        // shares its source's memoized build until either changes.
        cachedContent_(
            static_cast<const InlineContentShadowNode&>(sourceShadowNode)
                .cachedContent_) {}

  void setInheritedCascade(
      const std::shared_ptr<const TextAttributes>& cascade) override {
    inheritedCascade_ = cascade;
    // The cascade is a content input; a stale build must not survive it.
    cachedContent_ = nullptr;
  }

  const std::shared_ptr<const TextAttributes>* getStoredCascade()
      const override {
    return &inheritedCascade_;
  }

  /*
   * The effective inherited cascade, stamped by the owning View's configure
   * pass (or, for a box rebuilt during a layout clone, copied from the source
   * box). An anonymous IFC box measures and paints its bare-text runs from
   * this at measure time, so it stores its own copy; ordinary Views do not.
   */
  std::shared_ptr<const TextAttributes> inheritedCascade_{
      YogaLayoutableShadowNode::defaultCascadeTextAttributes()};

  /*
   * The inherited cascade with this box's RESOLVED inline direction stamped
   * on it — what every content build starts from.
   *
   * `ParagraphShadowNode` does exactly this before building its own string,
   * and a run needs it for the same reasons: the text engines resolve
   * `textAlign: 'auto'` against it, and an inline element's leading edge is
   * its inline-START edge, which is the right one under RTL. It cannot live
   * in the cascade itself — that is copy-on-write state shared between nodes
   * and stamped during configure, long before Yoga has resolved a direction,
   * so a per-node layout result has no place in it.
   */
  TextAttributes cascadeWithResolvedDirection() const {
    auto textAttributes = *inheritedCascade_;
    textAttributes.layoutDirection =
        YGNodeLayoutGetDirection(&yogaNode_) == YGDirectionRTL
        ? LayoutDirection::RightToLeft
        : LayoutDirection::LeftToRight;
    return textAttributes;
  }

  /*
   * Memoized content build. The same run used to be rebuilt from scratch —
   * fold, image measurement, white-space collapsing — up to three times per
   * commit (Yoga measure, state publish, attachment placement), which
   * dominated large single-block content ("article" benchmark shape). The
   * attributed string is reusable only for attachment-free content (image
   * measurement depends on per-call layout constraints); `hasAttachments`
   * itself is structural and lets the placement pass skip building entirely.
   * Written only while the node is unsealed (single commit thread), read
   * freely after — the same immutability contract every sealed member obeys.
   */
  /*
   * THREADING. This memo is written from layout, on a node that a concurrent
   * commit may share with another revision — `ShadowTree::tryCommit` lays out
   * before it takes the revision lock, so two commits can reach the same
   * shared node. The write is a `shared_ptr` store, so it is a data race in
   * the language sense, and it is worth being precise about why it is not the
   * same hazard as mutating a node's layout metrics in place:
   *
   *  - the payload is immutable and content-derived, so both threads compute
   *    the SAME value; the loser of a store is a lost cache update, and the
   *    next caller rebuilds. Nothing observable differs.
   *  - metrics, by contrast, are read by the mounting thread for the tree on
   *    screen, so writing them into a shared node shows the wrong geometry.
   *
   * That distinction is why the in-place metric stamp was removed while this
   * cache was kept. Upstream's `ParagraphShadowNode::measuredLayouts_` has the
   * same shape and the same exposure. If this ever needs to be airtight, the
   * fix is an atomic store here, not a return to stamping in place.
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
    /*
     * The per-fragment rects this string measured to, so stamping inline
     * elements does not lay the run out a second time. They live HERE rather
     * than in a cache of their own because they describe this exact string:
     * separate caches meant separate invalidation, and a marker change
     * invalidated the string while leaving rects that no longer described it.
     *
     * `rectsAvailableWidth` is the width they were measured under -- the input
     * that decides where fragments land -- and NaN when none were taken.
     */
    Float rectsAvailableWidth;
    std::vector<Rect> fragmentRects;
    AttributedString attributedString; // valid only when !hasAttachments
  };

  /*
   * Whether a memoized build is still the one the current inputs would
   * produce. `fontSizeMultiplier` legitimately holds NaN ("unset"), and IEEE
   * NaN != NaN would silently turn every probe into a miss.
   */
  /*
   * The memo's validity depends on two scalars, so ask with those rather than
   * with a whole TextAttributes: building one copies 27 strings, optionals and
   * colours, and on a memo HIT none of it is used.
   */
  /* Writes the content memo. One writer, so the string and the rects that
     describe it cannot be stored or invalidated apart. */
  void memoize(
      const TextAttributes &textAttributes,
      const AttributedString &attributedString,
      bool hasAttachments,
      const std::vector<Rect> &fragmentRects,
      Float rectsAvailableWidth) const;

  bool cachedContentMatches(Float fontSizeMultiplier, LayoutDirection layoutDirection) const
  {
    if (cachedContent_ == nullptr) {
      return false;
    }
    const auto cached = cachedContent_->fontSizeMultiplier;
    return (cached == fontSizeMultiplier ||
            (std::isnan(cached) && std::isnan(fontSizeMultiplier))) &&
        cachedContent_->layoutDirection == layoutDirection;
  }

  /* The run's direction, as laid out. */
  LayoutDirection resolvedLayoutDirection() const
  {
    return YGNodeLayoutGetDirection(&yogaNode_) == YGDirectionRTL
        ? LayoutDirection::RightToLeft
        : LayoutDirection::LeftToRight;
  }

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
    // An anonymous IFC box measures and paints bare-text runs straight from
    // the inherited cascade — the original cascade consumer.
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

#pragma mark - InlineTextContentAccessor

  AttributedString getContentAttributedString(Float fontSizeMultiplier) const override;

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

  /*
   * The measure-and-stamp half, given a finished string. Split out so the
   * memoized string can be used directly: rebuilding it here repeated the
   * fold, the attachment measurement and the whitespace collapse that
   * `measureContent` had just done.
   */
  std::vector<PendingInlineElementMetrics> stampFromString(
      const AttributedString &attributedString,
      const LayoutContext &layoutContext,
      Point contentOrigin,
      const LayoutMetrics &ownerLayoutMetrics) const;

  std::vector<PendingInlineElementMetrics> stampInlineElementMetrics(
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
