/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/image/ImageEventEmitter.h>
#include <react/renderer/components/image/ImageProps.h>
#include <react/renderer/components/image/ImageState.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/ShadowNodeFamily.h>
#include <react/renderer/imagemanager/ImageManager.h>
#include <react/renderer/imagemanager/primitives.h>

namespace facebook::react {

// NOLINTNEXTLINE(modernize-avoid-c-arrays)
extern const char ImgTagComponentName[];

/*
 * The intrinsic `<img>` tag: an inline **replaced** element (implicit-text-plan.md
 * §3.C). It reuses the RN Image machinery (`ImageProps`/`ImageState`/`ImageManager`)
 * for loading and rendering, but has its own component name/handle ("img") so it
 * can be routed inline into a bare-text run (rather than laid out as a block Yoga
 * child) and get its own inline-attachment component view. The View that owns the
 * run positions it via an attachment-layout pass (see `ViewShadowNode`), mirroring
 * how `ParagraphShadowNode` lays out inline attachments.
 *
 * This mirrors `ImageShadowNode`; its image-request logic is duplicated here
 * because `ImageShadowNode` is `final` and its component handle is fixed to
 * "Image".
 */
class ImgTagShadowNode final
    : public ConcreteViewShadowNode<ImgTagComponentName, ImageProps, ImageEventEmitter, ImageState> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  static ShadowNodeTraits BaseTraits() {
    auto traits = ConcreteViewShadowNode::BaseTraits();
    traits.set(ShadowNodeTraits::Trait::LeafYogaNode);
    return traits;
  }

  void setImageManager(const std::shared_ptr<ImageManager> &imageManager);

  static ImageState initialStateData(
      const Props::Shared & /*props*/,
      const ShadowNodeFamily::Shared & /*family*/,
      const ComponentDescriptor & /*componentDescriptor*/) {
    auto imageSource = ImageSource{ImageSource::Type::Invalid};
    return {imageSource, {imageSource, nullptr}, {}};
  }

#pragma mark - LayoutableShadowNode

  void layout(LayoutContext layoutContext) override;

 private:
  ImageSource getImageSource() const;

  std::shared_ptr<ImageManager> imageManager_;

  void updateStateIfNeeded();
};

/*
 * Descriptor for `<img>`; wires the shared `ImageManager` like
 * `ImageComponentDescriptor`.
 */
class ImgTagComponentDescriptor final : public ConcreteComponentDescriptor<ImgTagShadowNode> {
 public:
  explicit ImgTagComponentDescriptor(const ComponentDescriptorParameters &parameters);

  void adopt(ShadowNode &shadowNode) const override;

 private:
  const std::shared_ptr<ImageManager> imageManager_;
};

} // namespace facebook::react
