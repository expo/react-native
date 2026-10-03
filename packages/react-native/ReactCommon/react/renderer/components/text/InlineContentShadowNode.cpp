/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "InlineContentShadowNode.h"

#include <react/renderer/components/text/InlineElementMetrics.h>

#include <algorithm>
#include <cmath>
#include <limits>

#include <react/renderer/attributedstring/AttributedStringBox.h>
#include <react/renderer/attributedstring/ParagraphAttributes.h>
#include <react/renderer/components/text/BaseTextShadowNode.h>
#include <react/renderer/components/view/YogaStylableProps.h>
#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/core/LayoutContext.h>
#include <react/renderer/core/LayoutableShadowNode.h>
#include <react/renderer/textlayoutmanager/TextLayoutContext.h>
#include <react/renderer/textlayoutmanager/TextLayoutManagerExtended.h>

namespace facebook::react {

// NOLINTNEXTLINE(facebook-hte-CArray, modernize-avoid-c-arrays)
const char InlineContentComponentName[] = "InlineContent";

namespace {

// Reserves each atomic inline's box in the run by measuring the attachment
// shadow node and stamping its size onto the attachment fragment, so the run
// measures with the box included. Mirrors
// `ParagraphShadowNode::getContentWithMeasuredAttachments`.
void measureAtomicInlines(
    AttributedString& attributedString,
    const BaseTextShadowNode::Attachments& attachments,
    const LayoutContext& layoutContext,
    const LayoutConstraints& layoutConstraints) {
  auto& fragments = attributedString.getFragments();
  auto baseConstraints = layoutConstraints;
  baseConstraints.minimumSize = Size{0, 0};
  for (const auto& attachment : attachments) {
    const auto* layoutable =
        dynamic_cast<const LayoutableShadowNode*>(attachment.shadowNode);
    if (layoutable == nullptr || attachment.fragmentIndex >= fragments.size()) {
      continue;
    }
    // A measurement root takes its min/max from the constraints, not from its
    // own style — see `constraintsHonoringOwnBounds` for the bug that is.
    auto size = layoutable->measure(
        layoutContext,
        constraintsHonoringOwnBounds(*attachment.shadowNode, baseConstraints));
    // Where this box's baseline sits, so the line layout can put that baseline
    // on the line's rather than dropping the box's bottom onto it.
    fragments[attachment.fragmentIndex].atomicInlineBaseline =
        layoutable->baseline(layoutContext, size);

    // An atomic inline box's inline-axis margins add to the advance it
    // occupies on the line (CSS2 §10.8): the reserved box is the MARGIN box,
    // not the border box `measure()` returns. Block-axis margins deliberately
    // do not grow the line box — on the web they have no effect on line
    // height for an inline-level box.
    const auto& attachmentProps = *attachment.shadowNode->getProps();
    if (const auto* yogaProps =
            dynamic_cast<const YogaStylableProps*>(&attachmentProps)) {
      const auto& style = yogaProps->yogaStyle;
      const auto inlineMargins =
          style.computeMarginForAxis(yoga::FlexDirection::Row, 0.0f);
      if (!std::isnan(inlineMargins)) {
        size.width += inlineMargins;
      }
    }

    fragments[attachment.fragmentIndex]
        .parentShadowView.layoutMetrics.frame.size = size;
  }
}

} // namespace

void InlineContentShadowNode::setTextLayoutManager(
    std::shared_ptr<const TextLayoutManager> textLayoutManager) {
  ensureUnsealed();
  textLayoutManager_ = std::move(textLayoutManager);
}

Float InlineContentShadowNode::baseline(
    const LayoutContext& layoutContext,
    Size size) const {
  return lineBaseline(layoutContext, size, /* lastLine */ false);
}

Float InlineContentShadowNode::lastLineBaseline(
    const LayoutContext& layoutContext,
    Size size) const {
  return lineBaseline(layoutContext, size, /* lastLine */ true);
}

Float InlineContentShadowNode::lineBaseline(
    const LayoutContext& layoutContext,
    Size size,
    bool lastLine) const {
  if (textLayoutManager_ == nullptr) {
    return 0;
  }
  auto attributedString = AttributedString{};
  auto attachments = BaseTextShadowNode::Attachments{};
  const auto textAttributes = baseTextAttributes();
  BaseTextShadowNode::buildAttributedString(
      textAttributes, *this, attributedString, attachments);
  if (attributedString.isEmpty()) {
    return 0;
  }
  // The boxes on the first line decide where its baseline sits, so they are
  // measured first, exactly as `measureContent` does.
  measureAtomicInlines(
      attributedString,
      attachments,
      layoutContext,
      LayoutConstraints{.minimumSize = {0, 0}, .maximumSize = size});
  attributedString.setBaseTextAttributes(textAttributes);

  if constexpr (TextLayoutManagerExtended::supportsLineMeasurement()) {
    auto lines = TextLayoutManagerExtended(*textLayoutManager_)
                     .measureLines(
                         AttributedStringBox{attributedString},
                         ParagraphAttributes{},
                         size);
    if (lines.empty()) {
      return 0;
    }
    // Derived from the line's BOTTOM rather than its ascender: the ascender is
    // a font metric and overshoots the real distance from the content's top to
    // the baseline whenever the line box is not exactly ascent+descent tall.
    // The bottom minus the descender is where the line's baseline actually is.
    const auto& line = lastLine ? lines.back() : lines.front();
    return line.frame.origin.y + line.frame.size.height -
        std::abs(line.descender);
  }
  return 0;
}

std::vector<InlineAttachmentPlacement>
InlineContentShadowNode::getInlineAttachmentPlacements(
    const LayoutContext& layoutContext) const {
  std::vector<InlineAttachmentPlacement> placements;
  if (textLayoutManager_ == nullptr) {
    return placements;
  }

  auto textAttributes = baseTextAttributes();
  textAttributes.fontSizeMultiplier = layoutContext.fontSizeMultiplier;

  auto attributedString = AttributedString{};
  auto attachments = BaseTextShadowNode::Attachments{};
  BaseTextShadowNode::buildAttributedString(
      textAttributes, *this, attributedString, attachments);
  if (attachments.empty()) {
    return placements;
  }

  // Reserve each box so the run lays out with the attachments included,
  // exactly as `measureContent` does. The boxes are not laid out yet at this
  // point (the owning View positions them right after), so they are measured
  // here rather than read from their (still-zero) layout metrics. The inline
  // axis is bounded by the run's own FINAL width — layout is done on this path
  // — so a shrink-to-fit atomic inline is placed at the same clamped size the
  // run measured with, instead of overflowing the container the layout
  // respected.
  const auto placementRunWidth = getLayoutMetrics().frame.size.width;
  measureAtomicInlines(
      attributedString,
      attachments,
      layoutContext,
      LayoutConstraints{
          .minimumSize = {0, 0},
          .maximumSize = {
              placementRunWidth > 0 ? placementRunWidth
                                    : std::numeric_limits<Float>::infinity(),
              std::numeric_limits<Float>::infinity()}});
  attributedString.setBaseTextAttributes(textAttributes);
  if (attributedString.isEmpty()) {
    return placements;
  }

  // Lay the run out at the box's final size so the attachment frames reflect
  // wrapping and alignment as actually mounted.
  auto boxSize = getLayoutMetrics().frame.size;
  TextLayoutContext textLayoutContext{
      .pointScaleFactor = layoutContext.pointScaleFactor,
      .surfaceId = getSurfaceId(),
  };
  auto measurement = textLayoutManager_->measure(
      AttributedStringBox{attributedString},
      ParagraphAttributes{},
      textLayoutContext,
      LayoutConstraints{.minimumSize = boxSize, .maximumSize = boxSize});

  // `measurement.attachments` is parallel to the attachment fragments in the
  // measured string, which preserves the order of `attachments`.
  auto count = std::min(attachments.size(), measurement.attachments.size());
  placements.reserve(count);
  for (size_t i = 0; i < count; ++i) {
    placements.push_back(
        {&attachments[i].shadowNode->getFamily(),
         measurement.attachments[i].frame});
  }
  return placements;
}

Size InlineContentShadowNode::measureContent(
    const LayoutContext& layoutContext,
    const LayoutConstraints& layoutConstraints) const {
  auto textAttributes = baseTextAttributes();
  textAttributes.fontSizeMultiplier = layoutContext.fontSizeMultiplier;

  auto attributedString = AttributedString{};
  auto attachments = BaseTextShadowNode::Attachments{};
  BaseTextShadowNode::buildAttributedString(
      textAttributes, *this, attributedString, attachments);
  measureAtomicInlines(
      attributedString, attachments, layoutContext, layoutConstraints);
  attributedString.setBaseTextAttributes(textAttributes);

  if (attributedString.isEmpty()) {
    return layoutConstraints.clamp({0, 0});
  }

  TextLayoutContext textLayoutContext{
      .pointScaleFactor = layoutContext.pointScaleFactor,
      .surfaceId = getSurfaceId(),
  };

  return textLayoutManager_
      ->measure(
          AttributedStringBox{attributedString},
          ParagraphAttributes{},
          textLayoutContext,
          layoutConstraints)
      .size;
}

} // namespace facebook::react
