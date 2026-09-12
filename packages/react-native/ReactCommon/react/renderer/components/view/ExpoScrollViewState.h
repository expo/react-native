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
 * What the shadow tree and the platform view have to agree on.
 *
 * Deliberately only two things, and neither of them is an inset.
 *
 * The content's bounding rect travels UP: only layout knows how big the content
 * turned out, and the platform view needs it to size its scrollable area. The
 * scroll offset travels DOWN: only the platform knows where the user has
 * scrolled to, and layout needs it to place sticky content and to survive a
 * remount at the same position.
 *
 * Insets are absent on purpose. They are a property of the scroll view's
 * presentation, not of its content's layout — moving the content by an inset is
 * a scroll-time transform, exactly as `UIScrollView.contentInset` is — and
 * routing them through here would put a shadow-tree commit on every frame of a
 * keyboard animation. At 120Hz that is a relayout of the whole subtree per
 * frame, to move content that has not changed size. So insets are applied on
 * the platform, synchronously, and never enter layout.
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
  /*
   * The platform sends only the offset, so the CONTENT RECT is carried over.
   *
   * It used to be reset to {} here. That was harmless while nothing on either
   * platform ever pushed a state update — and the moment the scroll views
   * started writing their offset every frame, it would have wiped the content
   * size the platform view sizes its scrollable area from, once per scrolled
   * pixel, until the next layout put it back.
   */
  ExpoScrollViewState(const ExpoScrollViewState& previousState, folly::dynamic data)
      : contentOffset(
            {(Float)data["contentOffsetLeft"].getDouble(), (Float)data["contentOffsetTop"].getDouble()}),
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
