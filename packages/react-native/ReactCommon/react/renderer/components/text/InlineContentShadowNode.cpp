/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "InlineContentShadowNode.h"

#include <string>

#include <react/renderer/attributedstring/AttributedStringBox.h>
#include <react/renderer/attributedstring/ParagraphAttributes.h>
#include <react/renderer/components/text/BaseTextShadowNode.h>
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
// ImplicitTextContent.cpp.
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
// IFCs (this class is created solely for implicit-text runs); explicit `<Text>`
// keeps RN's verbatim whitespace. See implicit-text-plan.md §3.A/§4.4 and the
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
// (implicit-text-plan.md §3.C). Mirrors
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
    fragments[attachment.fragmentIndex].parentShadowView.layoutMetrics.frame.size =
        layoutable->measure(layoutContext, constraints);
  }
}

// Stamps the attachment fragment sizes from the attachment nodes' already-laid-out
// metrics (used on the paint/state path, which has no layout context).
void sizeImageAttachmentsFromLayout(
    AttributedString& attributedString,
    const BaseTextShadowNode::Attachments& attachments) {
  auto& fragments = attributedString.getFragments();
  for (const auto& attachment : attachments) {
    const auto* layoutable =
        dynamic_cast<const LayoutableShadowNode*>(attachment.shadowNode);
    if (layoutable == nullptr || attachment.fragmentIndex >= fragments.size()) {
      continue;
    }
    fragments[attachment.fragmentIndex].parentShadowView.layoutMetrics.frame.size =
        layoutable->getLayoutMetrics().frame.size;
  }
}

} // namespace

void InlineContentShadowNode::setTextLayoutManager(
    std::shared_ptr<const TextLayoutManager> textLayoutManager) {
  ensureUnsealed();
  textLayoutManager_ = std::move(textLayoutManager);
}

AttributedString InlineContentShadowNode::getContentAttributedString() const {
  auto textAttributes = getInheritedTextAttributes();
  auto attributedString = AttributedString{};
  auto attachments = BaseTextShadowNode::Attachments{};
  BaseTextShadowNode::buildAttributedString(
      textAttributes, *this, attributedString, attachments);
  sizeImageAttachmentsFromLayout(attributedString, attachments);
  collapseWhitespace(attributedString);
  attributedString.setBaseTextAttributes(textAttributes);
  return attributedString;
}

Size InlineContentShadowNode::measureContent(
    const LayoutContext& layoutContext,
    const LayoutConstraints& layoutConstraints) const {
  auto textAttributes = getInheritedTextAttributes();
  textAttributes.fontSizeMultiplier = layoutContext.fontSizeMultiplier;

  auto attributedString = AttributedString{};
  auto attachments = BaseTextShadowNode::Attachments{};
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
