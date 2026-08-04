/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "InlineContentShadowNode.h"

#include <react/renderer/components/text/InlineElementMetrics.h>

#include <algorithm>
#include <limits>
#include <string>

#include <react/renderer/attributedstring/AttributedStringBox.h>
#include <react/renderer/attributedstring/ParagraphAttributes.h>
#include <react/renderer/components/text/BaseTextShadowNode.h>
#include <react/renderer/components/view/YogaStylableProps.h>
#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/core/LayoutContext.h>
#include <react/renderer/core/LayoutableShadowNode.h>
#include <react/renderer/textlayoutmanager/TextLayoutContext.h>

namespace facebook::react {

// NOLINTNEXTLINE(facebook-hte-CArray, modernize-avoid-c-arrays)
const char InlineContentComponentName[] = "InlineContent";

namespace {

// ASCII whitespace subject to CSS `white-space: normal` collapsing
// (css-text-3 §3). Matches the whitespace-only-run predicate in
// AnonymousTextContent.cpp.
bool isCollapsibleWhitespace(char character) {
  return character == ' ' || character == '\t' || character == '\n' ||
      character == '\r' || character == '\f';
}

// Applies CSS `white-space: normal` processing to an anonymous IFC's attributed
// string (css-text-3 §3): collapse each run of collapsible whitespace to a
// single space and trim whitespace at the IFC's leading and trailing edges.
// Collapsing spans fragment boundaries — a space split across two text nodes,
// or around an inline element, collapses to one — mirroring how the web
// collapses across inline boxes. Attachment fragments (e.g. the replaced
// `<img>`) are opaque, non-whitespace anchors. This runs only on anonymous
// IFCs (this class is created solely for text-children runs); explicit `<Text>`
// keeps RN's verbatim whitespace. See text-children-plan.md §3.A/§4.4 and the
// §7 decision (CSS-normal collapsing).
void collapseWhitespace(AttributedString& attributedString) {
  auto& fragments = attributedString.getFragments();

  // Collapse pass. `pendingCollapse` starts true so leading whitespace at the
  // IFC edge is dropped; it stays true while the last emitted character was a
  // (collapsed) space, so consecutive whitespace — even across fragments —
  // yields a single space.
  bool pendingCollapse = true;
  for (auto& fragment : fragments) {
    if (fragment.isAttachment()) {
      // A replaced element is an opaque, non-whitespace box.
      pendingCollapse = false;
      continue;
    }
    std::string collapsed;
    collapsed.reserve(fragment.string.size());
    for (char character : fragment.string) {
      if (isCollapsibleWhitespace(character)) {
        if (!pendingCollapse) {
          collapsed.push_back(' ');
          pendingCollapse = true;
        }
      } else {
        collapsed.push_back(character);
        pendingCollapse = false;
      }
    }
    fragment.string = std::move(collapsed);
  }

  // Trailing edge: at most one collapsed space can remain at the end; strip it
  // from the last text-bearing fragment (a trailing replaced element is not
  // whitespace, so stop there).
  for (auto it = fragments.rbegin(); it != fragments.rend(); ++it) {
    if (it->isAttachment()) {
      break;
    }
    if (it->string.empty()) {
      continue;
    }
    if (it->string.back() == ' ') {
      it->string.pop_back();
    }
    break;
  }

  // Drop fragments emptied by collapsing so the run stays canonical and
  // `isEmpty()` reports true for a run that reduced to nothing.
  std::erase_if(fragments, [](const AttributedString::Fragment& fragment) {
    return !fragment.isAttachment() && fragment.string.empty();
  });
}

// Reserves each inline replaced element's (`<img>`) intrinsic box in the run by
// measuring the attachment shadow node and stamping its size onto the attachment
// fragment, so the run measures with the image's box included
// (text-children-plan.md §3.C). Mirrors
// `ParagraphShadowNode::getContentWithMeasuredAttachments`. Runs before
// whitespace collapsing so the attachment fragment indices are still valid.
void measureImageAttachments(
    AttributedString& attributedString,
    const BaseTextShadowNode::Attachments& attachments,
    const LayoutContext& layoutContext,
    const LayoutConstraints& layoutConstraints) {
  auto& fragments = attributedString.getFragments();
  auto constraints = layoutConstraints;
  constraints.minimumSize = Size{0, 0};
  for (const auto& attachment : attachments) {
    const auto* layoutable =
        dynamic_cast<const LayoutableShadowNode*>(attachment.shadowNode);
    if (layoutable == nullptr || attachment.fragmentIndex >= fragments.size()) {
      continue;
    }
    auto size = layoutable->measure(layoutContext, constraints);

    // An atomic inline box's inline-axis margins add to the advance it
    // occupies on the line (CSS2 §10.8): the reserved box is the MARGIN box,
    // not the border box `measure()` returns. Block-axis margins deliberately
    // do not grow the line box — on the web they have no effect on line
    // height for an inline-level box.
    const auto& attachmentProps =
        *attachment.shadowNode->getProps();
    if (const auto* yogaProps =
            dynamic_cast<const YogaStylableProps*>(&attachmentProps)) {
      const auto& style = yogaProps->yogaStyle;
      const auto inlineMargins =
          style.computeMarginForAxis(yoga::FlexDirection::Row, 0.0f);
      if (!std::isnan(inlineMargins)) {
        size.width += inlineMargins;
      }
    }

    fragments[attachment.fragmentIndex].parentShadowView.layoutMetrics.frame.size =
        size;
  }
}

} // namespace

void InlineContentShadowNode::appendListMarkerIfNeeded(
    AttributedString& attributedString,
    const TextAttributes& textAttributes) const {
  // The marker leads the content, so it is MEASURED with it and the first line
  // starts after it. Every builder in this file has to run it — measurement
  // builds its own attributed string separately from painting, and a marker in
  // only one of them would overlap the text instead of displacing it.
  //
  // We have neither `::marker` nor generated content, so it is an ordinary
  // fragment of this box's inline flow and inherits the element's font and
  // colour the way a real marker does.
  //
  // DOM-CSS-LIMITATION(list-marker-is-inside): this is
  // `list-style-position: inside`, not the web's default `outside` — the
  // marker sits in the content box, so a wrapped line aligns under it rather
  // than hanging past it. `outside` needs the marker painted into the gutter
  // that `<ul>`'s `padding-inline-start` reserves.
  //
  // DOM-CSS-LIMITATION(no-ordered-list-counters): `<ol>` items take the same
  // bullet; numbering needs a counter across an element's siblings.
  if (listMarker_.empty()) {
    return;
  }
  auto marker = AttributedString::Fragment{};
  marker.string = listMarker_;
  marker.textAttributes = textAttributes;
  // No `parentShadowView`: the marker is not any element's content, so it is
  // treated as bare text and never stamped with an element box.
  attributedString.appendFragment(std::move(marker));
}

void InlineContentShadowNode::setListMarker(std::string listMarker) {
  ensureUnsealed();
  listMarker_ = std::move(listMarker);
}

void InlineContentShadowNode::setTextLayoutManager(
    std::shared_ptr<const TextLayoutManager> textLayoutManager) {
  ensureUnsealed();
  textLayoutManager_ = std::move(textLayoutManager);
}

AttributedString InlineContentShadowNode::getContentAttributedString() const {
  auto textAttributes = getInheritedTextAttributes();
  auto attributedString = AttributedString{};
  auto attachments = BaseTextShadowNode::Attachments{};

  appendListMarkerIfNeeded(attributedString, textAttributes);
  BaseTextShadowNode::buildAttributedString(
      textAttributes, *this, attributedString, attachments);
  // Reserve each inline `<img>` box so the painted run offsets the surrounding
  // glyphs past the image, matching the measured layout. The image nodes are
  // never Yoga-laid-out in place (their owning View lays out clones), so their
  // own layout metrics are zero here — we re-measure instead, exactly as
  // `measureContent` does, using the box's own pixel scale.
  auto layoutContext = LayoutContext{};
  layoutContext.pointScaleFactor = getLayoutMetrics().pointScaleFactor;
  measureImageAttachments(
      attributedString,
      attachments,
      layoutContext,
      LayoutConstraints{
          .minimumSize = {0, 0},
          .maximumSize = {
              std::numeric_limits<Float>::infinity(),
              std::numeric_limits<Float>::infinity()}});
  collapseWhitespace(attributedString);
  attributedString.setBaseTextAttributes(textAttributes);
  return attributedString;
}

std::vector<InlineAttachmentPlacement>
InlineContentShadowNode::getInlineAttachmentPlacements(
    const LayoutContext& layoutContext) const {
  std::vector<InlineAttachmentPlacement> placements;
  if (textLayoutManager_ == nullptr) {
    return placements;
  }

  auto textAttributes = getInheritedTextAttributes();
  textAttributes.fontSizeMultiplier = layoutContext.fontSizeMultiplier;

  auto attributedString = AttributedString{};
  auto attachments = BaseTextShadowNode::Attachments{};
  appendListMarkerIfNeeded(attributedString, textAttributes);
  BaseTextShadowNode::buildAttributedString(
      textAttributes, *this, attributedString, attachments);
  if (attachments.empty()) {
    return placements;
  }

  // Reserve each image's box so the run lays out with the attachments included,
  // exactly as `measureContent` does. The images are not laid out yet at this
  // point (the owning View positions them right after), so we measure them here
  // rather than reading their (still-zero) layout metrics.
  measureImageAttachments(
      attributedString,
      attachments,
      layoutContext,
      LayoutConstraints{
          .minimumSize = {0, 0},
          .maximumSize = {
              std::numeric_limits<Float>::infinity(),
              std::numeric_limits<Float>::infinity()}});
  collapseWhitespace(attributedString);
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

void InlineContentShadowNode::stampInlineElementMetrics(
    const LayoutContext& layoutContext,
    Point contentOrigin,
    const LayoutMetrics& ownerLayoutMetrics) const {
  if (textLayoutManager_ == nullptr) {
    return;
  }

  auto textAttributes = getInheritedTextAttributes();
  textAttributes.fontSizeMultiplier = layoutContext.fontSizeMultiplier;

  auto attributedString = AttributedString{};
  auto attachments = BaseTextShadowNode::Attachments{};
  appendListMarkerIfNeeded(attributedString, textAttributes);
  BaseTextShadowNode::buildAttributedString(
      textAttributes, *this, attributedString, attachments);
  if (attributedString.isEmpty()) {
    return;
  }
  attributedString.setBaseTextAttributes(textAttributes);

  // Lay the run out at the size it was actually given, so the rects reflect
  // the wrapping the user sees.
  const auto boxSize = getLayoutMetrics().frame.size;
  TextLayoutContext textLayoutContext{
      .pointScaleFactor = layoutContext.pointScaleFactor,
      .surfaceId = getSurfaceId(),
  };
  const auto measurement = textLayoutManager_->measure(
      AttributedStringBox{attributedString},
      ParagraphAttributes{},
      textLayoutContext,
      LayoutConstraints{.minimumSize = boxSize, .maximumSize = boxSize});

  facebook::react::stampInlineElementMetrics(
      *this,
      attributedString,
      measurement.fragmentRects,
      contentOrigin,
      ownerLayoutMetrics);
}

Size InlineContentShadowNode::measureContent(
    const LayoutContext& layoutContext,
    const LayoutConstraints& layoutConstraints) const {
  auto textAttributes = getInheritedTextAttributes();
  textAttributes.fontSizeMultiplier = layoutContext.fontSizeMultiplier;

  auto attributedString = AttributedString{};
  auto attachments = BaseTextShadowNode::Attachments{};
  appendListMarkerIfNeeded(attributedString, textAttributes);
  BaseTextShadowNode::buildAttributedString(
      textAttributes, *this, attributedString, attachments);
  measureImageAttachments(
      attributedString, attachments, layoutContext, layoutConstraints);
  collapseWhitespace(attributedString);
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
