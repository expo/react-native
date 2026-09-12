/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "ExpoScrollViewEventEmitter.h"

namespace facebook::react {

jsi::Value ExpoScrollEvent::asJSIValue(jsi::Runtime& runtime) const {
  auto payload = jsi::Object(runtime);

  {
    auto offset = jsi::Object(runtime);
    offset.setProperty(runtime, "x", contentOffset.x);
    offset.setProperty(runtime, "y", contentOffset.y);
    payload.setProperty(runtime, "contentOffset", offset);
  }

  {
    auto insets = jsi::Object(runtime);
    insets.setProperty(runtime, "top", inset.top);
    insets.setProperty(runtime, "left", inset.left);
    insets.setProperty(runtime, "bottom", inset.bottom);
    insets.setProperty(runtime, "right", inset.right);
    payload.setProperty(runtime, "inset", insets);
  }

  {
    auto size = jsi::Object(runtime);
    size.setProperty(runtime, "width", contentSize.width);
    size.setProperty(runtime, "height", contentSize.height);
    payload.setProperty(runtime, "contentSize", size);
  }

  {
    auto size = jsi::Object(runtime);
    size.setProperty(runtime, "width", containerSize.width);
    size.setProperty(runtime, "height", containerSize.height);
    payload.setProperty(runtime, "containerSize", size);
  }

  // Milliseconds, matching every other timestamp JS sees.
  payload.setProperty(runtime, "timestamp", timestamp * 1000);

  return payload;
}

folly::dynamic ExpoScrollEvent::asDynamic() const {
  return folly::dynamic::object(
      "contentOffset", folly::dynamic::object("x", contentOffset.x)("y", contentOffset.y))(
      "inset",
      folly::dynamic::object("top", inset.top)("left", inset.left)("bottom", inset.bottom)("right", inset.right))(
      "contentSize", folly::dynamic::object("width", contentSize.width)("height", contentSize.height))(
      "containerSize", folly::dynamic::object("width", containerSize.width)("height", containerSize.height))(
      "timestamp", timestamp * 1000);
}

EventPayloadType ExpoScrollEvent::getType() const {
  return EventPayloadType::ScrollEvent;
}

std::optional<double> ExpoScrollEvent::extractValue(const std::vector<std::string>& path) const {
  // The paths a native-driven animation can read off a scroll without a JS
  // round trip. Kept to the two that animate: an animation on the inset is how
  // a header follows the keyboard.
  if (path.size() == 2 && path[0] == "contentOffset") {
    if (path[1] == "x") {
      return contentOffset.x;
    }
    if (path[1] == "y") {
      return contentOffset.y;
    }
  }
  if (path.size() == 2 && path[0] == "inset") {
    if (path[1] == "top") {
      return inset.top;
    }
    if (path[1] == "bottom") {
      return inset.bottom;
    }
    if (path[1] == "left") {
      return inset.left;
    }
    if (path[1] == "right") {
      return inset.right;
    }
  }
  return std::nullopt;
}

void ExpoScrollViewEventEmitter::onScroll(const ExpoScrollEvent& event) const {
  // Unique: a scroll that has not been consumed yet is replaced rather than
  // queued, so a slow consumer sees the latest position instead of a backlog.
  dispatchUniqueEvent("scroll", std::make_shared<ExpoScrollEvent>(event));
}

void ExpoScrollViewEventEmitter::onInsetChange(const ExpoScrollEvent& event) const {
  dispatchUniqueEvent("insetChange", std::make_shared<ExpoScrollEvent>(event));
}

void ExpoScrollViewEventEmitter::onScrollBeginDrag(const ExpoScrollEvent& event) const {
  dispatchScrollEvent("scrollBeginDrag", event);
}

void ExpoScrollViewEventEmitter::onScrollEndDrag(const ExpoScrollEndDragEvent& event) const {
  dispatchEvent("scrollEndDrag", std::make_shared<ExpoScrollEndDragEvent>(event));
}

void ExpoScrollViewEventEmitter::onMomentumScrollBegin(const ExpoScrollEvent& event) const {
  dispatchScrollEvent("momentumScrollBegin", event);
}

void ExpoScrollViewEventEmitter::onMomentumScrollEnd(const ExpoScrollEvent& event) const {
  dispatchScrollEvent("momentumScrollEnd", event);
}

void ExpoScrollViewEventEmitter::dispatchScrollEvent(std::string name, const ExpoScrollEvent& event) const {
  dispatchEvent(std::move(name), std::make_shared<ExpoScrollEvent>(event));
}

} // namespace facebook::react
