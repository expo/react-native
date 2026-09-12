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
 * Drives the keyboard with a finger.
 *
 * iOS gives this away for the price of a flag: `keyboardDismissMode = .interactive` and
 * UIKit moves the keyboard with the drag. Android has no equivalent — the IME lives in
 * another window and nothing there responds to a touch in this one — so the same behaviour
 * has to be driven explicitly: ask for control of the IME's animation, then place it by hand
 * on every move event, then hand it back with a decision about where it should end up.
 *
 * The rule for when to take control is that the scroll has nowhere left to go. Pulling down
 * on a list that is already at its end is a gesture with no other meaning, which is what makes
 * it safe to borrow: nothing else was going to happen. Taking control on any downward drag
 * would fight scrolling for every gesture.
 */
public class KeyboardDragger(private val view: View) {

  private var controller: WindowInsetsAnimationControllerCompat? = null
  private var requesting = false
  private var cancellation: CancellationSignal? = null

  /** Where the finger was when control began, and how tall the IME was then. */
  private var anchorY = 0f
  private var anchorBottom = 0

  public val isControlling: Boolean
    get() = controller != null

  /**
   * Whether there is a keyboard to drag at all.
   *
   * Public because a caller has to know this BEFORE offering a drag: taking control of the IME's
   * animation is asynchronous, so [onDrag] returns false on the gesture that starts it, and a
   * caller that waits for a true answer before claiming the gesture never gets one — the events go
   * to whatever the finger is on and the controller arrives with nothing driving it.
   */
  public fun isKeyboardVisible(): Boolean =
      ViewCompat.getRootWindowInsets(view)?.isVisible(WindowInsetsCompat.Type.ime()) ?: false

  private fun imeVisible(): Boolean = isKeyboardVisible()

  private fun imeBottom(): Int =
      ViewCompat.getRootWindowInsets(view)?.getInsets(WindowInsetsCompat.Type.ime())?.bottom ?: 0

  /**
   * Offer a drag to the keyboard.
   *
   * Returns true once the keyboard has taken the gesture over, after which the caller should
   * stop treating it as a scroll.
   */
  public fun onDrag(y: Float, deltaY: Float, scrollCanConsume: Boolean): Boolean {
    val active = controller
    if (active != null) {
      // Downward drag shrinks the IME; the inset can never be negative or exceed the
      // keyboard's own height, and clamping here rather than trusting the gesture keeps a
      // fast flick from asking for a position that does not exist.
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
            })
    return false
  }

  /**
   * Let go, and decide where the keyboard should settle.
   *
   * A flick decides on its own, whichever way it is going; a slow drag is decided by how far
   * it got. Handing back `shown = false` past halfway is the same rule the platform uses for
   * its own dismissals, and it means a gesture that clearly meant to dismiss is not undone by
   * stopping short.
   */
  public fun onRelease(velocityY: Float) {
    val active = controller ?: run {
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

  /** Abandon any control, leaving the keyboard where the platform wants it. */
  public fun cancel() {
    controller?.finish(controller?.currentInsets?.bottom ?: 0 > 0)
    controller = null
    cancellation?.cancel()
    cancellation = null
    requesting = false
  }

  private companion object {
    /** Pixels per second past which the gesture is read as a flick rather than a placement. */
    const val FLING_VELOCITY = 1000f
  }
}
