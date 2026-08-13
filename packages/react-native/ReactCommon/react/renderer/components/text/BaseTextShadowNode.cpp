/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "BaseTextShadowNode.h"

#include <string_view>

#include <react/renderer/dom/NodeNameProvider.h>

#include <react/renderer/components/text/TextEffectShadowNode.h>
#include <react/renderer/components/text/TextNodeShadowNode.h>
#include <react/renderer/components/text/TextProps.h>
#include <react/renderer/components/text/TextShadowNode.h>
#include <react/renderer/components/view/BaseViewProps.h>
#include <react/renderer/components/view/YogaLayoutableShadowNode.h>
#include <react/renderer/mounting/ShadowView.h>

namespace facebook::react {

// The first-class text node's component name (text-children-plan.md §3.F);
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

    // `<br>`: a forced line break (HTML §4.5.28). It carries no text of its
    // own, so it contributes a newline the text engines already break on —
    // both `NSAttributedString` and Android's `Layout` treat one as mandatory.
    //
    // The fragment records the `<br>` itself as its parent so whitespace
    // collapsing can recognise it: an ordinary newline in source text is
    // collapsible and becomes a space (css-text-3 §3), and this one must not.
    // `<br>` is a view-config ALIAS of `<span>`, so its component name is
    // "span" — the authored tag lives in the `nodeName` prop, which is exactly
    // what `NodeNameProvider` exposes. Checking the component name found
    // nothing at all.
    const auto* nodeNameProvider =
        dynamic_cast<const NodeNameProvider*>(childNode->getProps().get());
    if (nodeNameProvider != nullptr &&
        nodeNameProvider->domNodeName() == "br") {
      auto breakFragment = AttributedString::Fragment{};
      breakFragment.string = "\n";
      breakFragment.forcedBreak = true;
      breakFragment.textAttributes = baseTextAttributes;
      breakFragment.parentShadowView = shadowViewFromShadowNode(*childNode);
      outAttributedString.appendFragment(std::move(breakFragment));
      continue;
    }

    // TextShadowNode
    auto textShadowNode = dynamic_cast<const TextShadowNode*>(childNode.get());
    if (textShadowNode != nullptr) {
      auto localTextAttributes = baseTextAttributes;
      if (textShadowNode->getConcreteProps().cascadeResetAll) {
        // `all: 'initial'` on an inline element: restart from the defaults,
        // keeping the layout-context fields that are not cascade values.
        auto reset = TextAttributes::defaultTextAttributes();
        reset.fontSizeMultiplier = localTextAttributes.fontSizeMultiplier;
        reset.layoutDirection = localTextAttributes.layoutDirection;
        localTextAttributes = reset;
      }
      localTextAttributes.apply(
          textShadowNode->getConcreteProps().textAttributes);

      // An inline element's inline-axis margin/border/padding add to the
      // advance at its leading and trailing edges (box-model-scope.md G3,
      // CSS2 §10.6.1). Record it on the element's first and last fragments so
      // a wrapped box pays for its edges once rather than per line; block-axis
      // values deliberately do not touch the line height.
      // Resolved HERE rather than at parse: `marginInlineStart` and friends
      // name the inline axis, and which physical edge that is depends on the
      // direction Yoga resolved for this subtree — which the cascade carries
      // by the time a string is being built, and the parser could not know.
      const auto inlineBox =
          textShadowNode->getConcreteProps().inlineBox.resolve(
              localTextAttributes.layoutDirection);
      const auto firstIndex = outAttributedString.getFragments().size();

      buildAttributedString(
          localTextAttributes,
          *textShadowNode,
          outAttributedString,
          outAttachments);

      // An element with no text of its own still has a box on the line
      // (CSSOM-View §4), and the only way to report one is to have a fragment
      // for it. Empty, so it changes no measurement; flagged, so the passes
      // that discard empty fragments leave it alone.
      if (firstIndex == outAttributedString.getFragments().size()) {
        auto emptyFragment = AttributedString::Fragment{};
        emptyFragment.textAttributes = localTextAttributes;
        emptyFragment.parentShadowView =
            shadowViewFromShadowNode(*textShadowNode);
        emptyFragment.isEmptyElement = true;
        outAttributedString.appendFragment(std::move(emptyFragment));
      }

      if (!inlineBox.isEmpty()) {
        auto& fragments = outAttributedString.getFragments();
        if (firstIndex < fragments.size()) {
          // Every fragment of the element carries the decorations so painting
          // can find the box's full extent; only the outer edges reserve
          // advance.
          for (auto i = firstIndex; i < fragments.size(); i++) {
            fragments[i].inlineBox = inlineBox;
          }
          fragments[firstIndex].isInlineBoxStart = true;
          fragments.back().isInlineBoxEnd = true;
        }
      }
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

    // Span-like `display:'inline'` box (un-sized, all-inline contents): its
    // children join the surrounding run with its inheritable text props
    // applied, exactly like a <span> (css-display; Safari-pinned). Sized or
    // non-inline-content inline boxes fall through to the atomic attachment
    // branch below. Fragments created inside carry this element as their
    // `parentShadowView`, so touches resolve to its emitter like
    // <span onPress>.
    if (YogaLayoutableShadowNode::isInlineFlowContent(*childNode)) {
      auto localTextAttributes = baseTextAttributes;
      if (const auto* baseViewProps = dynamic_cast<const BaseViewProps*>(
              childNode->getProps().get())) {
        if (baseViewProps->isInheritanceBoundary(childNode->getTraits().check(
                ShadowNodeTraits::Trait::UACascadeBoundary))) {
          // The same `all` reset for a span-like inline View.
          auto reset = TextAttributes::defaultTextAttributes();
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
