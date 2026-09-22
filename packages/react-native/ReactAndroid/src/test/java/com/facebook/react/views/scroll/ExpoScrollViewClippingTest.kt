/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.scroll

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Rect
import android.view.View
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import com.facebook.react.uimanager.DisplayMetricsHolder
import org.assertj.core.api.Assertions.assertThat
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ExpoScrollViewClippingTest {
  @After
  fun tearDown() {
    DisplayMetricsHolder.setScreenDisplayMetrics(null)
  }

  @Test
  fun contentCannotPaintOverASiblingHeaderAfterScrolling() {
    ReactNativeFeatureFlagsForTests.setUp()
    val context = Robolectric.buildActivity(Activity::class.java).create().get()
    DisplayMetricsHolder.initDisplayMetrics(context)
    val view = ExpoScrollView(context)
    var visibleContent = Rect()
    var drewContent = false
    val content =
        object : View(context) {
          override fun onDraw(canvas: Canvas) {
            drewContent = true
            visibleContent = canvas.clipBounds
          }
        }
    view.addView(content)
    content.measure(
        View.MeasureSpec.makeMeasureSpec(200, View.MeasureSpec.EXACTLY),
        View.MeasureSpec.makeMeasureSpec(1000, View.MeasureSpec.EXACTLY),
    )
    view.layout(0, 0, 200, 300)
    content.layout(0, 0, 200, 1000)
    view.clipToPadding = false
    view.scrollTo(0, 500)
    val bitmap = Bitmap.createBitmap(200, 1000, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.translate(0f, -view.scrollY.toFloat())
    view.draw(canvas)

    assertThat(drewContent).isTrue()
    assertThat(visibleContent.top).isEqualTo(500)
    assertThat(visibleContent.bottom).isEqualTo(800)
  }
}
