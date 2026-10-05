/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.uiapp

import android.graphics.Bitmap
import android.graphics.ColorSpace
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.uimanager.PixelUtil
import kotlin.math.roundToInt

/**
 * Reads the window's pixels at the given points as extended linear sRGB floats, so a test can tell
 * a Display P3 red (about 1.22, -0.04, -0.02) from an sRGB one; a PNG screenshot is 8-bit sRGB. It
 * copies the window's surface, so in the default color mode a wide color reads back clipped.
 */
internal class ScreenshotManager(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  @ReactMethod
  fun sample(points: ReadableArray, promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      promise.reject(
          "E_UNSUPPORTED",
          "Sampling needs Android 10 (API 29) for float bitmaps' colours; this device runs API " +
              "${Build.VERSION.SDK_INT}.",
      )
      return
    }
    val window = reactApplicationContext.currentActivity?.window
    if (window == null) {
      promise.reject("E_NO_WINDOW", "There is no activity window to sample.")
      return
    }
    val decor = window.decorView
    val bitmap =
        Bitmap.createBitmap(
            decor.width,
            decor.height,
            Bitmap.Config.RGBA_F16,
            true,
            ColorSpace.get(ColorSpace.Named.LINEAR_EXTENDED_SRGB),
        )
    PixelCopy.request(
        window,
        bitmap,
        { result ->
          if (result != PixelCopy.SUCCESS) {
            promise.reject("E_COPY", "PixelCopy failed with result $result.")
            return@request
          }
          val values = Arguments.createArray()
          for (index in 0 until points.size()) {
            val point = points.getArray(index)
            val x = point?.let { PixelUtil.toPixelFromDIP(it.getDouble(0)).roundToInt() } ?: -1
            val y = point?.let { PixelUtil.toPixelFromDIP(it.getDouble(1)).roundToInt() } ?: -1
            if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) {
              values.pushNull()
              continue
            }
            val color = bitmap.getColor(x, y)
            values.pushArray(
                Arguments.createArray().apply {
                  pushDouble(color.red().toDouble())
                  pushDouble(color.green().toDouble())
                  pushDouble(color.blue().toDouble())
                  pushDouble(color.alpha().toDouble())
                }
            )
          }
          bitmap.recycle()
          promise.resolve(
              Arguments.createMap().apply {
                putString("space", "srgb-linear")
                putArray("values", values)
              }
          )
        },
        Handler(Looper.getMainLooper()),
    )
  }

  companion object {
    const val NAME: String = "ScreenshotManager"
  }
}
