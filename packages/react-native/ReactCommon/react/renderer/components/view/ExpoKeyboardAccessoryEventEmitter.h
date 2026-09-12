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
 * Whether the bar is resting on the screen or riding the keyboard.
 *
 * The question a docked bar has to answer about itself, and the reason it needs
 * an event to do it. Nothing else can: `Keyboard`'s notifications are not a
 * signal here — installing an `inputAccessoryView` posts `keyboardWillShow`
 * with the ACCESSORY's frame as the end frame, so a bar that listened to them
 * came out permanently undocked — and the accessory's own `safeAreaInsets`
 * differ by WINDOW rather than by state, which the shadow tree cannot see.
 *
 * The bar already computes this. It has to, to reserve the strip of the home
 * indicator the keys have not covered, and that reserve IS the answer: a full
 * safe area when the bar is on the screen's bottom, nothing once the keys are
 * under it. This publishes what it already knows.
 */
struct ExpoKeyboardDockEvent : public EventPayload {
  /*
   * 1 while the bar rests on the screen, 0 while the keys are under it, and
   * everything between during the transition.
   *
   * A FRACTION rather than a boolean because the transition is a third of a
   * second long and the thing an author does with this — the native chat moves
   * its composer's padding from 28 points to 16 — has to move with it. A boolean
   * would make that a step in the middle of a slide, which is the one thing
   * worse than not doing it at all.
   */
  Float docked{};

  /*
   * The same answer in points: how much of the safe area the bar is reserving
   * for itself this frame. Carried alongside the fraction because an author who
   * wants to lay something out against the indicator's strip needs the length,
   * and dividing the fraction back out by a safe area they would have to look
   * up separately is a worse way to get it.
   */
  Float reserve{};

  ExpoKeyboardDockEvent() = default;

  folly::dynamic asDynamic() const;

  jsi::Value asJSIValue(jsi::Runtime& runtime) const override;
  EventPayloadType getType() const override;
  std::optional<double> extractValue(const std::vector<std::string>& path) const override;
};

class ExpoKeyboardAccessoryEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  void onDockChange(const ExpoKeyboardDockEvent& event) const;
};

} // namespace facebook::react
