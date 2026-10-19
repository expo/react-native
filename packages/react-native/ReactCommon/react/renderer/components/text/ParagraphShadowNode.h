/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <optional>
#include <react/cxxstableapi/FrameworksGuard.h>

#include <React/RendererCore.h>
#include <React/View.h>
#include <react/renderer/components/text/BaseTextShadowNode.h>
#include <react/renderer/components/text/ParagraphEventEmitter.h>
#include <react/renderer/components/text/ParagraphProps.h>
#include <react/renderer/components/text/ParagraphState.h>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>
#include <react/renderer/textlayoutmanager/TextLayoutManagerExtended.h>

namespace facebook::react {

extern const char ParagraphComponentName[];

/*
 * `ShadowNode` for <Paragraph> component, represents <View>-like component
 * containing and displaying text. Text content is represented as nested <Text>
 * components and `#text` nodes.
 */
class ParagraphShadowNode
    : public ConcreteViewShadowNode<ParagraphComponentName, ParagraphProps, ParagraphEventEmitter, ParagraphState>,
      public BaseTextShadowNode {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  ParagraphShadowNode(
      const ShadowNodeFragment &fragment,
      const ShadowNodeFamily::Shared &family,
      ShadowNodeTraits traits);

  ParagraphShadowNode(const ShadowNode &sourceShadowNode, const ShadowNodeFragment &fragment);

  static ShadowNodeTraits BaseTraits()
  {
    auto traits = ConcreteViewShadowNode::BaseTraits();
    traits.set(ShadowNodeTraits::Trait::LeafYogaNode);
    traits.set(ShadowNodeTraits::Trait::MeasurableYogaNode);
    traits.set(ShadowNodeTraits::Trait::BaselineYogaNode);
    // A paragraph folds the inherited text cascade beneath its own TextProps
    // (see getContent), so it is a cascade consumer.
    traits.set(ShadowNodeTraits::Trait::TextCascadeConsumer);
    // Root <Text>'s user-agent stylesheet declares `all: 'initial'`: old
    // React Native's "<Text> is a style boundary" contract, kept for
    // pixel-identical compatibility and expressed as the cascade's native UA
    // origin. Authored `all` resolves against this declaration in
    // BaseViewProps::isInheritanceBoundary — `unset`/`inherit` switch the
    // boundary off, `revert` rolls back to it. Nested <Text> renders as
    // virtual text (no ParagraphShadowNode), so the declaration reaches
    // exactly the roots.
    traits.set(ShadowNodeTraits::Trait::UACascadeBoundary);

#ifdef ANDROID
    // Unsetting `FormsStackingContext` trait is essential on Android where we
    // can't mount views inside `TextView`.
    // T221699219: This should be removed when PreparedLayoutTextView is rolled
    // out.
    traits.unset(ShadowNodeTraits::Trait::FormsStackingContext);
#endif

    return traits;
  }

  /*
   * Associates a shared TextLayoutManager with the node.
   * `ParagraphShadowNode` uses the manager to measure text content
   * and construct `ParagraphState` objects.
   */
  void setTextLayoutManager(std::shared_ptr<const TextLayoutManager> textLayoutManager);

#pragma mark - LayoutableShadowNode

  void layout(LayoutContext layoutContext) override;

  Size measureContent(const LayoutContext &layoutContext, const LayoutConstraints &layoutConstraints) const override;

  Float baseline(const LayoutContext &layoutContext, Size size) const override;

  /*
   * The paragraph's min-content size, for Yoga's automatic-minimum probe: the
   * widest of its longest words measured alone, and the height of the text
   * wrapped to that width. Nothing when there is no text to measure.
   */
  std::optional<Size> measureMinContent(
      const LayoutContext& layoutContext,
      const LayoutConstraints& layoutConstraints) const;

  Float lastLineBaseline(const LayoutContext &layoutContext, Size size) const override;

  /*
   * Internal representation of the nested content of the node in a format
   * suitable for future processing.
   */
  class Content final {
   public:
    AttributedString attributedString;
    ParagraphAttributes paragraphAttributes;
    Attachments attachments;
  };

 protected:
  bool shouldNewRevisionDirtyMeasurement(const ShadowNode &sourceShadowNode, const ShadowNodeFragment &fragment)
      const override;

 private:
  void initialize() noexcept;
  /*
   * Builds (if needed) and returns a reference to a `Content` object.
   */
  const Content &getContent(const LayoutContext &layoutContext) const;

  /*
   * Drops the content and the layouts measured for it if the content was built
   * for another font size multiplier or layout direction (it may have been
   * carried over from a previous revision).
   */
  void dropContentBuiltForAnotherContext(const LayoutContext &layoutContext) const;

  LayoutDirection resolvedLayoutDirection() const;

  /*
   * Builds and returns a `Content` object with given `layoutConstraints`.
   */
  Content getContentWithMeasuredAttachments(
      const LayoutContext &layoutContext,
      const LayoutConstraints &layoutConstraints) const;

  /*
   * Creates a `State` object (with `AttributedText` and
   * `TextLayoutManager`) if needed.
   */
  template <typename ParagraphStateT>
  void updateStateIfNeeded(const Content &content, const MeasuredPreparedTextLayout &layout);

  /*
   * Creates a `State` object (with `AttributedText`, `TextLayoutManager` and,
   * outside of Android, the size of the content frame) if needed.
   */
  void updateStateIfNeeded(const Content &content);

  /**
   * Returns any previously prepared layout, generated for measurement, which
   * may be used, given the currently assigned layout to the ShadowNode and
   * the current pixel density
   */
  const MeasuredPreparedTextLayout *findUsableLayout(Float pointScaleFactor);

  /**
   * Returns the final measure of the content frame, before layout rounding
   */
  Size rawContentSize();

  std::shared_ptr<const TextLayoutManager> textLayoutManager_;

  /*
   * Cached content of the subtree started from the node.
   */
  mutable std::optional<Content> content_{};

  /*
   * The effective inherited cascade, stamped by the configure pass — a
   * paragraph is a TextCascadeConsumer and reads it at measure time (see
   * getContent), so it stores its own copy; ordinary Views do not.
   */
  std::shared_ptr<const TextAttributes> inheritedCascade_{};

 public:
  void setInheritedCascade(const std::shared_ptr<const TextAttributes> &cascade) override
  {
    inheritedCascade_ = cascade;
  }

  const std::shared_ptr<const TextAttributes> *getStoredCascade() const override
  {
    return &inheritedCascade_;
  }

 private:
  /*
   * Intermediate layout results generated during measurement, that may be
   * reused by the platform. Layouts are immutable once measured and shared by clones.
   */
  mutable std::vector<std::shared_ptr<const MeasuredPreparedTextLayout>> measuredLayouts_;
};

} // namespace facebook::react
