/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "InlineContentShadowNode.h"

#include <string_view>

#include <react/renderer/dom/NodeNameProvider.h>

#include <react/renderer/mounting/ShadowView.h>

#include <react/renderer/components/text/InlineElementMetrics.h>

#include <algorithm>
#include <cmath>
#include <limits>
#include <string>

#include <react/renderer/attributedstring/AttributedStringBox.h>
#include <react/renderer/textlayoutmanager/TextLayoutManagerExtended.h>
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

// A segment break (css-text-3 §4.1): whitespace that ends a line where
// `white-space` preserves newlines, as opposed to a space or tab, which the
// same value may still collapse.
bool isSegmentBreak(char character) {
  return character == '\n' || character == '\r';
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
    auto whiteSpace =
        fragment.textAttributes.whiteSpace.value_or(WhiteSpace::Normal);
    if (preservesSpaces(whiteSpace) && preservesNewlines(whiteSpace)) {
      // `pre`, `pre-wrap`, `break-spaces` (css-text-3 §3): runs of spaces and
      // newlines are preserved verbatim, in what is rendered AND in what a copy
      // puts on the clipboard. Nothing here touches them, and `pendingCollapse`
      // is cleared so a following normal-whitespace run does not treat the
      // preserved text as if it had ended in a collapsed space.
      pendingCollapse = false;
      continue;
    }
    if (fragment.forcedBreak) {
      // A forced break from `<br>`. Its newline is content, not collapsible
      // whitespace, so it survives untouched — but whitespace FOLLOWING it
      // sits at the start of a new line and is dropped, which is what leaving
      // `pendingCollapse` set does.
      pendingCollapse = true;
      continue;
    }
    std::string collapsed;
    collapsed.reserve(fragment.string.size());
    for (char character : fragment.string) {
      // `pre-line` is the one value that splits the two axes: a segment break
      // is content that ends the line, while spaces and tabs around it still
      // collapse. The space before the break is dropped (it would sit at the
      // end of a line) and `pendingCollapse` stays set afterwards so the ones
      // after it are dropped too (they would lead the next line).
      if (isSegmentBreak(character) && preservesNewlines(whiteSpace)) {
        if (!collapsed.empty() && collapsed.back() == ' ') {
          collapsed.pop_back();
        }
        collapsed.push_back('\n');
        pendingCollapse = true;
        continue;
      }
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
    // Where this box's baseline sits, so the text engine can put that baseline
    // on the line's rather than dropping the box's bottom onto it.
    fragments[attachment.fragmentIndex].atomicInlineBaseline =
        layoutable->baseline(layoutContext, size);

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
  if (listMarker_.text.empty() || listMarker_.outside) {
    return;
  }
  auto marker = AttributedString::Fragment{};
  // The gap after the marker is a no-break space, so it survives the
  // white-space collapsing a plain space would not.
  marker.string = listMarker_.text + reinterpret_cast<const char*>(u8"\u00A0");
  marker.textAttributes = textAttributes;
  // No `parentShadowView`: the marker is not any element's content, so it is
  // treated as bare text and never stamped with an element box.
  attributedString.appendFragment(std::move(marker));
}

void InlineContentShadowNode::setListMarker(ListMarker listMarker) {
  ensureUnsealed();
  listMarker_ = std::move(listMarker);
}

void InlineContentShadowNode::setTextLayoutManager(
    std::shared_ptr<const TextLayoutManager> textLayoutManager) {
  ensureUnsealed();
  textLayoutManager_ = std::move(textLayoutManager);
}

InlineContentShadowNode::OutsideMarker
InlineContentShadowNode::getOutsideMarker() const {
  // Only `outside` markers are painted separately; an `inside` one is already
  // part of the measured content.
  if (listMarker_.text.empty() || !listMarker_.outside ||
      textLayoutManager_ == nullptr) {
    return {};
  }

  auto markerString = AttributedString{};
  auto fragment = AttributedString::Fragment{};
  // The trailing no-break space is the gap between the marker and the content.
  // Measuring it as part of the marker is what sets the marker's start
  // position once the caller right-aligns the whole thing to the content edge.
  fragment.string =
      listMarker_.text + reinterpret_cast<const char*>(u8"\u00A0");
  fragment.textAttributes = getInheritedTextAttributes();
  // A fragment reaching the paint path needs a real `parentShadowView`: the
  // text-effect machinery walks it, and a default-constructed one segfaults.
  fragment.parentShadowView = ShadowView{*this};
  markerString.appendFragment(std::move(fragment));

  const auto measurement = textLayoutManager_->measure(
      AttributedStringBox{markerString},
      ParagraphAttributes{},
      TextLayoutContext{
          .pointScaleFactor = getLayoutMetrics().pointScaleFactor,
          .surfaceId = getSurfaceId()},
      LayoutConstraints{});

  return OutsideMarker{
      .attributedString = markerString,
      .size = measurement.size,
      .present = true};
}

Float InlineContentShadowNode::baseline(
    const LayoutContext& /*layoutContext*/,
    Size size) const {
  if (textLayoutManager_ == nullptr) {
    return 0;
  }
  auto attributedString = AttributedString{};
  auto attachments = BaseTextShadowNode::Attachments{};
  appendListMarkerIfNeeded(attributedString, getInheritedTextAttributes());
  BaseTextShadowNode::buildAttributedString(
      getInheritedTextAttributes(), *this, attributedString, attachments);
  if (attributedString.isEmpty()) {
    return 0;
  }

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
    // the baseline whenever the line box is not exactly ascent+descent tall,
    // which put an inline-block's text a couple of points above the text
    // around it on iOS. The bottom minus the descender is where the glyphs
    // actually sit.
    const auto& line = lines[0];
    return line.frame.origin.y + line.frame.size.height -
        std::abs(line.descender);
  }
  return 0;
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

/*
 * The constraints text is laid out under, given its `white-space`.
 *
 * `pre` and `nowrap` do not wrap (css-text-3 §3), so the line breaker must be
 * given unbounded width — otherwise a long line silently folds and the
 * preserved whitespace is the only half of `pre` that works. The resulting box
 * is wider than its container, which is exactly what the web does: a `<pre>`
 * overflows rather than reflows.
 */
static LayoutConstraints constraintsForWhiteSpace(
    const TextAttributes& textAttributes,
    const LayoutConstraints& layoutConstraints) {
  if (wrapsText(textAttributes.whiteSpace.value_or(WhiteSpace::Normal))) {
    return layoutConstraints;
  }
  auto unwrapped = layoutConstraints;
  unwrapped.maximumSize.width = std::numeric_limits<Float>::infinity();
  return unwrapped;
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
          constraintsForWhiteSpace(textAttributes, layoutConstraints))
      .size;
}

} // namespace facebook::react
