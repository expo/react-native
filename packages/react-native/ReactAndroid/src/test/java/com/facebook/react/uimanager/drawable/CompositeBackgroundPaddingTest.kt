/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.uimanager.drawable

import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.InsetDrawable
import android.view.View
import com.facebook.react.uimanager.BackgroundStyleApplicator
import com.facebook.react.uimanager.DisplayMetricsHolder
import com.facebook.react.uimanager.LengthPercentage
import com.facebook.react.uimanager.LengthPercentageType
import com.facebook.react.uimanager.style.BorderRadiusProp
import com.facebook.react.uimanager.style.LogicalEdge
import org.assertj.core.api.Assertions.assertThat
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/**
 * Tests that the padding React sets on a view stays when its fill, border or radius first arrives,
 * whatever padding the background the view already had carries (an EditText's theme insets).
 */
@RunWith(RobolectricTestRunner::class)
class CompositeBackgroundPaddingTest {

  @Before
  fun setUp() {
    DisplayMetricsHolder.initDisplayMetrics(RuntimeEnvironment.getApplication())
  }

  @Test
  fun aFillKeepsThePaddingReactSet() {
    val view = viewWithPaddedBackground()
    BackgroundStyleApplicator.setBackgroundColor(view, Color.WHITE)

    assertThat(paddingOf(view)).isEqualTo(Rect(0, 0, 0, 0))
  }

  @Test
  fun aBorderAndARadiusKeepThePaddingReactSet() {
    val view = viewWithPaddedBackground()
    view.setPadding(4, 2, 4, 2)
    BackgroundStyleApplicator.setBorderWidth(view, LogicalEdge.ALL, 1f)
    BackgroundStyleApplicator.setBorderColor(view, LogicalEdge.ALL, Color.GRAY)
    BackgroundStyleApplicator.setBorderRadius(
        view,
        BorderRadiusProp.BORDER_RADIUS,
        LengthPercentage(8f, LengthPercentageType.POINT),
    )

    assertThat(paddingOf(view)).isEqualTo(Rect(4, 2, 4, 2))
  }

  /** A view whose own background insets its content, its padding then set by React to none. */
  private fun viewWithPaddedBackground(): View {
    val view = View(RuntimeEnvironment.getApplication())
    view.background = InsetDrawable(ColorDrawable(Color.TRANSPARENT), 10, 26, 10, 29)
    assertThat(paddingOf(view)).isEqualTo(Rect(10, 26, 10, 29))
    view.setPadding(0, 0, 0, 0)
    return view
  }

  private fun paddingOf(view: View): Rect =
      Rect(view.paddingLeft, view.paddingTop, view.paddingRight, view.paddingBottom)
}
