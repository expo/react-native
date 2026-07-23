/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "ImplicitTextCommitHook.h"

#include <string_view>

#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/ShadowNodeFragment.h>

namespace facebook::react {

namespace {

bool isTextish(const ShadowNode& node) {
  std::string_view name{node.getComponentName()};
  return name == "RawText" || name == "Text";
}

// Subtrees that already know how to consume raw text children, or that raw
// text must not be synthesized under.
bool consumesOwnTextChildren(const ShadowNode& node) {
  std::string_view name{node.getComponentName()};
  return name == "Paragraph" || name == "SelectableParagraph" ||
      name == "PreparedLayoutText" || name == "Text" || name == "RawText" ||
      name == "TextInput" || name == "AndroidTextInput";
}

} // namespace

RootShadowNode::Unshared ImplicitTextCommitHook::shadowTreeWillCommit(
    const ShadowTree& /*shadowTree*/,
    const RootShadowNode::Shared& /*oldRootShadowNode*/,
    const RootShadowNode::Unshared& newRootShadowNode,
    const ShadowTreeCommitOptions& /*commitOptions*/) noexcept {
  auto transformed = transform(*newRootShadowNode);
  if (!transformed) {
    return newRootShadowNode;
  }
  return std::static_pointer_cast<RootShadowNode>(
      std::const_pointer_cast<ShadowNode>(transformed));
}

std::shared_ptr<const ShadowNode> ImplicitTextCommitHook::transform(
    const ShadowNode& node) {
  if (consumesOwnTextChildren(node)) {
    return nullptr;
  }

  const auto& children = node.getChildren();

  auto hasTextChild = false;
  auto anyChildChanged = false;
  auto transformedChildren = children;
  for (auto index = size_t{0}; index < children.size(); index++) {
    if (isTextish(*children[index])) {
      hasTextChild = true;
      continue;
    }
    if (auto transformedChild = transform(*children[index])) {
      transformedChildren[index] = std::move(transformedChild);
      anyChildChanged = true;
    }
  }

  if (!hasTextChild && !anyChildChanged) {
    return nullptr;
  }

  auto newChildren = std::vector<std::shared_ptr<const ShadowNode>>{};
  newChildren.reserve(transformedChildren.size());

  auto run = std::vector<std::shared_ptr<const ShadowNode>>{};
  auto flushRun = [&]() {
    if (!run.empty()) {
      newChildren.push_back(
          synthesizeParagraph(std::move(run), node.getSurfaceId()));
      run.clear();
    }
  };

  for (auto& child : transformedChildren) {
    if (isTextish(*child)) {
      run.push_back(child);
    } else {
      flushRun();
      newChildren.push_back(child);
    }
  }
  flushRun();

  return node.clone(
      {.children = std::make_shared<
           const std::vector<std::shared_ptr<const ShadowNode>>>(
           std::move(newChildren))});
}

std::shared_ptr<const ShadowNode> ImplicitTextCommitHook::synthesizeParagraph(
    std::vector<std::shared_ptr<const ShadowNode>> run,
    SurfaceId surfaceId) {
  auto& descriptor = componentDescriptorRegistry_->at("Paragraph");

  PropsParserContext propsParserContext{surfaceId, *contextContainer_};

  auto family = descriptor.createFamily(
      {.tag = nextSyntheticTag_, .surfaceId = surfaceId, .instanceHandle = nullptr});
  nextSyntheticTag_ -= 2;

  auto props = descriptor.cloneProps(propsParserContext, nullptr, RawProps{});
  auto state = descriptor.createInitialState(props, family);

  return descriptor.createShadowNode(
      ShadowNodeFragment{
          .props = props,
          .children = std::make_shared<
              const std::vector<std::shared_ptr<const ShadowNode>>>(
              std::move(run)),
          .state = state,
      },
      family);
}

} // namespace facebook::react
