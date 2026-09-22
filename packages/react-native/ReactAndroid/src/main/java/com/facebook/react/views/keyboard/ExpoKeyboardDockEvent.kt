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
 * Whether the bar is resting on the screen or docked to the keyboard: the Android half of
 * `<native:keyboardaccessory>`'s `onDockChange`, see `ExpoKeyboardAccessoryEventEmitter.h`. The bar
 * sits above the whole obstruction, so the reserve is what remains of the always-there part:
 *
 *     reserve = clamp(safeArea - max(obstruction - safeArea, 0), 0, safeArea)
 *
 * the same shape as the iOS arithmetic, reaching zero once the keys are a safe area tall.
 */
internal class ExpoKeyboardDockEvent(
    surfaceId: Int,
    viewTag: Int,
    private val docked: Float,
    private val reserve: Float,
    // The bar's top in the window as drawn this frame, and its height; DIPs, as on iOS
    private val top: Float,
    private val height: Float,
) : Event<ExpoKeyboardDockEvent>(surfaceId, viewTag) {

  override fun getEventName(): String = EVENT_NAME

  // Coalesced, like a scroll: this fires on every frame of the keyboard's transition
  override fun canCoalesce(): Boolean = true

  override fun getEventData(): WritableMap =
      Arguments.createMap().apply {
        putDouble("docked", docked.toDouble())
        putDouble("reserve", reserve.toDouble())
        putDouble("top", top.toDouble())
        putDouble("height", height.toDouble())
      }

  companion object {
    const val EVENT_NAME: String = "topDockChange"
  }
}
