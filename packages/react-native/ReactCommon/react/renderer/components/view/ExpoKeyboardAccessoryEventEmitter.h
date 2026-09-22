/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/core/EventPayload.h>
#include <react/renderer/graphics/Float.h>

namespace facebook::react {

/*
 * Whether the bar is resting on the screen or riding the keyboard. Nothing else
 * can say: the keyboard notifications report the accessory's frame as the end
 * frame, and the safe area differs by window rather than by state. The bar
 * already computes the strip of the home indicator the keys have not covered,
 * and that reserve is the answer.
 */
struct ExpoKeyboardDockEvent : public EventPayload {
  // 1 while the bar rests on the screen, 0 while the keys are under it, and
  // everything between during the transition, so an author can animate with it
  Float docked{};

  // The top of the bar in the window as drawn this frame, measured on the
  // presentation tree; a send's flying balloon is drawn inside the bar and aimed
  // at a row outside it, so the two must agree
  Float top{};

  // And its height, since a caller usually wants the bottom, from which anything
  // drawn in the flight layer hangs
  Float height{};

  // The same answer in points: how much of the safe area the bar is reserving
  // this frame
  Float reserve{};

  ExpoKeyboardDockEvent() = default;

  folly::dynamic asDynamic() const;

  jsi::Value asJSIValue(jsi::Runtime &runtime) const override;
  EventPayloadType getType() const override;
  std::optional<double> extractValue(const std::vector<std::string> &path) const override;
};

class ExpoKeyboardAccessoryEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  void onDockChange(const ExpoKeyboardDockEvent &event) const;
};

} // namespace facebook::react
