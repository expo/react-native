/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.keyboard

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.events.Event

/**
 * Whether the bar is resting on the screen or docked to the keyboard.
 *
 * The Android half of `<native:keyboardaccessory>`'s `onDockChange` — see
 * `ExpoKeyboardAccessoryEventEmitter.h` for what the event is FOR, which is the
 * same question on both platforms and has a different answer to compute on each.
 *
 * iOS measures the strip of the home indicator the keys have not covered,
 * because its bar is in the keyboard's window and physically overlaps that
 * strip. Android's bar is in the app's own window and sits above the whole
 * obstruction, so it never overlaps anything — what it has instead is the
 * obstruction itself, which is the system bars alone when the IME is down and
 * the IME on top of them when it is up. The reserve is what remains of the
 * always-there part:
 *
 *     reserve = clamp(safeArea - max(obstruction - safeArea, 0), 0, safeArea)
 *
 * which is the same shape as the iOS arithmetic and reaches zero at the same
 * point of the transition — as soon as the keys are a safe area tall.
 */
internal class ExpoKeyboardDockEvent(
    surfaceId: Int,
    viewTag: Int,
    private val docked: Float,
    private val reserve: Float,
) : Event<ExpoKeyboardDockEvent>(surfaceId, viewTag) {

  override fun getEventName(): String = EVENT_NAME

  /**
   * Coalesced, like a scroll: this fires on every frame of the keyboard's
   * transition and a consumer that falls behind wants the bar's position now,
   * not the queue of places it has been.
   */
  override fun canCoalesce(): Boolean = true

  override fun getEventData(): WritableMap =
      Arguments.createMap().apply {
        putDouble("docked", docked.toDouble())
        putDouble("reserve", reserve.toDouble())
      }

  companion object {
    const val EVENT_NAME: String = "topDockChange"
  }
}
