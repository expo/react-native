/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "BaseTextShadowNode.h"

#include <react/renderer/components/text/TextEffectShadowNode.h>
#include <react/renderer/components/text/TextNodeShadowNode.h>
#include <react/renderer/components/text/TextProps.h>
#include <react/renderer/components/text/TextShadowNode.h>
#include <react/renderer/mounting/ShadowView.h>

namespace facebook::react {

// The first-class text node's component name (implicit-text-plan.md §3.F);
// DOM `nodeName`. Defined here (rather than a new TU) so it is available without
// a CocoaPods header/source-map regeneration. Never registered as a
// JS-resolvable component; constructed only via `UIManager::createTextNode`.
// NOLINTNEXTLINE(modernize-avoid-c-arrays)
const char TextNodeComponentName[] = "#text";

inline ShadowView shadowViewFromShadowNode(const ShadowNode& shadowNode) {
  auto shadowView = ShadowView{shadowNode};
  // Clearing `props` and `state` (which we don't use) allows avoiding retain
  // cycles.
  shadowView.props = nullptr;
  shadowView.state = nullptr;
  return shadowView;
}

void BaseTextShadowNode::buildAttributedString(
    const TextAttributes& baseTextAttributes,
    const ShadowNode& parentNode,
    AttributedString& outAttributedString,
    Attachments& outAttachments) {
  bool lastFragmentWasRawText = false;
  for (const auto& childNode : parentNode.getChildren()) {
    // Character data: the first-class `#text` node (§3.F).
    auto* textNode = dynamic_cast<const TextNodeShadowNode*>(childNode.get());
    if (textNode != nullptr) {
      const auto& rawText = textNode->getText();
      if (lastFragmentWasRawText) {
        outAttributedString.getFragments().back().string += rawText;
      } else {
        auto fragment = AttributedString::Fragment{};
        fragment.string = rawText;
        fragment.textAttributes = baseTextAttributes;

        // Storing a retaining pointer to `ParagraphShadowNode` inside
        // `attributedString` causes a retain cycle (besides that fact that we
        // don't need it at all). Storing a `ShadowView` instance instead of
        // `ShadowNode` should properly fix this problem.
        fragment.parentShadowView = shadowViewFromShadowNode(parentNode);
        outAttributedString.appendFragment(std::move(fragment));
        lastFragmentWasRawText = true;
      }
      continue;
    }

    lastFragmentWasRawText = false;

    // TextShadowNode
    auto textShadowNode = dynamic_cast<const TextShadowNode*>(childNode.get());
    if (textShadowNode != nullptr) {
      auto localTextAttributes = baseTextAttributes;
      localTextAttributes.apply(
          textShadowNode->getConcreteProps().textAttributes);
      buildAttributedString(
          localTextAttributes,
          *textShadowNode,
          outAttributedString,
          outAttachments);
      continue;
    }

    // TextEffectShadowNode
    auto textEffectNode =
        dynamic_cast<const TextEffectShadowNode*>(childNode.get());
    if (textEffectNode != nullptr) {
      auto localTextAttributes = baseTextAttributes;
      const auto& effectProps = textEffectNode->getConcreteProps();
      localTextAttributes.textEffects.push_back(
          TextEffectInfo{
              .name = effectProps.effectName,
              .props = effectProps.effectProps});
      buildAttributedString(
          localTextAttributes,
          *textEffectNode,
          outAttributedString,
          outAttachments);
      continue;
    }

    // Any *other* kind of ShadowNode
    auto fragment = AttributedString::Fragment{};
    fragment.string = AttributedString::Fragment::AttachmentCharacter();
    fragment.parentShadowView = shadowViewFromShadowNode(*childNode);
    fragment.textAttributes = baseTextAttributes;
    outAttributedString.appendFragment(std::move(fragment));
    outAttachments.push_back(
        Attachment{
            childNode.get(), outAttributedString.getFragments().size() - 1});
  }
}

} // namespace facebook::react
