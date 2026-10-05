/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.uimanager

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.graphics.ColorSpace
import android.os.Build
import android.text.Spanned
import android.view.View
import androidx.annotation.ColorLong
import com.facebook.react.R
import com.facebook.react.bridge.ColorPropConverter
import com.facebook.react.bridge.ColorSpaceColors
import com.facebook.react.bridge.ReactContext
import com.facebook.react.views.text.internal.span.ReactForegroundColorSpan

/**
 * Asks a window for the color mode its content needs: wide color gamut for a color in a wide space,
 * HDR for one brighter than SDR white. A window composes into one surface in the mode the app
 * chooses, and in the default mode a wide color is clipped to sRGB even on a wide-gamut screen. A
 * mode, once asked for, is kept for the activity's life.
 */
internal object WideColorGamut {

  /**
   * Asks for the mode the color needs: HDR where the view's effective `dynamic-range-limit` allows
   * it, else wide gamut. The limit arrives in the view's state after its colors, and a window never
   * leaves a mode, so an HDR color asks for wide gamut only until the limit is here;
   * `requestDynamicRangeForColors` asks again then.
   */
  fun request(view: View, @ColorLong color: Long) {
    if (isHighDynamicRange(color) && allowsHighDynamicRange(limitOf(view))) {
      requestHighDynamicRange(view)
    } else {
      request(view)
    }
  }

  /** The same for every foreground span of a text, each under the limit its span carries */
  fun request(view: View, text: CharSequence) {
    if (text !is Spanned) {
      return
    }
    var any = false
    for (span in text.getSpans(0, text.length, ReactForegroundColorSpan::class.java)) {
      val color = span.colorLong ?: continue
      any = true
      if (isHighDynamicRange(color) && allowsHighDynamicRange(span.dynamicRangeLimit)) {
        requestHighDynamicRange(view)
        return
      }
    }
    if (any) {
      request(view)
    }
  }

  /**
   * Whether any channel exceeds 1 in linear Rec. 2020, the widest gamut an SDR display has: a P3
   * red, above 1 only in sRGB's terms, is not HDR
   */
  fun isHighDynamicRange(@ColorLong color: Long): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || ColorPropConverter.isIntegerColor(color)) {
      return false
    }
    val rec2020 = ColorSpaceColors.colorSpace("rec2100-linear") ?: return false
    // `Color.convert` takes only `ColorSpace.Named`; `connect` takes the space built here
    val linear =
        ColorSpace.connect(Color.colorSpace(color), rec2020)
            .transform(Color.red(color), Color.green(color), Color.blue(color))
    return linear[0] > HDR_THRESHOLD || linear[1] > HDR_THRESHOLD || linear[2] > HDR_THRESHOLD
  }

  // The mode is the window's, so `constrained` needs HDR as `no-limit` does; no limit yet means
  // wait for it. DOM-CSS-LIMITATION(android-dynamic-range-is-per-window)
  private fun allowsHighDynamicRange(limit: String?): Boolean =
      limit == "no-limit" || limit == "constrained"

  private fun limitOf(view: View): String? = view.getTag(R.id.dynamic_range_limit) as? String

  // A hair above 1, so rounding in a conversion doesn't make an SDR white HDR
  private const val HDR_THRESHOLD = 1.001f

  fun request(view: View) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val activity = findActivity(view.context) ?: return
    val window = activity.window ?: return
    if (window.colorMode != ActivityInfo.COLOR_MODE_DEFAULT) {
      // Already wide, or HDR, which is wide too
      return
    }
    // A view gets its colors before it is attached, so it may have no display yet
    @Suppress("DEPRECATION") val display = view.display ?: activity.windowManager.defaultDisplay
    if (display == null || !display.isWideColorGamut) {
      return
    }
    window.colorMode = ActivityInfo.COLOR_MODE_WIDE_COLOR_GAMUT
  }

  /** HDR mode includes wide gamut */
  fun requestHighDynamicRange(view: View) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      return
    }
    val activity = findActivity(view.context) ?: return
    val window = activity.window ?: return
    if (window.colorMode == ActivityInfo.COLOR_MODE_HDR) {
      return
    }
    @Suppress("DEPRECATION") val display = view.display ?: activity.windowManager.defaultDisplay
    if (display == null || !display.isHdr) {
      return
    }
    window.colorMode = ActivityInfo.COLOR_MODE_HDR
  }

  private fun findActivity(context: Context): Activity? {
    var current: Context? = context
    while (current != null) {
      if (current is Activity) {
        return current
      }
      if (current is ReactContext) {
        current.currentActivity?.let {
          return it
        }
      }
      current = (current as? ContextWrapper)?.baseContext
    }
    return null
  }
}
