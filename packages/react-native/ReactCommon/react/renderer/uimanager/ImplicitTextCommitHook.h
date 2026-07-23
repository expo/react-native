/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/componentregistry/ComponentDescriptorRegistry.h>
#include <react/renderer/uimanager/UIManagerCommitHook.h>
#include <react/utils/ContextContainer.h>

namespace facebook::react {

/*
 * Prototype: wraps contiguous runs of bare text nodes (RawText, Text) found
 * under non-text parents into synthesized Paragraph nodes at commit time, so
 * string children render without an explicit <Text> wrapper ("anonymous box"
 * model).
 */
class ImplicitTextCommitHook final : public UIManagerCommitHook {
 public:
  ImplicitTextCommitHook(
      SharedComponentDescriptorRegistry componentDescriptorRegistry,
      std::shared_ptr<const ContextContainer> contextContainer)
      : componentDescriptorRegistry_(std::move(componentDescriptorRegistry)),
        contextContainer_(std::move(contextContainer)) {}

  void commitHookWasRegistered(const UIManager & /*uiManager*/) noexcept override {}

  void commitHookWasUnregistered(const UIManager & /*uiManager*/) noexcept override {}

  RootShadowNode::Unshared shadowTreeWillCommit(
      const ShadowTree &shadowTree,
      const RootShadowNode::Shared &oldRootShadowNode,
      const RootShadowNode::Unshared &newRootShadowNode,
      const ShadowTreeCommitOptions &commitOptions) noexcept override;

 private:
  std::shared_ptr<const ShadowNode> transform(const ShadowNode &node);

  std::shared_ptr<const ShadowNode> synthesizeParagraph(
      std::vector<std::shared_ptr<const ShadowNode>> run,
      SurfaceId surfaceId);

  SharedComponentDescriptorRegistry componentDescriptorRegistry_;
  std::shared_ptr<const ContextContainer> contextContainer_;
  Tag nextSyntheticTag_{-2};
};

} // namespace facebook::react
