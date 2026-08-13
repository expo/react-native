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

extern const char ImageComponentName[];

/*
 * `ShadowNode` for <Image> component.
 */
class ImageShadowNode final
    : public ConcreteViewShadowNode<ImageComponentName, ImageProps, ImageEventEmitter, ImageState> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  static ShadowNodeTraits BaseTraits()
  {
    auto traits = ConcreteViewShadowNode::BaseTraits();
    traits.set(ShadowNodeTraits::Trait::LeafYogaNode);
    return traits;
  }

  /*
   * Associates a shared `ImageManager` with the node.
   */
  void setImageManager(const std::shared_ptr<ImageManager> &imageManager);

  static ImageState initialStateData(
      const Props::Shared &props,
      const ShadowNodeFamily::Shared & /*family*/,
      const ComponentDescriptor &componentDescriptor)
  {
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

// NOLINTNEXTLINE(modernize-avoid-c-arrays)
extern const char ImgTagComponentName[];

/*
 * The intrinsic `<img>` tag: an inline **replaced** element (text-children-plan.md
 * §3.C). It reuses the RN Image machinery (`ImageProps`/`ImageState`/`ImageManager`)
 * for loading and rendering, but has its own component name/handle ("img") so it
 * can be routed inline into a bare-text run (rather than laid out as a block Yoga
 * child) and get its own inline-attachment component view. The owning View
 * positions it via an attachment-layout pass (see `ViewShadowNode`), mirroring how
 * `ParagraphShadowNode` lays out inline attachments.
 *
 * Mirrors `ImageShadowNode`; its image-request logic is duplicated (in
 * ImageShadowNode.cpp) because `ImageShadowNode` is `final` and its component
 * handle is fixed to "Image".
 */
class ImgTagShadowNode final
    : public ConcreteViewShadowNode<ImgTagComponentName, ImageProps, ImageEventEmitter, ImageState> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  static ShadowNodeTraits BaseTraits() {
    auto traits = ConcreteViewShadowNode::BaseTraits();
    traits.set(ShadowNodeTraits::Trait::LeafYogaNode);
    // The intrinsic <img> is an inline *replaced* element: it flows inline in a
    // View's IFC (InlineText) and is never blockified (InlineReplaced). Layout
    // checks the traits, not the name — any component that sets these behaves
    // as an inline replaced element, whatever it is called.
    traits.set(ShadowNodeTraits::Trait::InlineText);
    traits.set(ShadowNodeTraits::Trait::InlineReplaced);
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

  void layout(LayoutContext layoutContext) override;

 private:
  ImageSource getImageSource() const;

  std::shared_ptr<ImageManager> imageManager_;

  void updateStateIfNeeded();
};

class ImgTagComponentDescriptor final : public ConcreteComponentDescriptor<ImgTagShadowNode> {
 public:
  explicit ImgTagComponentDescriptor(const ComponentDescriptorParameters &parameters);

  void adopt(ShadowNode &shadowNode) const override;

 private:
  const std::shared_ptr<ImageManager> imageManager_;
};

} // namespace facebook::react
