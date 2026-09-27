/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "AnonymousTextContent.h"

#include <atomic>
#include <mutex>
#include <string_view>

#include <react/renderer/components/text/BaseParagraphComponentDescriptor.h>
#include <react/renderer/components/text/InlineContentShadowNode.h>
#include <react/renderer/components/text/TextNodeShadowNode.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>

namespace facebook::react {

namespace {

struct AnonymousTextContentState {
  std::shared_ptr<const ContextContainer> contextContainer;
  std::shared_ptr<const ComponentDescriptor> componentDescriptor;
  std::shared_ptr<const TextLayoutManager> textLayoutManager;
  // Every anonymous box carries the same default props (there is no author —
  // the box is synthesized). Parsing an empty RawProps through the whole
  // ViewProps constructor chain per box, per rebuild, was measurable on
  // text-heavy mounts; props are immutable, so one shared instance serves
  // every box.
  Props::Shared defaultProps;
};

AnonymousTextContentState& anonymousTextContentState() {
  static AnonymousTextContentState state;
  return state;
}

class InlineContentComponentDescriptor final
    : public ConcreteComponentDescriptor<InlineContentShadowNode> {
 public:
  using ConcreteComponentDescriptor::ConcreteComponentDescriptor;

 protected:
  void adopt(ShadowNode& shadowNode) const override {
    ConcreteComponentDescriptor::adopt(shadowNode);
    static_cast<InlineContentShadowNode&>(shadowNode)
        .setTextLayoutManager(anonymousTextContentState().textLayoutManager);
  }
};

Tag nextAnonymousTag() {
  // Negative, descending, even offsets: never collides with JS-allocated tags
  // (non-negative) or surface ids.
  static std::atomic<Tag> tag{-2};
  return tag.fetch_sub(2);
}

bool isWhitespaceOnlyRun(
    const std::vector<std::shared_ptr<const ShadowNode>>& runChildren) {
  for (const auto& child : runChildren) {
    const auto* textNode = dynamic_cast<const TextNodeShadowNode*>(child.get());
    if (textNode == nullptr) {
      // Inline text elements (and replaced elements) always generate a box.
      return false;
    }
    for (auto character : textNode->getText()) {
      if (character != ' ' && character != '\t' && character != '\n' &&
          character != '\r' && character != '\f') {
        return false;
      }
    }
  }
  return true;
}

std::shared_ptr<YogaLayoutableShadowNode> createAnonymousTextContent(
    std::vector<std::shared_ptr<const ShadowNode>> runChildren,
    const ShadowNode& containerShadowNode) {
  auto& state = anonymousTextContentState();
  if (state.componentDescriptor == nullptr || runChildren.empty()) {
    return nullptr;
  }

  // Anonymous flex items consisting entirely of white space are not rendered
  // (css-flexbox-1 §4).
  if (isWhitespaceOnlyRun(runChildren)) {
    return nullptr;
  }

  auto surfaceId = containerShadowNode.getSurfaceId();

  auto family = state.componentDescriptor->createFamily(
      {.tag = nextAnonymousTag(),
       .surfaceId = surfaceId,
       .instanceHandle = nullptr});
  if (state.defaultProps == nullptr) {
    // Default-constructed from an empty RawProps: nothing surface-specific
    // can be parsed out of nothing, so one instance is correct for every
    // surface. (Benign to race: both winners produce the identical value.)
    PropsParserContext propsParserContext{surfaceId, *state.contextContainer};
    state.defaultProps =
        state.componentDescriptor->cloneProps(propsParserContext, nullptr, {});
  }
  auto props = state.defaultProps;

  auto shadowNode = state.componentDescriptor->createShadowNode(
      ShadowNodeFragment{
          .props = props,
          .children = std::make_shared<
              const std::vector<std::shared_ptr<const ShadowNode>>>(
              std::move(runChildren)),
      },
      family);

  // The marker is NOT decided here: it depends on the item's position among
  // its siblings, which only the list container knows. The container assigns
  // it in `configureYogaTree`, before layout.

  return std::static_pointer_cast<YogaLayoutableShadowNode>(shadowNode);
}

} // namespace

void ensureAnonymousTextContentFactoryInstalled(
    const ComponentDescriptorParameters& parameters) {
  static std::once_flag onceFlag;
  std::call_once(onceFlag, [&parameters]() {
    auto& state = anonymousTextContentState();
    state.contextContainer = parameters.contextContainer;

    auto contextContainer = parameters.contextContainer;
    state.textLayoutManager =
        getManagerByName<TextLayoutManager>(contextContainer, TextLayoutManagerKey);

    state.componentDescriptor =
        std::make_shared<const InlineContentComponentDescriptor>(
            ComponentDescriptorParameters{
                .eventDispatcher = parameters.eventDispatcher,
                .contextContainer = parameters.contextContainer,
                .flavor = {}});

    YogaLayoutableShadowNode::setAnonymousTextContentFactory(
        &createAnonymousTextContent);
  });
}

} // namespace facebook::react
