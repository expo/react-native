/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import android.content.Context
import android.widget.SeekBar
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * `<input type="range">` on Android, backed by a real [SeekBar].
 *
 * A framework `SeekBar` rather than a drawn approximation, so it inherits the platform's metrics,
 * theming, RTL mirroring and TalkBack behaviour — and, most importantly here, its touch handling:
 * `AbsSeekBar` already calls `requestDisallowInterceptTouchEvent` when a drag starts, so a scrub
 * inside a scroll container is claimed by the control without anything extra. That is the same rule
 * `RCTElementDragOwnership` restores on iOS, arrived at from the other direction.
 *
 * `SeekBar` counts in integer steps from zero, while `<input type="range">` is defined over doubles
 * with a `min`, a `max` and a `step`. This translates between the two, which also makes snapping
 * fall out for free: the control genuinely has one position per step rather than reporting rounded
 * values from a continuous track.
 */
internal class ElementRangeView(context: Context) : SeekBar(context) {

  /** Called continuously while dragging — the DOM's `input`. */
  var onValueInput: ((Double) -> Unit)? = null

  /** Called once, when the drag ends — the DOM's `change`. */
  var onValueChange: ((Double) -> Unit)? = null

  private var minimum: Double = 0.0
  private var maximum: Double = 100.0
  private var stepSize: Double = 1.0
  private var isTracking = false
  /** Suppresses callbacks while props are being applied, so a prop write is not read back as user input. */
  private var isApplyingProps = false

  init {
    setOnSeekBarChangeListener(
        object : OnSeekBarChangeListener {
          override fun onProgressChanged(seekBar: SeekBar, progress: Int, fromUser: Boolean) {
            if (!fromUser || isApplyingProps) {
              return
            }
            onValueInput?.invoke(valueForProgress(progress))
          }

          override fun onStartTrackingTouch(seekBar: SeekBar) {
            isTracking = true
          }

          override fun onStopTrackingTouch(seekBar: SeekBar) {
            isTracking = false
            onValueChange?.invoke(valueForProgress(progress))
          }
        })
  }

  private fun stepCount(): Int {
    if (maximum <= minimum || stepSize <= 0.0) {
      return 1
    }
    return maxOf(1, ((maximum - minimum) / stepSize).roundToInt())
  }

  private fun valueForProgress(progress: Int): Double =
      (minimum + progress * stepSize).coerceIn(minimum, maximum)

  /**
   * Applies the element's range. Kept as one call because `max` and `progress` are coupled: setting
   * `max` alone rescales the existing progress and moves the thumb.
   */
  fun setRange(min: Double, max: Double, step: Double, value: Double) {
    minimum = min
    maximum = max
    stepSize = step
    isApplyingProps = true
    setMax(stepCount())
    if (!isTracking) {
      setValue(value)
    }
    isApplyingProps = false
  }

  fun setValue(value: Double) {
    if (isTracking) {
      // Never fight a live gesture: writing the prop value back mid-drag makes the thumb stutter
      // under the finger.
      return
    }
    val clamped = value.coerceIn(minimum, maximum)
    val target = if (stepSize > 0) ((clamped - minimum) / stepSize).roundToInt() else 0
    if (abs(target - progress) > 0) {
      isApplyingProps = true
      progress = target
      isApplyingProps = false
    }
  }
}
