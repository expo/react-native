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
import android.os.Build
import android.view.View
import com.facebook.react.bridge.ReactContext

/**
 * Puts a window into wide color gamut mode once it shows a color in a wide color space, and into
 * HDR mode once it shows an HDR picture.
 *
 * On iOS every view is color-matched to the screen, so a Display P3 color shows as P3 with
 * nothing asked. An Android window instead composes into one surface whose color mode the app
 * chooses: in the default mode the surface is sRGB and a wide color is clipped to sRGB even on a
 * wide-gamut screen. So the first wide color a window draws asks for
 * [ActivityInfo.COLOR_MODE_WIDE_COLOR_GAMUT], where the display supports it, and the window keeps
 * that mode for the activity's life rather than switching back and forth.
 */
internal object WideColorGamut {

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
