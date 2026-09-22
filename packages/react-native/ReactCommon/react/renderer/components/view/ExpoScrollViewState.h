/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/graphics/Float.h>
#include <react/renderer/graphics/Point.h>
#include <react/renderer/graphics/Rect.h>
#include <react/renderer/graphics/Size.h>

#ifdef RN_SERIALIZABLE_STATE
#include <folly/dynamic.h>
#endif

namespace facebook::react {

/*
 * What the shadow tree and the platform view agree on: the content's bounding
 * rect travels up, since only layout knows it, and the scroll offset travels
 * down, since only the platform knows it. Insets are absent on purpose: they
 * are a scroll-time transform, as `UIScrollView.contentInset` is, and routing
 * them through here would commit a relayout on every frame of a keyboard
 * animation.
 */
class ExpoScrollViewState final {
 public:
  ExpoScrollViewState() = default;
  ExpoScrollViewState(Point contentOffset, Rect contentBoundingRect)
      : contentOffset(contentOffset), contentBoundingRect(contentBoundingRect)
  {
  }

  Point contentOffset{};
  Rect contentBoundingRect{};

  Size getContentSize() const
  {
    return contentBoundingRect.size;
  }

#ifdef RN_SERIALIZABLE_STATE
  // The platform sends only the offset, so the content rect is carried over
  ExpoScrollViewState(const ExpoScrollViewState &previousState, folly::dynamic data)
      : contentOffset({(Float)data["contentOffsetLeft"].getDouble(), (Float)data["contentOffsetTop"].getDouble()}),
        contentBoundingRect(previousState.contentBoundingRect)
  {
  }

  folly::dynamic getDynamic() const
  {
    return folly::dynamic::object("contentOffsetLeft", contentOffset.x)("contentOffsetTop", contentOffset.y);
  }
#endif
};

} // namespace facebook::react
