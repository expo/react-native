/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "InlineContentShadowNode.h"

#include <react/renderer/attributedstring/AttributedStringBox.h>
#include <react/renderer/attributedstring/ParagraphAttributes.h>
#include <react/renderer/components/text/BaseTextShadowNode.h>
#include <react/renderer/core/LayoutContext.h>
#include <react/renderer/textlayoutmanager/TextLayoutContext.h>

namespace facebook::react {

// NOLINTNEXTLINE(facebook-hte-CArray, modernize-avoid-c-arrays)
const char InlineContentComponentName[] = "InlineContent";

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
