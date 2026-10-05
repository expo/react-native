/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/cxxstableapi/FrameworksGuard.h>

#include <memory>
#include <utility>

#include <react/renderer/imagemanager/ImageRequest.h>
#include <react/renderer/imagemanager/ImageRequestParams.h>
#include <react/renderer/imagemanager/primitives.h>

#ifdef ANDROID
#include <folly/dynamic.h>
#include <react/featureflags/ReactNativeFeatureFlags.h>
#endif

namespace facebook::react {

/*
 * State for <Image> component.
 */
class ImageState final {
 public:
  ImageState(
      const ImageSource &imageSource,
      ImageRequest imageRequest,
      const ImageRequestParams &imageRequestParams,
      DynamicRangeLimit dynamicRangeLimit = DynamicRangeLimit::NoLimit)
      : imageSource_(imageSource),
        imageRequest_(std::make_shared<ImageRequest>(std::move(imageRequest))),
        imageRequestParams_(imageRequestParams),
        dynamicRangeLimit_(dynamicRangeLimit)
  {
  }

  // The same picture and request under another limit, which is paint-only
  ImageState(const ImageState &previousState, DynamicRangeLimit dynamicRangeLimit)
      : imageSource_(previousState.imageSource_),
        imageRequest_(previousState.imageRequest_),
        imageRequestParams_(previousState.imageRequestParams_),
        dynamicRangeLimit_(dynamicRangeLimit)
  {
  }

  /*
   * Returns stored ImageSource object.
   */
  ImageSource getImageSource() const;

  /*
   * Exposes for reading stored `ImageRequest` object.
   * `ImageRequest` object cannot be copied or moved from `ImageLocalData`.
   */
  const ImageRequest &getImageRequest() const;

  /*
   * Returns stored ImageRequestParams object.
   */
  const ImageRequestParams &getImageRequestParams() const;

  // The effective `dynamic-range-limit`: the picture's own, else inherited,
  // else CSS's initial `no-limit`
  DynamicRangeLimit getDynamicRangeLimit() const
  {
    return dynamicRangeLimit_;
  }
#ifdef ANDROID
  ImageState(const ImageState &previousState, folly::dynamic data)
      : imageRequestParams_{}, dynamicRangeLimit_(previousState.dynamicRangeLimit_) {};

  /*
   * Empty implementation for Android because it doesn't use this class.
   */
  folly::dynamic getDynamic() const
  {
    return {};
  };

  // Android's view manager sees the picture's own prop but not what it
  // inherits, so it reads the effective limit from here
  MapBuffer getMapBuffer() const
  {
    auto builder = MapBufferBuilder();
    // Empty with the flag off
    if (ReactNativeFeatureFlags::enableColorSpaces()) {
      builder.putInt(IS_KEY_DYNAMIC_RANGE_LIMIT, static_cast<int32_t>(dynamicRangeLimit_));
    }
    return builder.build();
  }

  constexpr static MapBuffer::Key IS_KEY_DYNAMIC_RANGE_LIMIT = 0;
#endif

 private:
  ImageSource imageSource_;
  std::shared_ptr<ImageRequest> imageRequest_;
  ImageRequestParams imageRequestParams_;
  DynamicRangeLimit dynamicRangeLimit_{DynamicRangeLimit::NoLimit};
};

} // namespace facebook::react
