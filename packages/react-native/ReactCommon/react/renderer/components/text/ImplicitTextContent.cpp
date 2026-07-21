/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "ImplicitTextContent.h"

#include <atomic>
#include <mutex>
#include <string_view>

#include <react/renderer/components/text/BaseParagraphComponentDescriptor.h>
#include <react/renderer/components/text/InlineContentShadowNode.h>
#include <react/renderer/components/text/RawTextShadowNode.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>

namespace facebook::react {

namespace {

struct ImplicitTextContentState {
  std::shared_ptr<const ContextContainer> contextContainer;
  std::shared_ptr<const ComponentDescriptor> componentDescriptor;
  std::shared_ptr<const TextLayoutManager> textLayoutManager;
};

ImplicitTextContentState& implicitTextContentState() {
  static ImplicitTextContentState state;
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
        .setTextLayoutManager(implicitTextContentState().textLayoutManager);
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
    const auto* rawTextChild =
        dynamic_cast<const RawTextShadowNode*>(child.get());
    if (rawTextChild == nullptr) {
      // Inline text elements always generate a box.
      return false;
    }
    for (auto character : rawTextChild->getConcreteProps().text) {
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
  auto& state = implicitTextContentState();
  if (state.componentDescriptor == nullptr || runChildren.empty()) {
    return nullptr;
  }

  // Anonymous flex items consisting entirely of white space are not rendered
  // (css-flexbox-1 §4).
  if (isWhitespaceOnlyRun(runChildren)) {
    return nullptr;
  }

  auto surfaceId = containerShadowNode.getSurfaceId();
  PropsParserContext propsParserContext{surfaceId, *state.contextContainer};

  auto family = state.componentDescriptor->createFamily(
      {.tag = nextAnonymousTag(),
       .surfaceId = surfaceId,
       .instanceHandle = nullptr});
  auto props =
      state.componentDescriptor->cloneProps(propsParserContext, nullptr, {});

  auto shadowNode = state.componentDescriptor->createShadowNode(
      ShadowNodeFragment{
          .props = props,
          .children = std::make_shared<
              const std::vector<std::shared_ptr<const ShadowNode>>>(
              std::move(runChildren)),
      },
      family);

  return std::static_pointer_cast<YogaLayoutableShadowNode>(shadowNode);
}

} // namespace

void ensureImplicitTextContentFactoryInstalled(
    const ComponentDescriptorParameters& parameters) {
  static std::once_flag onceFlag;
  std::call_once(onceFlag, [&parameters]() {
    auto& state = implicitTextContentState();
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
