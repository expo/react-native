/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.uimanager

import android.graphics.Point
import android.graphics.Rect
import android.view.View
import androidx.annotation.UiThread
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.facebook.infer.annotation.Assertions
import com.facebook.react.views.view.isEdgeToEdgeFeatureFlagOn
import kotlin.math.max


public object RootViewUtil {
  /** Returns the root view of a given view in a react application. */
  @JvmStatic
  public fun getRootView(reactView: View): RootView? {
    var current = reactView
    while (true) {
      if (current is RootView) {
        return current
      }
      val next = current.parent ?: return null
      Assertions.assertCondition(next is View)
      current = next as View
    }
  }

  @UiThread
  @JvmStatic
  public fun getViewportOffset(v: View): Point {
    val locationInWindow = IntArray(2)
    v.getLocationInWindow(locationInWindow)

    if (!isEdgeToEdgeFeatureFlagOn) {
      // When not in edge-to-edge mode, subtract the top system bar insets so the offset is
      // relative to the content area (below the status bar / cutout).
      ViewCompat.getRootWindowInsets(v)?.apply {
        val insets =
            getInsets(
                WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.displayCutout()
            )

        locationInWindow[0] -= insets.left
        locationInWindow[1] -= insets.top
      }
    }

    return Point(locationInWindow[0], locationInWindow[1])
  }

  /**
   * How much of [v] the system's own furniture — status bar, navigation bar, cutout — is drawing
   * over, in pixels. This is the value `env(safe-area-inset-*)` resolves to.
   *
   * Measured as the OVERLAP of the view with each bar rather than as the window's insets. A root
   * already sitting below the status bar — which is every root when the app is not edge-to-edge —
   * needs nothing reserved at its top, and asking how far the view extends past each bar answers
   * that without the caller having to know which mode the app is in.
   *
   * [width] and [height] are passed rather than read off the view because the first caller is
   * `onMeasure`, where the view has a measured size but not yet a laid-out one.
   */
  @UiThread
  @JvmStatic
  @JvmOverloads
  public fun getSafeAreaInsets(v: View, width: Int = v.width, height: Int = v.height): Rect {
    val insets = ViewCompat.getRootWindowInsets(v) ?: return Rect()
    val root = v.rootView ?: return Rect()
    val bars =
        insets.getInsets(
            WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
        )
    val location = IntArray(2)
    v.getLocationInWindow(location)

    // The view's far edges, CLAMPED to the window. A surface can be measured taller than the
    // window it is in — that is exactly what a collapsing toolbar does to its scrolling child —
    // and without the clamp the overlap grows by however much it overhangs. Measured: a
    // navigation bar 63px tall was reported as 231, because the surface was 168px taller than
    // the window and every one of those pixels counted as "past the bar".
    val right = minOf(location[0] + width, root.width)
    val bottom = minOf(location[1] + height, root.height)

    return Rect(
        max(bars.left - location[0], 0),
        max(bars.top - location[1], 0),
        max(right - (root.width - bars.right), 0),
        max(bottom - (root.height - bars.bottom), 0),
    )
  }
}
