/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "ExpoKeyboardAccessoryEventEmitter.h"

namespace facebook::react {

jsi::Value ExpoKeyboardDockEvent::asJSIValue(jsi::Runtime& runtime) const {
  auto payload = jsi::Object(runtime);
  payload.setProperty(runtime, "docked", docked);
  payload.setProperty(runtime, "reserve", reserve);
  return payload;
}

folly::dynamic ExpoKeyboardDockEvent::asDynamic() const {
  return folly::dynamic::object("docked", docked)("reserve", reserve);
}

/*
 * `ValueFactory` is the generic bucket, and there is no better one: the three
 * types name the two payloads the renderer treats specially — a pointer event,
 * which `UIManagerBinding` routes differently, and a scroll — and this is
 * neither.
 */
EventPayloadType ExpoKeyboardDockEvent::getType() const {
  return EventPayloadType::ValueFactory;
}

std::optional<double> ExpoKeyboardDockEvent::extractValue(const std::vector<std::string>& path) const {
  if (path.size() == 1) {
    if (path[0] == "docked") {
      return docked;
    }
    if (path[0] == "reserve") {
      return reserve;
    }
  }
  return std::nullopt;
}

/*
 * UNIQUE, like a scroll: this fires on every frame of the keyboard's transition
 * and a consumer that falls behind wants the bar's position now, not the queue
 * of places it has been.
 */
void ExpoKeyboardAccessoryEventEmitter::onDockChange(const ExpoKeyboardDockEvent& event) const {
  dispatchUniqueEvent("dockChange", std::make_shared<ExpoKeyboardDockEvent>(event));
}

} // namespace facebook::react
