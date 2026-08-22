/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import android.view.View
import android.view.View.MeasureSpec
import com.facebook.react.bridge.Arguments
import com.facebook.react.uimanager.StateWrapper

/**
 * Tells layout how big a mounted control wants to be — the Android half of
 * `EXPReportControlSize`, feeding the same `ElementControlSizeState`.
 *
 * The control is asked with an unconstrained measure, which is the platform's own intrinsic size:
 * its text, its padding and its theme's minimum touch size, none of which layout could re-derive.
 * The report goes out only when the answer changes, since every report is a state update and a
 * relayout.
 */
internal class ElementControlSizeReporter(private val view: View) {

  var stateWrapper: StateWrapper? = null
    set(value) {
      field = value
      // A new wrapper is a new shadow node, which starts without a report
      lastWidth = Float.NaN
      lastHeight = Float.NaN
      report()
    }

  private var lastWidth = Float.NaN
  private var lastHeight = Float.NaN

  fun report() {
    val wrapper = stateWrapper ?: return
    val (width, height) = measureIntrinsic(view)
    if (width == lastWidth && height == lastHeight) {
      return
    }
    lastWidth = width
    lastHeight = height
    wrapper.updateState(
        Arguments.createMap().apply {
          putDouble("width", width.toDouble())
          putDouble("height", height.toDouble())
        })
  }

  companion object {
    /**
     * The view's intrinsic size in density-independent pixels.
     *
     * The unconstrained measure overwrites the view's measured size, so the size React gave it is
     * measured back in afterwards; a view React has not laid out yet has nothing to restore.
     */
    fun measureIntrinsic(view: View): Pair<Float, Float> {
      val unspecified = MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
      view.measure(unspecified, unspecified)
      val density = view.resources.displayMetrics.density
      val size = Pair(view.measuredWidth / density, view.measuredHeight / density)
      if (view.width > 0 && view.height > 0) {
        view.measure(
            MeasureSpec.makeMeasureSpec(view.width, MeasureSpec.EXACTLY),
            MeasureSpec.makeMeasureSpec(view.height, MeasureSpec.EXACTLY),
        )
      }
      return size
    }
  }
}
