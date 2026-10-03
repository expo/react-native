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
#include <react/renderer/components/view/ViewPropsOf.h>
#include <react/renderer/components/view/YogaLayoutableShadowNode.h>
#include <react/renderer/mounting/ShadowView.h>

namespace facebook::react {

// The `#text` node's component name and DOM `nodeName`. Never resolved from
// JavaScript; only `UIManager::createTextNode` constructs the node.
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
    Attachments& outAttachments,
    const TextAttributes& initialTextAttributes) {
  bool lastFragmentWasRawText = false;
  for (const auto& childNode : parentNode.getChildren()) {
    // Character data: the first-class `#text` node.
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
      if (textShadowNode->getConcreteProps().cascadeResetAll) {
        // `all: 'initial'` on an inline element: restart from the formatting
        // root's initial values, keeping the layout-context fields that are not
        // cascade values.
        auto reset = initialTextAttributes;
        reset.fontSizeMultiplier = localTextAttributes.fontSizeMultiplier;
        reset.layoutDirection = localTextAttributes.layoutDirection;
        localTextAttributes = reset;
      }
      localTextAttributes.apply(
          textShadowNode->getConcreteProps().textAttributes);
      buildAttributedString(
          localTextAttributes,
          *textShadowNode,
          outAttributedString,
          outAttachments,
          initialTextAttributes);
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
          outAttachments,
          initialTextAttributes);
      continue;
    }

    // Span-like `display:'inline'` box (un-sized, all-inline contents): its
    // children join the surrounding run with its inheritable text props
    // applied, exactly like a <span> (css-display; Safari-pinned). Sized or
    // non-inline-content inline boxes fall through to the atomic attachment
    // branch below.
    if (YogaLayoutableShadowNode::isInlineFlowContent(*childNode)) {
      auto localTextAttributes = baseTextAttributes;
      if (const auto* baseViewProps = viewPropsOf(*childNode)) {
        if (baseViewProps->isInheritanceBoundary(childNode->getTraits().check(
                ShadowNodeTraits::Trait::UACascadeBoundary))) {
          // The same `all` reset for a span-like inline View.
          auto reset = initialTextAttributes;
          reset.fontSizeMultiplier = localTextAttributes.fontSizeMultiplier;
          reset.layoutDirection = localTextAttributes.layoutDirection;
          localTextAttributes = reset;
        }
        baseViewProps->applyInheritedTextAttributes(localTextAttributes);
      }
      buildAttributedString(
          localTextAttributes,
          *childNode,
          outAttributedString,
          outAttachments,
          initialTextAttributes);
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
