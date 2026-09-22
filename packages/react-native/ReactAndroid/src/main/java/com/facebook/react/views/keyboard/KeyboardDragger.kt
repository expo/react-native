/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.keyboard

import android.os.CancellationSignal
import android.view.View
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationControlListenerCompat
import androidx.core.view.WindowInsetsAnimationControllerCompat
import androidx.core.view.WindowInsetsCompat
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Drives the keyboard with a finger, as iOS's `keyboardDismissMode = .interactive` does. The IME
 * lives in another window, so control of its animation is requested, the insets placed by hand on
 * every move, and the controller handed back with a decision about where to settle.
 */
public class KeyboardDragger(private val view: View) {

  private var controller: WindowInsetsAnimationControllerCompat? = null
  private var requesting = false
  private var cancellation: CancellationSignal? = null

  // Where the finger was when control began, and how tall the IME was then
  private var anchorY = 0f
  private var anchorBottom = 0

  public val isControlling: Boolean
    get() = controller != null

  // Whether there is a keyboard to drag; public because taking control is asynchronous, so a
  // caller must claim the gesture before [onDrag] can answer true
  public fun isKeyboardVisible(): Boolean =
      ViewCompat.getRootWindowInsets(view)?.isVisible(WindowInsetsCompat.Type.ime()) ?: false

  private fun imeVisible(): Boolean = isKeyboardVisible()

  private fun imeBottom(): Int =
      ViewCompat.getRootWindowInsets(view)?.getInsets(WindowInsetsCompat.Type.ime())?.bottom ?: 0

  // Offers a drag to the keyboard; true once the keyboard has taken the gesture over
  public fun onDrag(y: Float, deltaY: Float, scrollCanConsume: Boolean): Boolean {
    val active = controller
    if (active != null) {
      // A downward drag shrinks the IME; clamped, so a fast flick cannot ask for a position
      // that does not exist
      val target = (anchorBottom - (y - anchorY)).roundToInt().coerceIn(0, anchorBottom)
      active.setInsetsAndAlpha(Insets.of(0, 0, 0, target), 1f, 0f)
      return true
    }

    if (requesting || scrollCanConsume || deltaY <= 0 || !imeVisible()) {
      return false
    }

    anchorY = y
    anchorBottom = imeBottom()
    if (anchorBottom <= 0) {
      return false
    }

    requesting = true
    cancellation = CancellationSignal()
    ViewCompat.getWindowInsetsController(view)
        ?.controlWindowInsetsAnimation(
            WindowInsetsCompat.Type.ime(),
            /* durationMillis = */ -1,
            /* interpolator = */ null,
            cancellation,
            object : WindowInsetsAnimationControlListenerCompat {
              override fun onReady(
                  controller: WindowInsetsAnimationControllerCompat,
                  types: Int,
              ) {
                requesting = false
                this@KeyboardDragger.controller = controller
              }

              override fun onFinished(controller: WindowInsetsAnimationControllerCompat) {
                requesting = false
                this@KeyboardDragger.controller = null
              }

              override fun onCancelled(controller: WindowInsetsAnimationControllerCompat?) {
                requesting = false
                this@KeyboardDragger.controller = null
              }
            },
        )
    return false
  }

  // Lets go and decides where the keyboard settles: a flick by its direction, a slow drag by
  // whether it got past halfway, the platform's own rule
  public fun onRelease(velocityY: Float) {
    val active =
        controller
            ?: run {
              cancellation?.cancel()
              cancellation = null
              requesting = false
              return
            }
    val current = active.currentInsets.bottom
    val shown =
        when {
          abs(velocityY) > FLING_VELOCITY -> velocityY < 0
          else -> current > anchorBottom / 2
        }
    active.finish(shown)
    controller = null
    cancellation = null
  }

  // Abandons any control, leaving the keyboard where the platform wants it
  public fun cancel() {
    controller?.finish(controller?.currentInsets?.bottom ?: 0 > 0)
    controller = null
    cancellation?.cancel()
    cancellation = null
    requesting = false
  }

  private companion object {
    // Pixels per second past which the gesture is a flick rather than a placement
    const val FLING_VELOCITY = 1000f
  }
}
