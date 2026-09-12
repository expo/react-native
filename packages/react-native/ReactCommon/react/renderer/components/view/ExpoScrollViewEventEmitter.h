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

/*
 * What a scroll reports.
 *
 * Its own payload rather than the existing `ScrollEvent`, for a build reason
 * rather than a design one: `ScrollEvent` lives in `components/scrollview`,
 * which depends on `components/view`, and this component lives in
 * `components/view`. Reusing it would make the two modules depend on each
 * other. The fields are the same ones any scroll reports, plus `inset`, which
 * the existing event does not carry per-frame and which a caller tracking the
 * keyboard needs in the same message as the offset it belongs to.
 */
struct ExpoScrollEvent : public EventPayload {
  Size contentSize{};
  Point contentOffset{};
  Size containerSize{};

  /*
   * The insets IN FORCE for this frame — the composed total, not the author's
   * request. Reported alongside the offset because they move together: during a
   * keyboard animation the offset and the inset change on the same frame, and a
   * caller that reads them from two places gets a torn pair.
   */
  EdgeInsets inset{};

  Float timestamp{};

  ExpoScrollEvent() = default;

  folly::dynamic asDynamic() const;

  jsi::Value asJSIValue(jsi::Runtime& runtime) const override;
  EventPayloadType getType() const override;
  std::optional<double> extractValue(const std::vector<std::string>& path) const override;
};

/*
 * A drag that has ended also says where it is going, which is the only way a
 * caller can act on the destination before the deceleration gets there.
 */
struct ExpoScrollEndDragEvent : public ExpoScrollEvent {
  Point targetContentOffset{};
  Point velocity{};

  ExpoScrollEndDragEvent() = default;
  explicit ExpoScrollEndDragEvent(const ExpoScrollEvent& event) : ExpoScrollEvent(event) {}
};

class ExpoScrollViewEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  void onScroll(const ExpoScrollEvent& event) const;
  void onScrollBeginDrag(const ExpoScrollEvent& event) const;
  void onScrollEndDrag(const ExpoScrollEndDragEvent& event) const;
  void onMomentumScrollBegin(const ExpoScrollEvent& event) const;
  void onMomentumScrollEnd(const ExpoScrollEvent& event) const;

  /*
   * The composed insets changed — the keyboard moved, the safe area changed, or
   * the author set new ones.
   *
   * Separate from `scroll` because it fires when nothing has scrolled, which is
   * the common case: a keyboard opening under a short list moves no content.
   */
  void onInsetChange(const ExpoScrollEvent& event) const;

 private:
  void dispatchScrollEvent(std::string name, const ExpoScrollEvent& event) const;
};

} // namespace facebook::react
