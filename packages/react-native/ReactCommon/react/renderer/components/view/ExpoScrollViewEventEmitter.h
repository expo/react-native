/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <folly/dynamic.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/core/EventPayload.h>
#include <react/renderer/graphics/Point.h>
#include <react/renderer/graphics/RectangleEdges.h>
#include <react/renderer/graphics/Size.h>

namespace facebook::react {

// What a scroll reports. Its own payload because `ScrollEvent` lives in
// `components/scrollview`, which depends on this module; plus `inset`, which a
// caller tracking the keyboard needs in the same message as the offset.
struct ExpoScrollEvent : public EventPayload {
  Size contentSize{};
  Point contentOffset{};
  Size containerSize{};

  // The insets in force this frame, the composed total; reported with the offset
  // because the two change on the same frame during a keyboard animation
  EdgeInsets inset{};

  /*
   * The part of the offset the shadow tree was never told about. The view
   * composes its insets natively and does not report those offset adjustments
   * as scrolls, so every position measured from the tree is a layout position:
   *
   *     drawn = measured - contentShift
   *
   * It changes only when the composition does, which is when this event fires.
   */
  Point contentShift{};
  // Where the offset will rest once whatever is moving it has finished: the
  // rise's target in flight, the laid-out end while the drawn end is followed,
  // the current offset otherwise. A send's flight aims here; said again on
  // `onInsetChange` whenever a rise starts or is retargeted.
  Float restOffset{};

  Float timestamp{};

  ExpoScrollEvent() = default;

  folly::dynamic asDynamic() const;

  jsi::Value asJSIValue(jsi::Runtime &runtime) const override;
  EventPayloadType getType() const override;
  std::optional<double> extractValue(const std::vector<std::string> &path) const override;
};

// A drag that has ended also says where it is going
struct ExpoScrollEndDragEvent : public ExpoScrollEvent {
  Point targetContentOffset{};
  Point velocity{};

  ExpoScrollEndDragEvent() = default;
  explicit ExpoScrollEndDragEvent(const ExpoScrollEvent &event) : ExpoScrollEvent(event) {}
};

class ExpoScrollViewEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  void onScroll(const ExpoScrollEvent &event) const;
  void onScrollBeginDrag(const ExpoScrollEvent &event) const;
  void onScrollEndDrag(const ExpoScrollEndDragEvent &event) const;
  void onMomentumScrollBegin(const ExpoScrollEvent &event) const;
  void onMomentumScrollEnd(const ExpoScrollEvent &event) const;

  // The composed insets changed; separate from `scroll` because a keyboard
  // opening under a short list moves no content
  void onInsetChange(const ExpoScrollEvent &event) const;

 private:
  void dispatchScrollEvent(std::string name, const ExpoScrollEvent &event) const;
};

} // namespace facebook::react
